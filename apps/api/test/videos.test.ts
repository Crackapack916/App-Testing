import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { freshDb, type Db } from "../../../packages/db/test/db";
import { makeCard, makeProduct } from "../../../packages/db/test/fixtures";
import { createApp } from "../src/app";
import { linkClips } from "../src/clips";
import { localVideos } from "../src/videos";

// Item 11: upload one video per pack, verify it, preview it through an expiring link.
let db: Db;
let app: ReturnType<typeof createApp>;
const storage = localVideos(mkdtempSync(join(tmpdir(), "videos-")), "secret");
beforeEach(async () => {
  db = await freshDb();
  app = createApp({ pool: db.pool, jwtSecret: "s", devLogin: true, clips: linkClips, devStaffEmails: ["ops@x.test"], testClock: true, videos: storage });
});
afterEach(async () => { await db.close(); });

const call = async (method: string, path: string, o: { token?: string; at?: string; body?: unknown; raw?: BodyInit; headers?: Record<string, string> } = {}) => {
  const r = await app.request(path, { method, body: o.raw ?? (o.body === undefined ? undefined : JSON.stringify(o.body)),
    headers: { "content-type": "application/json", ...(o.token ? { authorization: `Bearer ${o.token}` } : {}), ...(o.at ? { "x-test-now": o.at } : {}), ...o.headers } });
  return r;
};
const json = async (...a: Parameters<typeof call>) => { const r = await call(...a); return { status: r.status, body: await r.json() as any }; };

describe("pack videos on local storage", () => {
  it("uploads straight to storage, checks the size, and plays back with byte ranges through a signed link", async () => {
    const p = await makeProduct(db);
    await makeCard(db);
    const staff = (await json("POST", "/dev/login", { body: { email: "ops@x.test", role: "staff" } })).body;
    const cust = (await json("POST", "/dev/login", { body: { email: "c@x.test", verified: true } })).body;
    await db.q("select purchase_credits($1, 5000, 'seed')", [cust.user_id]);
    await json("POST", "/orders", { token: cust.token, at: "2026-10-01T12:00:00-07:00", body: { product_id: p, quantity: 1 } });
    const { batch } = (await json("GET", "/staff/tonight", { token: staff.token, at: "2026-10-01T19:01:00-07:00" })).body;
    await json("POST", `/staff/batches/${batch.id}/lock`, { token: staff.token, at: "2026-10-01T19:01:00-07:00" });
    const { session_id } = (await json("POST", `/staff/batches/${batch.id}/sessions`, { token: staff.token, at: "2026-10-01T19:10:00-07:00", body: {} })).body;
    const st = (await json("GET", `/staff/sessions/${session_id}`, { token: staff.token, at: "2026-10-01T19:10:00-07:00" })).body;
    await json("POST", `/staff/sessions/${session_id}/boxes/${st.next.sealed_boxes[0].id}/open`, { token: staff.token, at: "2026-10-01T19:11:00-07:00" });
    const pack = (await json("POST", `/staff/sessions/${session_id}/next`, { token: staff.token, at: "2026-10-01T19:12:00-07:00" })).body;
    const id = pack.pack_opening_id;
    const pathname = `packs/${id}.mp4`;
    const bytes = new Uint8Array(300_000).map((_, i) => i % 251);   // bigger than the 256 KB JSON cap

    // No upload before the video is started, and never outside the fixed paths.
    expect((await call("PUT", `/staff/videos/local/${pathname}`, { token: staff.token, raw: bytes })).status).toBe(403);
    await json("POST", `/staff/packs/${id}/video/start`, { token: staff.token });
    expect((await call("PUT", `/staff/videos/local/packs/${id}.exe`, { token: staff.token, raw: bytes })).status).toBe(403);
    expect((await call("PUT", `/staff/videos/local/${pathname}`, { raw: bytes })).status).toBe(401);
    const tok = await json("POST", "/staff/videos/token", { token: staff.token, body: { pathname } });
    expect(tok.body).toEqual({ uploadUrl: `/staff/videos/local/${pathname}`, kind: "local" });
    expect((await call("PUT", `/staff/videos/local/${pathname}`, { token: staff.token, raw: bytes, headers: { "content-type": "video/mp4" } })).status).toBe(200);

    const meta = { pathname, size: bytes.length, sha256: "cd".repeat(32), duration_ms: 42_000, content_type: "video/mp4", recorded_at: "2026-10-02T02:12:00Z" };
    expect((await json("POST", `/staff/packs/${id}/video/finish`, { token: staff.token, body: { ...meta, size: 5 } })).body.error).toBe("video_size_mismatch");
    expect((await json("POST", `/staff/packs/${id}/video/finish`, { token: staff.token, body: { ...meta, content_type: "video/webm" } })).body.error).toBe("video_type_unsupported");
    expect((await json("POST", `/staff/packs/${id}/video/finish`, { token: staff.token, body: meta })).status).toBe(200);
    expect((await db.one("select status, size_bytes::int, duration_ms from pack_videos where pack_opening_id = $1", [id])))
      .toEqual({ status: "ready", size_bytes: 300_000, duration_ms: 42_000 });
    expect((await db.one("select count(*)::int as n from custody_events where event_type = 'video_uploaded'")).n).toBe(1);

    // Preview: an expiring link that serves byte ranges (scrubbing) and refuses tampering.
    const { url } = (await json("GET", `/staff/packs/${id}/video`, { token: staff.token })).body;
    const u = new URL(url);
    const part = await app.request(u.pathname + u.search, { headers: { range: "bytes=1000-1999" } });
    expect(part.status).toBe(206);
    expect(part.headers.get("content-range")).toBe("bytes 1000-1999/300000");
    expect(new Uint8Array(await part.arrayBuffer())).toEqual(bytes.slice(1000, 2000));
    const forged = u.searchParams.get("sig")!.replace(/^./, (ch) => (ch === "0" ? "1" : "0"));
    expect((await app.request(`${u.pathname}?exp=${u.searchParams.get("exp")}&sig=${forged}`)).status).toBe(403);
    expect((await app.request(u.pathname + "?exp=1&sig=" + u.searchParams.get("sig"))).status).toBe(403);
    // The customer can't watch until the batch is approved.
    expect((await json("GET", `/me/packs/${id}/video`, { token: cust.token })).status).toBe(404);
  });
});
