import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { atTime, freshDb, type Db } from "./db";
import { BEFORE_CUTOFF, makeProduct, makeUser } from "./fixtures";

let db: Db;
beforeEach(async () => { db = await freshDb(); });
afterEach(async () => { await db.close(); });

const balance = (u: string) => db.one("select purchased::int, earned::int from credit_accounts where user_id = $1", [u]);
const order = (u: string, p: string, qty: number) =>
  atTime(db, BEFORE_CUTOFF, "select place_order($1, $2, $3) as id", [u, p, qty]).then((r) => r[0].id as string);

describe("credits", () => {
  it("applies a Stripe event exactly once", async () => {
    const u = await makeUser(db);
    const first = await db.one("select purchase_credits($1, 2550, 'evt_1') as applied", [u]);
    const replay = await db.one("select purchase_credits($1, 2550, 'evt_1') as applied", [u]);
    expect([first.applied, replay.applied]).toEqual([true, false]);
    expect(await balance(u)).toEqual({ purchased: 2550, earned: 0 });
  });

  it("charges the pricing ladder and refuses when short", async () => {
    const p = await makeProduct(db);
    const u = await makeUser(db, { credits: 10_000 });
    await order(u, p, 3); // 3 x 850
    expect(await balance(u)).toEqual({ purchased: 7450, earned: 0 });
    await order(u, p, 6); // 6 x 825 = 4950
    expect(await balance(u)).toEqual({ purchased: 2500, earned: 0 });
    await expect(order(u, p, 3)).rejects.toThrow(/insufficient_credits/);
    expect(await balance(u)).toEqual({ purchased: 2500, earned: 0 });
    const s = await db.one("select packs_reserved from product_stock where product_id = $1", [p]);
    expect(s.packs_reserved).toBe(9); // the failed order reserved nothing
  });

  it("spends earned credit first and refunds a cancellation to the same buckets", async () => {
    const p = await makeProduct(db);
    const u = await makeUser(db, { credits: 1000 });
    await db.q("insert into credit_entries (user_id, bucket, amount, kind) values ($1, 'earned', 500, 'buyback')", [u]);
    const o = await order(u, p, 1); // 900: 500 earned + 400 purchased
    expect(await balance(u)).toEqual({ purchased: 600, earned: 0 });
    await atTime(db, BEFORE_CUTOFF, "select cancel_order($1, $2)", [o, u]);
    expect(await balance(u)).toEqual({ purchased: 1000, earned: 500 });
    const s = await db.one("select packs_reserved from product_stock where product_id = $1", [p]);
    expect(s.packs_reserved).toBe(0);
    await expect(atTime(db, BEFORE_CUTOFF, "select cancel_order($1, $2)", [o, u])).rejects.toThrow(/order_not_cancellable/);
  });

  it("never lets a balance go negative, even under concurrent spending", async () => {
    const p = await makeProduct(db);
    const u = await makeUser(db, { credits: 2700 }); // exactly 3 single packs
    const results = await Promise.allSettled(Array.from({ length: 8 }, () => order(u, p, 1)));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(3);
    expect(await balance(u)).toEqual({ purchased: 0, earned: 0 });
    await expect(db.q("insert into credit_entries (user_id, bucket, amount, kind) values ($1, 'purchased', -1, 'adjustment')", [u]))
      .rejects.toThrow(/purchased_non_negative/);
  });

  it("keeps the ledger append only", async () => {
    const u = await makeUser(db, { credits: 100 });
    await expect(db.q("update credit_entries set amount = 1000000 where user_id = $1", [u])).rejects.toThrow(/append_only/);
    await expect(db.q("delete from credit_entries where user_id = $1", [u])).rejects.toThrow(/append_only/);
  });
});
