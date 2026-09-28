import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { freshDb, type Db } from "../../../packages/db/test/db";
import { importScryfallBulk } from "../../../packages/catalog/src/provider";
import { createApp } from "../src/app";
import { linkClips } from "../src/clips";

// Item 8. Real printings (packages/catalog/test/fixtures/scryfall), imported into our database.
const F = (n: string) => new URL(`../../../packages/catalog/test/fixtures/scryfall/${n}`, import.meta.url).pathname;
let db: Db;
let app: ReturnType<typeof createApp>;
beforeAll(async () => {
  db = await freshDb();
  await importScryfallBulk(db.pool, { file: F("cards.json"), setsFile: F("sets.json") });
  app = createApp({ pool: db.pool, jwtSecret: "s", devLogin: false, testClock: false, clips: linkClips });
}, 120_000);
afterAll(async () => { await db.close(); });

// No Authorization header anywhere: search works for guests.
const get = async (path: string) => { const r = await app.request(path); return { status: r.status, body: await r.json() as any }; };

describe("search from our own database", () => {
  it("returns lightning bolt in under 300 ms with no call to Scryfall", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    await get("/cards/search?q=lightning%20bolt"); // warm the connection
    const t0 = performance.now();
    const r = await get("/cards/search?q=lightning%20bolt");
    const ms = performance.now() - t0;
    expect(ms).toBeLessThan(300);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
    expect(r.status).toBe(200);
    expect(r.body.cards.length).toBeGreaterThan(10);
    expect(r.body.cards.every((c: any) => c.name === "Lightning Bolt")).toBe(true);
    const c = r.body.cards[0];
    expect(c.image_url).toMatch(/^https:\/\/cards\.scryfall\.io\/normal\//);
    expect(c).toHaveProperty("set_icon");
    expect(c).toHaveProperty("price_asof");
    for (const k of ["image_uris", "scryfall_id"]) expect(c).not.toHaveProperty(k);
  });

  it("opens the exact printing for a set code plus collector number, letters and symbols included", async () => {
    const m10 = (await get("/cards/search?q=m10%20146")).body;
    expect(m10.exact).toMatchObject({ name: "Lightning Bolt", set_code: "M10", collector_number: "146", price_cents: 189, price_finish: "nonfoil" });
    const star = (await get(`/cards/search?q=${encodeURIComponent("SLD 1638★")}`)).body;
    // Foil only printing shows its foil price.
    expect(star.exact).toMatchObject({ collector_number: "1638★", price_cents: 432, price_finish: "foil" });
    expect((await get("/cards/search?q=sld%20IFIYW-2")).body.exact.collector_number).toBe("IFIYW-2");
  });

  it("filters by set, rarity, color, type, finish, price and format, and sorts", async () => {
    const q = (s: string) => get(`/cards/search?${s}`).then((r) => r.body.cards as any[]);
    const fdnMythics = await q("set=fdn&rarity=mythic&limit=100");
    expect(fdnMythics.length).toBeGreaterThan(5);
    expect(fdnMythics.every((c) => c.set_code === "FDN" && c.rarity === "mythic")).toBe(true);
    const foilOnly = await q("q=lightning%20bolt&finish=etched");
    expect(foilOnly.every((c) => c.finishes.includes("etched"))).toBe(true);
    const red = await q("set=fdn&color=R&type=creature&limit=100");
    expect(red.length).toBeGreaterThan(3);
    expect(red.every((c) => /creature/i.test(c.type_line))).toBe(true);
    const cheap = await q("q=lightning%20bolt&max=200");
    expect(cheap.every((c) => c.price_cents <= 200)).toBe(true);
    const byPrice = await q("q=lightning%20bolt&sort=price");
    const prices = byPrice.map((c) => c.price_cents).filter((p) => p != null);
    expect(prices).toEqual([...prices].sort((a, b) => b - a));
    const byName = await q("set=fdn&sort=name&limit=20");
    const folded = byName.map((c) => c.name.toLowerCase());
    expect(folded).toEqual([...folded].sort());
    const legal = await q("set=fdn&format=standard&limit=5");
    expect(legal.length).toBe(5);
    expect((await get("/cards/search?format=nope")).status).toBe(400);
  });

  it("shows every printing on the detail sheet with legalities and dated prices", async () => {
    const m10 = (await get("/cards/search?q=m10%20146")).body.exact;
    const d = (await get(`/cards/${m10.id}`)).body;
    expect(d.card).toMatchObject({ name: "Lightning Bolt", legalities: { modern: "legal" } });
    expect(d.card.prices.foil.cents).toBe(1269);
    expect(d.printings.length).toBeGreaterThan(15);
    expect(d.printings.some((p: any) => p.set_code === "2X2")).toBe(true);
  });
});
