import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import pg from "pg";
import { StripeProcessor } from "@crackapack/payments";
import { createApp } from "./app";
import type { PushService } from "./context";

const env = process.env;
const required = (k: string) => {
  const v = env[k];
  if (!v) throw new Error(`${k} is required`);
  return v;
};

// Placeholder until Expo push tokens are stored: logs what would be sent.
const push: PushService = {
  async send(userId, title, body) {
    console.log(`[push] ${userId}: ${title} / ${body}`);
  },
};

const app = createApp({
  pool: new pg.Pool({ connectionString: required("DATABASE_URL"), max: 10 }),
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
  testClock: env.TEST_CLOCK === "1",
});

// Serve the built staff tool from the same origin, if present.
if (env.STAFF_DIST) app.use("/ops/*", serveStatic({ root: env.STAFF_DIST, rewriteRequestPath: (p) => p.replace(/^\/ops/, "") }));

const port = Number(env.PORT ?? 8787);
serve({ fetch: app.fetch, port });
console.log(`api listening on :${port}`);
