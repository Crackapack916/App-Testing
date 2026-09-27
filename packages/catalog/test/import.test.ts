import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { freshDb, type Db } from "../../db/test/db";
import { Importer, } from "../src/importer";
import { mapPrices, mapSet, type MtgjsonSet } from "../src/mtgjson";
import { allPrices, allPrintings, readSetFile } from "../src/sources";

const F = (name: string) => new URL(`./fixtures/${name}`, import.meta.url).pathname;
const tst = JSON.parse(readFileSync(F("TST.json"), "utf8")).data as MtgjsonSet;

describe("mapping", () => {
  it("keeps paper printings, imports double faced cards once, and normalizes fields", () => {
    const m = mapSet(tst)!;
    expect(m.set).toEqual({ code: "TST", name: "Test Set", release_date: "2026-08-01" });
    expect(m.cards.map((c) => c.collector_number)).toEqual(["1", "2", "3", "4z", "5", "8"]);
    const by = Object.fromEntries(m.cards.map((c) => [c.collector_number, c]));
    expect(by["3"]).toMatchObject({ mtgjson_uuid: "u-dfc-a", name: "Delver of Secrets // Insectile Aberration" });
    expect(by["4z"]).toMatchObject({ is_serialized: true, finishes: ["foil"] });
    expect(by["5"].finishes).toEqual(["nonfoil", "etched"]);
    expect(by["8"].rarity).toBe("special");
    expect(by["1"]).toMatchObject({ scryfall_id: "sf-bolt", tcgplayer_id: "1001", oracle_text: "Lightning Bolt deals 3 damage to any target." });
    expect(by["2"]).toMatchObject({ tcgplayer_id: "1002", legalities: { commander: "Legal", legacy: "Banned" } });
  });

  it("skips digital only sets", () => {
    expect(mapSet({ code: "YTS", name: "A", isOnlineOnly: true, cards: tst.cards })).toBeNull();
  });

  it("takes the newest USD retail price, TCGplayer first, then Card Kingdom", () => {
    expect(mapPrices("u", { paper: { tcgplayer: { currency: "USD", retail: { normal: { "2026-09-25": 1.1, "2026-09-27": 1.25 } } } } }))
      .toEqual([{ mtgjson_uuid: "u", finish: "nonfoil", market_cents: 125, as_of: "2026-09-27", price_source: "mtgjson:tcgplayer" }]);
    expect(mapPrices("u", { paper: { cardkingdom: { currency: "USD", retail: { normal: { "2026-09-27": 24.99 } } } } })[0])
      .toMatchObject({ market_cents: 2499, price_source: "mtgjson:cardkingdom" });
    expect(mapPrices("u", { paper: { tcgplayer: { currency: "USD", buylist: { normal: { "2026-09-27": 0.5 } } } } })).toEqual([]);
    expect(mapPrices("u", { paper: { cardmarket: { currency: "EUR", retail: { normal: { "2026-09-27": 1 } } } } } as any)).toEqual([]);
  });
});

