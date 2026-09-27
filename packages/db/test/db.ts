import pg from "pg";
import { randomUUID } from "node:crypto";
import { withDb } from "./global-setup";

export type Db = {
  pool: pg.Pool;
  url: string;
  /** A client whose app_now() is pinned to `at`. Release when done. */
  at(at: string | Date): Promise<pg.PoolClient>;
  q<T extends pg.QueryResultRow = any>(sql: string, params?: unknown[]): Promise<T[]>;
  one<T extends pg.QueryResultRow = any>(sql: string, params?: unknown[]): Promise<T>;
  close(): Promise<void>;
};

/** A fresh database cloned from the migrated template. */
export async function freshDb(): Promise<Db> {
  const admin = process.env.TEST_ADMIN_URL ?? "postgres://postgres@127.0.0.1:54329/postgres";
  const name = "t_" + randomUUID().replace(/-/g, "");
  const c = new pg.Client({ connectionString: admin });
  await c.connect();
  await c.query(`create database ${name} template crackapack_template`);
  await c.end();
  const url = withDb(admin, name);
  const pool = new pg.Pool({ connectionString: url, max: 40 });
  pool.on("error", () => {}); // connections killed by the drop at teardown

  return {
    pool,
    url,
    async at(at) {
      const client = await pool.connect();
      const iso = at instanceof Date ? at.toISOString() : at;
      await client.query("select set_config('app.now_override', $1, false)", [iso]);
      return client;
    },
    async q(sql, params) {
      return (await pool.query(sql, params)).rows;
    },
    async one(sql, params) {
      const rows = (await pool.query(sql, params)).rows;
      if (rows.length !== 1) throw new Error(`expected one row, got ${rows.length}`);
      return rows[0];
    },
    async close() {
      await pool.end();
      const c2 = new pg.Client({ connectionString: admin });
      await c2.connect();
      await c2.query(`drop database if exists ${name} with (force)`);
      await c2.end();
    },
  };
}

/** Runs one statement with app_now() pinned to `at`. */
export async function atTime<T extends pg.QueryResultRow = any>(db: Db, at: string, sql: string, params?: unknown[]) {
  const c = await db.at(at);
  try {
    return (await c.query<T>(sql, params)).rows;
  } finally {
    await c.query("select set_config('app.now_override', '', false)");
    c.release();
  }
}
