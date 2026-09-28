import { Hono } from "hono";
import { BUNDLES } from "@crackapack/payments";
import { optionalUser, requireUser } from "../auth";
import { ApiError } from "../errors";
import { IMAGE_SQL, withImages } from "../images";
import type { Env } from "../context";
import { SUPPORT_EMAIL } from "../email-templates";
import { sendSafely, staffAlert } from "../notify";

/** Customer facing routes. Every write goes through a database function. */
export const customer = new Hono<Env>();

// Public: the sets on sale, with each one's state for this customer (guests see the defaults).
customer.use("/storefront", optionalUser());
customer.get("/storefront", async (c) => {
  const db = c.get("db");
  const user = c.get("user") ?? null;
  const { rows } = await db.query(
    `select p.id as product_id, p.set_code, s.name as set_name, p.booster_type, p.name, s.icon_svg_uri, s.wizards_info_url,
            s.pack_image_url, coalesce(product_available_packs(p.id), 0) as stock,
            (select json_agg(json_build_object('min_qty', min_qty, 'per_pack_credits', per_pack_credits) order by min_qty)
             from price_tiers t where t.product_id = p.id) as ladder,
            d.id as drop_id, d.starts_at as drop_starts_at, d.ends_at as drop_ends_at, d.state as drop_state,
            greatest(0, d.packs_allocated - packs_sold_in_drop(d.id)) as drop_remaining,
            case when $1::uuid is null then 0 else packs_held_in_set($1, p.set_code) end as held,
            case when $1::uuid is null then (cfg()).max_packs_per_set_per_customer else set_limit_for($1, p.set_code) end as set_limit
     from products p join mtg_sets s on s.code = p.set_code
     left join lateral (
       select x.*, drop_state(x) as state from drops x where x.set_code = p.set_code and x.status = 'published'
       order by (x.ends_at is not null and x.ends_at <= app_now()),
                case when x.ends_at is not null and x.ends_at <= app_now() then -extract(epoch from x.starts_at) else extract(epoch from x.starts_at) end
       limit 1) d on true
     where p.active order by d.starts_at nulls first, s.name`, [user?.id ?? null]);
  const { rows: [meta] } = await db.query(
    `select b.batch_date::text, b.cutoff_at, app_now() as now, (cfg()).max_packs_per_order as max_per_order,
            (select break_until from spend_limits where user_id = $1 and break_until > app_now()) as break_until
     from batch_for_time(app_now()) b`, [user?.id ?? null]);
  const products = rows.map((r) => {
    const left = Math.max(0, r.set_limit - r.held);
    const room = Math.min(left, r.stock, r.drop_id ? r.drop_remaining : Infinity, meta.max_per_order);
    // One status per set, first match wins, so the page shows one clear reason.
    const status = meta.break_until ? "on_break"
      : r.drop_state === "upcoming" ? "upcoming"
      : r.drop_state === "ended" ? "ended"
      : r.stock <= 0 || r.drop_state === "sold_out" ? "sold_out"
      : left <= 0 ? "limit_reached"
      : "available";
    return { ...r, drop_remaining: undefined, stock: undefined, sold_out: r.stock <= 0, left_for_you: left,
      max_qty: status === "available" ? room : 0, status };
  });
  // `now` lets the app count down on the server's clock, not the phone's.
  return c.json({ products, next_cutoff: meta.cutoff_at, batch_date: meta.batch_date, now: meta.now, break_until: meta.break_until });
});

customer.get("/bundles", (c) => c.json({ bundles: BUNDLES }));

customer.use("/me/*", requireUser());
customer.use("/orders/*", requireUser());
customer.use("/orders", requireUser());
customer.use("/checkout", requireUser());

customer.get("/me", async (c) => {
  const u = c.get("user");
  const { rows: [acct] } = await c.get("db").query(
    `select coalesce(purchased, 0)::int as purchased, coalesce(earned, 0)::int as earned,
            (select age_verified_at is not null from users where id = $1) as age_verified,
            (select email from users where id = $1) as email,
            (select buyback_enabled from system_config) as buyback,
            (select count(*) from notifications n where n.user_id = $1 and n.kind = 'cracked' and n.opened_at is null)::int as unseen
     from (select 1) x left join credit_accounts a on a.user_id = $1`, [u.id]);
  return c.json({ id: u.id, display_name: u.display_name, role: u.role, age_verified: acct.age_verified, email: acct.email,
    credits: { total: acct.purchased + acct.earned, refundable: acct.purchased, earned: acct.earned },
    features: { buyback: acct.buyback }, unseen_cracked: acct.unseen });
});

