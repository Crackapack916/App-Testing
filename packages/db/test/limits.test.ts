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

describe("spending limits", () => {
  it("caps orders in a rolling 24 hours at the platform maximum by default", async () => {
    await db.q("update system_config set max_daily_spend_credits = 2000");
    const u = await makeUser(db, { credits: 50_000 });
    const p = await makeProduct(db, { boxes: 2 });
    await order(u, p, 1, "2026-10-01T08:00:00-07:00");
    await order(u, p, 1, "2026-10-01T09:00:00-07:00");
    await expect(order(u, p, 1, "2026-10-01T10:00:00-07:00")).rejects.toThrow(/daily_limit_reached/);
    // A day later the earlier orders have rolled out of the 24 hour window.
    await expect(order(u, p, 1, "2026-10-02T09:30:00-07:00")).resolves.toBeTruthy();
  });

  it("applies a lower limit immediately and a higher one only after 24 hours", async () => {
    const u = await makeUser(db, { credits: 50_000 });
    const p = await makeProduct(db, { boxes: 2 });
    await atTime(db, "2026-10-01T08:00:00-07:00", "select set_spend_limits($1, 1000, null)", [u]);
    await order(u, p, 1, "2026-10-01T08:30:00-07:00");
    await expect(order(u, p, 1, "2026-10-01T09:00:00-07:00")).rejects.toThrow(/daily_limit_reached/);
    await atTime(db, "2026-10-01T09:00:00-07:00", "select set_spend_limits($1, 5000, null)", [u]);
    await expect(order(u, p, 1, "2026-10-01T10:00:00-07:00")).rejects.toThrow(/daily_limit_reached/);
    const eff = await atTime(db, "2026-10-02T09:01:00-07:00", "select * from effective_spend_limits($1)", [u]);
    expect(Number(eff[0].daily)).toBe(5000);
  });

  it("never lets a customer set a limit above the platform maximum", async () => {
    const u = await makeUser(db);
    await atTime(db, T, "select set_spend_limits($1, 99999999, 99999999)", [u]);
    const eff = await atTime(db, "2026-10-03T00:00:00Z", "select * from effective_spend_limits($1)", [u]);
    expect([Number(eff[0].daily), Number(eff[0].monthly)]).toEqual([25000, 100000]);
  });

  it("enforces the limit when one customer places orders concurrently", async () => {
    await db.q("update system_config set max_daily_spend_credits = 2700");
    const u = await makeUser(db, { credits: 50_000 });
    const p = await makeProduct(db, { boxes: 2 });
    const results = await Promise.allSettled(Array.from({ length: 8 }, () => order(u, p, 1)));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(3);
    expect(Number((await db.one("select spent_on_packs($1, '24 hours') as s", [u])).s)).toBe(2700);
  });

  it("blocks ordering during a break, which can be extended but not shortened", async () => {
    const u = await makeUser(db, { credits: 50_000 });
    const p = await makeProduct(db);
    const [{ until }] = await atTime(db, T, "select take_break($1, 7) as until", [u]);
    await expect(order(u, p, 1, "2026-10-05T10:00:00-07:00")).rejects.toThrow(/on_break/);
    const [{ until: again }] = await atTime(db, T, "select take_break($1, 1) as until", [u]);
    expect(new Date(again).getTime()).toBe(new Date(until).getTime());
    await expect(order(u, p, 1, "2026-10-08T11:00:00-07:00")).resolves.toBeTruthy();
  });
});
