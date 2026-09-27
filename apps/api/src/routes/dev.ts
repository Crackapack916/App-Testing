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
  const { email, role, display_name } = await c.req.json<{ email: string; role?: string; display_name?: string }>();
  const { rows: [u] } = await db.query(
    `insert into users (email, display_name, role, age_verified_at, state_code)
     values ($1, $2, coalesce($3, 'customer'), now(), 'CA')
     on conflict (email) do update set display_name = coalesce(excluded.display_name, users.display_name)
     returning id, role`, [email, display_name ?? null, role ?? null]);
  return c.json({ token: await issueToken(u.id, c.get("services").jwtSecret), user_id: u.id, role: u.role });
});
