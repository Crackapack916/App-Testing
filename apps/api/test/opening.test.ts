import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { freshDb, type Db } from "../../../packages/db/test/db";
import { makeProduct } from "../../../packages/db/test/fixtures";
import { createApp } from "../src/app";
import { linkClips } from "../src/clips";

// Opening packs with no session step: the first box starts it, the last pack finishes it.
let db: Db;
let app: ReturnType<typeof createApp>;
beforeEach(async () => {
  db = await freshDb();
  app = createApp({ pool: db.pool, jwtSecret: "s", devLogin: true, clips: linkClips, devStaffEmails: ["ops@x.test"], testClock: true });
});
afterEach(async () => { await db.close(); });

const call = async (method: string, path: string, token?: string, at?: string, body?: unknown) => {
  const r = await app.request(path, { method, body: body === undefined ? undefined : JSON.stringify(body),
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...(at ? { "x-test-now": at } : {}) } });
  return { status: r.status, body: await r.json() as any };
};
const login = async (email: string, role?: string) => (await call("POST", "/dev/login", undefined, undefined, { email, role, verified: true })).body;

describe("opening packs by night", () => {
  it("needs a locked queue, starts on the first box, pairs packs in queue order, and finishes on the last pack", async () => {
    const p = await makeProduct(db);
    const staff = await login("ops@x.test", "staff");
    const [a, b] = [await login("a@x.test"), await login("b@x.test")];
    for (const [u, ref] of [[a, "ra"], [b, "rb"]] as const) await db.q("select purchase_credits($1, 5000, $2)", [u.user_id, ref]);
    await call("POST", "/orders", a.token, "2026-10-01T12:00:00-07:00", { product_id: p, quantity: 2 });
    await call("POST", "/orders", b.token, "2026-10-01T13:00:00-07:00", { product_id: p, quantity: 1 });
    const { batch } = (await call("GET", "/staff/tonight", staff.token, "2026-10-01T19:01:00-07:00")).body;
    const at = (m: number) => `2026-10-01T19:${String(10 + m).padStart(2, "0")}:00-07:00`;

    // Not before the lock.
    expect((await call("POST", `/staff/batches/${batch.id}/opening/next`, staff.token, at(0))).body.error).toBe("batch_not_locked");
    await call("POST", `/staff/batches/${batch.id}/lock`, staff.token, "2026-10-01T19:01:00-07:00");

    let o = (await call("GET", `/staff/batches/${batch.id}/opening`, staff.token, at(0))).body;
    expect(o).toMatchObject({ finished_at: null, recent: [], batch: { opened: 0, total: 3 }, next: { position: 1, open_box: null } });
    await call("POST", `/staff/batches/${batch.id}/opening/boxes/${o.next.sealed_boxes[0].id}/open`, staff.token, at(1));
    expect((await db.q("select count(*)::int as n from opening_sessions")).at(0)).toEqual({ n: 1 });   // started by itself

    const opened = [];
    for (let i = 0; i < 3; i++) opened.push((await call("POST", `/staff/batches/${batch.id}/opening/next`, staff.token, at(2 + i))).body);
    expect(opened.map((x) => [x.queue_position, x.finished])).toEqual([[1, false], [2, false], [3, true]]);
    o = (await call("GET", `/staff/batches/${batch.id}/opening`, staff.token, at(6))).body;
    expect(o.finished_at).toBeTruthy();
    expect(o.next).toBeNull();
    expect(o.batch.status).toBe("completed");
    // The finished night moves to Unfinished until its videos and cards are approved.
    const t = (await call("GET", "/staff/tonight", staff.token, at(6))).body;
    expect([t.batch, t.unfinished.map((x: any) => x.id)]).toEqual([null, [batch.id]]);
  });

  it("gives two screens pressing Crack pack at the same moment one pack each, in queue order, with no errors", async () => {
    const p = await makeProduct(db);
    const staff = await login("ops@x.test", "staff");
    for (const e of ["a", "b", "c"]) {
      const u = await login(`${e}@x.test`);
      await db.q("select purchase_credits($1, 5000, $2)", [u.user_id, `r${e}`]);
      await call("POST", "/orders", u.token, "2026-10-01T12:00:00-07:00", { product_id: p, quantity: 2 });
    }
    const { batch } = (await call("GET", "/staff/tonight", staff.token, "2026-10-01T19:01:00-07:00")).body;
    await call("POST", `/staff/batches/${batch.id}/lock`, staff.token, "2026-10-01T19:01:00-07:00");
    const at = "2026-10-01T19:10:00-07:00";
    const o = (await call("GET", `/staff/batches/${batch.id}/opening`, staff.token, at)).body;
    await call("POST", `/staff/batches/${batch.id}/opening/boxes/${o.next.sealed_boxes[0].id}/open`, staff.token, at);
    const results = [];
    for (let round = 0; round < 3; round++) {
      results.push(...await Promise.all([1, 2].map(() => call("POST", `/staff/batches/${batch.id}/opening/next`, staff.token, at))));
    }
    expect(results.map((r) => [r.status, r.body.error])).toEqual(Array(6).fill([200, undefined]));
    const opened = await db.q("select q.position from pack_openings po join queue_entries q on q.id = po.queue_entry_id where po.batch_id = $1 order by 1", [batch.id]);
    expect(opened.map((r) => r.position)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(results.filter((r) => r.body.finished)).not.toHaveLength(0);
    expect((await db.one("select status from batches where id = $1", [batch.id])).status).toBe("completed");
  });
});
