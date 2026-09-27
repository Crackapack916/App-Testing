import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { freshDb, type Db } from "./db";

let db: Db;
beforeEach(async () => { db = await freshDb(); });
afterEach(async () => { await db.close(); });

const upsert = (auth: string, email: string | null) => db.one("select upsert_auth_user($1, $2) as id", [auth, email]).then((r) => r.id);

describe("identity provider accounts", () => {
  it("creates a user on first sign in and returns the same user after", async () => {
    const a = await upsert("user_1", "Alice@X.test");
    expect(await upsert("user_1", null)).toBe(a);
    expect(await db.one("select email, auth_user_id from users where id = $1", [a])).toEqual({ email: "alice@x.test", auth_user_id: "user_1" });
  });

  it("links an existing unlinked account by email, and refuses an email linked elsewhere", async () => {
    const [{ id: legacy }] = await db.q("insert into users (email) values ('bob@x.test') returning id");
    expect(await upsert("user_2", "BOB@x.test")).toBe(legacy);
    await expect(upsert("user_3", "bob@x.test")).rejects.toThrow(/email_in_use/);
  });

  it("needs an email for a brand new account", async () => {
    await expect(upsert("user_4", null)).rejects.toThrow(/email_required/);
    await expect(upsert("", "x@x.test")).rejects.toThrow(/auth_id_required/);
  });
});

describe("roles", () => {
  it("promotes by email, rejects unknown roles and users, and logs the change", async () => {
    await upsert("user_9", "ops@x.test");
    await db.q("select set_user_role('OPS@x.test', 'staff', null)");
    expect((await db.one("select role from users where email = 'ops@x.test'")).role).toBe("staff");
    await expect(db.q("select set_user_role('ops@x.test', 'god', null)")).rejects.toThrow(/invalid_role/);
    await expect(db.q("select set_user_role('nobody@x.test', 'staff', null)")).rejects.toThrow(/unknown_user/);
    expect(await db.q("select event_type from custody_events")).toEqual([{ event_type: "role_changed" }]);
  });
});
