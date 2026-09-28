import { sign, verify } from "hono/jwt";
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

/** Sets the user when a valid token is sent; guests continue without one. */
export function optionalUser(): MiddlewareHandler<Env> {
  return async (c, next) => {
    const header = c.req.header("authorization") ?? "";
    if (header.startsWith("Bearer ")) {
      try {
        const userId = await resolveUserId(c, header.slice(7));
        const { rows } = await c.get("db").query<User>("select id, role, display_name from users where id = $1", [userId]);
        if (rows[0]) c.set("user", rows[0]);
      } catch { /* an expired token browses as a guest */ }
    }
    await next();
  };
}

/** Tokens are issued by /auth/login, /auth/signup and /auth/reset (or /dev/login in tests). */
async function resolveUserId(c: Context<Env>, token: string): Promise<string> {
  try {
    return String((await verify(token, c.get("services").jwtSecret, "HS256")).sub);
  } catch {
    throw new ApiError("unauthenticated");
  }
}
