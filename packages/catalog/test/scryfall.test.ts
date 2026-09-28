import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { freshDb, type Db } from "../../db/test/db";
import { importScryfallBulk, scryfallProvider } from "../src/provider";
import { HEADERS, limiter, mapScryfallCard, type ScryfallCard } from "../src/scryfall";
import { readFileSync } from "node:fs";

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

  it("re-importing keeps internal ids stable", async () => {
    const before = await db.one("select id from cards where set_code = 'M10' and collector_number = '146'");
    await importScryfallBulk(db.pool, { file: F("cards.json"), setsFile: F("sets.json") });
    expect(await db.one("select id from cards where set_code = 'M10' and collector_number = '146'")).toEqual(before);
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
