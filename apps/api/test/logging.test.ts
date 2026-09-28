import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { freshDb, type Db } from "../../../packages/db/test/db";
import { makeProduct } from "../../../packages/db/test/fixtures";
import { importScryfallBulk, scryfallProvider } from "../../../packages/catalog/src/provider";
import { createApp } from "../src/app";
import { linkClips } from "../src/clips";

// Item 12, on real printings (Scryfall fixtures): FDN 87 Goblin Boarders (nonfoil, foil),
// FDN 400 Preposterous Proportions (foil only), SLD 1638★ Lightning Bolt (foil only, not imported).
const FIX = new URL("../../../packages/catalog/test/fixtures/scryfall/", import.meta.url).pathname;
const all = JSON.parse(readFileSync(join(FIX, "cards.json"), "utf8")) as { set: string; collector_number: string }[];
const tmp = mkdtempSync(join(tmpdir(), "log-"));
writeFileSync(join(tmp, "fdn.json"), JSON.stringify(all.filter((c) => c.set === "fdn")));
const star = all.find((c) => c.set === "sld" && c.collector_number === "1638★");

let db: Db;
let app: ReturnType<typeof createApp>;
let scryfallCalls: { url: string; headers: Record<string, string> }[];
beforeEach(async () => {
  db = await freshDb();
  await importScryfallBulk(db.pool, { file: join(tmp, "fdn.json"), setsFile: join(FIX, "sets.json") });
  scryfallCalls = [];
  const fakeScryfall = (async (url: string, init: RequestInit) => {
    scryfallCalls.push({ url, headers: init.headers as Record<string, string> });
    return url.endsWith("/cards/sld/1638%E2%98%85") ? Response.json(star) : new Response("{}", { status: 404 });
  }) as unknown as typeof fetch;
  app = createApp({ pool: db.pool, jwtSecret: "s", devLogin: true, devStaffEmails: ["ops@x.test"],
    testClock: true, clips: linkClips, cardData: scryfallProvider(fakeScryfall) });
}, 120_000);
afterEach(async () => { await db.close(); });