// Spending: daily, weekly and monthly limits (each optional) and breaks.
export const BUSINESS_EMAIL = SUPPORT_EMAIL;

customer.get("/me/limits", async (c) => {
  const db = c.get("db");
  const id = c.get("user").id;
  const { rows } = await db.query(
    `select period, limit_credits::int as limit, spent::int, resets_at, pending_credits::int as pending, has_pending,
            (select pending_daily_at from spend_limits where user_id = $1) as pd_at,
            (select pending_weekly_at from spend_limits where user_id = $1) as pw_at,
            (select pending_monthly_at from spend_limits where user_id = $1) as pm_at
     from spending_summary($1)`, [id]);
  const { rows: [b] } = await db.query(
    `select break_until, break_until > app_now() as on_break,
            exists (select 1 from break_end_requests r where r.user_id = $1 and r.resolved_at is null) as end_requested,
            (select count(*) from orders where user_id = $1)::int as orders,
            (select limit_loosen_delay_hours from system_config) as loosen_delay_hours
     from (select 1) x left join spend_limits l on l.user_id = $1`, [id]);
  const at = { daily: "pd_at", weekly: "pw_at", monthly: "pm_at" } as const;
  return c.json({
    limits: rows.map((r) => ({ period: r.period, limit: r.limit, spent: r.spent, resets_at: r.resets_at,
      pending: r.has_pending ? { limit: r.pending, at: r[at[r.period as keyof typeof at]] } : null })),
    break_until: b.on_break ? b.break_until : null,
    break_end_requested: b.end_requested,
    // Prompt gently to set a limit before a first purchase.
    suggest_limit: b.orders === 0 && rows.every((r) => r.limit == null),
    loosen_delay_hours: b.loosen_delay_hours,
    support_email: BUSINESS_EMAIL,
  });
});

customer.put("/me/limits/:period", async (c) => {
  const { credits } = await c.req.json<{ credits: number | null }>();
  const db = c.get("db");
  const { rows: [r] } = await db.query("select set_spend_limit($1, $2, $3) as result", [c.get("user").id, c.req.param("period"), credits]);
  const { rows: [u] } = await db.query(
    `select u.email, case $2 when 'daily' then l.pending_daily_at when 'weekly' then l.pending_weekly_at else l.pending_monthly_at end as at
     from users u left join spend_limits l on l.user_id = u.id where u.id = $1`, [c.get("user").id, c.req.param("period")]);
  await sendSafely(c.get("services"), { kind: "limit_changed", to: u.email,
    data: { period: c.req.param("period"), credits, pending: r.result === "pending", at: u.at } });
  return c.json({ result: r.result });
});

customer.post("/me/break", async (c) => {
  const { hours } = await c.req.json<{ hours: number }>();
  const db = c.get("db");
  const { rows: [r] } = await db.query("select take_break($1, $2) as until", [c.get("user").id, hours]);
  const { rows: [u] } = await db.query("select email from users where id = $1", [c.get("user").id]);
  await sendSafely(c.get("services"), { kind: "break_started", to: u.email, data: { until: r.until } });
  return c.json({ break_until: r.until });
});

// "Request early end": recorded for staff; the app also opens a pre filled email.
customer.post("/me/break/end-request", async (c) => {
  const db = c.get("db");
  await db.query("select request_break_end($1)", [c.get("user").id]);
  const { rows: [u] } = await db.query(
    "select u.email, l.break_until from users u join spend_limits l on l.user_id = u.id where u.id = $1", [c.get("user").id]);
  const subject = "Break end request";
  const body = `Account email: ${u.email}\nBreak ends: ${new Date(u.break_until).toLocaleString("en-US", { timeZone: "America/Los_Angeles" })} Pacific\n`;
  return c.json({ mailto: `mailto:${BUSINESS_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}` });
});

customer.post("/orders", async (c) => {
  const body = await c.req.json<{ product_id: string; quantity: number }>();
  const { rows: [r] } = await c.get("db").query("select place_order($1, $2, $3) as id",
    [c.get("user").id, body.product_id, body.quantity]);
  const { rows: [o] } = await c.get("db").query(
    `select u.email, o.quantity, o.total_credits::int, s.name as set_name, p.id as product_id, p.name as product,
            coalesce(product_available_packs(p.id), 0) as left
     from orders o join users u on u.id = o.user_id join products p on p.id = o.product_id join mtg_sets s on s.code = p.set_code
     where o.id = $1`, [r.id]);
  await sendSafely(c.get("services"), { kind: "order_confirmation", to: o.email, data: { packs: o.quantity, set_name: o.set_name, credits: o.total_credits } });
  if (o.left === 0) await staffAlert(c.get("services"), `${o.product} sold out`, `The last sellable pack of ${o.product} was just ordered. Receive more boxes on the Stock screen, or leave it sold out.`);
  return c.json({ order_id: r.id }, 201);
});

