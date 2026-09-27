import { sign, verify } from "hono/jwt";
import type { MiddlewareHandler } from "hono";
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
    let sub: string;
    try {
      sub = String((await verify(token, c.get("services").jwtSecret, "HS256")).sub);
    } catch {
      throw new ApiError("unauthenticated");
    }
    const { rows } = await c.get("db").query<User>("select id, role, display_name from users where id = $1", [sub]);
    const user = rows[0];
    if (!user) throw new ApiError("unauthenticated");
    if (roles.length && !roles.includes(user.role) && user.role !== "admin") throw new ApiError("forbidden");
    c.set("user", user);
    await next();
  };
}
