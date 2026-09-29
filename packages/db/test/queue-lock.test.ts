import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { atTime, freshDb, type Db } from "./db";
import { AFTER_CUTOFF, AT_CUTOFF, BEFORE_CUTOFF, JUST_BEFORE, makeProduct, makeStaff, makeUser } from "./fixtures";

let db: Db;
beforeEach(async () => { db = await freshDb(); });
afterEach(async () => { await db.close(); });

const order = (at: string, user: string, product: string, qty = 1) =>
  atTime(db, at, "select place_order($1, $2, $3) as id", [user, product, qty]).then((r) => r[0].id as string);
const lock = (at: string, batch: string, staff: string) =>
  atTime(db, at, "select lock_batch($1, $2) as hash", [batch, staff]).then((r) => r[0].hash as string);
const batchOf = (orderId: string) =>
  db.one("select b.*, b.batch_date::text as d from orders o join batches b on b.id = o.batch_id where o.id = $1", [orderId]);

describe("cutoff assignment", () => {
  it("puts 18:59:59.999 in tonight's batch and 19:00:00 in tomorrow's", async () => {
    const [u, p] = [await makeUser(db, { credits: 10_000 }), await makeProduct(db)];
    const before = await batchOf(await order(JUST_BEFORE, u, p));
    const at = await batchOf(await order(AT_CUTOFF, u, p));
    expect(before.d).toBe("2026-10-01");
    expect(at.d).toBe("2026-10-02");
    expect(new Date(before.cutoff_at).toISOString()).toBe("2026-10-02T02:00:00.000Z");
  });

  it("uses Pacific time across the DST change", async () => {
    const [u, p] = [await makeUser(db, { credits: 10_000 }), await makeProduct(db)];
    const b = await batchOf(await order("2026-11-01T12:00:00-08:00", u, p));
    expect(new Date(b.cutoff_at).toISOString()).toBe("2026-11-02T03:00:00.000Z");
  });

  it("rejects unverified ages, blocked states and inactive products", async () => {
    const p = await makeProduct(db);
    const minor = await makeUser(db, { credits: 10_000, verified: false });
    await expect(order(BEFORE_CUTOFF, minor, p)).rejects.toThrow(/age_not_verified/);
    await db.q("update system_config set blocked_states = '{WA}'");
    const wa = await makeUser(db, { credits: 10_000, state: "WA" });
    await expect(order(BEFORE_CUTOFF, wa, p)).rejects.toThrow(/state_blocked/);
    await db.q("update products set active = false");
    const ok = await makeUser(db, { credits: 10_000 });
    await expect(order(BEFORE_CUTOFF, ok, p)).rejects.toThrow(/product_unavailable/);
  });
});

