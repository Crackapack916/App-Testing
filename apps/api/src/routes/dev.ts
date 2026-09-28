import { Hono } from "hono";
import { issueToken } from "../auth";
import { ApiError } from "../errors";
import type { Env } from "../context";

/**
 * Pilot sign in, standing in until real auth is wired. Only mounted when DEV_LOGIN=1,
 * and refused unless the database itself is in test mode.
 */
export const dev = new Hono<Env>();

dev.post("/login", async (c) => {
  const db = c.get("db");
  const { rows: [cfg] } = await db.query("select mode from system_config");
  if (cfg.mode !== "test") throw new ApiError("forbidden");
  // Customers verify their own age in the app (set_profile). Tests may pass verified: true.
  const { email, role: asked, display_name, verified } = await c.req.json<{ email: string; role?: string; display_name?: string; verified?: boolean }>();
  // Only allowlisted emails may become staff; everyone else is a customer.
  const staffOk = (c.get("services").devStaffEmails ?? []).includes(String(email).toLowerCase());
  if (asked && asked !== "customer" && !staffOk) throw new ApiError("forbidden");
  const role = asked === "staff" && staffOk ? "staff" : null;
  const { rows: [u] } = await db.query(
    `insert into users (email, display_name, role, age_verified_at, state_code)
     values ($1, $2, coalesce($3, 'customer'), case when $4 then now() end, case when $4 then 'CA' end)
     on conflict (email) do update set display_name = coalesce(excluded.display_name, users.display_name)
     returning id, role`, [email, display_name ?? null, role ?? null, verified === true]);
  // A verified pilot account stands for one that has signed up and passed its first purchase
  // checks, so it has accepted the current Terms and Privacy Policy.
  if (verified === true) await db.query("select accept_policies_at_purchase($1) where needs_policy_acceptance($1)", [u.id]);
  return c.json({ token: await issueToken(u.id, c.get("services").jwtSecret), user_id: u.id, role: u.role });
});
