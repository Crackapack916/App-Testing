import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { freshDb, type Db } from "../../../packages/db/test/db";
import { createApp } from "../src/app";
import { linkClips } from "../src/clips";
import { logEmail, type EmailMessage } from "../src/email";
import { decryptDob } from "../src/secrets";

const KEY = Buffer.alloc(32, 9);
let db: Db;
let sent: EmailMessage[];
let app: ReturnType<typeof createApp>;
beforeEach(async () => {
  db = await freshDb();
  sent = [];
  app = createApp({ pool: db.pool, jwtSecret: "s", devLogin: false, testClock: true,
    clips: linkClips, dobKey: KEY, email: logEmail(sent), appUrl: "https://app.test" });
});
afterEach(async () => { await db.close(); });

const call = async (method: string, path: string, body?: unknown, opts: { token?: string; at?: string } = {}) => {
  const r = await app.request(path, { method, headers: { "content-type": "application/json",
    ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}), ...(opts.at ? { "x-test-now": opts.at } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json() as any };
};
const signup = (email: string, dob: [string, string, string], at = "2026-10-01T12:00:00-07:00", password = "correct horse") =>
  call("POST", "/auth/signup", { email, password, dob: { month: dob[0], day: dob[1], year: dob[2] }, accept_terms: true }, { at });

describe("sign up", () => {
  it("creates an 18+ account, stores only the encrypted birthdate, and records the policies accepted", async () => {
    const r = await signup("New@Example.com", ["10", "01", "2008"]); // 18 today in Pacific
    expect(r.status).toBe(201);
    const me = await call("GET", "/me", undefined, { token: r.body.token });
    expect(me.body).toMatchObject({ email: "new@example.com", age_verified: true });
    const u = await db.one("select birthdate, dob_encrypted, age_verified_at is not null as ok from users where email = 'new@example.com'");
    expect(u.birthdate).toBeNull();
    expect(u.dob_encrypted).not.toContain("2008");
    expect(decryptDob(u.dob_encrypted, KEY)).toBe("2008-10-01");
    expect(u.ok).toBe(true);
    expect(await db.q("select doc, context from policy_acceptances order by doc")).toEqual([
      { doc: "privacy", context: "signup" }, { doc: "terms", context: "signup" }]);
  });

  it("refuses under 18 on the sign up date, in Pacific time", async () => {
    // 18th birthday is Oct 2. At 11pm Pacific on Oct 1 it is already Oct 2 in UTC, but not in Pacific.
    const r = await signup("young@x.test", ["10", "02", "2008"], "2026-10-01T23:30:00-07:00");
    expect([r.status, r.body.message]).toEqual([403, "You must be 18 or older to use CrackAPack."]);
    expect((await signup("young@x.test", ["10", "02", "2008"], "2026-10-02T00:05:00-07:00")).status).toBe(201);
  });

  it("rejects impossible dates, weak passwords, missing terms, and a reused email", async () => {
    expect((await signup("a@x.test", ["02", "30", "1990"])).body.error).toBe("invalid_birthdate");
    expect((await signup("a@x.test", ["13", "01", "1990"])).body.error).toBe("invalid_birthdate");
    expect((await signup("a@x.test", ["1", "1", "1990"], undefined, "short")).body.error).toBe("weak_password");
    expect((await call("POST", "/auth/signup", { email: "a@x.test", password: "long enough", dob: { month: "1", day: "1", year: "1990" } })).body.error).toBe("terms_required");
    expect((await signup("a@x.test", ["02", "29", "2000"])).status).toBe(201);
    expect((await signup("A@x.test", ["01", "01", "1990"])).body.error).toBe("email_in_use");
  });
});

describe("log in and password reset", () => {
  it("logs in with the right password only, and gives the same answer for an unknown email", async () => {
    await signup("p@x.test", ["01", "01", "1990"]);
    expect((await call("POST", "/auth/login", { email: " P@x.test ", password: "correct horse" })).status).toBe(200);
    const wrong = await call("POST", "/auth/login", { email: "p@x.test", password: "nope nope" });
    const unknown = await call("POST", "/auth/login", { email: "who@x.test", password: "nope nope" });
    expect([wrong.status, wrong.body.error]).toEqual([401, "invalid_login"]);
    expect(unknown.body).toEqual(wrong.body);
  });

  it("emails a one time reset link that expires", async () => {
    await signup("r@x.test", ["01", "01", "1990"]);
    expect((await call("POST", "/auth/forgot", { email: "nobody@x.test" })).body).toEqual({ ok: true });
    expect(sent).toHaveLength(0);
    await call("POST", "/auth/forgot", { email: "r@x.test" }, { at: "2026-10-01T12:00:00Z" });
    expect(sent.map((m) => [m.kind, m.to])).toEqual([["password_reset", "r@x.test"]]);
    const token = new URL(String(sent[0].data.link)).searchParams.get("token")!;
    expect(String(sent[0].data.link)).toMatch(/^https:\/\/app\.test\/reset-password\?token=/);
    expect((await call("POST", "/auth/reset", { token, password: "new password" }, { at: "2026-10-01T13:01:00Z" })).body.error).toBe("reset_link_invalid");
    expect((await call("POST", "/auth/reset", { token, password: "new password" }, { at: "2026-10-01T12:30:00Z" })).status).toBe(200);
    expect((await call("POST", "/auth/reset", { token, password: "again again" }, { at: "2026-10-01T12:31:00Z" })).body.error).toBe("reset_link_invalid");
    expect((await call("POST", "/auth/login", { email: "r@x.test", password: "new password" })).status).toBe(200);
  });
});
