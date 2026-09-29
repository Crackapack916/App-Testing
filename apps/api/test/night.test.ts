import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { freshDb, type Db } from "../../../packages/db/test/db";
import { makeCard, makeProduct } from "../../../packages/db/test/fixtures";
import { createApp } from "../src/app";
import { linkClips } from "../src/clips";
import { mapScryfallCard, type ScryfallCard } from "@crackapack/catalog/scryfall";
import { logEmail, type EmailMessage } from "../src/email";
import type { VideoStorage } from "../src/videos";

const eoeCard = { object: "card", id: "x", oracle_id: "o", name: "Test Printing", set: "eoe", set_name: "Edge of Eternities", collector_number: "1",
  rarity: "common", type_line: "Creature", finishes: ["nonfoil"], legalities: {}, layout: "normal", released_at: "2025-08-01", games: ["paper"],
  image_uris: { small: "https://cards.test/s.jpg", normal: "https://cards.test/n.jpg" }, prices: { usd: "0.10" } } as unknown as ScryfallCard;

let db: Db;
let app: ReturnType<typeof createApp>;
let emails: EmailMessage[];
// Stands in for Vercel Blob: the browser "uploaded" whatever is in `stored`.
const stored = new Map<string, number>();
const videos: VideoStorage = {
  kind: "blob",
  clientUpload: async () => ({ ok: true }),
  sizeOf: async (p) => stored.get(p) ?? null,
  signedUrl: async (p, s) => `https://blob.test/${p}?expires=${s}`,
};