describe("import into the database", () => {
  let db: Db;
  beforeEach(async () => { db = await freshDb(); });
  afterEach(async () => { await db.close(); });

  async function run(printings = F("AllPrintings.json.gz"), prices = F("AllPricesToday.json.gz")) {
    const imp = new Importer(db.pool);
    for await (const s of allPrintings(printings)) await imp.addSet(s);
    await imp.flushCards();
    for await (const { key, value } of allPrices(prices)) await imp.addPrices(key, value);
    return imp.finish();
  }
  const card = (num: string) => db.one("select * from cards where set_code = 'TST' and collector_number = $1", [num]);

  it("streams AllPrintings and AllPricesToday into cards, ids and prices", async () => {
    expect(await run()).toEqual({ sets: 1, cards: 6, prices: 5, skippedSets: 1 });
    const bolt = await card("1");
    expect(bolt).toMatchObject({ name: "Lightning Bolt", rarity: "common", type_line: "Instant", mana_cost: "{R}" });
    const ids = await db.q("select source, external_id from card_external_ids where card_id = $1 order by source", [bolt.id]);
    expect(ids).toEqual([
      { source: "mtgjson", external_id: "u-bolt" }, { source: "scryfall", external_id: "sf-bolt" }, { source: "tcgplayer", external_id: "1001" },
    ]);
    const prices = await db.q(
      `select c.collector_number, p.finish, p.market_cents::int, p.price_source from card_prices_current p join cards c on c.id = p.card_id
       order by c.collector_number, p.finish`);
    expect(prices).toEqual([
      { collector_number: "1", finish: "foil", market_cents: 450, price_source: "mtgjson:tcgplayer" },
      { collector_number: "1", finish: "nonfoil", market_cents: 125, price_source: "mtgjson:tcgplayer" },
      { collector_number: "2", finish: "nonfoil", market_cents: 2499, price_source: "mtgjson:cardkingdom" },
      { collector_number: "5", finish: "etched", market_cents: 1234, price_source: "mtgjson:tcgplayer" },
      { collector_number: "5", finish: "nonfoil", market_cents: 200, price_source: "mtgjson:tcgplayer" },
    ]);
    expect(await db.q("select 1 from mtg_sets where code = 'YTS'")).toEqual([]);
  });

  it("is idempotent and never changes an existing card's id", async () => {
    // A card that already exists (and could already be in someone's vault) before the first import.
    await db.q("insert into mtg_sets (code, name) values ('TST', 'placeholder')");
    const [{ id: before }] = await db.q("insert into cards (name, set_code, collector_number, rarity) values ('Old name', 'TST', '1', 'common') returning id");
    await run();
    await run();
    expect((await card("1")).id).toBe(before);
    expect((await card("1")).name).toBe("Lightning Bolt");
    expect(Number((await db.one("select count(*) from cards")).count)).toBe(6);
    expect(Number((await db.one("select count(*) from card_external_ids")).count)).toBe(6 + 2 + 2);
  });

  it("never lets an older price replace a newer one, but keeps it as history for sets we sell", async () => {
    await run();
    await db.q("insert into products (set_code, booster_type, name) values ('TST', 'play', 'TST Play Booster')");
    await run();
    const imp = new Importer(db.pool);
    for await (const { key, value } of allPrices(F("AllPricesOlder.json"))) await imp.addPrices(key, value);
    expect((await imp.finish()).prices).toBe(0);
    const bolt = await card("1");
    expect((await db.one("select market_cents::int from card_prices_current where card_id = $1 and finish = 'nonfoil'", [bolt.id])).market_cents).toBe(125);
    const hist = await db.q("select as_of::text, market_cents::int from price_snapshots where card_id = $1 and finish = 'nonfoil' order by as_of", [bolt.id]);
    expect(hist).toEqual([{ as_of: "2026-09-20", market_cents: 75 }, { as_of: "2026-09-27", market_cents: 125 }]);
  });

  it("skips price history for cards nobody sells or holds", async () => {
    await run();
    expect(Number((await db.one("select count(*) from price_snapshots")).count)).toBe(0);
    expect(Number((await db.one("select count(*) from card_prices_current")).count)).toBe(5);
  });

  it("reads a single set file", async () => {
    const imp = new Importer(db.pool);
    await imp.addSet(await readSetFile(F("TST.json")));
    expect((await imp.finish()).cards).toBe(6);
  });

  it("runs from the command line and fails loudly when nothing matches", () => {
    const cli = (...args: string[]) => spawnSync("npx", ["tsx", "src/cli.ts", ...args], {
      cwd: new URL("..", import.meta.url).pathname, env: { ...process.env, DATABASE_URL: db.url }, encoding: "utf8",
    });
    const ok = cli("--printings", F("AllPrintings.json.gz"), "--prices", F("AllPricesToday.json.gz"));
    expect(ok.status).toBe(0);
    expect(JSON.parse(ok.stdout.trim().split("\n").at(-1)!)).toMatchObject({ sets: 1, cards: 6, prices: 5 });
    const bad = cli("--prices", F("AllPricesOlder.json"));
    expect(bad.status).not.toBe(0);
    expect(bad.stderr).toMatch(/no prices applied/);
  });
});
