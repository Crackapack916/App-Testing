import { Hono } from "hono";
import type pg from "pg";
import { requireUser } from "../auth";
import { ApiError } from "../errors";
import type { ClipService, Env } from "../context";
import type { localVideos } from "../videos";
import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

/**
 * The nightly operations tool. Staff never choose a customer or a pack: the only way to
 * open a pack is POST /sessions/:id/next, which calls open_next_pack with no entry argument.
 */
export const staff = new Hono<Env>();
staff.use("*", requireUser("staff"));

/** Milliseconds since the session (and its recording) started. Server side, so every mark shares one clock. */
const OFFSET_SQL = "(extract(epoch from app_now() - (select started_at from opening_sessions where id = $1)) * 1000)::bigint";
const CLIP_LEAD_MS = 2000;

// Tonight --------------------------------------------------------------------------

staff.get("/tonight", async (c) => {
  const db = c.get("db");
  // The night to work: the oldest past-cutoff batch with work left. A completed session
  // stays here until every order is logged and notified.
  const { rows: [batch] } = await db.query(
    `select b.id, b.batch_date::text, b.cutoff_at, b.status, b.locked_at, b.manifest_hash, b.entry_count,
            s.id as session_id, s.started_at as session_started_at
     from batches b left join opening_sessions s on s.batch_id = b.id
     where b.cutoff_at <= app_now()
       and (b.status in ('locked', 'in_session')
         or (b.status = 'open' and exists (select 1 from queue_entries q where q.batch_id = b.id and q.status <> 'cancelled'))
         or (b.status = 'completed' and exists (select 1 from orders o where o.batch_id = b.id and o.status = 'queued')))
     order by b.batch_date limit 1`);
  const { rows: [upcoming] } = await db.query(
    `select b.id, b.batch_date::text, b.cutoff_at,
            (select count(*) from queue_entries q where q.batch_id = b.id and q.status = 'queued')::int as packs
     from batch_for_time(app_now()) b`);
  const { rows: [clock] } = await db.query("select app_now() as now, mode = 'test' as test_mode from system_config");
  const queue = batch ? await queueOf(db, batch.id) : [];
  const { rows: stock } = await db.query(
    `select p.id as product_id, p.name, s.packs_on_hand, s.packs_reserved, p.safety_buffer_packs,
            (select count(*) from sealed_boxes x where x.product_id = p.id and x.status = 'sealed')::int as sealed_boxes
     from products p join product_stock s on s.product_id = p.id order by p.name`);
  // test_clock: the staff tool may offer to run the night early (X-Test-Now). Never on a live database.
  const test_clock = !!c.get("services").testClock && clock.test_mode;
  return c.json({ now: clock.now, test_clock, batch: batch ?? null, upcoming, queue, stock });
});

async function queueOf(db: pg.PoolClient, batchId: string) {
  const { rows } = await db.query(
    `select q.id, q.position, q.status, q.pack_index, o.quantity, o.id as order_id, q.placed_at,
            coalesce(u.display_name, split_part(u.email, '@', 1)) as customer, p.name as product, p.id as product_id
     from queue_entries q join orders o on o.id = q.order_id join users u on u.id = q.user_id join products p on p.id = q.product_id
     where q.batch_id = $1 and q.status <> 'cancelled'
     order by q.position nulls last, q.placed_at, q.purchase_seq, q.pack_index`, [batchId]);
  return rows;
}

staff.post("/batches/:id/lock", async (c) => {
  const { rows: [r] } = await c.get("db").query("select lock_batch($1, $2) as hash", [c.req.param("id"), c.get("user").id]);
  return c.json({ manifest_hash: r.hash });
});

// Publicly verifiable: the canonical text whose SHA-256 is the manifest hash.
staff.get("/batches/:id/manifest", async (c) => {
  const { rows: [r] } = await c.get("db").query(
    "select batch_manifest($1) as manifest, manifest_hash from batches where id = $1", [c.req.param("id")]);
  if (!r) throw new ApiError("unknown_batch");
  return c.json(r);
});

// Session --------------------------------------------------------------------------

staff.post("/batches/:id/sessions", async (c) => {
  const { stream_ref } = await c.req.json<{ stream_ref?: string }>().catch(() => ({ stream_ref: undefined }));
  const { rows: [r] } = await c.get("db").query("select start_session($1, $2, $3) as id",
    [c.req.param("id"), c.get("user").id, stream_ref ?? null]);
  return c.json({ session_id: r.id }, 201);
});

