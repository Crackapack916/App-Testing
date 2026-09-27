import { Hono } from "hono";
import type pg from "pg";
import { requireUser } from "../auth";
import { ApiError } from "../errors";
import type { Env } from "../context";

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
  const { rows: [clock] } = await db.query("select app_now() as now");
  const queue = batch ? await queueOf(db, batch.id) : [];
  const { rows: stock } = await db.query(
    `select p.id as product_id, p.name, s.packs_on_hand, s.packs_reserved, p.safety_buffer_packs,
            (select count(*) from sealed_boxes x where x.product_id = p.id and x.status = 'sealed')::int as sealed_boxes
     from products p join product_stock s on s.product_id = p.id order by p.name`);
  return c.json({ now: clock.now, batch: batch ?? null, upcoming, queue, stock });
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
 * Records and publishes clips for fully opened orders that don't have one yet.
 * A clip runs from just before the order's first pack to the moment the next order's
 * first pack is opened (or the session ends), so every card reveal is inside it.
 */
async function closeFinishedClips(c: { get: (k: "db" | "user") => any }, sessionId: string, exceptOrder: string | null) {
  const db: pg.PoolClient = c.get("db");
  const actor = c.get("user").id;
  const { rows } = await db.query(
    `select o.id as order_id, min(po.stream_offset_ms) as first_ms, ${OFFSET_SQL} as end_ms, s.stream_ref
     from opening_sessions s
     join orders o on o.batch_id = s.batch_id
     join queue_entries q on q.order_id = o.id
     left join pack_openings po on po.queue_entry_id = q.id
     where s.id = $1 and o.status = 'queued' and o.id is distinct from $2
       and not exists (select 1 from order_clips oc where oc.order_id = o.id)
     group by o.id, s.stream_ref
     having bool_and(q.status = 'opened')`, [sessionId, exceptOrder]);
  for (const r of rows) {
    const start = Math.max(0, Number(r.first_ms) - CLIP_LEAD_MS);
    const end = Math.max(Number(r.end_ms), start + 1);
    await db.query("select record_order_clip($1, $2, $3, $4)", [r.order_id, start, end, actor]);
    await db.query("select mark_clip_ready($1, $2, $3)", [r.order_id, clipRef(r.stream_ref, start, end), actor]);
  }
}

/**
 * Pilot clip: a media fragment into the full session recording, so no video is re-encoded.
 * Replace with a Mux clip when the recording pipeline is in place.
 */
function clipRef(streamRef: string | null, startMs: number, endMs: number) {
  return `${streamRef ?? "recording"}#t=${(startMs / 1000).toFixed(1)},${(endMs / 1000).toFixed(1)}`;
}

// Logging contents -------------------------------------------------------------------

staff.get("/batches/:id/packs", async (c) => {
  const { rows } = await c.get("db").query(
    `select po.id, q.position, q.order_id, p.set_code, p.name as product, po.contents_finalized_at,
            (select count(*) from pack_contents pc where pc.pack_opening_id = po.id)::int as logged
     from pack_openings po join queue_entries q on q.id = po.queue_entry_id join products p on p.id = q.product_id
     where po.batch_id = $1 and po.status = 'opened' order by q.position`, [c.req.param("id")]);
  return c.json({ packs: rows });
});

staff.get("/packs/:id", async (c) => {
  const { rows } = await c.get("db").query(
    `select pc.slot, pc.card_id, pc.finish, pc.condition, pc.serial_number, cd.name, cd.collector_number, cd.rarity, cd.set_code,
            pr.market_cents::int
     from pack_contents pc join cards cd on cd.id = pc.card_id
     left join card_prices_current pr on pr.card_id = pc.card_id and pr.finish = pc.finish
     where pc.pack_opening_id = $1 order by pc.slot`, [c.req.param("id")]);
  return c.json({ cards: rows });
});

