import pg from "pg";
import { migrate } from "../scripts/migrate";

// Builds a migrated template database once. Each test file clones it (see db.ts).
export default async function setup() {
  const admin = process.env.DATABASE_URL ?? "postgres://postgres@127.0.0.1:54329/postgres";
  const c = new pg.Client({ connectionString: admin });
  await c.connect();
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