beforeEach(async () => {
  db = await freshDb();
  emails = [];
  stored.clear();
  app = createApp({
    pool: db.pool,
    jwtSecret: "test-secret",
    email: logEmail(emails),
    videos,
    devLogin: true,
    clips: linkClips,
    devStaffEmails: ["ops@x.test"],
    testClock: true,
    dobKey: Buffer.alloc(32, 1),
    // Stands in for Scryfall in the per set import (section 15): EOE has two printings, both with images.
    cardData: {
      name: "fake",
      lookup: async () => null,
      set: async (code) => (code === "eoe" ? { code: "eoe", name: "Edge of Eternities", set_type: "expansion", icon_svg_uri: "https://svgs.test/eoe.svg" } : null),
      setPrintings: async (code) => ["1", "2"].map((n) => mapScryfallCard({ ...eoeCard, set: code, collector_number: n, id: `eoe-${n}` })!),
    },
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
  const r = await call("POST", "/dev/login", { body: { email, role, display_name: email.split("@")[0], verified: true } });
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

  it("never lets dev login grant staff to an email that isn't allowlisted", async () => {
    const r = await call("POST", "/dev/login", { body: { email: "mallory@x.test", role: "staff" } });
    expect([r.status, r.body.error]).toEqual([403, "forbidden"]);
    const admin = await call("POST", "/dev/login", { body: { email: "mallory@x.test", role: "admin" } });
    expect(admin.status).toBe(403);
    expect(await db.q("select role from users where email = 'mallory@x.test'")).toEqual([]);
  });

  it("only lets an admin change roles", async () => {
    const staff = await login("ops@x.test", "staff");
    await login("newhire@x.test");
    const denied = await call("POST", "/staff/team/role", { token: staff.token, body: { email: "newhire@x.test", role: "staff" } });
    expect([denied.status, denied.body.error]).toEqual([403, "forbidden"]);
    await db.q("update users set role = 'admin' where email = 'ops@x.test'");
    const ok = await call("POST", "/staff/team/role", { token: staff.token, body: { email: "newhire@x.test", role: "staff" } });
    expect(ok.status).toBe(200);
    expect((await db.one("select role from users where email = 'newhire@x.test'")).role).toBe("staff");
  });

  it("rejects oversized requests", async () => {
    const u = await login("big@x.test");
    const r = await call("POST", "/me/shipments", { token: u.token, body: { items: [], address: { name: "x".repeat(300_000) } } });
    expect(r.status).toBe(413);
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

describe("age gate and limits", () => {
  it("makes a new customer verify their age before ordering, then enforces their limits", async () => {
    const p = await makeProduct(db);
    const r = await call("POST", "/dev/login", { body: { email: "new@x.test" } });
    const token = r.body.token as string;
    await db.q("select purchase_credits($1, 10000, 'seed')", [r.body.user_id]);
    expect((await call("GET", "/me", { token })).body.age_verified).toBe(false);
    let o = await call("POST", "/orders", { token, at: BEFORE, body: { product_id: p, quantity: 1 } });
    expect([o.status, o.body.error]).toEqual([403, "policies_not_accepted"]);
    expect((await call("POST", "/me/policies/accept", { token, at: BEFORE })).body.error).toBe("age_not_verified");
    // An account without a birthdate on file confirms it once.
    const young = await call("POST", "/auth/confirm-age", { token, at: BEFORE, body: { dob: { month: "5", day: "5", year: "2012" } } });
    expect([young.status, young.body.error]).toEqual([403, "underage"]);
    expect((await call("POST", "/auth/confirm-age", { token, at: BEFORE, body: { dob: { month: "5", day: "5", year: "1995" } } })).status).toBe(200);
    expect((await call("POST", "/auth/confirm-age", { token, at: BEFORE, body: { dob: { month: "5", day: "5", year: "1990" } } })).body.error).toBe("birthdate_locked");
    expect((await call("GET", "/me", { token })).body.needs_policy_acceptance).toBe(true);
    expect((await call("POST", "/me/policies/accept", { token, at: BEFORE })).status).toBe(200);
    expect((await call("GET", "/me", { token })).body.needs_policy_acceptance).toBe(false);
    expect((await call("GET", "/me/limits", { token, at: BEFORE })).body.suggest_limit).toBe(true);
    expect((await call("PUT", "/me/limits/daily", { token, at: BEFORE, body: { credits: 1000 } })).body).toEqual({ result: "applied" });
    expect((await call("POST", "/orders", { token, at: BEFORE, body: { product_id: p, quantity: 1 } })).status).toBe(201);
    o = await call("POST", "/orders", { token, at: BEFORE, body: { product_id: p, quantity: 1 } });
    expect([o.status, o.body.error]).toEqual([403, "daily_limit_reached"]);
    const lim = (await call("GET", "/me/limits", { token, at: BEFORE })).body;
    expect(lim.limits[0]).toMatchObject({ period: "daily", limit: 1000, spent: 900, pending: null });
    expect(lim.suggest_limit).toBe(false);
    await call("POST", "/me/break", { token, at: BEFORE, body: { hours: 168 } });
    const req = await call("POST", "/me/break/end-request", { token, at: BEFORE });
    expect(req.body.mailto).toMatch(/^mailto:crackapack\.business@gmail\.com\?subject=Break%20end%20request&body=Account%20email%3A%20new%40x\.test/);
    const staff = await login("ops@x.test", "staff");
    expect((await call("GET", "/staff/break-requests", { token: staff.token })).body.requests).toHaveLength(1);
    o = await call("POST", "/orders", { token, at: "2026-10-02T12:00:00-07:00", body: { product_id: p, quantity: 1 } });
    expect(o.body.error).toBe("on_break");
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

describe("catalog and products", () => {
  it("puts a set on sale from the staff API", async () => {
    await db.q("insert into mtg_sets (code, name) values ('EOE', 'Edge of Eternities')");
    const staff = await login("ops@x.test", "staff");
    const bad = await call("POST", "/staff/products", { token: staff.token, body: { set_code: "ZZZ" } });
    expect([bad.status, bad.body.error]).toEqual([404, "unknown_set"]);
    const { product_id } = (await call("POST", "/staff/products", { token: staff.token, body: { set_code: "eoe" } })).body;
    const lad = await call("PUT", `/staff/products/${product_id}/ladder`, { token: staff.token, body: { ladder: [{ min_qty: 1, per_pack_credits: 900 }, { min_qty: 3, per_pack_credits: 950 }] } });
    expect(lad.body.error).toBe("ladder_not_decreasing");
    await call("POST", "/staff/boxes", { token: staff.token, body: { product_id, label: "EOE-1", pack_count: 30 } });
    expect((await call("GET", "/storefront", { at: BEFORE })).body.products).toEqual([]);
    // Section 15: no sale until the set's card data passes its check.
    const refused = await call("POST", `/staff/products/${product_id}/active`, { token: staff.token, body: { active: true } });
    expect([refused.status, refused.body.error]).toEqual([409, "card_data_unverified"]);
    const check = await call("POST", "/staff/sets/eoe/card-data", { token: staff.token });
    expect(check.body).toMatchObject({ set_code: "EOE", ok: true, expected: 2 });
    expect((await call("GET", "/staff/products", { token: staff.token })).body.products[0]).toMatchObject({ card_data_ok: true, card_data_expected: 2 });
    await call("POST", `/staff/products/${product_id}/active`, { token: staff.token, body: { active: true } });
    const store = (await call("GET", "/storefront", { at: BEFORE })).body.products;
    expect(store[0]).toMatchObject({ name: "Edge of Eternities Play Booster", status: "available", sold_out: false, left_for_you: 6, max_qty: 6 });
    expect(store[0]).not.toHaveProperty("stock");
    expect(store[0].ladder.map((t: any) => t.per_pack_credits)).toEqual([1000, 950, 900]);
  });

  it("has no big pulls feed (the site never advertises pulls)", async () => {
    expect((await app.request("/feed/big-pulls")).status).toBe(404);
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
    expect(store.body.products[0]).toMatchObject({ product_id: p, status: "available", left_for_you: 6 });
    const oA = (await call("POST", "/orders", { token: alice.token, at: "2026-10-01T10:00:00-07:00", body: { product_id: p, quantity: 2 } })).body.order_id;
    const oB = (await call("POST", "/orders", { token: bob.token, at: "2026-10-01T11:00:00-07:00", body: { product_id: p, quantity: 1 } })).body.order_id;
    expect((await call("GET", "/me", { token: alice.token })).body.credits.total).toBe(10_000 - 1800);

    // Tonight, before and after locking.
    let tonight = await call("GET", "/staff/tonight", { token: staff.token, at: AFTER });
    expect(tonight.body.batch.status).toBe("open");
    // A test mode database with TEST_CLOCK on: the staff tool may offer "Jump to cutoff".
    expect(tonight.body.test_clock).toBe(true);
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

    // Nobody is notified before every pack has a video and approved contents.
    expect((await call("POST", `/staff/batches/${batchId}/approve`, { token: staff.token, at: DURING(6) })).body.error).toBe("videos_not_ready");

    // Logging: set scoped collector number lookup, then finalize each pack.
    const found = await call("GET", "/staff/cards/lookup?set=FDN&num=101", { token: staff.token });
    expect(found.body.card.id).toBe(rare);
    const logList = (await call("GET", `/staff/batches/${batchId}/packs`, { token: staff.token })).body.packs;
    expect(logList.map((x: any) => x.position)).toEqual([1, 2, 3]);
    for (const [i, pk] of logList.entries()) {
      await call("PUT", `/staff/packs/${pk.id}/cards/1`, { token: staff.token, body: { card_id: i === 0 ? rare : common } });
      await call("PUT", `/staff/packs/${pk.id}/cards/2`, { token: staff.token, body: { card_id: common } });
      await call("PUT", `/staff/packs/${pk.id}/cards/3`, { token: staff.token, body: { card_id: rare } });
      await call("DELETE", `/staff/packs/${pk.id}/cards/3`, { token: staff.token }); // mis-logged, removed
      expect((await call("POST", `/staff/packs/${pk.id}/finalize`, { token: staff.token, at: DURING(7) })).body.entries).toBe(2);
    }

    await call("POST", `/staff/sessions/${sessionId}/complete`, { token: staff.token, at: DURING(9) });
    // The ended night stays on the ops screen until everyone is notified.
    expect((await call("GET", "/staff/tonight", { token: staff.token, at: DURING(9) })).body.batch).toMatchObject({ id: batchId, status: "completed" });
    expect((await call("POST", `/staff/batches/${batchId}/approve`, { token: staff.token, at: DURING(9) })).body.error).toBe("videos_not_ready");

    // Videos: one per pack, straight to storage; the API checks the stored size and the path.
    const sha = "ab".repeat(32);
    for (const [i, pk] of logList.entries()) {
      const pathname = `packs/${pk.id}.mp4`;
      const finish = (body: object) => call("POST", `/staff/packs/${pk.id}/video/finish`, { token: staff.token, at: DURING(10), body });
      const meta = { pathname, size: 1000, sha256: sha, duration_ms: 60_000, content_type: "video/mp4", recorded_at: `2026-10-02T02:${10 + i}:00Z` };
      expect((await finish(meta)).body.error).toBe("video_missing");
      await call("POST", `/staff/packs/${pk.id}/video/start`, { token: staff.token, at: DURING(10) });
      stored.set(pathname, 999);
      expect((await finish(meta)).body.error).toBe("video_size_mismatch");
      stored.set(pathname, 1000);
      expect((await finish({ ...meta, pathname: `packs/${logList[(i + 1) % 3].id}.mp4` })).body.error).toBe("forbidden");
      expect((await finish(meta)).status).toBe(200);
    }
    const overview = (await call("GET", `/staff/batches/${batchId}/overview`, { token: staff.token })).body;
    expect(overview.packs.map((x: any) => [x.position, x.video_status, x.out_of_order])).toEqual([[1, "ready", false], [2, "ready", false], [3, "ready", false]]);
    expect(overview.ready_to_approve).toBe(true);
    // Alice can't watch before approval.
    expect((await call("GET", `/me/packs/${logList[0].id}/video`, { token: alice.token })).status).toBe(404);

    expect((await call("POST", `/staff/batches/${batchId}/approve`, { token: staff.token, at: DURING(11) })).body.notified).toBe(2);
    expect((await call("GET", "/staff/tonight", { token: staff.token, at: DURING(11) })).body.batch).toBeNull();
    expect(emails.map((e) => [e.kind, e.to])).toEqual([
      ["order_confirmation", "alice@x.test"], ["order_confirmation", "bob@x.test"],
      ["staff_alert", "crackapack.business@gmail.com"],   // the night is ready to approve
      ["pack_cracked", "alice@x.test"], ["pack_cracked", "bob@x.test"]]);

    // Customer side: the Vault dot, Cracked today, the pack in pulled order, and the video link.
    expect((await call("GET", "/me", { token: alice.token })).body.unseen_cracked).toBe(1);
    const cracked = (await call("GET", "/me/cracked", { token: alice.token })).body.packs;
    expect(cracked.map((x: any) => [x.pack_index, x.cards, x.is_new, x.video_status])).toEqual([[1, 2, true, "approved"], [2, 2, true, "approved"]]);
    const one = (await call("GET", `/me/packs/${logList[0].id}`, { token: alice.token })).body;
    expect(one.cards.map((x: any) => [x.slot, x.name])).toEqual([[1, "Card 101"], [2, "Card 7"]]);
    expect((await call("GET", `/me/packs/${logList[0].id}`, { token: bob.token })).status).toBe(404);
    const link = (await call("GET", `/me/packs/${logList[0].id}/video`, { token: alice.token })).body;
    expect(link).toMatchObject({ url: `https://blob.test/packs/${logList[0].id}.mp4?expires=3600`, content_type: "video/mp4" });
    expect((await call("GET", `/me/packs/${logList[0].id}/video`, { token: bob.token })).status).toBe(404);
    await call("POST", "/me/cracked/seen", { token: alice.token });
    expect((await call("GET", "/me", { token: alice.token })).body.unseen_cracked).toBe(0);

    // Vault: newest pack first, cards in pulled order.
    const vault = (await call("GET", "/me/vault", { token: alice.token })).body;
    expect(vault.cards.map((c: any) => [c.name, c.qty, c.individual_card_id !== null])).toEqual([
      ["Card 7", 3, false], ["Card 101", 1, true],
    ]);
    expect(vault.total_market_cents).toBe(4500 + 3 * 8);
    expect(vault.shipping).toEqual({ free_min: 5000, fee: 499 });

    // Credits: one balance and plain activity with a running balance.
    const cr = (await call("GET", "/me/credits", { token: alice.token })).body;
    expect(cr).toMatchObject({ available: 10_000 - 1800, pending: 0 });
    expect(cr.activity.map((a: any) => [a.description, a.amount, a.balance])).toEqual([
      ["Bought 2 packs FDN", -1800, 8200], ["Added credits", 10_000, 10_000]]);
    const orders = (await call("GET", "/orders", { token: alice.token })).body.orders;
    expect(orders[0]).toMatchObject({ status: "fulfilled", positions: [1, 2], packs_opened: 2, clip_ref: clips[0].clip_ref });
    expect((await call("GET", "/me/notifications", { token: bob.token })).body.notifications).toHaveLength(1);

    // Sell back is off by default (test run): refused with a clear message, and the app hides it.
    expect((await call("GET", "/me", { token: alice.token })).body.features).toEqual({ buyback: false });
    const off = await call("POST", "/me/buyback/quote", { token: alice.token, body: { items: [{ card_id: rare, finish: "nonfoil" }] } });
    expect([off.status, off.body.error]).toEqual([403, "buyback_disabled"]);
    await db.q("update system_config set buyback_enabled = true");

    // Buyback the mythic through the API.
    const q = await call("POST", "/me/buyback/quote", { token: alice.token, body: { items: [{ card_id: rare, finish: "nonfoil" }] } });
    expect(q.body).toMatchObject({ total_credits: 4050, stale: false });
    const staleQuote = await call("POST", "/me/buyback/quote", { token: alice.token, at: "2030-01-01T00:00:00Z", body: { items: [{ card_id: rare, finish: "nonfoil" }] } });
    expect(staleQuote.body.stale).toBe(true);
    const ic = vault.cards[1].individual_card_id;
    const bb = await call("POST", "/me/buyback", { token: alice.token, body: { items: [{ individual_card_id: ic }], idempotency_key: "k1" } });
    expect(bb.body).toMatchObject({ status: "completed", total_credits: 4050 });
    expect((await call("GET", "/me", { token: alice.token })).body.credits).toEqual({ total: 8200 + 4050, refundable: 8200, earned: 4050 });

    // Bob ships his card: it leaves the customer ledger now and physical stock when staff mark it shipped.
    const bobVault = (await call("GET", "/me/vault", { token: bob.token })).body.cards;
    const ship = await call("POST", "/me/shipments", { token: bob.token, body: {
      items: [{ card_id: bobVault[0].card_id, finish: bobVault[0].finish, condition: bobVault[0].condition, qty: bobVault[0].qty }],
      address: { name: "Bob", line1: "1 K St", city: "Sacramento", state: "CA", zip: "95814" } } });
    expect(ship.status).toBe(201);
    const pending = (await call("GET", "/staff/shipments", { token: staff.token })).body.shipments;
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ customer: "bob", items: [expect.objectContaining({ name: bobVault[0].name })] });
    expect((await call("POST", `/staff/shipments/${pending[0].id}/shipped`, { token: staff.token, body: { tracking: " " } })).body.error).toBe("tracking_required");
    await call("POST", `/staff/shipments/${pending[0].id}/shipped`, { token: staff.token, body: { tracking: "9400TEST" } });
    expect((await call("GET", "/staff/shipments", { token: staff.token })).body.shipments).toEqual([]);
    expect((await call("POST", `/staff/shipments/${pending[0].id}/shipped`, { token: staff.token, body: { tracking: "x" } })).body.error).toBe("shipment_not_pending");
    expect(await db.q("select * from vault_invariant_violations")).toEqual([]);

    // The whole night is on the custody chain.
    expect((await db.one("select verify_custody_chain() as b")).b).toBeNull();

  });
});

describe("policies", () => {
  it("serves each page with its version and date, and shows sell back only when it is on", async () => {
    const list = (await call("GET", "/policies")).body.policies;
    expect(list.map((p: any) => [p.doc, p.version])).toEqual([["fairness", "2026-10-01"], ["terms", "2026-10-01"], ["privacy", "2026-10-01"]]);
    let f = (await call("GET", "/policies/fairness")).body;
    expect(f.body_md).toContain("## Our fairness promise");
    expect(f.body_md).not.toContain("Selling cards back");
    await db.q("update system_config set buyback_enabled = true");
    f = (await call("GET", "/policies/fairness")).body;
    expect(f.body_md).toContain("## Selling cards back\n");
    expect(f.body_md).not.toContain("{buyback}");
    expect((await call("GET", "/policies/nope")).status).toBe(404);
  });
});
