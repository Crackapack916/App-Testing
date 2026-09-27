import { createHmac } from "node:crypto";
import { exportSPKI, generateKeyPair, SignJWT } from "jose";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { freshDb, type Db } from "../../../packages/db/test/db";
import { makeCard, makeProduct } from "../../../packages/db/test/fixtures";
import { createApp } from "../src/app";
import { linkClips, muxClips, verifyMuxSignature } from "../src/clips";
import type { ClipService } from "../src/context";

let db: Db;
beforeEach(async () => { db = await freshDb(); });
afterEach(async () => { await db.close(); });

describe("Clerk sign in", () => {
  async function clerkSetup() {
    const { publicKey, privateKey } = await generateKeyPair("RS256");
    const pem = await exportSPKI(publicKey);
    const app = createApp({ pool: db.pool, jwtSecret: "s", push: { send: async () => {} }, devLogin: false, testClock: false,
      clips: linkClips, clerk: { jwtKey: pem, authorizedParties: ["https://app.crackapack.test"] } });
    const token = (claims: Record<string, unknown>, opts: { exp?: number; key?: CryptoKey } = {}) =>
      new SignJWT({ azp: "https://app.crackapack.test", ...claims }).setProtectedHeader({ alg: "RS256", kid: "ins_test" })
        .setIssuer("https://clerk.crackapack.test").setIssuedAt().setNotBefore(Math.floor(Date.now() / 1000) - 5)
        .setExpirationTime(opts.exp ?? Math.floor(Date.now() / 1000) + 60).sign(opts.key ?? privateKey);
    const me = async (t: string) => { const r = await app.request("/me", { headers: { authorization: `Bearer ${t}` } }); return { status: r.status, body: await r.json() as any }; };
    return { app, token, me };
  }

  it("creates the customer on first sign in and finds them after", async () => {
    const { token, me } = await clerkSetup();
    const first = await me(await token({ sub: "user_abc", email: "Alice@Example.com" }));
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ role: "customer", age_verified: false });
    const again = await me(await token({ sub: "user_abc" }));
    expect(again.body.id).toBe(first.body.id);
    expect(await db.q("select email, auth_user_id from users")).toEqual([{ email: "alice@example.com", auth_user_id: "user_abc" }]);
  });

  it("rejects forged, expired and wrong origin tokens, and pilot tokens once Clerk is on", async () => {
    const { token, me } = await clerkSetup();
    const other = await generateKeyPair("RS256");
    expect((await me(await token({ sub: "u", email: "x@x.test" }, { key: other.privateKey }))).status).toBe(401);
    expect((await me(await token({ sub: "u", email: "x@x.test" }, { exp: Math.floor(Date.now() / 1000) - 60 }))).status).toBe(401);
    expect((await me(await token({ sub: "u", email: "x@x.test", azp: "https://evil.test" }))).status).toBe(401);
    const pilot = await new SignJWT({ sub: "00000000-0000-0000-0000-000000000000" }).setProtectedHeader({ alg: "HS256" })
      .setExpirationTime("1h").sign(new TextEncoder().encode("s"));
    expect((await me(pilot)).status).toBe(401);
    expect(await db.q("select * from users")).toEqual([]);
  });

  it("refuses an email already linked to a different Clerk account", async () => {
    const { token, me } = await clerkSetup();
    await me(await token({ sub: "user_1", email: "same@x.test" }));
    const r = await me(await token({ sub: "user_2", email: "same@x.test" }));
    expect([r.status, r.body.error]).toEqual([409, "email_in_use"]);
  });
});

