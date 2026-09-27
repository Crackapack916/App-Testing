import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { atTime, freshDb, type Db } from "./db";
import { AT_CUTOFF, BEFORE_CUTOFF, makeCard, makeProduct, makeStaff, makeUser } from "./fixtures";

let db: Db;
beforeEach(async () => { db = await freshDb(); });
afterEach(async () => { await db.close(); });

const SESSION_TIME = "2026-10-01T19:10:00-07:00";
const run = (sql: string, params: unknown[] = []) => atTime(db, SESSION_TIME, sql, params);

async function lockedBatch(opts: { orders: [string, string, number][] }) {
  const staff = await makeStaff(db);
  let batchId = "";
  const orderIds: string[] = [];
  for (const [i, [user, product, qty]] of opts.orders.entries()) {
    const at = new Date(Date.parse(BEFORE_CUTOFF) + i * 1000).toISOString();
    const [{ id }] = await atTime(db, at, "select place_order($1, $2, $3) as id", [user, product, qty]);
    orderIds.push(id);
    batchId = (await db.one("select batch_id from orders where id = $1", [id])).batch_id;
  }
  await atTime(db, AT_CUTOFF, "select lock_batch($1, $2)", [batchId, staff]);
  return { staff, batchId, orderIds };
}

async function boxOf(product: string, n = 1) {
  return (await db.one("select id from sealed_boxes where product_id = $1 order by label offset $2 limit 1", [product, n - 1])).id;
}

