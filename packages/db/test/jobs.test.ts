import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { atTime, freshDb, type Db } from "./db";
import { BEFORE_CUTOFF, makeProduct, makeUser } from "./fixtures";
import { runJobs } from "../scripts/jobs";

let db: Db;
beforeEach(async () => { db = await freshDb(); });
afterEach(async () => { await db.close(); });

async function jobsAt(at: string) {
  const c = await db.at(at);
  // runJobs takes a pool; give it one pinned to this client's clock.
  const pool = { query: (sql: string, params?: unknown[]) => c.query(sql, params) } as any;
  try { return await runJobs(pool); } finally { await c.query("select set_config('app.now_override', '', false)"); c.release(); }
}

describe("scheduled jobs", () => {
  it("locks a queue only once its cutoff has passed, and is safe to rerun", async () => {
    const [u, p] = [await makeUser(db, { credits: 5000 }), await makeProduct(db)];
    await atTime(db, BEFORE_CUTOFF, "select place_order($1, $2, 1)", [u, p]);
    expect((await jobsAt("2026-10-01T18:59:00-07:00")).locked).toEqual([]);
    const r = await jobsAt("2026-10-01T19:00:30-07:00");
    expect(r.locked.map((x) => x.batch_date)).toEqual(["2026-10-01"]);
    expect(r.locked[0].manifest_hash).toMatch(/^[0-9a-f]{64}$/);
    expect((await jobsAt("2026-10-01T19:15:00-07:00")).locked).toEqual([]);
    const ev = await db.one("select actor_id from custody_events where event_type = 'queue_locked'");
    expect(ev.actor_id).toBeNull(); // locked by the system, not a person
  });

  it("credits a held buyback only after its window ends, exactly once", async () => {
    const u = await makeUser(db);
    await db.q(
      `insert into buyback_requests (user_id, schedule_id, total_credits, status, hold_until, created_at)
       values ($1, 1, 13500, 'held', '2026-10-04T12:00:00Z', '2026-10-01T12:00:00Z')`, [u]);
    expect((await jobsAt("2026-10-04T11:59:00Z")).buybacks_released).toBe(0);
    expect((await jobsAt("2026-10-04T12:15:00Z")).buybacks_released).toBe(1);
    expect((await jobsAt("2026-10-04T12:30:00Z")).buybacks_released).toBe(0);
    expect(await db.one("select earned::int, purchased::int from credit_accounts where user_id = $1", [u])).toEqual({ earned: 13500, purchased: 0 });
  });
});