staff.get("/sessions/:id", async (c) => {
  const db = c.get("db");
  const id = c.req.param("id");
  const { rows: [s] } = await db.query(
    `select s.*, b.batch_date::text, b.manifest_hash, ${OFFSET_SQL} as offset_ms,
            (select count(*) from queue_entries q where q.batch_id = s.batch_id and q.status = 'opened')::int as opened,
            (select count(*) from queue_entries q where q.batch_id = s.batch_id and q.status <> 'cancelled')::int as total
     from opening_sessions s join batches b on b.id = s.batch_id where s.id = $1`, [id]);
  if (!s) throw new ApiError("unknown_session");
  const { rows: [next] } = await db.query(
    `select q.position, q.pack_index, o.quantity, o.id as order_id, p.id as product_id, p.name as product,
            coalesce(u.display_name, split_part(u.email, '@', 1)) as customer,
            (select json_build_object('id', x.id, 'label', x.label, 'packs_opened', x.packs_opened, 'pack_count', x.pack_count)
             from sealed_boxes x where x.product_id = q.product_id and x.status = 'opened') as open_box,
            (select coalesce(json_agg(json_build_object('id', x.id, 'label', x.label, 'pack_count', x.pack_count) order by x.received_at, x.label), '[]')
             from sealed_boxes x where x.product_id = q.product_id and x.status = 'sealed') as sealed_boxes
     from queue_entries q join orders o on o.id = q.order_id join products p on p.id = q.product_id join users u on u.id = q.user_id
     where q.batch_id = $1 and q.status = 'queued' and q.position is not null
     order by q.position limit 1`, [s.batch_id]);
  const { rows: recent } = await db.query(
    `select po.id, po.status, po.void_reason, po.stream_offset_ms::int, q.position, q.order_id, x.label as box, po.pack_number_in_box
     from pack_openings po left join queue_entries q on q.id = po.queue_entry_id join sealed_boxes x on x.id = po.box_id
     where po.session_id = $1 order by po.opened_at desc limit 8`, [id]);
  return c.json({ session: s, next: next ?? null, recent });
});

staff.post("/sessions/:id/boxes/:boxId/open", async (c) => {
  await c.get("db").query(`select open_box($1, $2, ${OFFSET_SQL}, $3)`, [c.req.param("id"), c.req.param("boxId"), c.get("user").id]);
  return c.json({ ok: true });
});

staff.post("/sessions/:id/next", async (c) => {
  const db = c.get("db");
  const id = c.req.param("id");
  const { rows: [p] } = await db.query(`select * from open_next_pack($1, ${OFFSET_SQL}, $2)`, [id, c.get("user").id]);
  // Any order whose packs are now all open, other than the one in hand, has its clip end here.
  await closeFinishedClips(c, id, p.order_id);
  return c.json(p);
});

staff.post("/sessions/:id/void", async (c) => {
  const { product_id, reason } = await c.req.json<{ product_id: string; reason: string }>();
  const { rows: [r] } = await c.get("db").query(`select void_pack($1, $2, $3, ${OFFSET_SQL}, $4) as id`,
    [c.req.param("id"), product_id, reason, c.get("user").id]);
  return c.json({ pack_opening_id: r.id });
});

staff.post("/sessions/:id/complete", async (c) => {
  const id = c.req.param("id");
  const db = c.get("db");
  const { rows: [s] } = await db.query("select stream_ref from opening_sessions where id = $1", [id]);
  await closeFinishedClips(c, id, null);
  await db.query("select complete_session($1, $2, $3)", [id, s?.stream_ref ?? null, c.get("user").id]);
  return c.json({ ok: true });
});

/**
 * Records and requests clips for fully opened orders that don't have one yet.
 * A clip runs from just before the order's first pack to the moment the next order's
 * first pack is opened (or the session ends), so every card reveal is inside it.
 * Link clips are ready at once; Mux clips become ready via /webhooks/mux.
 */