customer.post("/orders/:id/cancel", async (c) => {
  await c.get("db").query("select cancel_order($1, $2)", [c.req.param("id"), c.get("user").id]);
  return c.json({ ok: true });
});

customer.get("/orders", async (c) => {
  const { rows } = await c.get("db").query(
    `select o.id, o.quantity, o.total_credits::int, o.status, o.placed_at, b.batch_date::text, b.status as batch_status,
            p.name as product, qe.positions, oc.clip_ref,
            (select count(*) from queue_entries q where q.order_id = o.id and q.status = 'opened')::int as packs_opened
     from orders o
     join batches b on b.id = o.batch_id
     join products p on p.id = o.product_id
     left join order_clips oc on oc.order_id = o.id and oc.status = 'ready'
     left join lateral (select array_agg(position order by position) filter (where position is not null) as positions
                        from queue_entries q where q.order_id = o.id) qe on true
     where o.user_id = $1 order by o.placed_at desc limit 100`, [c.get("user").id]);
  return c.json({ orders: rows });
});

// Credits: one balance, anything still processing, and the activity with a running balance.
const ACTIVITY_SQL = `
  with grouped as (
    select min(e.id) as id, min(e.created_at) as at, e.kind, e.ref_type, coalesce(e.ref_id, e.id::text) as ref_id, sum(e.amount)::bigint as amount
    from credit_entries e where e.user_id = $1
    group by e.kind, e.ref_type, coalesce(e.ref_id, e.id::text))
  select g.id, g.at, g.kind, g.amount::int, (sum(g.amount) over (order by g.id))::int as balance,
         o.quantity, s.name as set_name,
         (select count(*) from buyback_items bi where g.ref_type = 'buyback' and bi.request_id::text = g.ref_id)::int as cards,
         (select cd.name from buyback_items bi join cards cd on cd.id = bi.card_id
          where g.ref_type = 'buyback' and bi.request_id::text = g.ref_id limit 1) as card_name
  from grouped g
  left join orders o on g.ref_type = 'order' and o.id::text = g.ref_id
  left join products p on p.id = o.product_id left join mtg_sets s on s.code = p.set_code
  order by g.id desc limit 200`;

function describe(r: { kind: string; quantity: number | null; set_name: string | null; cards: number; card_name: string | null }) {
  const packs = r.quantity === 1 ? "1 pack" : `${r.quantity} packs`;
  switch (r.kind) {
    case "purchase": return "Added credits";
    case "card_refund": return "Refunded to your card";
    case "pack_order": return `Bought ${packs} ${r.set_name ?? ""}`.trim();
    case "order_cancel_refund": return `Order cancelled: ${packs} ${r.set_name ?? ""}`.trim();
    case "buyback": return r.cards === 1 ? `Sold back: ${r.card_name}` : `Sold back: ${r.cards} cards`;
    case "shipping_fee": return "Shipping fee";
    default: return "Adjustment";
  }
}

customer.get("/me/credits", async (c) => {
  const db = c.get("db");
  const id = c.get("user").id;
  const { rows: [acct] } = await db.query(
    `select coalesce(a.purchased + a.earned, 0)::int as available,
            (select coalesce(sum(total_credits), 0)::int from buyback_requests where user_id = $1 and status = 'held') as pending
     from (select 1) x left join credit_accounts a on a.user_id = $1`, [id]);
  const { rows } = await db.query(ACTIVITY_SQL, [id]);
  return c.json({ available: acct.available, pending: acct.pending,
    activity: rows.map((r) => ({ id: r.id, at: r.at, kind: r.kind, description: describe(r), amount: r.amount, balance: r.balance })) });
});