staff.put("/packs/:id/cards/:slot", async (c) => {
  const b = await c.req.json<{ card_id: string; finish?: string; condition?: string; serial_number?: string }>();
  await c.get("db").query("select log_pack_card($1, $2, $3, $4, $5, $6, $7)",
    [c.req.param("id"), Number(c.req.param("slot")), b.card_id, b.finish ?? "nonfoil", b.condition ?? "NM", b.serial_number ?? null, c.get("user").id]);
  return c.json({ ok: true });
});

staff.delete("/packs/:id/cards/:slot", async (c) => {
  await c.get("db").query("select clear_pack_card($1, $2)", [c.req.param("id"), Number(c.req.param("slot"))]);
  return c.json({ ok: true });
});

staff.post("/packs/:id/finalize", async (c) => {
  const { rows: [r] } = await c.get("db").query("select finalize_pack_contents($1, $2) as n", [c.req.param("id"), c.get("user").id]);
  return c.json({ cards: r.n });
});

// Set scoped collector number lookup: the logger types "123" and the set comes from the pack.
staff.get("/cards", async (c) => {
  const set = c.req.query("set");
  const num = c.req.query("num");
  const q = c.req.query("q");
  const db = c.get("db");
  const { rows } = num
    ? await db.query(
        `select id, name, set_code, collector_number, rarity, finishes from cards
         where set_code = $1 and collector_number = $2`, [set, num])
    : await db.query(
        `select id, name, set_code, collector_number, rarity, finishes from cards
         where ($1::text is null or set_code = $1) and name ilike '%' || $2 || '%'
         order by similarity(name, $2) desc limit 15`, [set ?? null, q ?? ""]);
  return c.json({ cards: rows });
});

// Notifying ---------------------------------------------------------------------------

staff.get("/batches/:id/orders", async (c) => {
  const { rows } = await c.get("db").query(
    `select o.id, o.quantity, o.status, coalesce(u.display_name, split_part(u.email, '@', 1)) as customer,
            oc.status as clip_status, oc.clip_ref,
            (select count(*) from queue_entries q join pack_openings po on po.queue_entry_id = q.id
             where q.order_id = o.id and po.contents_finalized_at is not null)::int as packs_logged
     from orders o join users u on u.id = o.user_id left join order_clips oc on oc.order_id = o.id
     where o.batch_id = $1 and o.status <> 'cancelled' order by o.placed_at`, [c.req.param("id")]);
  return c.json({ orders: rows });
});

// Notifies every order that is ready (clip published and every pack logged).
staff.post("/batches/:id/notify", async (c) => {
  const db = c.get("db");
  const push = c.get("services").push;
  const { rows } = await db.query(
    `select o.id, o.user_id, o.quantity from orders o
     where o.batch_id = $1 and o.status = 'queued'
       and exists (select 1 from order_clips oc where oc.order_id = o.id and oc.status = 'ready')
       and not exists (select 1 from queue_entries q left join pack_openings po on po.queue_entry_id = q.id
                       where q.order_id = o.id and po.contents_finalized_at is null)`, [c.req.param("id")]);
  for (const o of rows) {
    await db.query("select notify_order($1, $2)", [o.id, c.get("user").id]);
    await push.send(o.user_id, "You just cracked a pack",
      o.quantity > 1 ? `Your ${o.quantity} packs are in your vault.` : "Your pull is in your vault.",
      { order_id: o.id, screen: "vault" });
  }
  return c.json({ notified: rows.length });
});

// Stock and catalog --------------------------------------------------------------------

staff.get("/products", async (c) => {
  const { rows } = await c.get("db").query(
    `select p.*, s.name as set_name, st.packs_on_hand, st.packs_reserved
     from products p join mtg_sets s on s.code = p.set_code left join product_stock st on st.product_id = p.id order by s.name`);
  return c.json({ products: rows });
});

staff.post("/boxes", async (c) => {
  const b = await c.req.json<{ product_id: string; label: string; pack_count: number; cost_cents?: number }>();
  const { rows: [r] } = await c.get("db").query("select receive_box($1, $2, $3, $4, null, $5) as id",
    [b.product_id, b.label, b.pack_count, b.cost_cents ?? null, c.get("user").id]);
  return c.json({ box_id: r.id }, 201);
});
