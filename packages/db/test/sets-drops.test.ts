import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { atTime, freshDb, type Db } from "./db";
import { AT_CUTOFF, BEFORE_CUTOFF, makeCard, makeProduct, makeStaff, makeUser } from "./fixtures";

let db: Db;
beforeEach(async () => { db = await freshDb(); });
afterEach(async () => { await db.close(); });

const order = (u: string, p: string, qty: number, at = BEFORE_CUTOFF) =>
  atTime(db, at, "select place_order($1, $2, $3) as id", [u, p, qty]).then((r) => r[0].id as string);

describe("six packs per set per customer (item 5)", () => {
  it("counts every pending order across days, releases on cancel, and allows a logged staff override", async () => {
    const u = await makeUser(db, { credits: 50_000 });
    const p = await makeProduct(db, { setCode: "AAA", boxes: 2 });
    await order(u, p, 3);
    await order(u, p, 2, "2026-10-02T10:00:00-07:00");                 // another day still counts
    await expect(order(u, p, 2, "2026-10-02T10:00:00-07:00")).rejects.toThrow(/set_limit_reached/);
    const last = await order(u, p, 1, "2026-10-02T10:00:00-07:00");    // 6 of 6
    await expect(order(u, p, 1, "2026-10-02T10:00:00-07:00")).rejects.toThrow(/set_limit_reached/);
    await atTime(db, "2026-10-02T10:00:00-07:00", "select cancel_order($1, $2)", [last, u]);
    await expect(order(u, p, 1, "2026-10-02T10:00:00-07:00")).resolves.toBeTruthy();
    // Another set has its own six.
    const other = await makeProduct(db, { setCode: "BBB" });
    await expect(order(u, other, 6, "2026-10-02T10:00:00-07:00")).resolves.toBeTruthy();
    // Staff override with a reason.
    const staff = await makeStaff(db);
    await expect(db.q("select set_customer_set_limit($1, 'aaa', 8, ' ', $2)", [u, staff])).rejects.toThrow(/reason_required/);
    await db.q("select set_customer_set_limit($1, 'aaa', 8, 'Test buyer, approved by Tyson', $2)", [u, staff]);
    await expect(order(u, p, 2, "2026-10-02T10:00:00-07:00")).resolves.toBeTruthy();
    await expect(db.q("delete from set_limit_overrides")).rejects.toThrow(/append_only/);
  });

  it("never lets one customer pass six with concurrent purchases", async () => {
    const u = await makeUser(db, { credits: 90_000 });
    const p = await makeProduct(db, { setCode: "CCC", boxes: 2 });
    const results = await Promise.allSettled(Array.from({ length: 10 }, () => order(u, p, 1)));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(6);
    expect(results.filter((r) => r.status === "rejected").every((r) => /set_limit_reached/.test(String((r as PromiseRejectedResult).reason)))).toBe(true);
  });

  it("never oversells the last sealed packs when many customers buy at once", async () => {
    const p = await makeProduct(db, { setCode: "DDD", boxes: 1, packsPerBox: 5, buffer: 0 });
    const users = await Promise.all(Array.from({ length: 12 }, () => makeUser(db, { credits: 5_000 })));
    const results = await Promise.allSettled(users.map((u) => order(u, p, 1)));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(5);
    expect(results.filter((r) => r.status === "rejected").every((r) => /sold_out/.test(String((r as PromiseRejectedResult).reason)))).toBe(true);
    expect(await db.one("select packs_reserved from product_stock where product_id = $1", [p])).toEqual({ packs_reserved: 5 });
  });
});

