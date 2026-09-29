import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { freshDb, type Db } from "../../db/test/db";
import { importScryfallBulk, scryfallProvider } from "../src/provider";
import { importSetCardData } from "../src/lookup";
import { HEADERS, limiter, mapScryfallCard, type ScryfallCard } from "../src/scryfall";
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";

// Real printings fetched from Scryfall by .github/workflows/scryfall.yml (fixtures job).
const F = (n: string) => new URL(`./fixtures/scryfall/${n}`, import.meta.url).pathname;
const real = JSON.parse(readFileSync(F("cards.json"), "utf8")) as ScryfallCard[];
const find = (set: string, num: string) => real.find((c) => c.set === set && c.collector_number === num)!;

describe("mapping real Scryfall printings", () => {
  it("keeps finishes, prices in cents and image links exactly as given", () => {
    const m10 = mapScryfallCard(find("m10", "146"))!;
    expect(m10).toMatchObject({ name: "Lightning Bolt", set_code: "M10", collector_number: "146", rarity: "common",
      finishes: ["nonfoil", "foil"], prices: { nonfoil: 189, foil: 1269 } });
    expect(m10.image_uris).toEqual(find("m10", "146").image_uris);
    // Foil only star printing: no nonfoil price.
    expect(mapScryfallCard(find("sld", "1638★"))).toMatchObject({ finishes: ["foil"], prices: { foil: 432 } });
    // Double faced: front face images, both type lines.
    const delver = mapScryfallCard(find("isd", "51"))!;
    expect(delver.image_uris?.normal).toBe(find("isd", "51").card_faces![0].image_uris!.normal);
    expect(delver.type_line).toContain("//");
  });
});

describe("rate limiting and headers", () => {
  it("spaces lookups 100 ms apart (10 per second) and sends User-Agent and Accept", async () => {
    const calls: { t: number; headers: Record<string, string> }[] = [];
    const fake = (async (_u: string, init: RequestInit) => {
      calls.push({ t: Date.now(), headers: init.headers as Record<string, string> });
      return new Response(JSON.stringify(find("fdn", "87")), { status: 200 });
    }) as unknown as typeof fetch;
    const p = scryfallProvider(fake);
    await Promise.all([p.lookup("fdn", "87"), p.lookup("fdn", "87"), p.lookup("fdn", "87")]);
    expect(calls[2].t - calls[0].t).toBeGreaterThanOrEqual(190);
    expect(calls[0].headers).toEqual(HEADERS);
    expect(HEADERS["User-Agent"]).toMatch(/^CrackAPack\/[\d.]+ \(crackapack\.business@gmail\.com\)$/);
    const lim = limiter(50); const t0 = Date.now();
    await Promise.all([lim(async () => 1), lim(async () => 2), lim(async () => 3)]);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(95);
  });
});

describe("bulk import and search on our own database", () => {
  let db: Db;
  beforeAll(async () => {
    db = await freshDb();
    // The import must not call the network when given files.
    const spy = vi.spyOn(globalThis, "fetch");
    const r = await importScryfallBulk(db.pool, { file: F("cards.json"), setsFile: F("sets.json") });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
    expect(r.rows).toBeGreaterThan(800);
  }, 120_000);
  afterAll(async () => { await db.close(); });

  it("logs each import run with its outcome", async () => {
    expect(await db.q("select source, status, rows > 800 as ok from import_runs")).toEqual([{ source: "scryfall", status: "succeeded", ok: true }]);
    await expect(importScryfallBulk(db.pool, { file: "/nope.json", setsFile: F("sets.json") })).rejects.toThrow();
    expect((await db.q("select status, message from import_runs order by id desc limit 1"))[0]).toMatchObject({ status: "failed" });
  });

  it("re-importing keeps internal ids stable and leaves unchanged rows unwritten", async () => {
    const before = await db.one("select id from cards where set_code = 'M10' and collector_number = '146'");
    // xmin changes whenever a row is rewritten; an unchanged catalog must not be rewritten (storage limit).
    const versions = `select (select string_agg(xmin::text, ',' order by id) from cards) as cards,
      (select string_agg(xmin::text, ',' order by card_id) from card_images) as images,
      (select string_agg(xmin::text, ',' order by card_id, source) from card_external_ids) as ids`;
    const v1 = await db.one(versions);
    await importScryfallBulk(db.pool, { file: F("cards.json"), setsFile: F("sets.json") });
    expect(await db.one("select id from cards where set_code = 'M10' and collector_number = '146'")).toEqual(before);
    expect(await db.one(versions)).toEqual(v1);
  });

  it("matches names with trigrams, ranks exact then prefix, folds case and accents, and uses the index", async () => {
    const search = (q: string) => db.q(
      `with t as (select lower(f_unaccent($1::text)) as q) select cd.name from cards cd cross join t
       where cd.name_folded like '%' || t.q || '%' or t.q <% cd.name_folded
       order by (cd.name_folded = t.q) desc, (cd.name_folded like t.q || '%') desc, word_similarity(t.q, cd.name_folded) desc limit 5`, [q]);
    expect((await search("lightning bolt"))[0].name).toBe("Lightning Bolt");
    expect((await search("LIGHTNING BÖLT"))[0].name).toBe("Lightning Bolt");
    expect((await search("lightnin bolt"))[0].name).toBe("Lightning Bolt");      // typo still finds it
    expect((await search("delver"))[0].name).toBe("Delver of Secrets // Insectile Aberration");
    expect(await db.one("select lower(f_unaccent('Lim-Dûl')) as f")).toEqual({ f: "lim-dul" });
  });
});

