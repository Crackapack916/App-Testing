-- The order queue and its lock. This is the trust and legal core of the system.
--
-- Invariants, enforced here in the database rather than in application code:
--   1. Every order is timestamped at purchase and lands in the first open batch whose
--      cutoff is still in the future.
--   2. A batch can only be locked at or after its cutoff. Locking assigns every queued
--      pack a position by (placed_at, purchase_seq, pack_index) and publishes a SHA-256
--      manifest of that sequence.
--   3. Once locked, nothing can be inserted, removed, reordered or cancelled.
--   4. No pack in a batch can be opened until the batch is locked (see 0006).

create sequence purchase_seq;

create table batches (
  id                 uuid primary key default gen_random_uuid(),
  batch_date         date unique not null,
  cutoff_at          timestamptz not null,
  status             text not null default 'open' check (status in ('open', 'locked', 'in_session', 'completed')),
  locked_at          timestamptz,
  locked_by          uuid references users(id),
  entry_count        int,
  manifest_hash      text,
  completed_at       timestamptz
);

create table orders (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references users(id),
  product_id       uuid not null references products(id),
  batch_id         uuid not null references batches(id),
  quantity         int not null check (quantity >= 1),
  per_pack_credits bigint not null,
  total_credits    bigint not null,
  paid_earned      bigint not null,
  paid_purchased   bigint not null,
  placed_at        timestamptz not null,
  purchase_seq     bigint not null unique,
  status           text not null default 'queued' check (status in ('queued', 'cancelled', 'fulfilled')),
  cancelled_at     timestamptz,
  fulfilled_at     timestamptz
);
create index orders_user on orders (user_id, placed_at desc);
create index orders_batch on orders (batch_id);

-- One row per physical pack owed.
create table queue_entries (
  id               uuid primary key default gen_random_uuid(),
  batch_id         uuid not null references batches(id),
  order_id         uuid not null references orders(id),
  user_id          uuid not null references users(id),
  product_id       uuid not null references products(id),
  pack_index       int not null,
  placed_at        timestamptz not null,
  purchase_seq     bigint not null,
  position         int,   -- global order within the batch, set only by lock_batch
  status           text not null default 'queued' check (status in ('queued', 'cancelled', 'opened')),
  unique (order_id, pack_index),
  unique (batch_id, position)
);
create index queue_entries_next on queue_entries (batch_id, position) where status = 'queued';

-- Batch dates and cutoffs ---------------------------------------------------------

create function ensure_batch(p_date date) returns batches language plpgsql as $$
declare b batches; c system_config := cfg();
begin
  insert into batches (batch_date, cutoff_at)
  values (p_date, (p_date + c.cutoff_local) at time zone c.timezone)
  on conflict (batch_date) do nothing;
  select * into b from batches where batch_date = p_date;
  return b;
end $$;

-- The first open batch whose cutoff is after t.
create function batch_for_time(t timestamptz) returns batches language plpgsql as $$
declare c system_config := cfg(); d date; b batches;
begin
  d := (t at time zone c.timezone)::date;
  if (t at time zone c.timezone)::time >= c.cutoff_local then d := d + 1; end if;
  loop
    b := ensure_batch(d);
    if b.status = 'open' and b.cutoff_at > t then return b; end if;
    d := d + 1;
  end loop;
end $$;

-- Placing and cancelling ----------------------------------------------------------

create function place_order(p_user uuid, p_product uuid, p_qty int)
returns uuid language plpgsql as $$
declare
  c system_config := cfg();
  u users; p products; b batches;
  t timestamptz; per_pack bigint; total bigint; spent record;
  o uuid; s bigint; tries int := 0;
