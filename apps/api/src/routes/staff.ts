import { Hono } from "hono";
import type pg from "pg";
import { requireUser } from "../auth";
import { ApiError } from "../errors";
import type { ClipService, Env } from "../context";

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

// Re-requests a failed clip with the offsets already recorded for it.
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
    const { rows: [n] } = await db.query("select notify_order($1, $2) as id", [o.id, c.get("user").id]);
    // A failed push never blocks the night: the notification is recorded and shows in the app.
    await push.send(o.user_id, "You just cracked a pack",
      o.quantity > 1 ? `Your ${o.quantity} packs are in your vault.` : "Your pull is in your vault.",
      { order_id: o.id, notification_id: n.id, screen: "reveal" }).catch((e) => console.error("push failed", e));
  }
  return c.json({ notified: rows.length });
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
    `select p.*, s.name as set_name, st.packs_on_hand, st.packs_reserved,
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

staff.post("/boxes", async (c) => {
  const b = await c.req.json<{ product_id: string; label: string; pack_count: number; cost_cents?: number }>();
  const { rows: [r] } = await c.get("db").query("select receive_box($1, $2, $3, $4, null, $5) as id",
    [b.product_id, b.label, b.pack_count, b.cost_cents ?? null, c.get("user").id]);
  return c.json({ box_id: r.id }, 201);
});
