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
    await order(u, p, 3); // 3 x 850 (fixture ladder)
    expect(await balance(u)).toEqual({ purchased: 7450, earned: 0 });
    await order(u, p, 1); // 900
    expect(await balance(u)).toEqual({ purchased: 6550, earned: 0 });
    const poor = await makeUser(db, { credits: 2000 });
    await expect(order(poor, p, 3)).rejects.toThrow(/insufficient_credits/);
    expect(await balance(poor)).toEqual({ purchased: 2000, earned: 0 });
    const s = await db.one("select packs_reserved from product_stock where product_id = $1", [p]);
    expect(s.packs_reserved).toBe(4); // the failed order reserved nothing
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

describe("processor agnostic payments", () => {
  it("dedupes per processor and payment reference", async () => {
    const u = await makeUser(db);
    const apply = (proc: string, ref: string) =>
      db.one("select record_credit_purchase($1, 900, $2, $3) as ok", [u, proc, ref]).then((r) => r.ok);
    expect(await apply("stripe", "cs_1")).toBe(true);
    expect(await apply("stripe", "cs_1")).toBe(false);
    expect(await apply("paymentcloud", "cs_1")).toBe(true); // same ref, different processor
    expect(await balance(u)).toEqual({ purchased: 1800, earned: 0 });
  });

  it("refunds only unspent purchased credit, once per refund", async () => {
    const p = await makeProduct(db);
    const u = await makeUser(db, { credits: 2000 });
    await db.q("insert into credit_entries (user_id, bucket, amount, kind) values ($1, 'earned', 5000, 'buyback')", [u]);
    await order(u, p, 1); // spends earned first
    expect(Number((await db.one("select refundable_credits($1) as r", [u])).r)).toBe(2000);

    const refund = (amt: number, ref: string) => db.one("select refund_purchased_credits($1, $2, 'stripe', $3) as ok", [u, amt, ref]);
    expect((await refund(500, "re_1")).ok).toBe(true);
    expect((await refund(500, "re_1")).ok).toBe(false);
    await expect(refund(1600, "re_2")).rejects.toThrow(/purchased_non_negative/);
    expect(await balance(u)).toEqual({ purchased: 1500, earned: 4100 });
  });

  it("keeps payment events append only", async () => {
    await db.q("insert into payment_events (processor, event_id, event_type, status) values ('stripe', 'evt_1', 'x', 'ignored')");
    await expect(db.q("update payment_events set status = 'applied'")).rejects.toThrow(/append_only/);
  });
});