begin
  select * into u from users where id = p_user;
  if u.id is null then raise exception 'unknown_user'; end if;
  if u.age_verified_at is null then raise exception 'age_not_verified'; end if;
  if u.state_code = any (c.blocked_states) then raise exception 'state_blocked'; end if;
  if p_qty < 1 or p_qty > c.max_packs_per_order then raise exception 'invalid_quantity'; end if;

  select * into p from products where id = p_product;
  if p.id is null or not p.active then raise exception 'product_unavailable'; end if;

  -- Hold a share lock on the batch so lock_batch (which takes FOR UPDATE) waits for
  -- in flight purchases, then timestamp only after the lock is held.
  loop
    tries := tries + 1;
    if tries > 5 then raise exception 'batch_assignment_failed'; end if;
    b := batch_for_time(app_now());
    select * into b from batches where id = b.id for share;
    t := app_now();
    exit when b.status = 'open' and t < b.cutoff_at;
  end loop;

  update product_stock set packs_reserved = packs_reserved + p_qty
  where product_id = p_product and packs_on_hand - packs_reserved - p.safety_buffer_packs >= p_qty;
  if not found then raise exception 'sold_out'; end if;

  select per_pack_credits into per_pack from price_tiers
  where product_id = p_product and min_qty <= p_qty order by min_qty desc limit 1;
  if per_pack is null then raise exception 'no_price'; end if;
  total := per_pack * p_qty;

  o := gen_random_uuid();
  select * into spent from spend_credits(p_user, total, 'pack_order', 'order', o::text);

  s := nextval('purchase_seq');
  insert into orders (id, user_id, product_id, batch_id, quantity, per_pack_credits, total_credits,
                      paid_earned, paid_purchased, placed_at, purchase_seq)
  values (o, p_user, p_product, b.id, p_qty, per_pack, total, spent.earned_used, spent.purchased_used, t, s);

  insert into queue_entries (batch_id, order_id, user_id, product_id, pack_index, placed_at, purchase_seq)
  select b.id, o, p_user, p_product, i, t, s from generate_series(1, p_qty) i;

  perform log_custody(b.id, 'order_placed', jsonb_build_object(
    'order_id', o, 'product_id', p_product, 'quantity', p_qty,
    'placed_at_us', epoch_us(t), 'purchase_seq', s), p_user);
  return o;
end $$;

-- Cancellation closes at the cutoff, the same moment ordering closes.
create function cancel_order(p_order uuid, p_user uuid) returns void language plpgsql as $$
declare o orders; b batches;
begin
  select * into o from orders where id = p_order;
  if o.id is null or o.user_id <> p_user then raise exception 'unknown_order'; end if;
  select * into b from batches where id = o.batch_id for share;
  select * into o from orders where id = p_order for update;
  if o.status <> 'queued' then raise exception 'order_not_cancellable'; end if;
  if b.status <> 'open' or app_now() >= b.cutoff_at then raise exception 'cutoff_passed'; end if;

  update orders set status = 'cancelled', cancelled_at = app_now() where id = p_order;
  update queue_entries set status = 'cancelled' where order_id = p_order;
  update product_stock set packs_reserved = packs_reserved - o.quantity where product_id = o.product_id;

  if o.paid_earned > 0 then
    insert into credit_entries (user_id, bucket, amount, kind, ref_type, ref_id)
    values (o.user_id, 'earned', o.paid_earned, 'order_cancel_refund', 'order', o.id::text);
  end if;
  if o.paid_purchased > 0 then
    insert into credit_entries (user_id, bucket, amount, kind, ref_type, ref_id)
    values (o.user_id, 'purchased', o.paid_purchased, 'order_cancel_refund', 'order', o.id::text);
  end if;

  perform log_custody(b.id, 'order_cancelled', jsonb_build_object('order_id', o.id), p_user);
end $$;

-- The lock ------------------------------------------------------------------------

-- Canonical text of a locked queue. One line per pack, in position order.
create function batch_manifest(p_batch uuid) returns text language sql stable as $$
  select coalesce(string_agg(concat_ws('|', position, id, order_id, user_id, product_id, epoch_us(placed_at), purchase_seq, pack_index),
                             E'\n' order by position), '')
  from queue_entries where batch_id = p_batch and position is not null
$$;

create function lock_batch(p_batch uuid, p_actor uuid) returns text language plpgsql as $$
declare b batches; n int; h text;
begin
  select * into b from batches where id = p_batch for update;
  if b.id is null then raise exception 'unknown_batch'; end if;
  if b.status <> 'open' then raise exception 'batch_already_locked'; end if;
  if app_now() < b.cutoff_at then raise exception 'cutoff_not_reached'; end if;

  perform set_config('app.locking_batch', p_batch::text, true);
  with ranked as (
    select id, row_number() over (order by placed_at, purchase_seq, pack_index) as pos
    from queue_entries where batch_id = p_batch and status = 'queued'
  )
  update queue_entries q set position = r.pos from ranked r where q.id = r.id;
  get diagnostics n = row_count;
  perform set_config('app.locking_batch', '', true);

  h := encode(digest(batch_manifest(p_batch), 'sha256'), 'hex');
  update batches set status = 'locked', locked_at = app_now(), locked_by = p_actor,
                     entry_count = n, manifest_hash = h
  where id = p_batch;

  perform log_custody(p_batch, 'queue_locked', jsonb_build_object(
    'batch_date', b.batch_date, 'cutoff_at_us', epoch_us(b.cutoff_at),
    'entry_count', n, 'manifest_hash', h), p_actor);
  return h;