async function closeFinishedClips(c: { get: (k: "db" | "user" | "services") => any }, sessionId: string, exceptOrder: string | null) {
  const db: pg.PoolClient = c.get("db");
  const actor = c.get("user").id;
  const clips: ClipService = c.get("services").clips;
  const { rows } = await db.query(
    `select o.id as order_id, min(po.stream_offset_ms) as first_ms, ${OFFSET_SQL} as end_ms, s.stream_ref, s.started_at
     from opening_sessions s
     join orders o on o.batch_id = s.batch_id
     join queue_entries q on q.order_id = o.id
     left join pack_openings po on po.queue_entry_id = q.id
     where s.id = $1 and o.status = 'queued' and o.id is distinct from $2
       and not exists (select 1 from order_clips oc where oc.order_id = o.id)
     group by o.id, s.stream_ref, s.started_at
     having bool_and(q.status = 'opened')`, [sessionId, exceptOrder]);
  for (const r of rows) {
    const start = Math.max(0, Number(r.first_ms) - CLIP_LEAD_MS);
    const end = Math.max(Number(r.end_ms), start + 1);
    await db.query("select record_order_clip($1, $2, $3, $4)", [r.order_id, start, end, actor]);
    try {
      const out = await clips.create({ orderId: r.order_id, streamRef: r.stream_ref, sessionStartedAt: new Date(r.started_at), startMs: start, endMs: end });
      if (out.status === "ready") await db.query("select mark_clip_ready($1, $2, $3)", [r.order_id, out.ref, actor]);
    } catch (e) {
      // The pack opening stands; the clip can be retried from the Notify screen.
      await db.query("select mark_clip_failed($1, $2, $3)", [r.order_id, String((e as Error).message ?? e), actor]);
    }
  }
}

// Logging contents -------------------------------------------------------------------

// Logging starts from the locked queue: every position, and whether its pack is opened,
// being logged, or approved. Only opened packs can be logged.
staff.get("/batches/:id/log-queue", async (c) => {
  const { rows } = await c.get("db").query(
    `select q.position, q.order_id, q.pack_index, o.quantity as order_packs, p.set_code, p.name as product, s.slot_count,
            po.id as pack_id, po.contents_finalized_at as approved_at,
            (select count(*) from pack_contents pc where pc.pack_opening_id = po.id and pc.kind = 'card')::int as cards,
            (select count(*) from pack_contents pc where pc.pack_opening_id = po.id)::int as entries
     from queue_entries q join orders o on o.id = q.order_id join products p on p.id = q.product_id
     join mtg_sets s on s.code = p.set_code
     left join pack_openings po on po.queue_entry_id = q.id and po.status = 'opened'
     where q.batch_id = $1 and q.position is not null order by q.position`, [c.req.param("id")]);
  return c.json({ queue: rows });
});

// Kept for the notify and session screens.
staff.get("/batches/:id/packs", async (c) => {
  const { rows } = await c.get("db").query(
    `select po.id, q.position, q.order_id, p.set_code, p.name as product, po.contents_finalized_at,
            (select count(*) from pack_contents pc where pc.pack_opening_id = po.id)::int as logged
     from pack_openings po join queue_entries q on q.id = po.queue_entry_id join products p on p.id = q.product_id
     where po.batch_id = $1 and po.status = 'opened' order by q.position`, [c.req.param("id")]);
  return c.json({ packs: rows });
});

const LOGGED_CARD = `pc.slot, pc.kind, pc.card_id, pc.finish, pc.condition, cd.name, cd.set_code, cd.collector_number, cd.rarity,
  pr.market_cents::int, (select uris ->> 'small' from card_images ci where ci.card_id = pc.card_id) as image_small`;

staff.get("/packs/:id", async (c) => {
  const db = c.get("db");
  const id = c.req.param("id");
  const { rows: [pack] } = await db.query(
    `select po.id, q.position, q.order_id, q.pack_index, o.quantity as order_packs, p.set_code, p.name as product, s.slot_count,
            po.contents_finalized_at as approved_at, po.count_override_reason
     from pack_openings po join queue_entries q on q.id = po.queue_entry_id join orders o on o.id = q.order_id
     join products p on p.id = q.product_id join mtg_sets s on s.code = p.set_code where po.id = $1`, [id]);
  if (!pack) throw new ApiError("pack_not_opened", 404);
  const { rows: cards } = await db.query(
    `select ${LOGGED_CARD} from pack_contents pc left join cards cd on cd.id = pc.card_id
     left join card_prices_current pr on pr.card_id = pc.card_id and pr.finish = pc.finish
     where pc.pack_opening_id = $1 order by pc.slot`, [id]);
  const { rows: history } = await db.query(
    `select e.created_at, e.slot, e.action, e.kind, e.finish, e.old_finish, e.reason, u.email as actor,
            n.name as card, n.collector_number as num, o.name as old_card, o.collector_number as old_num
     from pack_content_events e left join users u on u.id = e.actor
     left join cards n on n.id = e.card_id left join cards o on o.id = e.old_card_id
     where e.pack_opening_id = $1 order by e.id desc`, [id]);
  return c.json({ pack, cards, history });
});