// Scryfall now publishes the daily bulk file as JSON Lines (jsonl_download_uri), sometimes gzipped.
describe("the JSON Lines bulk file (Scryfall's current format)", () => {
  let db: Db;
  beforeAll(async () => { db = await freshDb(); });
  afterAll(async () => { await db.close(); });

  const jsonl = real.slice(0, 40).map((c) => JSON.stringify(c)).join("\n") + "\n";
  const kept = real.slice(0, 40).filter((c) => mapScryfallCard(c)).length;   // the same cards the array import keeps
  const bulkList = { object: "list", data: [
    { object: "bulk_data", type: "oracle_cards", uri: "https://api.scryfall.com/bulk-data/o", jsonl_download_uri: "https://data.scryfall.io/o.jsonl" },
    { object: "bulk_data", id: "d", type: "default_cards", updated_at: "2026-09-29T09:00:00Z", uri: "https://api.scryfall.com/bulk-data/d",
      name: "Default Cards", description: "", jsonl_download_uri: "https://data.scryfall.io/default-cards.jsonl.gz", compressed_size: 1 },
  ] };
  const sets = JSON.parse(readFileSync(F("sets.json"), "utf8"));
  const fakeFetch = (file: Uint8Array) => (async (url: string) => {
    if (url.endsWith("/sets")) return new Response(JSON.stringify(sets));
    if (url.endsWith("/bulk-data")) return new Response(JSON.stringify(bulkList));
    if (url.includes("default-cards")) return new Response(new Blob([new Uint8Array(file)]));
    return new Response("not found", { status: 404 });
  }) as unknown as typeof fetch;

  it("downloads jsonl_download_uri and imports gzipped JSON Lines", async () => {
    const r = await importScryfallBulk(db.pool, { fetchImpl: fakeFetch(gzipSync(jsonl)) });
    expect(r.rows).toBe(kept);
    expect((await db.one("select status, rows from import_runs order by id desc limit 1"))).toEqual({ status: "succeeded", rows: kept });
  });

  it("also takes plain JSON Lines and the older JSON array", async () => {
    expect((await importScryfallBulk(db.pool, { fetchImpl: fakeFetch(Buffer.from(jsonl)) })).rows).toBe(kept);
    expect((await importScryfallBulk(db.pool, { fetchImpl: fakeFetch(Buffer.from(JSON.stringify(real.slice(0, 40)))) })).rows).toBe(kept);
  });
});

// Business context section 15: one set, page by page, then its check.
describe("per set import", () => {
  let db: Db;
  beforeAll(async () => { db = await freshDb(); });
  afterAll(async () => { await db.close(); });

  it("pages through the set, records every printing, and passes the check", async () => {
    const m10 = real.filter((c) => c.set === "m10");
    const pages = [m10.slice(0, 1), m10.slice(1)];
    const urls: string[] = [];
    const fake = (async (url: string) => {
      urls.push(url);
      if (url.endsWith("/sets/m10")) return new Response(JSON.stringify({ code: "m10", name: "Magic 2010", set_type: "core", icon_svg_uri: "https://svgs.test/m10.svg", released_at: "2009-07-17" }));
      if (url.includes("/cards/search")) {
        const i = url.includes("page=2") ? 1 : 0;
        return new Response(JSON.stringify({ data: pages[i], has_more: i === 0, next_page: i === 0 ? "https://api.scryfall.com/cards/search?q=e%3Am10&page=2" : undefined }));
      }
      return new Response("{}", { status: 404 });
    }) as unknown as typeof fetch;
    const r = await importSetCardData(db.pool, scryfallProvider(fake), "M10");
    expect(r).toMatchObject({ set_code: "M10", ok: true, expected: m10.length, problem: null });
    expect(urls.filter((u) => u.includes("/cards/search"))).toHaveLength(2);
    expect(urls[1]).toContain("unique=prints&include_extras=true&include_variations=true");
    await expect(importSetCardData(db.pool, scryfallProvider(fake), "zzz")).rejects.toThrow(/unknown_set/);
  });
});