end $$;

-- Freeze triggers -----------------------------------------------------------------

create function batches_guard() returns trigger language plpgsql as $$
declare rank_of jsonb := '{"open":0,"locked":1,"in_session":2,"completed":3}';
begin
  if tg_op = 'DELETE' then raise exception 'batches_cannot_be_deleted'; end if;
  if new.batch_date <> old.batch_date or new.cutoff_at <> old.cutoff_at then
    raise exception 'batch_schedule_immutable';
  end if;
  if (rank_of ->> new.status)::int not in ((rank_of ->> old.status)::int, (rank_of ->> old.status)::int + 1) then
    raise exception 'invalid_batch_transition % -> %', old.status, new.status;
  end if;
  if old.status <> 'open' and (new.locked_at is distinct from old.locked_at
      or new.locked_by is distinct from old.locked_by
      or new.entry_count is distinct from old.entry_count
      or new.manifest_hash is distinct from old.manifest_hash) then
    raise exception 'batch_lock_immutable';
  end if;
  return new;
end $$;
create trigger batches_guard before update or delete on batches
  for each row execute function batches_guard();

create function orders_guard() returns trigger language plpgsql as $$
declare bs text;
begin
  if tg_op = 'DELETE' then raise exception 'orders_cannot_be_deleted'; end if;
  if (new.user_id, new.product_id, new.batch_id, new.quantity, new.per_pack_credits, new.total_credits,
      new.paid_earned, new.paid_purchased, new.placed_at, new.purchase_seq)
     is distinct from
     (old.user_id, old.product_id, old.batch_id, old.quantity, old.per_pack_credits, old.total_credits,
      old.paid_earned, old.paid_purchased, old.placed_at, old.purchase_seq) then
    raise exception 'order_fields_immutable';
  end if;
  if new.status <> old.status then
    select status into bs from batches where id = old.batch_id;
    if not ((old.status = 'queued' and new.status = 'cancelled' and bs = 'open')
         or (old.status = 'queued' and new.status = 'fulfilled' and bs in ('in_session', 'completed'))) then
      raise exception 'invalid_order_transition % -> % (batch %)', old.status, new.status, bs;
    end if;
  end if;
  return new;
end $$;
create trigger orders_guard before update or delete on orders
  for each row execute function orders_guard();

create function queue_entries_guard() returns trigger language plpgsql as $$
declare bs text;
begin
  if tg_op = 'DELETE' then raise exception 'queue_entries_cannot_be_deleted'; end if;
  select status into bs from batches where id = coalesce(new.batch_id, old.batch_id);

  if tg_op = 'INSERT' then
    if bs <> 'open' then raise exception 'batch_locked'; end if;
    if new.position is not null then raise exception 'position_assigned_only_by_lock'; end if;
    return new;
  end if;

  if (new.batch_id, new.order_id, new.user_id, new.product_id, new.pack_index, new.placed_at, new.purchase_seq)
     is distinct from
     (old.batch_id, old.order_id, old.user_id, old.product_id, old.pack_index, old.placed_at, old.purchase_seq) then
    raise exception 'queue_entry_fields_immutable';
  end if;

  if new.position is distinct from old.position then
    if not (old.position is null and bs = 'open'
            and app_flag('app.locking_batch') = old.batch_id::text) then
      raise exception 'position_assigned_only_by_lock';
    end if;
  end if;

  if new.status <> old.status then
    if not ((old.status = 'queued' and new.status = 'cancelled' and bs = 'open')
         or (old.status = 'queued' and new.status = 'opened' and bs = 'in_session'
             and app_flag('app.opening_entry') = old.id::text)) then
      raise exception 'invalid_queue_transition % -> % (batch %)', old.status, new.status, bs;
    end if;
  end if;
  return new;
end $$;
create trigger queue_entries_guard before insert or update or delete on queue_entries
  for each row execute function queue_entries_guard();

create trigger batches_no_truncate before truncate on batches for each statement execute function reject_mutation();
create trigger orders_no_truncate before truncate on orders for each statement execute function reject_mutation();
create trigger queue_entries_no_truncate before truncate on queue_entries for each statement execute function reject_mutation();
