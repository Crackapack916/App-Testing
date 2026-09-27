import { sign, verify } from "hono/jwt";
import { verifyToken } from "@clerk/backend";
import type { Context, MiddlewareHandler } from "hono";
import { ApiError } from "./errors";
import type { Env, Role, User } from "./context";

const TTL_SECONDS = 60 * 60 * 24 * 30;

export async function issueToken(userId: string, secret: string) {
  return sign({ sub: userId, exp: Math.floor(Date.now() / 1000) + TTL_SECONDS }, secret, "HS256");
}

/** Resolves the bearer token to a user. Role is read fresh each request. */
export function requireUser(...roles: Role[]): MiddlewareHandler<Env> {
  return async (c, next) => {
    const header = c.req.header("authorization") ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!token) throw new ApiError("unauthenticated");
    const userId = await resolveUserId(c, token);
    const { rows } = await c.get("db").query<User>("select id, role, display_name from users where id = $1", [userId]);
    const user = rows[0];
    if (!user) throw new ApiError("unauthenticated");
    if (roles.length && !roles.includes(user.role) && user.role !== "admin") throw new ApiError("forbidden");
    c.set("user", user);
    await next();
  };
}

/**
 * A Clerk session token (production), or a pilot token from /dev/login (test mode only).
 * Returns our internal user id; a first Clerk sign in creates or links the user.
 */
async function resolveUserId(c: Context<Env>, token: string): Promise<string> {
  const { clerk, devLogin, jwtSecret } = c.get("services");
  if (clerk) {
    try {
      const claims = await verifyToken(token, { jwtKey: clerk.jwtKey, authorizedParties: clerk.authorizedParties });
      const email = typeof claims.email === "string" ? claims.email : null;
      const { rows: [r] } = await c.get("db").query("select upsert_auth_user($1, $2) as id", [claims.sub, email]);
      return r.id;
    } catch (e) {
      if (/email_in_use|email_required/.test(String(e))) throw e;
      if (!devLogin) throw new ApiError("unauthenticated");
    }
  }
  try {
    return String((await verify(token, jwtSecret, "HS256")).sub);
  } catch {
    throw new ApiError("unauthenticated");
  }
}