// Cracked today: the packs from the customer's latest approved night, newest order first.
customer.get("/me/cracked", async (c) => {
  const { rows } = await c.get("db").query(
    `with last_night as (
       select o.batch_id from orders o where o.user_id = $1 and o.status = 'fulfilled' order by o.fulfilled_at desc limit 1)
     select po.id as pack_id, q.order_id, q.pack_index, o.quantity as order_packs, q.position, p.set_code, s.name as set_name,
            b.batch_date::text, n.opened_at is null as is_new, v.status as video_status,
            (select count(*) from pack_contents pc where pc.pack_opening_id = po.id and pc.kind = 'card')::int as cards,
            (select coalesce(json_agg(ci.uris ->> 'small' order by pc.slot), '[]') from pack_contents pc
             join card_images ci on ci.card_id = pc.card_id where pc.pack_opening_id = po.id and pc.kind = 'card') as thumbs
     from last_night ln join batches b on b.id = ln.batch_id
     join orders o on o.batch_id = ln.batch_id and o.user_id = $1 and o.status = 'fulfilled'
     join queue_entries q on q.order_id = o.id
     join pack_openings po on po.queue_entry_id = q.id and po.status = 'opened'
     join products p on p.id = o.product_id join mtg_sets s on s.code = p.set_code
     left join pack_videos v on v.pack_opening_id = po.id
     left join lateral (select opened_at from notifications x where x.order_id = o.id and x.kind = 'cracked' order by sent_at desc limit 1) n on true
     order by o.placed_at desc, q.pack_index`, [c.get("user").id]);
  return c.json({ packs: rows });
});

customer.post("/me/cracked/seen", async (c) => {
  const { rows: [r] } = await c.get("db").query("select mark_cracked_seen($1) as n", [c.get("user").id]);
  return c.json({ marked: r.n });
});

// One of the customer's packs: its cards in the order they were pulled.
customer.get("/me/packs/:id", async (c) => {
  const db = c.get("db");
  const { rows: [pack] } = await db.query(
    `select po.id, q.order_id, q.pack_index, o.quantity as order_packs, p.set_code, s.name as set_name, b.batch_date::text, v.status as video_status
     from pack_openings po join queue_entries q on q.id = po.queue_entry_id join orders o on o.id = q.order_id
     join products p on p.id = o.product_id join mtg_sets s on s.code = p.set_code join batches b on b.id = po.batch_id
     left join pack_videos v on v.pack_opening_id = po.id
     where po.id = $1 and o.user_id = $2 and o.status = 'fulfilled'`, [c.req.param("id"), c.get("user").id]);
  if (!pack) throw new ApiError("unknown_pack", 404);
  const { rows } = await db.query(
    `select pc.slot, pc.kind, pc.card_id, pc.finish, cd.name, cd.set_code, cd.collector_number, cd.rarity, pr.market_cents::int, pr.price_asof, ${IMAGE_SQL}
     from pack_contents pc left join cards cd on cd.id = pc.card_id
     left join card_prices_current pr on pr.card_id = pc.card_id and pr.finish = pc.finish
     where pc.pack_opening_id = $1 and pc.kind = 'card' order by pc.slot`, [pack.id]);
  return c.json({ pack, cards: withImages(rows) });
});

// The pack's video, only for its owner, through a link that expires.
const VIDEO_LINK_SECONDS = 60 * 60;
customer.get("/me/packs/:id/video", async (c) => {
  const videos = c.get("services").videos;
  if (!videos) throw new ApiError("videos_unavailable", 503);
  const { rows: [v] } = await c.get("db").query(
    `select v.pathname, v.content_type, v.thumbnail_pathname from pack_videos v
     join pack_openings po on po.id = v.pack_opening_id join queue_entries q on q.id = po.queue_entry_id join orders o on o.id = q.order_id
     where v.pack_opening_id = $1 and o.user_id = $2 and o.status = 'fulfilled' and v.status = 'approved'`, [c.req.param("id"), c.get("user").id]);
  if (!v) throw new ApiError("unknown_video", 404);
  const abs = (u: string) => new URL(u, c.req.url).toString();
  return c.json({ url: abs(await videos.signedUrl(v.pathname, VIDEO_LINK_SECONDS)), content_type: v.content_type,
    poster: v.thumbnail_pathname ? abs(await videos.signedUrl(v.thumbnail_pathname, VIDEO_LINK_SECONDS)) : null,
    expires_in: VIDEO_LINK_SECONDS });
});

// Everything held, in the order received: newest pack first, cards in the order pulled.
customer.get("/me/vault", async (c) => {
  const { rows } = await c.get("db").query(
    `select h.card_id, h.finish, h.condition, h.qty, h.individual_card_id, h.market_cents::int, h.price_asof,
            cd.name, cd.set_code, s.name as set_name, cd.collector_number, cd.rarity, cd.released_at::text, cd.legalities,
            pull.at as received_at, pull.pack_id, pull.slot, ${IMAGE_SQL}
     from vault_holdings h join cards cd on cd.id = h.card_id join mtg_sets s on s.code = cd.set_code
     left join lateral (
       select po.opened_at as at, po.id as pack_id, pc.slot from pack_contents pc join pack_openings po on po.id = pc.pack_opening_id
       join queue_entries q on q.id = po.queue_entry_id
       where q.user_id = h.user_id and pc.card_id = h.card_id and pc.finish = h.finish
         and (h.individual_card_id is null or pc.individual_card_id = h.individual_card_id)
       order by po.opened_at desc limit 1) pull on true
     where h.user_id = $1
     order by pull.at desc nulls last, pull.slot, cd.name`, [c.get("user").id]);
  const total = rows.reduce((s, r) => s + (r.market_cents ?? 0) * r.qty, 0);
  const { rows: [cfg] } = await c.get("db").query("select free_ship_min_value_cents::int as free_min, ship_fee_credits::int as fee from system_config");
  return c.json({ cards: withImages(rows), total_market_cents: total, shipping: cfg });
});

