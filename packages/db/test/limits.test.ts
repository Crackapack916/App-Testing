import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { atTime, freshDb, type Db } from "./db";
import { BEFORE_CUTOFF, makeProduct, makeUser } from "./fixtures";

let db: Db;
beforeEach(async () => { db = await freshDb(); });
afterEach(async () => { await db.close(); });

const T = "2026-10-01T10:00:00-07:00";
const order = (u: string, p: string, qty: number, at = BEFORE_CUTOFF) =>
  atTime(db, at, "select place_order($1, $2, $3) as id", [u, p, qty]).then((r) => r[0].id);

describe("age gate", () => {
  it("creates accounts only for 18 and over in Pacific time, keeps no plain birthdate, and locks the confirmation", async () => {
    const reg = (email: string, dob: string, at = T) =>
      atTime(db, at, "select register_account($1, 'hash', $2, 'cipher', null) as id", [email, dob]).then((r) => r[0].id as string);
    await expect(reg("young@x.test", "2008-10-02")).rejects.toThrow(/underage/);
    const u = await reg("ok@x.test", "2008-10-01"); // 18 today
    expect(await db.one("select birthdate, dob_encrypted, age_verified_at is not null as ok from users where id = $1", [u]))
      .toEqual({ birthdate: null, dob_encrypted: "cipher", ok: true });
    await expect(reg("OK@x.test", "1990-01-01")).rejects.toThrow(/email_in_use/);
    await expect(db.q("update users set birthdate = '1990-01-01' where id = $1", [u])).rejects.toThrow(/users_no_plain_birthdate/);
    await expect(db.q("update users set age_verified_at = now() - interval '1 day' where id = $1", [u])).rejects.toThrow(/birthdate_locked/);
    await expect(atTime(db, T, "select set_profile($1, '1990-01-01', 'CA')", [u])).rejects.toThrow(/use_confirm_age/);

    // An older account with no age on file must confirm before ordering.
    const legacy = await makeUser(db, { verified: false, credits: 5000 });
    const p = await makeProduct(db);
    await expect(order(legacy, p, 1)).rejects.toThrow(/age_not_verified/);
    await expect(atTime(db, T, "select confirm_age($1, '2009-01-01', 'c')", [legacy])).rejects.toThrow(/underage/);
    await atTime(db, T, "select confirm_age($1, '1990-01-01', 'c')", [legacy]);
    await expect(atTime(db, T, "select confirm_age($1, '1991-01-01', 'c')", [legacy])).rejects.toThrow(/birthdate_locked/);
    await expect(order(legacy, p, 1)).resolves.toBeTruthy();
  });
});

// Item 4 test matrix. Pack price in fixtures: 900 credits for 1 pack.
const lim = (u: string, period: string, credits: number | null, at = T) =>
  atTime(db, at, "select set_spend_limit($1, $2, $3) as r", [u, period, credits]).then((r) => r[0].r as string);
const summary = (u: string, at = T) =>
  atTime(db, at, "select period, limit_credits::int as lim, spent::int, resets_at, pending_credits::int as pend, has_pending from spending_summary($1)", [u]);

