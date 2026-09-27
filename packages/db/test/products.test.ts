import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { freshDb, type Db } from "./db";

let db: Db;
beforeEach(async () => {
  db = await freshDb();
  await db.q("insert into mtg_sets (code, name) values ('FDN', 'Foundations')");
});
afterEach(async () => { await db.close(); });

const ladder = (...t: [number, number][]) => JSON.stringify(t.map(([min_qty, per_pack_credits]) => ({ min_qty, per_pack_credits })));

describe("putting a set on sale", () => {
  it("creates an inactive product with the launch ladder and empty stock", async () => {
    const { id } = await db.one("select create_product('fdn', 'play', null, null, null) as id");
    const p = await db.one("select * from products where id = $1", [id]);
    expect(p).toMatchObject({ set_code: "FDN", name: "Foundations Play Booster", active: false });
    const tiers = await db.q("select min_qty, per_pack_credits::int from price_tiers where product_id = $1 order by min_qty", [id]);
    expect(tiers.map((t) => [t.min_qty, t.per_pack_credits])).toEqual([[1, 900], [3, 850], [6, 825], [9, 800], [12, 775]]);
    expect(await db.one("select packs_on_hand, packs_reserved from product_stock where product_id = $1", [id])).toEqual({ packs_on_hand: 0, packs_reserved: 0 });
    await db.q("select set_product_active($1, true, null)", [id]);
    expect((await db.one("select available from storefront where product_id = $1", [id])).available).toBe(false); // no stock yet
  });

  it("rejects unknown sets and malformed ladders", async () => {
    await expect(db.q("select create_product('ZZZ', 'play', null, null, null)")).rejects.toThrow(/unknown_set/);
    const { id } = await db.one("select create_product('FDN', 'play', null, null, null) as id");
    await expect(db.q("select set_price_ladder($1, '[]')", [id])).rejects.toThrow(/ladder_empty/);
    await expect(db.q("select set_price_ladder($1, $2)", [id, ladder([3, 850])])).rejects.toThrow(/ladder_must_start_at_one/);
    await expect(db.q("select set_price_ladder($1, $2)", [id, ladder([1, 900], [3, 950])])).rejects.toThrow(/ladder_not_decreasing/);
    await expect(db.q("select set_price_ladder($1, $2)", [id, ladder([1, 0])])).rejects.toThrow(/ladder_price_invalid/);
    await db.q("select set_price_ladder($1, $2)", [id, ladder([1, 1000], [6, 950])]);
    expect(Number((await db.one("select count(*) from price_tiers where product_id = $1", [id])).count)).toBe(2);
  });
});
