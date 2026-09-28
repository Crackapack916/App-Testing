/**
 * Starts the API for end to end tests: a fresh database cloned from the migrated
 * template, seeded with a night's orders placed before the 7pm cutoff, serving the
 * built staff tool at /ops.
 */
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import setup from "../../../packages/db/test/global-setup";
import { freshDb } from "../../../packages/db/test/db";
import { makeCard, makeProduct } from "../../../packages/db/test/fixtures";
import { hashPassword } from "../../api/src/secrets";

await setup();
const db = await freshDb();
const at = (t: string, sql: string, params: unknown[]) =>
  db.pool.connect().then(async (c) => {
    try {
      await c.query("select set_config('app.now_override', $1, false)", [t]);
      return (await c.query(sql, params)).rows;
    } finally {
      c.release();
    }
  });

const product = await makeProduct(db, { setCode: "FDN", boxes: 2 });
await db.q("insert into mtg_sets (code, name, release_date) values ('EOE', 'Edge of Eternities', '2025-08-01')");
await makeCard(db, { set: "FDN", num: "101", rarity: "mythic", priceCents: 4500 });
await makeCard(db, { set: "FDN", num: "7", rarity: "common", priceCents: 8 });
await makeCard(db, { set: "FDN", num: "55", rarity: "uncommon", priceCents: 25, foilPriceCents: 90 });
for (const [i, [name, qty]] of ([["alice", 2], ["bob", 1]] as const).entries()) {
  const [u] = await db.q(
    "insert into users (email, display_name, age_verified_at, state_code) values ($1, $2, now(), 'CA') returning id",
    [`${name}@e2e.test`, name]);
  await db.q("select purchase_credits($1, 10000, gen_random_uuid()::text)", [u.id]);
  await at(`2026-10-01T1${i}:00:00-07:00`, "select place_order($1, $2, $3)", [u.id, product, qty]);
}
await db.q("insert into users (email, display_name, role, age_verified_at, password_hash) values ('ops@e2e.test', 'ops', 'staff', now(), $1)",
  [await hashPassword("ops password")]);
await db.pool.end();

const child = spawn("npx", ["tsx", resolve("../api/src/server.ts")], {
  stdio: "inherit",
  env: {
    ...process.env,
    DATABASE_URL: db.url,
    JWT_SECRET: "e2e-secret",
    DEV_LOGIN: "1",
    TEST_CLOCK: "1",
    PUSH: "log",
    DEV_STAFF_EMAILS: "ops@e2e.test",
    STAFF_DIST: resolve("dist"),
    PORT: process.env.E2E_PORT ?? "8788",
  },
});
const stop = () => { child.kill(); process.exit(0); };
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
