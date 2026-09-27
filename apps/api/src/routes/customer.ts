import { Hono } from "hono";
import { BUNDLES } from "@crackapack/payments";
import { requireUser } from "../auth";
import { ApiError } from "../errors";
import { SCRYFALL_ID_SQL, withImages } from "../images";
import type { Env } from "../context";

/** Customer facing routes. Every write goes through a database function. */
export const customer = new Hono<Env>();

// Public: what can be ordered tonight.
customer.get("/storefront", async (c) => {
  const { rows } = await c.get("db").query(
    `select s.*, (select json_agg(json_build_object('min_qty', min_qty, 'per_pack_credits', per_pack_credits) order by min_qty)
                  from price_tiers t where t.product_id = s.product_id) as ladder
     from storefront s order by s.set_name`);
  const { rows: [batch] } = await c.get("db").query(
    "select batch_date::text, cutoff_at, app_now() as now from batch_for_time(app_now())");
  // `now` lets the app count down on the server's clock, not the phone's.
  return c.json({ products: rows, next_cutoff: batch.cutoff_at, batch_date: batch.batch_date, now: batch.now });
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
            (select state_code from users where id = $1) as state
     from (select 1) x left join credit_accounts a on a.user_id = $1`, [u.id]);
  return c.json({ id: u.id, display_name: u.display_name, role: u.role, age_verified: acct.age_verified, state: acct.state,
    credits: { total: acct.purchased + acct.earned, refundable: acct.purchased, earned: acct.earned } });
});

// Age gate: birthdate and state (self attested in the pilot).
customer.post("/me/profile", async (c) => {
  const { birthdate, state } = await c.req.json<{ birthdate: string; state: string }>();
  await c.get("db").query("select set_profile($1, $2, $3)", [c.get("user").id, birthdate, state]);
  return c.json({ ok: true });
});

customer.get("/me/limits", async (c) => {
  const id = c.get("user").id;
  const { rows: [r] } = await c.get("db").query(
    `select e.daily::int, e.monthly::int, e.break_until,
            spent_on_packs($1, '24 hours')::int as spent_today, spent_on_packs($1, '30 days')::int as spent_month,
            l.pending_daily::int, l.pending_monthly::int, l.pending_at,
            (select max_daily_spend_credits::int from system_config) as max_daily,
            (select max_monthly_spend_credits::int from system_config) as max_monthly
     from effective_spend_limits($1) e left join spend_limits l on l.user_id = $1`, [id]);
  return c.json(r);
});

customer.put("/me/limits", async (c) => {
  const { daily, monthly } = await c.req.json<{ daily: number | null; monthly: number | null }>();
  await c.get("db").query("select set_spend_limits($1, $2, $3)", [c.get("user").id, daily, monthly]);
  return c.json({ ok: true });
});

customer.post("/me/break", async (c) => {
  const { days } = await c.req.json<{ days: number }>();
  const { rows: [r] } = await c.get("db").query("select take_break($1, $2) as until", [c.get("user").id, days]);
  return c.json({ break_until: r.until });
});

customer.post("/orders", async (c) => {
  const body = await c.req.json<{ product_id: string; quantity: number }>();
  const { rows: [r] } = await c.get("db").query("select place_order($1, $2, $3) as id",
    [c.get("user").id, body.product_id, body.quantity]);
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

// Everything held for the customer, with live value.
customer.get("/me/vault", async (c) => {
  const { rows } = await c.get("db").query(
    `select h.card_id, h.finish, h.condition, h.qty, h.individual_card_id, h.market_cents::int, h.price_asof,
            cd.name, cd.set_code, cd.collector_number, cd.rarity, cd.legalities, ${SCRYFALL_ID_SQL}
     from vault_holdings h join cards cd on cd.id = h.card_id
     where h.user_id = $1 order by h.market_cents desc nulls last, cd.name`, [c.get("user").id]);
  const total = rows.reduce((s, r) => s + (r.market_cents ?? 0) * r.qty, 0);
  return c.json({ cards: withImages(rows), total_market_cents: total });
});

// "Today's pulls": cards from the customer's most recent notified night.
customer.get("/me/pulls", async (c) => {
  const { rows } = await c.get("db").query(
    `with last_night as (
       select o.batch_id from orders o where o.user_id = $1 and o.status = 'fulfilled'
       order by o.fulfilled_at desc limit 1)
     select po.id as pack_opening_id, q.order_id, q.pack_index, pc.slot, pc.finish, pc.individual_card_id,
            cd.name, cd.set_code, cd.collector_number, cd.rarity, pr.market_cents::int, b.batch_date::text, ${SCRYFALL_ID_SQL}
     from last_night ln
     join batches b on b.id = ln.batch_id
     join queue_entries q on q.batch_id = ln.batch_id and q.user_id = $1
     join pack_openings po on po.queue_entry_id = q.id
     join pack_contents pc on pc.pack_opening_id = po.id
     join cards cd on cd.id = pc.card_id
     left join card_prices_current pr on pr.card_id = pc.card_id and pr.finish = pc.finish
     order by q.position, pc.slot`, [c.get("user").id]);
  return c.json({ pulls: withImages(rows) });
});

customer.post("/me/push-token", async (c) => {
  const { token, platform } = await c.req.json<{ token: string; platform: string }>();
  await c.get("db").query("select register_push_token($1, $2, $3)", [c.get("user").id, token, platform]);
  return c.json({ ok: true });
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
  const { bundle_key, success_url, cancel_url } = await c.req.json<{ bundle_key: string; success_url: string; cancel_url: string }>();
  const out = await payments.createCheckout({ userId: c.get("user").id, bundleKey: bundle_key, successUrl: success_url, cancelUrl: cancel_url });
  return c.json(out, 201);
});
