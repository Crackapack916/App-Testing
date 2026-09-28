import { Hono } from "hono";
import { ApiError } from "../errors";
import { issueToken, requireUser } from "../auth";
import { encryptDob, hashPassword, hashToken, newToken, realDate, verifyPassword } from "../secrets";
import type { Env } from "../context";

/** Email and password accounts. Date of birth is asked only at sign up. */
export const auth = new Hono<Env>();

const MIN_PASSWORD = 8;

auth.post("/signup", async (c) => {
  const { email, password, dob, accept_terms } = await c.req.json<{
    email: string; password: string; dob: { month: string; day: string; year: string }; accept_terms: boolean }>();
  if (!accept_terms) throw new ApiError("terms_required");
  if (typeof password !== "string" || password.length < MIN_PASSWORD) throw new ApiError("weak_password");
  const birthdate = realDate(dob?.month, dob?.day, dob?.year);
  if (!birthdate) throw new ApiError("invalid_birthdate");
  const { dobKey, jwtSecret } = c.get("services");
  if (!dobKey) throw new ApiError("signup_unavailable");
  const { rows: [r] } = await c.get("db").query("select register_account($1, $2, $3, $4, null) as id",
    [email, await hashPassword(password), birthdate, encryptDob(birthdate, dobKey)]);
  return c.json({ token: await issueToken(r.id, jwtSecret), user_id: r.id }, 201);
});

auth.post("/login", async (c) => {
  const { email, password } = await c.req.json<{ email: string; password: string }>();
  const { rows: [u] } = await c.get("db").query("select id, password_hash from users where email = lower(trim($1))", [email ?? ""]);
  // Same answer for an unknown email and a wrong password.
  if (!u || !(await verifyPassword(String(password ?? ""), u.password_hash))) throw new ApiError("invalid_login");
  return c.json({ token: await issueToken(u.id, c.get("services").jwtSecret), user_id: u.id });
});

auth.post("/forgot", async (c) => {
  const { email } = await c.req.json<{ email: string }>();
  const token = newToken();
  const { rows: [r] } = await c.get("db").query("select create_password_reset($1, $2) as user_id", [email ?? "", hashToken(token)]);
  const { email: mailer, appUrl } = c.get("services");
  if (r.user_id) {
    await mailer.send({ kind: "password_reset", to: String(email).trim().toLowerCase(),
      data: { link: `${appUrl}/reset-password?token=${encodeURIComponent(token)}` } });
  }
  // Always the same reply, whether or not the email has an account.
  return c.json({ ok: true });
});

auth.post("/reset", async (c) => {
  const { token, password } = await c.req.json<{ token: string; password: string }>();
  if (typeof password !== "string" || password.length < MIN_PASSWORD) throw new ApiError("weak_password");
  const { rows: [r] } = await c.get("db").query("select use_password_reset($1, $2) as id", [hashToken(String(token ?? "")), await hashPassword(password)]);
  return c.json({ token: await issueToken(r.id, c.get("services").jwtSecret), user_id: r.id });
});

/** Accounts made before sign up asked for a birthdate confirm it once. */
auth.post("/confirm-age", requireUser(), async (c) => {
  const { dob } = await c.req.json<{ dob: { month: string; day: string; year: string } }>();
  const birthdate = realDate(dob?.month, dob?.day, dob?.year);
  if (!birthdate) throw new ApiError("invalid_birthdate");
  const { dobKey } = c.get("services");
  if (!dobKey) throw new ApiError("signup_unavailable");
  await c.get("db").query("select confirm_age($1, $2, $3)", [c.get("user").id, birthdate, encryptDob(birthdate, dobKey)]);
  return c.json({ ok: true });
});