describe("lock_batch", () => {
  it("refuses to lock before the cutoff", async () => {
    const [u, p, staff] = [await makeUser(db, { credits: 10_000 }), await makeProduct(db), await makeStaff(db)];
    const b = await batchOf(await order(BEFORE_CUTOFF, u, p));
    await expect(lock(JUST_BEFORE, b.id, staff)).rejects.toThrow(/cutoff_not_reached/);
    await expect(lock(AT_CUTOFF, b.id, staff)).resolves.toMatch(/^[0-9a-f]{64}$/);
    await expect(lock(AFTER_CUTOFF, b.id, staff)).rejects.toThrow(/batch_already_locked/);
  });

  it("orders strictly by purchase time, keeps multi pack orders together, and skips cancellations", async () => {
    const p = await makeProduct(db);
    const p2 = await makeProduct(db, { setCode: "EOE" });
    const staff = await makeStaff(db);
    const [a, b, c] = [await makeUser(db, { credits: 50_000 }), await makeUser(db, { credits: 50_000 }), await makeUser(db, { credits: 50_000 })];

    const o1 = await order("2026-10-01T10:00:00-07:00", b, p, 3);
    const o2 = await order("2026-10-01T09:00:00-07:00", a, p2, 1); // earlier, placed second
    const o3 = await order("2026-10-01T11:00:00-07:00", c, p, 1);
    const o4 = await order("2026-10-01T12:00:00-07:00", a, p, 2);
    await atTime(db, "2026-10-01T13:00:00-07:00", "select cancel_order($1, $2)", [o3, c]);

    const batch = await batchOf(o1);
    await lock(AT_CUTOFF, batch.id, staff);

    const rows = await db.q(
      "select order_id, pack_index, position, status from queue_entries where batch_id = $1 order by position nulls last",
      [batch.id],
    );
    expect(rows.map((r) => [r.order_id, r.pack_index, r.position])).toEqual([
      [o2, 1, 1], [o1, 1, 2], [o1, 2, 3], [o1, 3, 4], [o4, 1, 5], [o4, 2, 6], [o3, 1, null],
    ]);
    const locked = await db.one("select * from batches where id = $1", [batch.id]);
    expect(locked.entry_count).toBe(6);
  });

  it("publishes a manifest hash anyone can recompute", async () => {
    const [u, p, staff] = [await makeUser(db, { credits: 50_000 }), await makeProduct(db), await makeStaff(db)];
    await order(BEFORE_CUTOFF, u, p, 3);
    const batch = await batchOf(await order(JUST_BEFORE, u, p, 1));
    const hash = await lock(AT_CUTOFF, batch.id, staff);
    const { m } = await db.one("select batch_manifest($1) as m", [batch.id]);
    expect(m.split("\n")).toHaveLength(4);
    expect(createHash("sha256").update(m).digest("hex")).toBe(hash);
    const ev = await db.one("select payload from custody_events where event_type = 'queue_locked'");
    expect(ev.payload.manifest_hash).toBe(hash);
  });
});

describe("a locked queue is frozen", () => {
  let batchId: string, orderId: string, user: string, product: string;
  beforeEach(async () => {
    user = await makeUser(db, { credits: 50_000 });
    product = await makeProduct(db);
    orderId = await order(BEFORE_CUTOFF, user, product, 2);
    batchId = (await batchOf(orderId)).id;
    await lock(AT_CUTOFF, batchId, await makeStaff(db));
  });

  it("routes a late purchase to the next batch even if its clock reads before the cutoff", async () => {
    const late = await order(JUST_BEFORE, user, product);
    expect((await batchOf(late)).id).not.toBe(batchId);
  });

  it("rejects direct inserts, reorders, deletes and edits", async () => {
    const e = await db.one("select * from queue_entries where batch_id = $1 and position = 1", [batchId]);
    await expect(db.q(
      `insert into queue_entries (batch_id, order_id, user_id, product_id, pack_index, placed_at, purchase_seq)
       values ($1, $2, $3, $4, 9, now(), 1)`, [batchId, orderId, user, product])).rejects.toThrow(/batch_locked/);
    await expect(db.q("update queue_entries set position = 99 where id = $1", [e.id])).rejects.toThrow(/position_assigned_only_by_lock/);
    await expect(db.q("update queue_entries set user_id = $2 where id = $1", [e.id, await makeUser(db)])).rejects.toThrow(/immutable/);
    await expect(db.q("update queue_entries set status = 'cancelled' where id = $1", [e.id])).rejects.toThrow(/invalid_queue_transition/);
    await expect(db.q("update queue_entries set status = 'opened' where id = $1", [e.id])).rejects.toThrow(/invalid_queue_transition/);
    await expect(db.q("delete from queue_entries where id = $1", [e.id])).rejects.toThrow(/cannot_be_deleted/);
    await expect(db.q("truncate queue_entries cascade")).rejects.toThrow(/append_only/);
  });

  it("rejects cancelling, editing the order, or rewriting the lock", async () => {
    await expect(atTime(db, AFTER_CUTOFF, "select cancel_order($1, $2)", [orderId, user])).rejects.toThrow(/cutoff_passed/);
    await expect(db.q("update orders set placed_at = placed_at - interval '1 hour' where id = $1", [orderId])).rejects.toThrow(/immutable/);
    await expect(db.q("update batches set manifest_hash = 'x' where id = $1", [batchId])).rejects.toThrow(/batch_lock_immutable/);
    await expect(db.q("update batches set status = 'open' where id = $1", [batchId])).rejects.toThrow(/invalid_batch_transition/);
    await expect(db.q("delete from batches where id = $1", [batchId])).rejects.toThrow(/cannot_be_deleted/);
  });
});