describe("spending limits", () => {
  it("has no limit by default and counts credits in calendar windows", async () => {
    const u = await makeUser(db, { credits: 50_000 });
    const p = await makeProduct(db, { boxes: 2 });
    for (let i = 0; i < 3; i++) await order(u, p, 1);
    const s = await summary(u, BEFORE_CUTOFF);
    expect(s.map((r) => [r.period, r.lim, r.spent])).toEqual([["daily", null, 2700], ["weekly", null, 2700], ["monthly", null, 2700]]);
    // Resets: midnight Pacific tonight, Monday 12:00 AM, the 1st. Oct 1 2026 is a Thursday (PDT, UTC-7).
    expect(s.map((r) => new Date(r.resets_at).toISOString())).toEqual([
      "2026-10-02T07:00:00.000Z", "2026-10-05T07:00:00.000Z", "2026-11-01T07:00:00.000Z"]);
  });

  it("sets, lowers, raises and removes each limit; with no delay every change applies at once", async () => {
    const u = await makeUser(db, { credits: 50_000 });
    const p = await makeProduct(db, { boxes: 2 });
    expect(await lim(u, "weekly", 5000)).toBe("applied");
    expect(await lim(u, "daily", 1000)).toBe("applied");
    await order(u, p, 1);                                                   // 900 of 1000 today
    await expect(order(u, p, 1)).rejects.toThrow(/daily_limit_reached/);
    expect(await lim(u, "daily", 2000)).toBe("applied");                    // raise
    await order(u, p, 1);
    expect(await lim(u, "daily", null)).toBe("applied");                    // remove
    await order(u, p, 1);                                                   // 2,700 this week
    await order(u, p, 1);                                                   // 3,600
    await expect(order(u, p, 2)).rejects.toThrow(/weekly_limit_reached/);   // 1,700 more passes 5,000
    expect(await lim(u, "monthly", 3000)).toBe("applied");                  // below what's spent: blocks new orders
    await expect(order(u, p, 1)).rejects.toThrow(/monthly_limit_reached/);
    // Every change is logged with old and new values.
    const ev = await db.q("select kind, period, old_value::int as o, new_value::int as n from spend_limit_events where user_id = $1 order by id", [u]);
    expect(ev).toEqual([
      { kind: "limit_set", period: "weekly", o: null, n: 5000 }, { kind: "limit_set", period: "daily", o: null, n: 1000 },
      { kind: "limit_set", period: "daily", o: 1000, n: 2000 }, { kind: "limit_set", period: "daily", o: 2000, n: null },
      { kind: "limit_set", period: "monthly", o: null, n: 3000 }]);
  });

  it("with a loosen delay: tightening is instant, raising or removing waits, and repeating never restarts the wait", async () => {
    await db.q("update system_config set limit_loosen_delay_hours = 24");
    const u = await makeUser(db, { credits: 50_000 });
    expect(await lim(u, "daily", 5000, "2026-10-01T08:00:00-07:00")).toBe("applied");   // new limit: tightening
    expect(await lim(u, "daily", 2500, "2026-10-01T08:00:00-07:00")).toBe("applied");   // lower: instant
    expect(await lim(u, "daily", 10000, "2026-10-01T09:00:00-07:00")).toBe("pending");  // raise waits
    expect(await lim(u, "daily", 10000, "2026-10-01T20:00:00-07:00")).toBe("pending");  // repeat keeps 9am tomorrow
    let s = await summary(u, "2026-10-02T08:59:00-07:00");
    expect([s[0].lim, s[0].pend, s[0].has_pending]).toEqual([2500, 10000, true]);
    s = await summary(u, "2026-10-02T09:00:00-07:00");
    expect([s[0].lim, s[0].has_pending]).toEqual([10000, false]);
    // A pending removal is cancelled by a tightening.
    expect(await lim(u, "daily", null, "2026-10-02T10:00:00-07:00")).toBe("pending");
    expect(await lim(u, "daily", 3000, "2026-10-02T11:00:00-07:00")).toBe("applied");
    s = await summary(u, "2026-10-04T00:00:00-07:00");
    expect([s[0].lim, s[0].has_pending]).toEqual([3000, false]);
  });

  it("rolls over the day at midnight Pacific, the week on Monday and the month on the 1st, across the DST change", async () => {
    const u = await makeUser(db, { credits: 90_000 });
    const p = await makeProduct(db, { boxes: 3 });
    await lim(u, "daily", 1000); await lim(u, "weekly", 2000); await lim(u, "monthly", 3000);
    const at = (t: string, qty = 1) => atTime(db, t, "select place_order($1, $2, $3) as id", [u, p, qty]);
    await at("2026-10-31T23:30:00-07:00");                                                // Sat Oct 31, 11:30pm PDT
    await expect(at("2026-10-31T23:59:00-07:00")).rejects.toThrow(/daily_limit_reached/);
    // Nov 1 is a new month and a new day (DST ends at 2am, still Pacific midnight for the reset).
    await at("2026-11-01T00:01:00-07:00");
    await expect(at("2026-11-01T12:00:00-08:00")).rejects.toThrow(/daily_limit_reached/);
    await at("2026-11-02T00:00:00-08:00");                                               // Monday: new week, new day
    const s = await summary(u, "2026-11-02T00:00:00-08:00");
    expect(s.map((r) => r.spent)).toEqual([900, 900, 1800]);
    expect(new Date(s[0].resets_at).toISOString()).toBe("2026-11-03T08:00:00.000Z");    // midnight PST
  });

  it("checks concurrent orders at the limit one at a time: never over", async () => {
    const u = await makeUser(db, { credits: 50_000 });
    const p = await makeProduct(db, { boxes: 2 });
    await lim(u, "daily", 2700);
    const results = await Promise.allSettled(Array.from({ length: 8 }, () => order(u, p, 1)));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(3);
    expect(results.filter((r) => r.status === "rejected").every((r) => /daily_limit_reached/.test(String((r as PromiseRejectedResult).reason)))).toBe(true);
    expect(Number((await atTime(db, BEFORE_CUTOFF, "select spent_in_window($1, 'daily') as s", [u]))[0].s)).toBe(2700);
  });

  it("releases the count when an order is cancelled", async () => {
    const u = await makeUser(db, { credits: 50_000 });
    const p = await makeProduct(db, { boxes: 2 });
    await lim(u, "daily", 900);
    const id = await order(u, p, 1);
    await expect(order(u, p, 1)).rejects.toThrow(/daily_limit_reached/);
    await atTime(db, BEFORE_CUTOFF, "select cancel_order($1, $2)", [id, u]);
    await expect(order(u, p, 1)).resolves.toBeTruthy();
  });
});

