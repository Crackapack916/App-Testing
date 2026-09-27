/**
 * Scheduled jobs, run every 15 minutes by .github/workflows/jobs.yml.
 *   1. Lock every queue whose cutoff has passed, so positions freeze and the manifest is
 *      published on time even if nobody presses Lock (same lock_batch staff use).
 *   2. Credit large buybacks whose processing hold has ended.
 * Idempotent: safe to run as often as you like.
 */
import pg from "pg";
import { fileURLToPath } from "node:url";

export async function runJobs(pool: pg.Pool) {
  const locked: { batch_date: string; manifest_hash: string }[] = [];
  const { rows: due } = await pool.query(
    "select id, batch_date::text from batches where status = 'open' and cutoff_at <= app_now() order by batch_date");
  for (const b of due) {
    try {
      const { rows: [r] } = await pool.query("select lock_batch($1, null) as hash", [b.id]);
      locked.push({ batch_date: b.batch_date, manifest_hash: r.hash });
    } catch (e) {
      // Staff locked it between the select and now.
      if (!/batch_already_locked/.test(String(e))) throw e;
    }
  }
  const { rows: [rel] } = await pool.query("select release_held_buybacks() as n");
  return { locked, buybacks_released: rel.n as number };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  try {
    console.log(JSON.stringify(await runJobs(pool)));
  } finally {
    await pool.end();
  }
}