customer.post("/me/notifications/:id/opened", async (c) => {
  await c.get("db").query("select mark_notification_opened($1, $2)", [c.req.param("id"), c.get("user").id]);
  return c.json({ ok: true });
});

customer.get("/me/notifications", async (c) => {
  const { rows } = await c.get("db").query(
    `select n.id, n.kind, n.order_id, n.sent_at, n.opened_at, oc.clip_ref
     from notifications n left join order_clips oc on oc.order_id = n.order_id
     where n.user_id = $1 order by n.sent_at desc limit 50`, [c.get("user").id]);
  return c.json({ notifications: rows });
});

// Quote before selling. The real price is re-quoted inside request_buyback.
customer.post("/me/buyback/quote", async (c) => {
  const { items } = await c.req.json<{ items: { card_id: string; finish: string; qty?: number }[] }>();
  const { rows: [cfg] } = await c.get("db").query("select buyback_enabled from system_config");
  if (!cfg.buyback_enabled) throw new ApiError("buyback_disabled");
  const { rows } = await c.get("db").query(
    `select i.card_id, i.finish, i.qty, p.market_cents::int, buylist_quote(p.market_cents, current_buylist_schedule())::int as quote_each,
            (p.card_id is null or p.price_asof < app_now() - (cfg()).max_price_age) as stale
     from jsonb_to_recordset($1::jsonb) as i(card_id uuid, finish text, qty int)
     left join card_prices_current p on p.card_id = i.card_id and p.finish = i.finish`,
    [JSON.stringify(items.map((i) => ({ ...i, qty: i.qty ?? 1 })))]);
  // Same freshness rule request_buyback enforces, so a quote never promises what the sale will refuse.
  return c.json({ items: rows, total_credits: rows.reduce((s, r) => s + (r.quote_each ?? 0) * r.qty, 0), stale: rows.some((r) => r.stale) });
});

customer.post("/me/buyback", async (c) => {
  const { items, idempotency_key } = await c.req.json<{ items: unknown[]; idempotency_key: string }>();
  if (!idempotency_key) throw new ApiError("idempotency_key_required", 400);
  const db = c.get("db");
  const { rows: [r] } = await db.query("select request_buyback($1, $2, $3) as id",
    [c.get("user").id, JSON.stringify(items), `${c.get("user").id}:${idempotency_key}`]);
  const { rows: [req] } = await db.query(
    "select id, status, total_credits::int, hold_until from buyback_requests where id = $1", [r.id]);
  const { rows: [bi] } = await db.query(
    "select u.email, (select coalesce(sum(qty), 0)::int from buyback_items where request_id = $1) as cards from users u where u.id = $2", [r.id, c.get("user").id]);
  await sendSafely(c.get("services"), { kind: "sellback_receipt", to: bi.email,
    data: { cards: bi.cards, credits: req.total_credits, hold_until: req.status === "held" ? req.hold_until : null } });
  return c.json(req, 201);
});

customer.post("/me/shipments", async (c) => {
  const { items, address } = await c.req.json<{ items: unknown[]; address: Record<string, string> }>();
  const db = c.get("db");
  const { rows: [r] } = await db.query("select request_shipment($1, $2, $3) as id",
    [c.get("user").id, JSON.stringify(items), JSON.stringify(address)]);
  const { rows: [s] } = await db.query(
    "select id, status, value_cents::int, fee_credits::int from shipment_requests where id = $1", [r.id]);
  return c.json(s, 201);
});

customer.post("/checkout", async (c) => {
  const payments = c.get("services").payments;
  if (!payments) throw new ApiError("payments_unavailable", 503);
  // No adding credit during a break.
  await c.get("db").query("select assert_not_on_break($1)", [c.get("user").id]);
  const { bundle_key, success_url, cancel_url } = await c.req.json<{ bundle_key: string; success_url: string; cancel_url: string }>();
  const out = await payments.createCheckout({ userId: c.get("user").id, bundleKey: bundle_key, successUrl: success_url, cancelUrl: cancel_url });
  return c.json(out, 201);
});