describe("opening session", () => {
  it("cannot start until the batch is locked", async () => {
    const [u, p, staff] = [await makeUser(db, { credits: 10_000 }), await makeProduct(db), await makeStaff(db)];
    const [{ id }] = await atTime(db, BEFORE_CUTOFF, "select place_order($1, $2, 1) as id", [u, p]);
    const { batch_id } = await db.one("select batch_id from orders where id = $1", [id]);
    await expect(run("select start_session($1, $2, 'mux-live')", [batch_id, staff])).rejects.toThrow(/batch_not_locked/);
  });

  it("pairs each physical pack with the next locked position, across products, with no staff choice", async () => {
    const fdn = await makeProduct(db, { setCode: "FDN" });
    const eoe = await makeProduct(db, { setCode: "EOE" });
    const [a, b] = [await makeUser(db, { credits: 50_000 }), await makeUser(db, { credits: 50_000 })];
    const { staff, batchId, orderIds } = await lockedBatch({ orders: [[a, fdn, 2], [b, eoe, 1], [b, fdn, 1]] });

    await expect(run("select open_next_pack($1, 0, $2)", ["00000000-0000-0000-0000-000000000000", staff])).rejects.toThrow(/unknown_session/);
    const [{ s }] = await run("select start_session($1, $2, 'mux-live') as s", [batchId, staff]);

    // No box open yet: refuse rather than guess.
    await expect(run("select * from open_next_pack($1, 1000, $2)", [s, staff])).rejects.toThrow(/no_open_box_for_product/);
    await run("select open_box($1, $2, 500, $3)", [s, await boxOf(fdn), staff]);
    await run("select open_box($1, $2, 600, $3)", [s, await boxOf(eoe), staff]);
    await expect(run("select open_box($1, $2, 700, $3)", [s, await boxOf(fdn, 1), staff])).rejects.toThrow(/box_not_sealed/);

    const opened = [];
    for (let i = 0; i < 4; i++) opened.push((await run("select * from open_next_pack($1, $2, $3)", [s, 1000 + i, staff]))[0]);
    expect(opened.map((o) => [o.queue_position, o.order_id, o.pack_number])).toEqual([
      [1, orderIds[0], 1], [2, orderIds[0], 2], [3, orderIds[1], 1], [4, orderIds[2], 3],
    ]);
    await expect(run("select * from open_next_pack($1, 9999, $2)", [s, staff])).rejects.toThrow(/queue_exhausted/);

    const stock = await db.one("select * from product_stock where product_id = $1", [fdn]);
    expect(stock).toMatchObject({ packs_on_hand: 27, packs_reserved: 0 });
  });

  it("voids a damaged pack without moving anyone's position", async () => {
    const p = await makeProduct(db, { buffer: 1 });
    const [a, b] = [await makeUser(db, { credits: 10_000 }), await makeUser(db, { credits: 10_000 })];
    const { staff, batchId, orderIds } = await lockedBatch({ orders: [[a, p, 1], [b, p, 1]] });
    const [{ s }] = await run("select start_session($1, $2, 'mux-live') as s", [batchId, staff]);
    await run("select open_box($1, $2, 0, $3)", [s, await boxOf(p), staff]);

    const first = (await run("select * from open_next_pack($1, 10, $2)", [s, staff]))[0];
    await expect(run("select void_pack($1, $2, '', 20, $3)", [s, p, staff])).rejects.toThrow(/void_reason_required/);
    await run("select void_pack($1, $2, 'torn wrapper', 20, $3)", [s, p, staff]);
    const second = (await run("select * from open_next_pack($1, 30, $2)", [s, staff]))[0];

    expect([first.order_id, first.pack_number]).toEqual([orderIds[0], 1]);
    expect([second.order_id, second.queue_position, second.pack_number]).toEqual([orderIds[1], 2, 3]);
  });

  it("refuses a void that would leave a customer without a pack", async () => {
    const p = await makeProduct(db, { packsPerBox: 3, buffer: 1 });
    const [a, b] = [await makeUser(db, { credits: 10_000 }), await makeUser(db, { credits: 10_000 })];
    const { staff, batchId } = await lockedBatch({ orders: [[a, p, 1], [b, p, 1]] });
    const [{ s }] = await run("select start_session($1, $2, 'mux-live') as s", [batchId, staff]);
    await run("select open_box($1, $2, 0, $3)", [s, await boxOf(p), staff]);
    await run("select void_pack($1, $2, 'crushed', 1, $3)", [s, p, staff]); // uses the buffer
    await expect(run("select void_pack($1, $2, 'crushed', 2, $3)", [s, p, staff])).rejects.toThrow(/stock_covers_reservations/);
  });

  it("runs batches oldest first", async () => {
    const p = await makeProduct(db);
    const u = await makeUser(db, { credits: 50_000 });
    const staff = await makeStaff(db);
    const [{ id: o1 }] = await atTime(db, "2026-10-01T12:00:00-07:00", "select place_order($1, $2, 1) as id", [u, p]);
    const [{ id: o2 }] = await atTime(db, "2026-10-02T12:00:00-07:00", "select place_order($1, $2, 1) as id", [u, p]);
    const b1 = (await db.one("select batch_id from orders where id = $1", [o1])).batch_id;
    const b2 = (await db.one("select batch_id from orders where id = $1", [o2])).batch_id;
    await atTime(db, "2026-10-02T20:00:00-07:00", "select lock_batch($1, $2)", [b1, staff]);
    await atTime(db, "2026-10-02T20:00:00-07:00", "select lock_batch($1, $2)", [b2, staff]);
    await expect(atTime(db, "2026-10-02T20:01:00-07:00", "select start_session($1, $2, null)", [b2, staff])).rejects.toThrow(/earlier_batch_incomplete/);
    await expect(atTime(db, "2026-10-02T20:01:00-07:00", "select start_session($1, $2, null)", [b1, staff])).resolves.toBeTruthy();
  });

  it("notifies only after the clip is ready and contents are logged, then records the full custody trail", async () => {
    const p = await makeProduct(db);
    const u = await makeUser(db, { credits: 10_000 });
    const card = await makeCard(db, { rarity: "common", priceCents: 5 });
    const { staff, batchId, orderIds } = await lockedBatch({ orders: [[u, p, 1]] });
    const [{ s }] = await run("select start_session($1, $2, 'mux-live') as s", [batchId, staff]);
    await run("select open_box($1, $2, 0, $3)", [s, await boxOf(p), staff]);
    const pack = (await run("select * from open_next_pack($1, 1000, $2)", [s, staff]))[0];

    await run("select record_order_clip($1, 900, 60000, $2)", [orderIds[0], staff]);
    await expect(run("select notify_order($1, $2)", [orderIds[0], staff])).rejects.toThrow(/clip_not_ready/);
    await run("select mark_clip_ready($1, 'mux-clip-1', $2)", [orderIds[0], staff]);
    await expect(run("select notify_order($1, $2)", [orderIds[0], staff])).rejects.toThrow(/contents_not_finalized/);
    for (let slot = 1; slot <= 14; slot++) await run("select log_pack_card($1, $2, $3, 'nonfoil', 'NM', null, $4)", [pack.pack_opening_id, slot, card, staff]);
    await run("select finalize_pack_contents($1, $2)", [pack.pack_opening_id, staff]);
    await run("select notify_order($1, $2)", [orderIds[0], staff]);
    await run("select complete_session($1, 'mux-asset', $2)", [s, staff]);

    const events = await db.q("select event_type from custody_events where batch_id = $1 order by seq", [batchId]);
    expect(events.map((e) => e.event_type)).toEqual([
      "order_placed", "queue_locked", "session_started", "box_opened", "pack_opened",
      "clip_generated", "contents_finalized", "customer_notified", "session_completed",
    ]);
    expect((await db.one("select status from batches where id = $1", [batchId])).status).toBe("completed");
    expect((await db.one("select verify_custody_chain() as broken")).broken).toBeNull();
    await expect(db.q("update pack_openings set box_id = box_id where id = $1", [pack.pack_opening_id])).resolves.toBeTruthy();
    await expect(db.q("update pack_openings set queue_entry_id = null, status = 'void' where id = $1", [pack.pack_opening_id])).rejects.toThrow(/immutable/);
  });
});

describe("custody log", () => {
  it("cannot be edited, and detects tampering done by bypassing the guards", async () => {
    await db.q("select log_custody(null, 'test_a', '{\"n\":1}', null)");
    await db.q("select log_custody(null, 'test_b', '{\"n\":2}', null)");
    await db.q("select log_custody(null, 'test_c', '{\"n\":3}', null)");
    await expect(db.q("update custody_events set payload = '{}' where seq = 2")).rejects.toThrow(/append_only/);
    await expect(db.q("delete from custody_events where seq = 3")).rejects.toThrow(/append_only/);
    expect((await db.one("select verify_custody_chain() as b")).b).toBeNull();

    // A superuser disabling the trigger still cannot hide an edit.
    await db.q("alter table custody_events disable trigger custody_events_immutable");
    await db.q("update custody_events set payload = '{\"n\":99}' where seq = 2");
    expect(Number((await db.one("select verify_custody_chain() as b")).b)).toBe(2);
  });

  it("stays a single unbroken chain under concurrent writers", async () => {
    await Promise.all(Array.from({ length: 50 }, (_, i) => db.q("select log_custody(null, 'c', $1, null)", [{ i }])));
    expect((await db.one("select verify_custody_chain() as b")).b).toBeNull();
    expect(Number((await db.one("select max(seq) as m from custody_events")).m)).toBe(50);
  });
});
