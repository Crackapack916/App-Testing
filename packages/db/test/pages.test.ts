import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { atTime, freshDb, type Db } from "./db";
import { makeProduct, makeStaff, makeUser } from "./fixtures";

let db: Db;
beforeEach(async () => { db = await freshDb(); });
afterEach(async () => { await db.close(); });

const save = (id: string | null, starts: string, ends: string | null, status = "published", actor: string | null = null) =>
  db.one<{ id: string }>("select save_drop($1, 'EEE', $2, $3, 20, null, $4, $5) as id", [id, starts, ends, status, actor]).then((r) => r.id);

describe("save_drop", () => {
  it("creates and edits drops, and refuses bad windows, unknown sets and overlapping published drops", async () => {
    await makeProduct(db, { setCode: "EEE" });
    const staff = await makeStaff(db);
    const id = await save(null, "2026-10-01T12:00:00-07:00", "2026-10-01T18:00:00-07:00", "draft", staff);
    await save(id, "2026-10-01T12:00:00-07:00", "2026-10-01T19:00:00-07:00", "published", staff);
    expect((await db.one("select status, ends_at from drops where id = $1", [id])).status).toBe("published");
    await expect(save(null, "2026-10-01T18:00:00-07:00", "2026-10-01T20:00:00-07:00")).rejects.toThrow(/drop_overlap/);
    await expect(save(null, "2026-10-01T18:00:00-07:00", "2026-10-01T20:00:00-07:00", "draft")).resolves.toBeTruthy();
    await expect(save(null, "2026-10-02T18:00:00-07:00", "2026-10-02T17:00:00-07:00")).rejects.toThrow(/invalid_drop_window/);
    await expect(db.q("select save_drop(null, 'ZZZ', now(), null, 1, null, 'draft', null)")).rejects.toThrow(/unknown_set/);
  });
});

describe("drop reminders", () => {
  it("is opt in, one per customer, only before the drop, and unsubscribe stops it", async () => {
    await makeProduct(db, { setCode: "EEE" });
    const u = await makeUser(db);
    const id = await save(null, "2026-10-01T12:00:00-07:00", null);
    const at = "2026-10-01T09:00:00-07:00";
    await atTime(db, at, "select request_drop_reminder($1, $2, 'tok1')", [id, u]);
    await atTime(db, at, "select request_drop_reminder($1, $2, 'tok2')", [id, u]);   // idempotent
    expect(await atTime(db, at, "select * from due_drop_reminders()")).toHaveLength(0);           // not within the hour
    expect(await atTime(db, "2026-10-01T11:15:00-07:00", "select * from due_drop_reminders()")).toHaveLength(1);
    await atTime(db, at, "select unsubscribe_drop_reminder('tok1')");
    expect(await atTime(db, "2026-10-01T11:15:00-07:00", "select * from due_drop_reminders()")).toHaveLength(0);
    await expect(atTime(db, "2026-10-01T12:30:00-07:00", "select request_drop_reminder($1, $2, 'tok3')", [id, u])).rejects.toThrow(/drop_not_upcoming/);
    await expect(db.q("select unsubscribe_drop_reminder('nope')")).rejects.toThrow(/unknown_reminder/);
  });
});

describe("mark_cracked_seen", () => {
  it("clears only the customer's own unseen cracked notifications", async () => {
    const [a, b] = [await makeUser(db), await makeUser(db)];
    await db.q("insert into notifications (user_id, kind, sent_at) values ($1, 'cracked', now()), ($1, 'cracked', now()), ($2, 'cracked', now())", [a, b]);
    expect((await db.one("select mark_cracked_seen($1) as n", [a])).n).toBe(2);
    expect((await db.one("select mark_cracked_seen($1) as n", [a])).n).toBe(0);
    expect((await db.one("select count(*)::int as n from notifications where user_id = $1 and opened_at is null", [b])).n).toBe(1);
  });
});