const call = async (method: string, path: string, token?: string, body?: unknown, at?: string) => {
  const r = await app.request(path, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...(at ? { "x-test-now": at } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json() as any };
};
const login = async (email: string, role?: string) => (await call("POST", "/dev/login", undefined, { email, role, verified: true })).body;

async function openOnePack() {
  const product = await makeProduct(db, { setCode: "FDN" });
  const staff = await login("ops@x.test", "staff");
  const cust = await login("c@x.test");
  await db.q("select purchase_credits($1, 5000, 'seed')", [cust.user_id]);
  await call("POST", "/orders", cust.token, { product_id: product, quantity: 1 }, "2026-10-01T12:00:00-07:00");
  const { batch } = (await call("GET", "/staff/tonight", staff.token, undefined, "2026-10-01T19:01:00-07:00")).body;
  await call("POST", `/staff/batches/${batch.id}/lock`, staff.token, undefined, "2026-10-01T19:01:00-07:00");
  // Before opening: the queue is there, nothing to log.
  let q = (await call("GET", `/staff/batches/${batch.id}/log-queue`, staff.token)).body.queue;
  expect(q).toMatchObject([{ position: 1, set_code: "FDN", pack_id: null }]);
  const { session_id } = (await call("POST", `/staff/batches/${batch.id}/sessions`, staff.token, {}, "2026-10-01T19:10:00-07:00")).body;
  const st = (await call("GET", `/staff/sessions/${session_id}`, staff.token)).body;
  await call("POST", `/staff/sessions/${session_id}/boxes/${st.next.sealed_boxes[0].id}/open`, staff.token, undefined, "2026-10-01T19:11:00-07:00");
  await call("POST", `/staff/sessions/${session_id}/next`, staff.token, undefined, "2026-10-01T19:12:00-07:00");
  q = (await call("GET", `/staff/batches/${batch.id}/log-queue`, staff.token)).body.queue;
  return { staff, cust, pack: q[0].pack_id as string };
}

describe("logging by collector number", () => {
  it("resolves a printing from our table with finishes, image and price, without calling Scryfall", async () => {
    const staff = await login("ops@x.test", "staff");
    const r = await call("GET", "/staff/cards/lookup?set=fdn&num=87", staff.token);
    expect(r.body).toMatchObject({ source: "local", card: { name: "Goblin Boarders", set_code: "FDN", collector_number: "87", finishes: ["nonfoil", "foil"] } });
    expect(r.body.card.image_url).toMatch(/^https:\/\/cards\.scryfall\.io\/normal\//);
    expect(Object.keys(r.body.card.prices).sort()).toEqual(["foil", "nonfoil"]);
    expect(scryfallCalls).toEqual([]);
  });

  it("falls back to Scryfall for a printing we don't have (other set, star number), then caches it", async () => {
    const staff = await login("ops@x.test", "staff");
    const r = await call("GET", `/staff/cards/lookup?set=sld&num=${encodeURIComponent("1638★")}`, staff.token);
    expect(r.body).toMatchObject({ source: "scryfall", card: { name: "Lightning Bolt", collector_number: "1638★", finishes: ["foil"] } });
    expect(scryfallCalls).toHaveLength(1);
    expect(scryfallCalls[0].headers["User-Agent"]).toMatch(/^CrackAPack/);
    const again = await call("GET", `/staff/cards/lookup?set=SLD&num=${encodeURIComponent("1638★")}`, staff.token);
    expect(again.body.source).toBe("local");
    expect(scryfallCalls).toHaveLength(1);
    expect((await call("GET", "/staff/cards/lookup?set=fdn&num=99999", staff.token)).status).toBe(404);
  });

  it("logs a pack from the locked queue, refuses a finish the printing lacks, checks the count, and locks on approval", async () => {
    await db.q("update mtg_sets set slot_count = 3 where code = 'FDN'");
    const { staff, cust, pack } = await openOnePack();
    const id = async (num: string) => (await call("GET", `/staff/cards/lookup?set=fdn&num=${num}`, staff.token)).body.card.id;
    const [goblin, foilOnly] = [await id("87"), await id("400")];
    const put = (slot: number, body: unknown) => call("PUT", `/staff/packs/${pack}/cards/${slot}`, staff.token, body);
    expect((await put(1, { card_id: foilOnly, finish: "nonfoil" })).body.error).toBe("finish_not_available");
    await put(1, { card_id: foilOnly, finish: "foil" });
    await put(2, { card_id: goblin, finish: "nonfoil" });
    await put(3, { kind: "token" });
    const view = (await call("GET", `/staff/packs/${pack}`, staff.token)).body;
    expect(view.cards.map((c: any) => [c.slot, c.kind, c.name ?? null])).toEqual([[1, "card", "Preposterous Proportions"], [2, "card", "Goblin Boarders"], [3, "token", null]]);
    expect(view.pack).toMatchObject({ position: 1, set_code: "FDN", slot_count: 3, pack_index: 1, order_packs: 1 });
    // 2 cards against 3 expected: needs a written reason.
    expect((await call("POST", `/staff/packs/${pack}/finalize`, staff.token, {})).body.error).toBe("card_count_mismatch");
    expect((await call("POST", `/staff/packs/${pack}/finalize`, staff.token, { count_override_reason: "Token counted as a card slot for this set" })).status).toBe(200);
    expect((await put(2, { card_id: foilOnly, finish: "foil" })).body.error).toBe("pack_contents_finalized");
    // After approval: a reason and the vault moves.
    expect((await call("POST", `/staff/packs/${pack}/amend`, staff.token, { slot: 2, card_id: goblin, finish: "foil", reason: "" })).body.error).toBe("reason_required");
    await call("POST", `/staff/packs/${pack}/amend`, staff.token, { slot: 2, card_id: goblin, finish: "foil", reason: "Video shows the foil" });
    const vault = (await call("GET", "/me/vault", cust.token)).body.cards;
    expect(vault.map((c: any) => [c.name, c.finish]).sort()).toEqual([["Goblin Boarders", "foil"], ["Preposterous Proportions", "foil"]]);
    const hist = (await call("GET", `/staff/packs/${pack}`, staff.token)).body.history;
    expect(hist.map((h: any) => h.action)).toEqual(["amended", "approved", "logged", "logged", "logged"]);
    expect(hist[0]).toMatchObject({ reason: "Video shows the foil", actor: "ops@x.test", card: "Goblin Boarders", num: "87" });
  });
});