describe("before the lock", () => {
  it("never lets anything but lock_batch assign a position", async () => {
    const [u, p] = [await makeUser(db, { credits: 10_000 }), await makeProduct(db)];
    const o = await order(BEFORE_CUTOFF, u, p);
    await expect(db.q("update queue_entries set position = 1 where order_id = $1", [o])).rejects.toThrow(/position_assigned_only_by_lock/);
  });

  it("closes cancellation at the cutoff even if staff have not locked yet", async () => {
    const [u, p] = [await makeUser(db, { credits: 10_000 }), await makeProduct(db)];
    const o = await order(BEFORE_CUTOFF, u, p);
    await expect(atTime(db, AT_CUTOFF, "select cancel_order($1, $2)", [o, u])).rejects.toThrow(/cutoff_passed/);
  });
});

describe("concurrency at the cutoff", () => {
  it("never loses or strands an order when purchases race the lock", async () => {
    // 40 buyers: this checks the lock and stock, not the nightly six (sets-drops.test.ts), so lift the cap.
    await db.q("update system_config set max_packs_per_set_per_night = 1000");
    const p = await makeProduct(db, { boxes: 10 });
    const staff = await makeStaff(db);
    const users = await Promise.all(Array.from({ length: 40 }, () => makeUser(db, { credits: 20_000 })));
    const first = await order(BEFORE_CUTOFF, users[0], p);
    const batchId = (await batchOf(first)).id;

    // 39 purchases whose clocks read just before the cutoff, racing a lock at the cutoff.
    const purchases = users.slice(1).map((u, i) =>
      order(new Date(Date.parse(JUST_BEFORE) - i).toISOString(), u, p));
    const locking = new Promise((r) => setTimeout(r, 5)).then(() => lock(AT_CUTOFF, batchId, staff));
    const ids = await Promise.all(purchases);
    await locking;

    const all = [first, ...ids];
    const rows = await db.q(
      "select o.id, o.batch_id, q.position from orders o join queue_entries q on q.order_id = o.id where o.id = any($1)", [all]);
    expect(rows).toHaveLength(40);
    const inA = rows.filter((r) => r.batch_id === batchId);
    // Everything in the locked batch has a position; nothing slipped in unpositioned.
    expect(inA.every((r) => r.position !== null)).toBe(true);
    const b = await db.one("select entry_count from batches where id = $1", [batchId]);
    expect(b.entry_count).toBe(inA.length);
    // Everything else went to tomorrow and is still open.
    for (const r of rows.filter((r) => r.batch_id !== batchId)) expect(r.position).toBeNull();
    // Positions are exactly 1..n.
    expect(inA.map((r) => r.position).sort((a, b) => a - b)).toEqual(inA.map((_, i) => i + 1));
  });

  it("never oversells sealed stock", async () => {
    // 40 buyers: this checks the lock and stock, not the nightly six (sets-drops.test.ts), so lift the cap.
    await db.q("update system_config set max_packs_per_set_per_night = 1000");
    const p = await makeProduct(db, { boxes: 1, packsPerBox: 30, buffer: 2 }); // 28 sellable
    const users = await Promise.all(Array.from({ length: 40 }, () => makeUser(db, { credits: 5_000 })));
    const results = await Promise.allSettled(users.map((u) => order(BEFORE_CUTOFF, u, p)));
    const ok = results.filter((r) => r.status === "fulfilled").length;
    const soldOut = results.filter((r) => r.status === "rejected" && /sold_out/.test(String(r.reason))).length;
    expect(ok).toBe(28);
    expect(soldOut).toBe(12);
    const s = await db.one("select * from product_stock where product_id = $1", [p]);
    expect(s.packs_reserved).toBe(28);
    const store = await db.one("select available from storefront where product_id = $1", [p]);
    expect(store.available).toBe(false);
  });
});
