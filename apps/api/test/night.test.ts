import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { freshDb, type Db } from "../../../packages/db/test/db";
import { makeCard, makeProduct } from "../../../packages/db/test/fixtures";
import { createApp } from "../src/app";

let db: Db;
let app: ReturnType<typeof createApp>;
let pushed: { userId: string; title: string }[];

beforeEach(async () => {
  db = await freshDb();
  pushed = [];
  app = createApp({
    pool: db.pool,
    jwtSecret: "test-secret",
    push: { send: async (userId, title) => { pushed.push({ userId, title }); } },
    devLogin: true,
    testClock: true,
  });
});
afterEach(async () => { await db.close(); });

const BEFORE = "2026-10-01T18:00:00-07:00";
const AFTER = "2026-10-01T19:01:00-07:00";
const DURING = (min: number) => `2026-10-01T19:${String(10 + min).padStart(2, "0")}:00-07:00`;

async function call(method: string, path: string, opts: { token?: string; body?: unknown; at?: string } = {}) {
  const res = await app.request(path, {
    method,
    headers: {
      "content-type": "application/json",
      ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
      ...(opts.at ? { "x-test-now": opts.at } : {}),
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  return { status: res.status, body: (await res.json()) as any };
}

async function login(email: string, role = "customer", credits = 0) {
  const r = await call("POST", "/dev/login", { body: { email, role, display_name: email.split("@")[0] } });
  if (credits) await db.q("select purchase_credits($1, $2, gen_random_uuid()::text)", [r.body.user_id, credits]);
  return r.body as { token: string; user_id: string };
}

describe("auth", () => {
  it("requires a token, and a staff role for staff routes", async () => {
    expect((await call("GET", "/me")).status).toBe(401);
    expect((await call("GET", "/me", { token: "garbage" })).status).toBe(401);
    const cust = await login("c@x.test");
    expect((await call("GET", "/me", { token: cust.token })).status).toBe(200);
    const r = await call("GET", "/staff/tonight", { token: cust.token });
    expect([r.status, r.body.error]).toEqual([403, "forbidden"]);
  });

  it("refuses dev login once the database is live", async () => {
    await db.q("update system_config set mode = 'live'");
    expect((await call("POST", "/dev/login", { body: { email: "a@x.test" } })).status).toBe(403);
  });

  it("does not let one customer cancel another's order", async () => {
    const p = await makeProduct(db);
    const a = await login("a@x.test", "customer", 5000);
    const b = await login("b@x.test", "customer", 5000);
    const o = await call("POST", "/orders", { token: a.token, at: BEFORE, body: { product_id: p, quantity: 1 } });
    const r = await call("POST", `/orders/${o.body.order_id}/cancel`, { token: b.token, at: BEFORE });
    expect([r.status, r.body.error]).toEqual([404, "unknown_order"]);
  });
});

describe("errors", () => {
  it("maps database codes to statuses and customer messages", async () => {
    const p = await makeProduct(db, { packsPerBox: 2, buffer: 1 });
    const u = await login("u@x.test", "customer", 1000);
    let r = await call("POST", "/orders", { token: u.token, at: BEFORE, body: { product_id: p, quantity: 3 } });
    expect([r.status, r.body.error]).toEqual([409, "sold_out"]);
    r = await call("POST", "/orders", { token: u.token, at: BEFORE, body: { product_id: p, quantity: 99 } });
    expect([r.status, r.body.error]).toEqual([400, "invalid_quantity"]);
    const o = await call("POST", "/orders", { token: u.token, at: BEFORE, body: { product_id: p, quantity: 1 } });
    r = await call("POST", `/orders/${o.body.order_id}/cancel`, { token: u.token, at: AFTER });
    expect([r.status, r.body.error, r.body.message]).toEqual([409, "cutoff_passed", "Tonight's queue is closed. Orders lock at 7pm Pacific."]);
  });
});

describe("a full night over the API", () => {
  it("orders, locks, opens in strict order, logs, notifies, and shows the pulls", async () => {
    const p = await makeProduct(db, { setCode: "FDN" });
    const rare = await makeCard(db, { set: "FDN", num: "101", rarity: "mythic", priceCents: 4500 });
    const common = await makeCard(db, { set: "FDN", num: "7", rarity: "common", priceCents: 8 });
    const staff = await login("ops@x.test", "staff");
    const alice = await login("alice@x.test", "customer", 10_000);
    const bob = await login("bob@x.test", "customer", 10_000);

    // Storefront and ordering.
    const store = await call("GET", "/storefront", { at: BEFORE });
    expect(store.body.products[0]).toMatchObject({ product_id: p, available: true, single_pack_credits: "900" });
    const oA = (await call("POST", "/orders", { token: alice.token, at: "2026-10-01T10:00:00-07:00", body: { product_id: p, quantity: 2 } })).body.order_id;
    const oB = (await call("POST", "/orders", { token: bob.token, at: "2026-10-01T11:00:00-07:00", body: { product_id: p, quantity: 1 } })).body.order_id;
    expect((await call("GET", "/me", { token: alice.token })).body.credits.total).toBe(10_000 - 1800);

    // Tonight, before and after locking.
    let tonight = await call("GET", "/staff/tonight", { token: staff.token, at: AFTER });
    expect(tonight.body.batch.status).toBe("open");
    expect(tonight.body.queue.map((q: any) => q.customer)).toEqual(["alice", "alice", "bob"]);
    const batchId = tonight.body.batch.id;
    expect((await call("POST", `/staff/batches/${batchId}/lock`, { token: staff.token, at: BEFORE })).body.error).toBe("cutoff_not_reached");
    const locked = await call("POST", `/staff/batches/${batchId}/lock`, { token: staff.token, at: AFTER });
    expect(locked.body.manifest_hash).toMatch(/^[0-9a-f]{64}$/);
    tonight = await call("GET", "/staff/tonight", { token: staff.token, at: AFTER });
    expect(tonight.body.queue.map((q: any) => q.position)).toEqual([1, 2, 3]);

    // Session: box must be opened on camera first; packs pair in strict order.
    const sessionId = (await call("POST", `/staff/batches/${batchId}/sessions`, { token: staff.token, at: DURING(0), body: { stream_ref: "https://stream.test/night.m3u8" } })).body.session_id;
    let state = await call("GET", `/staff/sessions/${sessionId}`, { token: staff.token, at: DURING(0) });
    expect(state.body.next).toMatchObject({ position: 1, customer: "alice", open_box: null });
    expect((await call("POST", `/staff/sessions/${sessionId}/next`, { token: staff.token, at: DURING(1) })).body.error).toBe("no_open_box_for_product");
    const box = state.body.next.sealed_boxes[0].id;
    await call("POST", `/staff/sessions/${sessionId}/boxes/${box}/open`, { token: staff.token, at: DURING(1) });

    const packs = [];
    for (let i = 0; i < 3; i++) packs.push((await call("POST", `/staff/sessions/${sessionId}/next`, { token: staff.token, at: DURING(2 + i) })).body);
    expect(packs.map((x) => [x.queue_position, x.order_id])).toEqual([[1, oA], [2, oA], [3, oB]]);
    // Alice's clip closed the moment Bob's first pack was opened.
    const clips = await db.q("select order_id, start_offset_ms::int, end_offset_ms::int, clip_ref from order_clips");
    expect(clips).toEqual([{ order_id: oA, start_offset_ms: 118_000, end_offset_ms: 240_000, clip_ref: "https://stream.test/night.m3u8#t=118.0,240.0" }]);

    // Nobody can be notified before their contents are logged.
    expect((await call("POST", `/staff/batches/${batchId}/notify`, { token: staff.token, at: DURING(6) })).body.notified).toBe(0);

    // Logging: set scoped collector number lookup, then finalize each pack.
    const found = await call("GET", "/staff/cards?set=FDN&num=101", { token: staff.token });
    expect(found.body.cards[0].id).toBe(rare);
    const logList = (await call("GET", `/staff/batches/${batchId}/packs`, { token: staff.token })).body.packs;
    expect(logList.map((x: any) => x.position)).toEqual([1, 2, 3]);
    for (const [i, pk] of logList.entries()) {
      await call("PUT", `/staff/packs/${pk.id}/cards/1`, { token: staff.token, body: { card_id: i === 0 ? rare : common } });
      await call("PUT", `/staff/packs/${pk.id}/cards/2`, { token: staff.token, body: { card_id: common } });
      await call("PUT", `/staff/packs/${pk.id}/cards/3`, { token: staff.token, body: { card_id: rare } });
      await call("DELETE", `/staff/packs/${pk.id}/cards/3`, { token: staff.token }); // mis-logged, removed
      expect((await call("POST", `/staff/packs/${pk.id}/finalize`, { token: staff.token, at: DURING(7) })).body.cards).toBe(2);
    }

    // Alice is ready (clip + contents). Bob's clip closes when the session completes.
    expect((await call("POST", `/staff/batches/${batchId}/notify`, { token: staff.token, at: DURING(8) })).body.notified).toBe(1);
    await call("POST", `/staff/sessions/${sessionId}/complete`, { token: staff.token, at: DURING(9) });
    // The ended night stays on the ops screen until everyone is notified.
    expect((await call("GET", "/staff/tonight", { token: staff.token, at: DURING(9) })).body.batch).toMatchObject({ id: batchId, status: "completed" });
    expect((await call("POST", `/staff/batches/${batchId}/notify`, { token: staff.token, at: DURING(9) })).body.notified).toBe(1);
    expect((await call("GET", "/staff/tonight", { token: staff.token, at: DURING(9) })).body.batch).toBeNull();
    expect(pushed.map((x) => x.userId)).toEqual([alice.user_id, bob.user_id]);
    expect(pushed[0].title).toBe("You just cracked a pack");

    // Customer side: vault, today's pulls, notifications, order history with clip.
    const vault = (await call("GET", "/me/vault", { token: alice.token })).body;
    expect(vault.cards.map((c: any) => [c.name, c.qty, c.individual_card_id !== null])).toEqual([
      ["Card 101", 1, true], ["Card 7", 3, false],
    ]);
    expect(vault.total_market_cents).toBe(4500 + 3 * 8);
    expect((await call("GET", "/me/pulls", { token: alice.token })).body.pulls).toHaveLength(4);
    const orders = (await call("GET", "/orders", { token: alice.token })).body.orders;
    expect(orders[0]).toMatchObject({ status: "fulfilled", positions: [1, 2], packs_opened: 2, clip_ref: clips[0].clip_ref });
    expect((await call("GET", "/me/notifications", { token: bob.token })).body.notifications).toHaveLength(1);

    // Buyback the mythic through the API.
    const q = await call("POST", "/me/buyback/quote", { token: alice.token, body: { items: [{ card_id: rare, finish: "nonfoil" }] } });
    expect(q.body.total_credits).toBe(4050);
    const ic = vault.cards[0].individual_card_id;
    const bb = await call("POST", "/me/buyback", { token: alice.token, body: { items: [{ individual_card_id: ic }], idempotency_key: "k1" } });
    expect(bb.body).toMatchObject({ status: "completed", total_credits: 4050 });
    expect((await call("GET", "/me", { token: alice.token })).body.credits).toEqual({ total: 8200 + 4050, refundable: 8200, earned: 4050 });

    // The whole night is on the custody chain.
    expect((await db.one("select verify_custody_chain() as b")).b).toBeNull();
  });
});
