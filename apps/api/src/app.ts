import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Env, Services } from "./context";
import { toResponse } from "./errors";
import { customer } from "./routes/customer";
import { staff } from "./routes/staff";
import { webhooks } from "./routes/webhooks";
import { dev } from "./routes/dev";

export function createApp(services: Services) {
  const app = new Hono<Env>();
  app.use("*", cors());

  // One pooled connection per request. In test mode, X-Test-Now pins app_now() for it.
  app.use("*", async (c, next) => {
    c.set("services", services);
    if (c.req.path.startsWith("/webhooks/")) return next(); // uses the pool directly for its own transaction
    const db = await services.pool.connect();
    c.set("db", db);
    const pinned = services.testClock ? c.req.header("x-test-now") ?? "" : "";
    try {
      await db.query("select set_config('app.now_override', $1, false)", [pinned]);
      await next();
    } finally {
      await db.query("select set_config('app.now_override', '', false)").catch(() => {});
      db.release();
    }
  });

  app.onError((e, c) => {
    const { status, body } = toResponse(e);
    return c.json(body, status as 400);
  });

  app.get("/health", (c) => c.json({ ok: true }));
  app.route("/", customer);
  app.route("/staff", staff);
  app.route("/webhooks", webhooks);
  if (services.devLogin) app.route("/dev", dev);
  return app;
}