staff.put("/packs/:id/cards/:slot", async (c) => {
  const b = await c.req.json<{ kind?: string; card_id?: string; finish?: string; condition?: string; serial_number?: string }>();
  await c.get("db").query("select log_pack_card($1, $2, $3, $4, $5, $6, $7, $8)",
    [c.req.param("id"), Number(c.req.param("slot")), b.kind ?? "card", b.card_id ?? null, b.finish ?? null, b.condition ?? "NM",
     b.serial_number ?? null, c.get("user").id]);
  return c.json({ ok: true });
});

staff.delete("/packs/:id/cards/:slot", async (c) => {
  await c.get("db").query("select clear_pack_card($1, $2, $3)", [c.req.param("id"), Number(c.req.param("slot")), c.get("user").id]);
  return c.json({ ok: true });
});

// Approve: checks the count against the set's slot count (a written override when it differs).
staff.post("/packs/:id/finalize", async (c) => {
  const b = await c.req.json<{ count_override_reason?: string }>().catch(() => ({} as { count_override_reason?: string }));
  const { rows: [r] } = await c.get("db").query("select finalize_pack_contents($1, $2, $3) as n",
    [c.req.param("id"), c.get("user").id, b.count_override_reason ?? null]);
  return c.json({ entries: r.n });
});

// A change after approval: reason required, logged, and the customer's vault follows.
staff.post("/packs/:id/amend", async (c) => {
  const b = await c.req.json<{ slot: number; kind?: string | null; card_id?: string | null; finish?: string | null; reason: string }>();
  await c.get("db").query("select amend_pack_card($1, $2, $3, $4, $5, $6, $7)",
    [c.req.param("id"), b.slot, b.kind ?? null, b.card_id ?? null, b.finish ?? null, b.reason, c.get("user").id]);
  return c.json({ ok: true });
});

// A printing by set code and collector number: our table first, then Scryfall (cached).
const LOOKUP = `select cd.id, cd.name, cd.set_code, cd.collector_number, cd.rarity, cd.finishes,
    (select json_object_agg(p.finish, p.market_cents) from card_prices_current p where p.card_id = cd.id) as prices,
    (select uris ->> 'normal' from card_images ci where ci.card_id = cd.id) as image_url
  from cards cd where cd.set_code = upper($1) and lower(cd.collector_number) = lower($2)`;

staff.get("/cards/lookup", async (c) => {
  const set = (c.req.query("set") ?? "").trim();
  const num = (c.req.query("num") ?? "").trim();
  if (!set || !num) throw new ApiError("unknown_card", 404);
  const db = c.get("db");
  let { rows: [card] } = await db.query(LOOKUP, [set, num]);
  let source = "local";
  const provider = c.get("services").cardData;
  if (!card && provider) {
    const row = await provider.lookup(set, num).catch(() => null);
    if (row) {
      await db.query("select import_scryfall_cards($1, now())", [JSON.stringify([row])]);
      ({ rows: [card] } = await db.query(LOOKUP, [set, num]));
      source = provider.name;
    }
  }
  if (!card) throw new ApiError("unknown_card", 404);
  return c.json({ card, source });
});

// Name search for the logger (kept for finding a number by name).
staff.get("/cards", async (c) => {
  const set = c.req.query("set");
  const q = c.req.query("q") ?? "";
  const { rows } = await c.get("db").query(
    `select id, name, set_code, collector_number, rarity, finishes from cards
     where ($1::text is null or set_code = upper($1)) and name_folded like '%' || lower(f_unaccent($2::text)) || '%'
     order by similarity(name_folded, lower(f_unaccent($2::text))) desc limit 15`, [set ?? null, q]);
  return c.json({ cards: rows });
});

