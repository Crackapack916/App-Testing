import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { atTime, freshDb, type Db } from "./db";

let db: Db;
beforeEach(async () => { db = await freshDb(); });
afterEach(async () => { await db.close(); });

const T0 = "2026-10-01T12:00:00-07:00";
const fail = (at: string, email = "a@x.test") => atTime(db, at, "select record_login_failure($1)", [email]);
const check = (at: string, email = "a@x.test") => atTime(db, at, "select assert_login_allowed($1)", [email]);
const reset = (at: string, token: string, email = "a@x.test") =>
  atTime(db, at, "select create_password_reset($1, $2) as u", [email, token]).then((r) => r[0].u as string | null);

describe("login limit", () => {
  it("locks an email after 10 wrong passwords in 15 minutes, per email, until the window passes", async () => {
    for (let i = 0; i < 9; i++) await fail(T0);
    await expect(check(T0)).resolves.toBeTruthy();
    await fail(T0);
    await expect(check(T0)).rejects.toThrow(/too_many_attempts/);
    await expect(check(T0, " A@X.test ")).rejects.toThrow(/too_many_attempts/);
    await expect(check(T0, "b@x.test")).resolves.toBeTruthy();
    await expect(check("2026-10-01T12:16:00-07:00")).resolves.toBeTruthy();
  });

  it("is ended by a password reset", async () => {
    await db.q("insert into users (email, display_name, password_hash) values ('a@x.test', 'a', 'scrypt$x')");
    for (let i = 0; i < 10; i++) await fail(T0);
    await expect(check(T0)).rejects.toThrow(/too_many_attempts/);
    await reset(T0, "tok");
    await atTime(db, "2026-10-01T12:01:00-07:00", "select use_password_reset('tok', 'scrypt$y')");
    await expect(check("2026-10-01T12:02:00-07:00")).resolves.toBeTruthy();
  });

  it("keeps attempts append only", async () => {
    await fail(T0);
    await expect(db.q("delete from auth_attempts")).rejects.toThrow();
  });
});

describe("password reset limit", () => {
  it("sends at most 3 resets an hour per email, with the same reply for unknown emails", async () => {
    await db.q("insert into users (email, display_name, password_hash) values ('a@x.test', 'a', 'scrypt$x')");
    expect(await reset(T0, "t1")).toBeTruthy();
    expect(await reset(T0, "t2")).toBeTruthy();
    expect(await reset(T0, "t3")).toBeTruthy();
    expect(await reset(T0, "t4")).toBeNull();
    expect(await reset("2026-10-01T13:01:00-07:00", "t5")).toBeTruthy();
    expect(await reset(T0, "t6", "nobody@x.test")).toBeNull();
  });

  it("holds the limit when requests arrive at once", async () => {
    await db.q("insert into users (email, display_name, password_hash) values ('a@x.test', 'a', 'scrypt$x')");
    const sent = await Promise.all([1, 2, 3, 4, 5, 6].map((i) => reset(T0, `c${i}`)));
    expect(sent.filter(Boolean)).toHaveLength(3);
  });
});