describe("breaks", () => {
  it("offers 24 hours, 7 days or 30 days, blocks orders and adding credit, and can't be shortened", async () => {
    const u = await makeUser(db, { credits: 50_000 });
    const p = await makeProduct(db);
    await expect(atTime(db, T, "select take_break($1, 48)", [u])).rejects.toThrow(/invalid_break/);
    const [{ until }] = await atTime(db, T, "select take_break($1, 168) as until", [u]);
    expect(new Date(until).toISOString()).toBe("2026-10-08T17:00:00.000Z");
    const [{ until: again }] = await atTime(db, T, "select take_break($1, 24) as until", [u]);
    expect(again).toEqual(until);                                                   // shorter pick never shortens
    await expect(order(u, p, 1, "2026-10-05T10:00:00-07:00")).rejects.toThrow(/on_break/);
    await expect(atTime(db, T, "select assert_not_on_break($1)", [u])).rejects.toThrow(/on_break/);
    // Loosening is refused during a break; tightening is still allowed.
    await lim(u, "daily", 5000, "2026-09-30T10:00:00-07:00");
    await expect(lim(u, "daily", null, "2026-10-05T10:00:00-07:00")).rejects.toThrow(/on_break/);
    expect(await lim(u, "daily", 1000, "2026-10-05T10:00:00-07:00")).toBe("applied");
    // It ends by itself.
    await expect(order(u, p, 1, "2026-10-08T10:01:00-07:00")).resolves.toBeTruthy();
    expect(await atTime(db, "2026-10-08T10:01:00-07:00", "select user_id from due_break_end_emails()")).toEqual([{ user_id: u }]);
    await atTime(db, "2026-10-08T10:01:00-07:00", "select mark_break_end_emailed($1)", [u]);
    expect(await atTime(db, "2026-10-08T10:02:00-07:00", "select user_id from due_break_end_emails()")).toEqual([]);
  });

  it("records an early end request, and only staff can lift a break, with a reason", async () => {
    const u = await makeUser(db, { credits: 50_000 });
    const staff = await makeUser(db, { role: "staff" });
    const p = await makeProduct(db);
    await expect(atTime(db, T, "select request_break_end($1)", [u])).rejects.toThrow(/not_on_break/);
    await atTime(db, T, "select take_break($1, 720)", [u]);
    const [{ id }] = await atTime(db, T, "select request_break_end($1) as id", [u]);
    const [{ id: same }] = await atTime(db, T, "select request_break_end($1) as id", [u]);
    expect(same).toBe(id);
    await expect(atTime(db, T, "select lift_break($1, '  ', $2)", [u, staff])).rejects.toThrow(/reason_required/);
    await atTime(db, T, "select lift_break($1, 'Customer emailed, confirmed by phone', $2)", [u, staff]);
    expect(await db.one("select resolved_by from break_end_requests where id = $1", [id])).toEqual({ resolved_by: staff });
    await expect(order(u, p, 1, BEFORE_CUTOFF)).resolves.toBeTruthy();
    const ev = await db.q("select kind, reason from spend_limit_events where user_id = $1 order by id", [u]);
    expect(ev.map((e) => e.kind)).toEqual(["break_started", "break_end_requested", "break_lifted"]);
    expect(ev[2].reason).toBe("Customer emailed, confirmed by phone");
  });
});
