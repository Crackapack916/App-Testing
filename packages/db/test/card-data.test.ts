import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { atTime, freshDb, type Db } from "./db";
import { makeCard, makeProduct, makeUser } from "./fixtures";

// Business context section 15: every set on sale has checked card data, independent of the daily import.
let db: Db;
beforeEach(async () => { db = await freshDb(); });
afterEach(async () => { await db.close(); });

const image = (id: string) => db.q(`insert into card_images (card_id, source, uris) values ($1, 'scryfall', '{"normal":"https://cards.scryfall.io/n.jpg"}')`, [id]);

describe("set card data check", () => {
  it("passes only when every printing from the per set import is present with an image", async () => {
    await db.q("insert into mtg_sets (code, name) values ('NEW', 'New Set')");
    expect((await db.one("select verify_set_card_data('NEW') as r")).r).toMatchObject({ ok: false, problem: "No per set import yet" });
    await db.q("select record_set_printings('new', array['1', '2', '3a'])");
    const [a, b] = [await makeCard(db, { set: "NEW", num: "1" }), await makeCard(db, { set: "NEW", num: "2" })];
    await image(a);
    let r = (await db.one("select verify_set_card_data('NEW') as r")).r;
    expect(r).toMatchObject({ ok: false, expected: 3, missing: ["3a"], missing_images: ["2"], problem: "1 printings missing; 1 printings without an image" });
    await image(b);
    await image(await makeCard(db, { set: "NEW", num: "3A" }));    // collector numbers match regardless of case
    r = (await db.one("select verify_set_card_data('NEW', 'per_set_import') as r")).r;
    expect(r).toMatchObject({ ok: true, expected: 3, problem: null });
    expect(await db.one("select card_data_ok, card_data_problem from mtg_sets where code = 'NEW'")).toEqual({ card_data_ok: true, card_data_problem: null });
    expect((await db.q("select ok, source from set_card_data_checks order by id")).map((c) => [c.ok, c.source]))
      .toEqual([[false, "check"], [false, "check"], [true, "per_set_import"]]);
    await expect(db.q("delete from set_card_data_checks")).rejects.toThrow(/append_only/);
    await expect(db.q("select record_set_printings('NEW', array[]::text[])")).rejects.toThrow(/no_printings/);
  });

  it("blocks going on sale, publishing a drop and ordering until the check passes, and stops orders if it fails later", async () => {
    const p = await makeProduct(db, { setCode: "GAT" });
    const u = await makeUser(db, { credits: 20_000 });
    await db.q("update mtg_sets set card_data_ok = false where code = 'GAT'");
    const order = () => atTime(db, "2026-10-01T12:00:00-07:00", "select place_order($1, $2, 1)", [u, p]);
    await expect(order()).rejects.toThrow(/card_data_unverified/);
    await expect(db.q("select set_product_active($1, true, null)", [p])).rejects.toThrow(/card_data_unverified/);
    await expect(db.q("select save_drop(null, 'GAT', now() + interval '1 day', null, 10, null, 'published', null)")).rejects.toThrow(/card_data_unverified/);
    await expect(db.q("select save_drop(null, 'GAT', now() + interval '1 day', null, 10, null, 'draft', null)")).resolves.toBeTruthy();   // drafts are fine

    await db.q("select record_set_printings('GAT', array['1'])");
    await image(await makeCard(db, { set: "GAT", num: "1" }));
    await db.q("select verify_set_card_data('GAT')");
    await expect(order()).resolves.toBeTruthy();
    // A later check that fails (a printing lost its image) stops new orders.
    await db.q("delete from card_images");
    expect((await db.one("select verify_set_card_data('GAT') as r")).r.ok).toBe(false);
    await expect(order()).rejects.toThrow(/card_data_unverified/);
    expect((await db.q("select * from sets_needing_card_data()")).map((r) => Object.values(r)[0])).toEqual(["GAT"]);
  });
});