describe("Mux clips", () => {
  it("cuts the clip from the live recording, converting session time through wall clock time", async () => {
    const calls: { method: string; url: string; body?: any }[] = [];
    const fakeFetch = (async (url: string, init: RequestInit) => {
      calls.push({ method: init.method!, url, body: init.body ? JSON.parse(String(init.body)) : undefined });
      if (url.endsWith("/live-streams/ls_1")) return Response.json({ data: { active_asset_id: "asset_live" } });
      if (url.endsWith("/assets/asset_live")) return Response.json({ data: { created_at: String(Date.parse("2026-10-02T02:08:00Z") / 1000) } });
      return Response.json({ data: { id: "asset_clip" } }, { status: 201 });
    }) as unknown as typeof fetch;
    const mux = muxClips({ tokenId: "id", tokenSecret: "secret", liveStreamId: "ls_1", webhookSecret: "w" }, fakeFetch);
    // Session started 19:10 PT (02:10Z); OBS connected two minutes earlier.
    const out = await mux.create({ orderId: "order-1", streamRef: null, sessionStartedAt: new Date("2026-10-02T02:10:00Z"), startMs: 118_000, endMs: 240_000 });
    expect(out).toEqual({ status: "pending" });
    const create = calls.find((c) => c.method === "POST")!;
    expect(create.url).toBe("https://api.mux.com/video/v1/assets");
    expect(create.body).toEqual({
      inputs: [{ url: "mux://assets/asset_live", start_time: 238, end_time: 360 }],
      playback_policies: ["public"], video_quality: "basic", passthrough: "order-1",
    });
  });

  it("verifies Mux webhook signatures and rejects stale or forged ones", () => {
    const body = '{"type":"video.asset.ready"}';
    const t = 1_790_000_000;
    const sig = (secret: string, ts = t) => `t=${ts},v1=${createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex")}`;
    expect(verifyMuxSignature(body, sig("w"), "w", t + 10)).toBe(true);
    expect(verifyMuxSignature(body, sig("wrong"), "w", t + 10)).toBe(false);
    expect(verifyMuxSignature(body, sig("w"), "w", t + 3600)).toBe(false);
    expect(verifyMuxSignature(body + " ", sig("w"), "w", t + 10)).toBe(false);
    expect(verifyMuxSignature(body, undefined, "w")).toBe(false);
  });

  it("holds notifications until Mux reports the clip ready, and recovers from a failed clip", async () => {
    let fail = true;
    const requested: string[] = [];
    const pendingClips: ClipService = { name: "mux", async create({ orderId }) {
      requested.push(orderId);
      if (fail) { fail = false; throw new Error("mux_503"); }
      return { status: "pending" };
    } };
    const pushed: string[] = [];
    const app = createApp({ pool: db.pool, jwtSecret: "s", push: { send: async (u) => { pushed.push(u); } }, devLogin: true,
      devStaffEmails: ["ops@x.test"], testClock: true, clips: pendingClips, muxWebhookSecret: "whsec" });
    const call = async (method: string, path: string, token?: string, at?: string, body?: unknown, headers: Record<string, string> = {}) => {
      const r = await app.request(path, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...(at ? { "x-test-now": at } : {}), ...headers },
        body: typeof body === "string" ? body : body === undefined ? undefined : JSON.stringify(body) });
      return { status: r.status, body: await r.json() as any };
    };
    const login = async (email: string, role?: string) => (await call("POST", "/dev/login", undefined, undefined, { email, role, verified: true })).body;

    const p = await makeProduct(db);
    const card = await makeCard(db, { priceCents: 10 });
    const staff = await login("ops@x.test", "staff");
    const cust = await login("c@x.test");
    await db.q("select purchase_credits($1, 5000, 'seed')", [cust.user_id]);
    const { order_id } = (await call("POST", "/orders", cust.token, "2026-10-01T12:00:00-07:00", { product_id: p, quantity: 1 })).body;
    const { batch } = (await call("GET", "/staff/tonight", staff.token, "2026-10-01T19:01:00-07:00")).body;
    await call("POST", `/staff/batches/${batch.id}/lock`, staff.token, "2026-10-01T19:01:00-07:00");
    const { session_id } = (await call("POST", `/staff/batches/${batch.id}/sessions`, staff.token, "2026-10-01T19:10:00-07:00", {})).body;
    const st = (await call("GET", `/staff/sessions/${session_id}`, staff.token, "2026-10-01T19:10:00-07:00")).body;
    await call("POST", `/staff/sessions/${session_id}/boxes/${st.next.sealed_boxes[0].id}/open`, staff.token, "2026-10-01T19:11:00-07:00");
    await call("POST", `/staff/sessions/${session_id}/next`, staff.token, "2026-10-01T19:12:00-07:00");
    await call("POST", `/staff/sessions/${session_id}/complete`, staff.token, "2026-10-01T19:14:00-07:00");
    const { packs } = (await call("GET", `/staff/batches/${batch.id}/packs`, staff.token)).body;
    await call("PUT", `/staff/packs/${packs[0].id}/cards/1`, staff.token, undefined, { card_id: card });
    await call("POST", `/staff/packs/${packs[0].id}/finalize`, staff.token, "2026-10-01T19:15:00-07:00");

    // First attempt failed: clip is marked failed, nobody is notified.
    expect((await db.one("select status from order_clips where order_id = $1", [order_id])).status).toBe("failed");
    expect((await call("POST", `/staff/batches/${batch.id}/notify`, staff.token, "2026-10-01T19:16:00-07:00")).body.notified).toBe(0);
    // Retry from the Notify screen: now pending at Mux.
    expect((await call("POST", `/staff/orders/${order_id}/clip/retry`, staff.token)).body.status).toBe("pending");
    expect((await call("POST", `/staff/batches/${batch.id}/notify`, staff.token, "2026-10-01T19:17:00-07:00")).body.notified).toBe(0);

    // Mux calls back: forged first, then real.
    const event = JSON.stringify({ type: "video.asset.ready", data: { passthrough: order_id, playback_ids: [{ id: "pb123", policy: "public" }] } });
    const ts = Math.floor(Date.now() / 1000);
    const sign = (secret: string) => `t=${ts},v1=${createHmac("sha256", secret).update(`${ts}.${event}`).digest("hex")}`;
    expect((await call("POST", "/webhooks/mux", undefined, undefined, event, { "mux-signature": sign("nope") })).status).toBe(400);
    expect((await call("POST", "/webhooks/mux", undefined, undefined, event, { "mux-signature": sign("whsec") })).body.status).toBe("applied");
    expect((await db.one("select clip_ref from order_clips where order_id = $1", [order_id])).clip_ref).toBe("https://stream.mux.com/pb123.m3u8");
    // Mux retries deliveries: a replay is acknowledged and logs nothing new.
    expect((await call("POST", "/webhooks/mux", undefined, undefined, event, { "mux-signature": sign("whsec") })).body.status).toBe("duplicate");
    expect(Number((await db.one("select count(*) from custody_events where event_type = 'clip_generated'")).count)).toBe(1);

    expect((await call("POST", `/staff/batches/${batch.id}/notify`, staff.token, "2026-10-01T19:20:00-07:00")).body.notified).toBe(1);
    expect(pushed).toEqual([cust.user_id]);
    expect(requested).toEqual([order_id, order_id]);
    const events = (await db.q("select event_type from custody_events where batch_id = $1 order by seq", [batch.id])).map((e) => e.event_type);
    expect(events).toContain("clip_failed");
    expect(events.indexOf("clip_generated")).toBeLessThan(events.indexOf("customer_notified"));
  });
});