staff.post("/orders/:id/clip/retry", async (c) => {
  const db = c.get("db");
  const id = c.req.param("id");
  const { rows: [r] } = await db.query(
    `select oc.start_offset_ms, oc.end_offset_ms, s.stream_ref, s.started_at from order_clips oc
     join opening_sessions s on s.id = oc.session_id where oc.order_id = $1 and oc.status = 'failed'`, [id]);
  if (!r) throw new ApiError("unknown_clip", 404);
  await db.query("select retry_clip($1)", [id]);
  const out = await (c.get("services").clips as ClipService).create({ orderId: id, streamRef: r.stream_ref,
    sessionStartedAt: new Date(r.started_at), startMs: Number(r.start_offset_ms), endMs: Number(r.end_offset_ms) });
  if (out.status === "ready") await db.query("select mark_clip_ready($1, $2, $3)", [id, out.ref, c.get("user").id]);
  return c.json({ status: out.status });
});

/** Local storage links are paths on the API; Blob links are already absolute. */
const absolute = (requestUrl: string, url: string) => new URL(url, requestUrl).toString();

// Videos and approval (item 11) ---------------------------------------------------------

// Every pack in the batch in queue order, with its video and logging status.
staff.get("/batches/:id/overview", async (c) => {
  const { rows } = await c.get("db").query(
    `select q.position, q.order_id, q.pack_index, o.quantity as order_packs, p.set_code, s.name as set_name,
            coalesce(u.display_name, split_part(u.email, '@', 1)) as customer, o.status as order_status,
            po.id as pack_id, po.opened_at, po.contents_finalized_at as approved_at,
            (select count(*) from pack_contents pc where pc.pack_opening_id = po.id and pc.kind = 'card')::int as cards,
            coalesce(v.status, 'missing') as video_status, v.size_bytes, v.duration_ms, v.sha256, v.recorded_at, v.uploaded_at,
            (select email from users where id = v.uploaded_by) as uploaded_by
     from queue_entries q join orders o on o.id = q.order_id join users u on u.id = q.user_id
     join products p on p.id = q.product_id join mtg_sets s on s.code = p.set_code
     left join pack_openings po on po.queue_entry_id = q.id and po.status = 'opened'
     left join pack_videos v on v.pack_opening_id = po.id
     where q.batch_id = $1 and q.position is not null order by q.position`, [c.req.param("id")]);
  // A recording whose own timestamp is earlier than the pack before it is out of queue order.
  let last = 0;
  const packs = rows.map((r) => {
    const t = r.recorded_at ? new Date(r.recorded_at).getTime() : null;
    const out_of_order = t != null && t < last;
    if (t != null) last = Math.max(last, t);
    return { ...r, out_of_order };
  });
  const { rows: [m] } = await c.get("db").query("select pathname, size_bytes, sha256, uploaded_at from session_masters where batch_id = $1", [c.req.param("id")]);
  const ready = packs.length > 0 && packs.every((r) => r.pack_id && ["ready", "approved"].includes(r.video_status) && r.approved_at);
  return c.json({ packs, session_master: m ?? null, ready_to_approve: ready, videos_kind: c.get("services").videos?.kind ?? null });
});

// The browser asks for a one upload token, then sends the file straight to storage.
// Paths are fixed by the server: packs/<pack id>.<ext> and masters/<batch id>.<ext>.
const VIDEO_PATH = /^(packs|thumbs|masters)\/([0-9a-f-]{36})\.(mp4|mov|jpg)$/;
staff.post("/videos/token", async (c) => {
  const videos = c.get("services").videos;
  if (!videos) throw new ApiError("videos_unavailable", 503);
  const db = c.get("db");
  const body = await c.req.json();
  const out = await videos.clientUpload(c.req.raw, body, async (pathname) => {
    const m = VIDEO_PATH.exec(pathname);
    if (!m) return false;
    if (m[1] === "masters") return (await db.query("select 1 from batches where id = $1 and status in ('locked', 'in_session', 'completed')", [m[2]])).rowCount === 1;
    return (await db.query("select 1 from pack_videos where pack_opening_id = $1 and status = 'uploading'", [m[2]])).rowCount === 1;
  });
  return c.json({ ...(out as object), kind: videos.kind });
});

