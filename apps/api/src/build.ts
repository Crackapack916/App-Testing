import pg from "pg";
import { StripeProcessor } from "@crackapack/payments";
import { createApp } from "./app";
import { expoPush } from "./push";
import { linkClips, muxClips } from "./clips";

/** Builds the API from environment variables. Shared by the Node server and the Vercel entry. */
export function appFromEnv(env: NodeJS.ProcessEnv = process.env) {
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

  // Production signs in only through Clerk.
  if (env.NODE_ENV === "production" && !env.CLERK_JWT_KEY) throw new Error("CLERK_JWT_KEY is required when NODE_ENV=production");

  // Serverless instances should each hold only a few connections (PG_POOL_MAX=3 on Vercel).
  const pool = new pg.Pool({ connectionString: required("DATABASE_URL"), max: Number(env.PG_POOL_MAX ?? 10) });
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
    clerk: env.CLERK_JWT_KEY
      ? { jwtKey: env.CLERK_JWT_KEY, authorizedParties: env.CLERK_AUTHORIZED_PARTIES?.split(",").map((s) => s.trim()).filter(Boolean) }
      : undefined,
    clips: env.MUX_TOKEN_ID
      ? muxClips({ tokenId: env.MUX_TOKEN_ID, tokenSecret: required("MUX_TOKEN_SECRET"), liveStreamId: required("MUX_LIVE_STREAM_ID"), webhookSecret: required("MUX_WEBHOOK_SECRET") })
      : linkClips,
    muxWebhookSecret: env.MUX_WEBHOOK_SECRET,
    devLogin: env.DEV_LOGIN === "1",
    devStaffEmails: (env.DEV_STAFF_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean),
    testClock: env.TEST_CLOCK === "1",
  });
  return app;
}
