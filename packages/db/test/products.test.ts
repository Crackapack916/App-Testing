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
    expect(tiers.map((t) => [t.min_qty, t.per_pack_credits])).toEqual([[1, 1000], [3, 950], [6, 900]]);
    expect(await db.one("select packs_on_hand, packs_reserved from product_stock where product_id = $1", [id])).toEqual({ packs_on_hand: 0, packs_reserved: 0 });
    // Section 15: no sale until the set's card data passes its check.
    await expect(db.q("select set_product_active($1, true, null)", [id])).rejects.toThrow(/card_data_unverified/);
    await db.q("update mtg_sets set card_data_ok = true where code = 'FDN'");
    // A real pack photo is required too, and can't be removed while the set is on sale.
    await expect(db.q("select set_product_active($1, true, null)", [id])).rejects.toThrow(/pack_photo_required/);
    await db.q("select set_set_info('FDN', null, '/packs/fdn.jpg')");
    await db.q("select set_product_active($1, true, null)", [id]);
    await expect(db.q("select set_set_info('FDN', null, '')")).rejects.toThrow(/pack_photo_required/);
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

describe("push tokens", () => {
  it("registers, reassigns and rejects malformed tokens", async () => {
    const [a] = await db.q("insert into users (email) values ('a@x.test') returning id");
    const [b] = await db.q("insert into users (email) values ('b@x.test') returning id");
    await db.q("select register_push_token($1, 'ExponentPushToken[abc]', 'ios')", [a.id]);
    await db.q("select register_push_token($1, 'ExponentPushToken[abc]', 'ios')", [b.id]);
    expect((await db.one("select user_id from push_tokens")).user_id).toBe(b.id);
    await expect(db.q("select register_push_token($1, 'not-a-token', 'ios')", [a.id])).rejects.toThrow(/invalid_push_token/);
    await db.q("select remove_push_token('ExponentPushToken[abc]')");
    expect(await db.q("select * from push_tokens")).toEqual([]);
  });
});