// Local storage only (pilot and tests): the browser PUTs the file here instead of to Vercel Blob.
staff.put("/videos/local/*", async (c) => {
  const videos = c.get("services").videos as ReturnType<typeof localVideos> | undefined;
  if (videos?.kind !== "local") throw new ApiError("videos_unavailable", 503);
  const pathname = c.req.path.replace(/^.*\/videos\/local\//, "");
  const m = VIDEO_PATH.exec(pathname);
  const db = c.get("db");
  const ok = m && (m[1] === "masters"
    ? (await db.query("select 1 from batches where id = $1 and status in ('locked', 'in_session', 'completed')", [m[2]])).rowCount === 1
    : (await db.query("select 1 from pack_videos where pack_opening_id = $1 and status = 'uploading'", [m[2]])).rowCount === 1);
  if (!ok) throw new ApiError("forbidden");
  const file = videos.file(pathname);
  await mkdir(dirname(file), { recursive: true });
  await pipeline(Readable.fromWeb(c.req.raw.body as never), createWriteStream(file));
  return c.json({ pathname });
});

staff.post("/packs/:id/video/start", async (c) => {
  await c.get("db").query("select start_pack_video($1, $2)", [c.req.param("id"), c.get("user").id]);
  return c.json({ ok: true });
});

staff.post("/packs/:id/video/finish", async (c) => {
  const b = await c.req.json<{ pathname: string; size: number; sha256: string; duration_ms: number | null; content_type: string;
    thumbnail?: string | null; recorded_at?: string | null }>();
  const videos = c.get("services").videos;
  if (!videos) throw new ApiError("videos_unavailable", 503);
  const id = c.req.param("id");
  if (!VIDEO_PATH.test(b.pathname) || !b.pathname.includes(id)) throw new ApiError("forbidden");
  // Trust storage, not the browser, for the size.
  const size = await videos.sizeOf(b.pathname);
  if (size == null) throw new ApiError("video_missing");
  if (size !== b.size) throw new ApiError("video_size_mismatch");
  await c.get("db").query("select finish_pack_video($1, $2, $3, $4, $5, $6, $7, $8, $9)",
    [id, b.pathname, size, b.sha256, b.duration_ms, b.content_type, b.thumbnail ?? null, b.recorded_at ?? null, c.get("user").id]);
  return c.json({ ok: true });
});

// Preview for staff, through the same expiring links customers get.
staff.get("/packs/:id/video", async (c) => {
  const videos = c.get("services").videos;
  if (!videos) throw new ApiError("videos_unavailable", 503);
  const { rows: [v] } = await c.get("db").query("select pathname, content_type, thumbnail_pathname from pack_videos where pack_opening_id = $1 and pathname is not null", [c.req.param("id")]);
  if (!v) throw new ApiError("unknown_video", 404);
  return c.json({ url: absolute(c.req.url, await videos.signedUrl(v.pathname, 3600)), content_type: v.content_type,
    poster: v.thumbnail_pathname ? absolute(c.req.url, await videos.signedUrl(v.thumbnail_pathname, 3600)) : null });
});

staff.post("/batches/:id/session-master", async (c) => {
  const b = await c.req.json<{ pathname: string; size: number; sha256: string }>();
  const videos = c.get("services").videos;
  if (!videos) throw new ApiError("videos_unavailable", 503);
  if (!b.pathname.startsWith(`masters/${c.req.param("id")}.`)) throw new ApiError("forbidden");
  const size = await videos.sizeOf(b.pathname);
  if (size == null) throw new ApiError("video_missing");
  if (size !== b.size) throw new ApiError("video_size_mismatch");
  await c.get("db").query("select record_session_master($1, $2, $3, $4, $5)", [c.req.param("id"), b.pathname, size, b.sha256, c.get("user").id]);
  return c.json({ ok: true });
});

// The last step: refused until every pack has a ready video and approved contents.
// Then every order is notified by email, and the Vault shows its dot.
staff.post("/batches/:id/approve", async (c) => {
  const db = c.get("db");
  const id = c.req.param("id");
  const { rows: orders } = await db.query(
    `select o.id, o.quantity, u.email, s.name as set_name from orders o join users u on u.id = o.user_id
     join products p on p.id = o.product_id join mtg_sets s on s.code = p.set_code
     where o.batch_id = $1 and o.status = 'queued' order by o.purchase_seq`, [id]);
  const { rows: [r] } = await db.query("select approve_and_notify_batch($1, $2) as n", [id, c.get("user").id]);
  const email = c.get("services").email;
  const base = c.get("services").appUrl;
  for (const o of orders) {
    // A failed email never blocks the night: the Vault dot still shows it.
    await email.send({ kind: "pack_cracked", to: o.email, data: { order_id: o.id, packs: o.quantity, set_name: o.set_name, url: `${base}/vault` } })
      .catch((e) => console.error("email failed", e));
  }
  return c.json({ notified: r.n });
});

// Shipping ------------------------------------------------------------------------------

staff.get("/shipments", async (c) => {
  const status = c.req.query("status") ?? "requested";
  const { rows } = await c.get("db").query(
    `select sr.id, sr.status, sr.address, sr.value_cents::int, sr.fee_credits::int, sr.created_at, sr.shipped_at, sr.tracking_ref,
            coalesce(u.display_name, split_part(u.email, '@', 1)) as customer,
            (select json_agg(json_build_object(
                'line', si.line, 'qty', si.qty, 'finish', si.finish, 'condition', si.condition,
                'name', cd.name, 'set_code', cd.set_code, 'collector_number', cd.collector_number, 'rarity', cd.rarity,
                'individual', si.individual_card_id is not null,
                'bin', coalesce(ic.bin, l.bin)) order by coalesce(ic.bin, l.bin) nulls last, cd.set_code, cd.collector_number)
             from shipment_items si join cards cd on cd.id = si.card_id
             left join individual_cards ic on ic.id = si.individual_card_id
             left join inventory_lots l on l.card_id = si.card_id and l.finish = si.finish and l.condition = si.condition
             where si.shipment_id = sr.id) as items
     from shipment_requests sr join users u on u.id = sr.user_id
     where sr.status = $1 order by sr.created_at limit 100`, [status]);
  return c.json({ shipments: rows });
});

staff.post("/shipments/:id/shipped", async (c) => {
  const { tracking } = await c.req.json<{ tracking: string }>();
  if (!tracking?.trim()) throw new ApiError("tracking_required", 400);
  await c.get("db").query("select mark_shipped($1, $2)", [c.req.param("id"), tracking.trim()]);
  return c.json({ ok: true });
});

// Team (admins only) ------------------------------------------------------------------

// Break end requests and lifting a break (a reason is required and logged).
staff.get("/break-requests", async (c) => {
  const { rows } = await c.get("db").query(
    `select r.id, r.user_id, u.email, r.break_until, r.requested_at from break_end_requests r join users u on u.id = r.user_id
     where r.resolved_at is null order by r.requested_at`);
  return c.json({ requests: rows });
});

staff.post("/users/:id/lift-break", async (c) => {
  const { reason } = await c.req.json<{ reason: string }>();
  const db = c.get("db");
  await db.query("select lift_break($1, $2, $3)", [c.req.param("id"), reason, c.get("user").id]);
  const { rows: [u] } = await db.query("select email from users where id = $1", [c.req.param("id")]);
  await db.query("select mark_break_end_emailed($1)", [c.req.param("id")]);
  await c.get("services").email.send({ kind: "break_ended", to: u.email, data: { lifted: true } });
  return c.json({ ok: true });
});

staff.post("/team/role", requireUser("admin"), async (c) => {
  const { email, role } = await c.req.json<{ email: string; role: string }>();
  await c.get("db").query("select set_user_role($1, $2, $3)", [email, role, c.get("user").id]);
  return c.json({ ok: true });
});

// Stock and catalog --------------------------------------------------------------------

staff.get("/products", async (c) => {
  const { rows } = await c.get("db").query(
    `select p.*, s.name as set_name, s.wizards_info_url, s.pack_image_url, st.packs_on_hand, st.packs_reserved,
            (select count(*) from sealed_boxes x where x.product_id = p.id and x.status = 'sealed')::int as sealed_boxes,
            (select json_agg(json_build_object('min_qty', t.min_qty, 'per_pack_credits', t.per_pack_credits) order by t.min_qty)
             from price_tiers t where t.product_id = p.id) as ladder
     from products p join mtg_sets s on s.code = p.set_code left join product_stock st on st.product_id = p.id
     order by p.active desc, s.release_date desc nulls last, s.name`);
  return c.json({ products: rows });
});

staff.get("/sets", async (c) => {
  const q = c.req.query("q") ?? "";
  const { rows } = await c.get("db").query(
    `select code, name, release_date::text from mtg_sets
     where code ilike $1 || '%' or name ilike '%' || $1 || '%' order by release_date desc nulls last limit 20`, [q]);
  return c.json({ sets: rows });
});

staff.post("/products", async (c) => {
  const b = await c.req.json<{ set_code: string; booster_type?: string; name?: string; ladder?: unknown[] }>();
  const { rows: [r] } = await c.get("db").query("select create_product($1, $2, $3, $4, $5) as id",
    [b.set_code, b.booster_type ?? "play", b.name ?? null, b.ladder ? JSON.stringify(b.ladder) : null, c.get("user").id]);
  return c.json({ product_id: r.id }, 201);
});

staff.put("/products/:id/ladder", async (c) => {
  const { ladder } = await c.req.json<{ ladder: unknown[] }>();
  await c.get("db").query("select set_price_ladder($1, $2)", [c.req.param("id"), JSON.stringify(ladder)]);
  return c.json({ ok: true });
});

staff.post("/products/:id/active", async (c) => {
  const { active } = await c.req.json<{ active: boolean }>();
  await c.get("db").query("select set_product_active($1, $2, $3)", [c.req.param("id"), active, c.get("user").id]);
  return c.json({ ok: true });
});

// Set info: Wizards' published pack information and the official pack photo.
staff.put("/sets/:code", async (c) => {
  const b = await c.req.json<{ wizards_info_url?: string | null; pack_image_url?: string | null }>();
  await c.get("db").query("select set_set_info($1, $2, $3)", [c.req.param("code"), b.wizards_info_url ?? null, b.pack_image_url ?? null]);
  return c.json({ ok: true });
});

// Per set limit override for one customer, with a reason (logged, append only).
staff.post("/set-limits", async (c) => {
  const b = await c.req.json<{ email: string; set_code: string; max_packs: number; reason: string }>();
  const db = c.get("db");
  const { rows: [u] } = await db.query("select id from users where lower(email) = lower($1)", [b.email ?? ""]);
  if (!u) throw new ApiError("unknown_user");
  await db.query("select set_customer_set_limit($1, $2, $3, $4, $5)", [u.id, b.set_code, b.max_packs, b.reason, c.get("user").id]);
  return c.json({ ok: true });
});

staff.get("/set-limits", async (c) => {
  const { rows } = await c.get("db").query(
    `select o.id, u.email, o.set_code, o.max_packs, o.reason, a.email as actor, o.created_at
     from set_limit_overrides o join users u on u.id = o.user_id join users a on a.id = o.actor order by o.id desc limit 100`);
  return c.json({ overrides: rows, default_limit: (await c.get("db").query("select max_packs_per_set_per_customer as n from system_config")).rows[0].n });
});

// Drops (item 14) -------------------------------------------------------------------------

staff.get("/drops", async (c) => {
  const { rows } = await c.get("db").query(
    `select d.id, d.set_code, s.name as set_name, d.starts_at, d.ends_at, d.packs_allocated, d.per_customer_limit, d.status,
            case when d.status = 'published' then drop_state(d) end as state, packs_sold_in_drop(d.id) as sold,
            (select count(*) from drop_reminders r where r.drop_id = d.id and r.unsubscribed_at is null)::int as reminders
     from drops d join mtg_sets s on s.code = d.set_code order by d.starts_at desc limit 100`);
  return c.json({ drops: rows });
});

type DropBody = { set_code: string; starts_at: string; ends_at?: string | null; packs_allocated: number; per_customer_limit?: number | null; status: string };
const saveDrop = async (c: { get: (k: "db" | "user") => any }, id: string | null, b: DropBody) => {
  const { rows: [r] } = await c.get("db").query("select save_drop($1, $2, $3, $4, $5, $6, $7, $8) as id",
    [id, b.set_code, b.starts_at, b.ends_at || null, b.packs_allocated, b.per_customer_limit || null, b.status, c.get("user").id]);
  return r.id as string;
};
staff.post("/drops", async (c) => c.json({ id: await saveDrop(c, null, await c.req.json<DropBody>()) }, 201));
staff.put("/drops/:id", async (c) => c.json({ id: await saveDrop(c, c.req.param("id"), await c.req.json<DropBody>()) }));

staff.post("/boxes", async (c) => {
  const b = await c.req.json<{ product_id: string; label: string; pack_count: number; cost_cents?: number }>();
  const { rows: [r] } = await c.get("db").query("select receive_box($1, $2, $3, $4, null, $5) as id",
    [b.product_id, b.label, b.pack_count, b.cost_cents ?? null, c.get("user").id]);
  return c.json({ box_id: r.id }, 201);
});
