import { Hono } from "hono";
import { cors } from "hono/cors";
import { bodyLimit } from "hono/body-limit";
import type { Env, ServiceOptions, Services } from "./context";
import { logEmail } from "./email";
import { toResponse } from "./errors";
import { customer } from "./routes/customer";
import { staff } from "./routes/staff";
import { webhooks } from "./routes/webhooks";
import { dev } from "./routes/dev";
import { cards } from "./routes/cards";
import { auth } from "./routes/auth";
import { drops } from "./routes/drops";
import { localVideoFiles } from "./routes/local-videos";

export function createApp(options: ServiceOptions) {
  const services: Services = { email: logEmail(), dobKey: null, appUrl: "http://localhost:8081", ...options };
  const app = new Hono<Env>();
  app.use("*", cors());
  // Local video uploads (pilot and tests only) are the one exception to the size cap.
  const limit = bodyLimit({ maxSize: 256 * 1024, onError: (c) => c.json({ error: "payload_too_large", message: "Request too large." }, 413) });
  app.use("*", (c, next) => c.req.method === "PUT" && c.req.path.startsWith("/staff/videos/local/") ? next() : limit(c, next));

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
  app.route("/auth", auth);
  app.route("/", cards);
  app.route("/", drops);
  app.route("/", localVideoFiles);
  app.route("/", customer);
  app.route("/staff", staff);
  app.route("/webhooks", webhooks);
  if (services.devLogin) app.route("/dev", dev);
  return app;
}