describe("drops (item 14)", () => {
  it("sells a set only while its drop is live, up to the packs allocated and the drop's per customer limit", async () => {
    const p = await makeProduct(db, { setCode: "EEE", boxes: 2 });
    const [a, b] = [await makeUser(db, { credits: 50_000 }), await makeUser(db, { credits: 50_000 })];
    await db.q(`insert into drops (set_code, starts_at, ends_at, packs_allocated, per_customer_limit, status)
                values ('EEE', '2026-10-01T12:00:00-07:00', '2026-10-01T18:00:00-07:00', 5, 3, 'published')`);
    await expect(order(a, p, 1, "2026-10-01T11:59:00-07:00")).rejects.toThrow(/drop_not_live/);
    await expect(order(a, p, 4, "2026-10-01T12:00:00-07:00")).rejects.toThrow(/set_limit_reached/);   // drop limit 3
    await order(a, p, 3, "2026-10-01T12:00:00-07:00");
    await expect(order(b, p, 3, "2026-10-01T12:05:00-07:00")).rejects.toThrow(/sold_out/);           // 5 allocated
    await order(b, p, 2, "2026-10-01T12:05:00-07:00");
    const state = (at: string) => atTime(db, at, "select drop_state(d) as s from drops d").then((r) => r[0].s);
    expect(await state("2026-10-01T11:00:00-07:00")).toBe("upcoming");
    expect(await state("2026-10-01T12:10:00-07:00")).toBe("sold_out");
    expect(await state("2026-10-01T18:00:00-07:00")).toBe("ended");
    await expect(order(b, p, 1, "2026-10-01T18:30:00-07:00")).rejects.toThrow(/drop_not_live/);
  });

  it("lists reminders due one hour before the drop, skipping unsubscribes", async () => {
    const [a, b] = [await makeUser(db), await makeUser(db)];
    await makeProduct(db, { setCode: "FFF" });
    const { id } = await db.one(`insert into drops (set_code, starts_at, packs_allocated, status) values ('FFF', '2026-10-05T12:00:00-07:00', 10, 'published') returning id`);
    await db.q("insert into drop_reminders (drop_id, user_id, token) values ($1, $2, 't1'), ($1, $3, 't2')", [id, a, b]);
    await db.q("update drop_reminders set unsubscribed_at = now() where token = 't2'");
    expect(await atTime(db, "2026-10-05T10:59:00-07:00", "select user_id from due_drop_reminders()")).toEqual([]);
    expect(await atTime(db, "2026-10-05T11:00:00-07:00", "select user_id from due_drop_reminders()")).toEqual([{ user_id: a }]);
  });
});

describe("pack videos and batch approval (item 11)", () => {
  it("refuses to approve and notify until every pack has a ready video and approved contents", async () => {
    const u = await makeUser(db, { credits: 10_000 });
    const p = await makeProduct(db, { setCode: "GGG" });
    const staff = await makeStaff(db);
    const card = await makeCard(db, { set: "GGG" });
    const [{ id: o }] = await atTime(db, BEFORE_CUTOFF, "select place_order($1, $2, 2) as id", [u, p]);
    const { batch_id } = await db.one("select batch_id from orders where id = $1", [o]);
    const T = "2026-10-01T19:10:00-07:00";
    const run = (sql: string, params: unknown[]) => atTime(db, T, sql, params);
    await atTime(db, AT_CUTOFF, "select lock_batch($1, $2)", [batch_id, staff]);
    const [{ s }] = await run("select start_session($1, $2, null) as s", [batch_id, staff]);
    await run("select open_box($1, $2, 0, $3)", [s, (await db.one("select id from sealed_boxes where product_id = $1", [p])).id, staff]);
    const packs: string[] = [];
    for (let i = 0; i < 2; i++) packs.push((await run("select * from open_next_pack($1, 0, $2)", [s, staff]))[0].pack_opening_id);
    await run("select complete_session($1, null, $2)", [s, staff]);
    for (const pk of packs) {
      await run("select log_pack_card($1, 1, 'card', $2, 'nonfoil', 'NM', null, $3)", [pk, card, staff]);
      await run("select finalize_pack_contents($1, $2)", [pk, staff]);
    }
    await expect(run("select approve_and_notify_batch($1, $2)", [batch_id, staff])).rejects.toThrow(/videos_not_ready/);
    const sha = "b".repeat(64);
    await run("select start_pack_video($1, $2)", [packs[0], staff]);
    await expect(run("select finish_pack_video($1, 'x.hevc', 10, $2, 1, 'video/hevc', null, null, $3)", [packs[0], sha, staff])).rejects.toThrow(/video_type_unsupported/);
    await run("select finish_pack_video($1, 'v/1.mp4', 10, $2, 1000, 'video/mp4', null, null, $3)", [packs[0], sha, staff]);
    await expect(run("select approve_and_notify_batch($1, $2)", [batch_id, staff])).rejects.toThrow(/videos_not_ready/);
    await run("select start_pack_video($1, $2)", [packs[1], staff]);
    await run("select finish_pack_video($1, 'v/2.mov', 10, $2, 1000, 'video/quicktime', null, null, $3)", [packs[1], sha, staff]);
    expect(Number((await run("select approve_and_notify_batch($1, $2) as n", [batch_id, staff]))[0].n)).toBe(1);
    expect(await db.q("select distinct status from pack_videos")).toEqual([{ status: "approved" }]);
    expect(await db.one("select status from orders where id = $1", [o])).toEqual({ status: "fulfilled" });
    await expect(run("select start_pack_video($1, $2)", [packs[0], staff])).rejects.toThrow(/video_approved/);
  });
});
