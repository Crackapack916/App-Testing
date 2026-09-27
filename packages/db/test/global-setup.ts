import pg from "pg";
import { migrate } from "../scripts/migrate";

// Builds a migrated template database once. Each test file clones it (see db.ts).
export default async function setup() {
  const admin = process.env.DATABASE_URL ?? "postgres://postgres@127.0.0.1:54329/postgres";
  const c = await connectWhenReady(admin);
  await c.query("drop database if exists crackapack_template");
  await c.query("create database crackapack_template");
  await c.end();
  await migrate(withDb(admin, "crackapack_template"));
  process.env.TEST_ADMIN_URL = admin;
}

export function withDb(url: string, db: string) {
  const u = new URL(url);
  u.pathname = "/" + db;
  return u.toString();
}

// The session start hook may still be bringing Postgres up. Wait up to 60s before failing.
async function connectWhenReady(url: string) {
  const deadline = Date.now() + 60_000;
  for (;;) {
    const c = new pg.Client({ connectionString: url });
    try {
      await c.connect();
      return c;
    } catch (e) {
      await c.end().catch(() => {});
      if (Date.now() > deadline) throw e;
      await new Promise((r) => setTimeout(r, 500));
    }
  }
}
