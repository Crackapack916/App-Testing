import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import pg from "pg";
import { StripeProcessor } from "@crackapack/payments";
import { createApp } from "./app";
import { expoPush } from "./push";

const env = process.env;
const required = (k: string) => {
  const v = env[k];
  if (!v) throw new Error(`${k} is required`);
  return v;
};

// Pilot conveniences must never reach a production server: dev login signs anyone in
// as any email, and the test clock would let a customer order after the cutoff.
if (env.NODE_ENV === "production" && (env.DEV_LOGIN === "1" || env.TEST_CLOCK === "1")) {
  throw new Error("DEV_LOGIN and TEST_CLOCK are not allowed when NODE_ENV=production");
}

const pool = new pg.Pool({ connectionString: required("DATABASE_URL"), max: 10 });
// PUSH=log prints instead of sending (local and e2e runs).
const push = env.PUSH === "log"
  ? { async send(userId: string, title: string, body: string) { console.log(`[push] ${userId}: ${title} / ${body}`); } }
  : expoPush(pool, fetch, env.EXPO_ACCESS_TOKEN);

const app = createApp({
  pool,
  jwtSecret: required("JWT_SECRET"),
  payments: env.STRIPE_SECRET_KEY
    ? new StripeProcessor({
        secretKey: env.STRIPE_SECRET_KEY,
        webhookSecret: env.STRIPE_WEBHOOK_SECRET ?? "",
        livemode: env.STRIPE_LIVEMODE === "true",
      })
    : undefined,
  push,
  devLogin: env.DEV_LOGIN === "1",
  devStaffEmails: (env.DEV_STAFF_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean),
  testClock: env.TEST_CLOCK === "1",
});

// Serve the built staff tool from the same origin, if present.
if (env.STAFF_DIST) app.use("/ops/*", serveStatic({ root: env.STAFF_DIST, rewriteRequestPath: (p) => p.replace(/^\/ops/, "") }));

const port = Number(env.PORT ?? 8787);
serve({ fetch: app.fetch, port });
console.log(`api listening on :${port}`);
