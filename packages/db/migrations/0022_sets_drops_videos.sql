-- Per set limits, drops, pack videos and approval (revision brief items 3, 5, 9, 11, 14).
--
-- Invariants:
--   * A customer can hold at most max_packs_per_set_per_customer packs of one set across the
--     whole test run (not per day), counting pending orders; cancelled or refunded orders
--     release the count. A drop's per customer limit, or a logged staff override, replaces it.
--     Checked on the order insert, after spend_credits has locked the customer's credit
--     account, so a customer's concurrent purchases are counted one at a time.
--   * A set with a published drop sells only while that drop is live, and never more than
--     the drop's packs allocated (the drop row is locked while counting).
--   * Every opened pack has at most one video. Customers are notified only when every pack
--     in their order has a ready video and approved contents; approving a batch marks its
--     videos approved and notifies every order, and is refused until all of them are ready.

alter table system_config
  add column max_packs_per_set_per_customer int not null default 6 check (max_packs_per_set_per_customer > 0),
  add column video_retention_months int not null default 12 check (video_retention_months > 0);

-- Wizards' published pack information, and official pack photos (supplied by Tyson).
alter table mtg_sets add column wizards_info_url text;

-- Staff overrides of the per set limit for one customer. Latest wins; append only.
create table set_limit_overrides (
  id         bigserial primary key,
  user_id    uuid not null references users(id),
  set_code   text not null references mtg_sets(code),
  max_packs  int not null check (max_packs >= 0),
  reason     text not null check (length(trim(reason)) > 0),
  actor      uuid not null references users(id),
  created_at timestamptz not null default clock_timestamp()
);
create trigger set_limit_overrides_immutable before update or delete on set_limit_overrides
  for each row execute function reject_mutation();

create table drops (
  id                 uuid primary key default gen_random_uuid(),
  set_code           text not null references mtg_sets(code),
  starts_at          timestamptz not null,
  ends_at            timestamptz,
  packs_allocated    int not null check (packs_allocated >= 0),
  per_customer_limit int check (per_customer_limit > 0),
  status             text not null default 'draft' check (status in ('draft', 'published', 'cancelled')),
  created_by         uuid references users(id),
  updated_at         timestamptz not null default now(),
  check (ends_at is null or ends_at > starts_at)
);
create index drops_set on drops (set_code, starts_at);

create function packs_sold_in_drop(p_drop uuid) returns int language sql stable as $$
  select coalesce(sum(o.quantity), 0)::int from orders o join products p on p.id = o.product_id join drops d on d.id = p_drop
  where p.set_code = d.set_code and o.status <> 'cancelled' and o.placed_at >= d.starts_at
    and (d.ends_at is null or o.placed_at < d.ends_at)
$$;

-- Upcoming, Live now, Sold out, Ended (drafts and cancelled drops are never shown).
create function drop_state(d drops) returns text language sql stable as $$
  select case
    when app_now() < d.starts_at then 'upcoming'
    when d.ends_at is not null and app_now() >= d.ends_at then 'ended'
    when packs_sold_in_drop(d.id) >= d.packs_allocated then 'sold_out'
    else 'live' end
$$;

create function packs_held_in_set(p_user uuid, p_set text) returns int language sql stable as $$
  select coalesce(sum(o.quantity), 0)::int from orders o join products p on p.id = o.product_id
  where o.user_id = p_user and p.set_code = p_set and o.status <> 'cancelled'
$$;

create function set_limit_for(p_user uuid, p_set text) returns int language sql stable as $$
  select coalesce(
    (select max_packs from set_limit_overrides where user_id = p_user and set_code = p_set order by id desc limit 1),
    (select per_customer_limit from drops d where d.set_code = p_set and d.status = 'published'
       and d.starts_at <= app_now() and (d.ends_at is null or app_now() < d.ends_at) order by d.starts_at desc limit 1),
    (cfg()).max_packs_per_set_per_customer)
$$;

create function orders_set_guard() returns trigger language plpgsql as $$
declare v_set text; lim int; d drops; has_drops boolean;
begin
  select p.set_code into v_set from products p where p.id = new.product_id;
  lim := set_limit_for(new.user_id, v_set);
  if packs_held_in_set(new.user_id, v_set) + new.quantity > lim then raise exception 'set_limit_reached'; end if;

  select exists (select 1 from drops where drops.set_code = v_set and status = 'published') into has_drops;
  if has_drops then
    select * into d from drops where drops.set_code = v_set and status = 'published'
      and starts_at <= app_now() and (ends_at is null or app_now() < ends_at)
    order by starts_at desc limit 1 for update;
    if d.id is null then raise exception 'drop_not_live'; end if;
    if packs_sold_in_drop(d.id) + new.quantity > d.packs_allocated then raise exception 'sold_out'; end if;
  end if;
  return new;
end $$;
create trigger orders_set_guard before insert on orders for each row execute function orders_set_guard();

create function set_customer_set_limit(p_user uuid, p_set text, p_max int, p_reason text, p_actor uuid) returns void language plpgsql as $$
begin
  if nullif(trim(p_reason), '') is null then raise exception 'reason_required'; end if;
  insert into set_limit_overrides (user_id, set_code, max_packs, reason, actor) values (p_user, upper(p_set), p_max, trim(p_reason), p_actor);
end $$;

create table drop_reminders (
  drop_id         uuid not null references drops(id),
  user_id         uuid not null references users(id),
  token           text not null unique,
  created_at      timestamptz not null default now(),
  sent_at         timestamptz,
  unsubscribed_at timestamptz,
  primary key (drop_id, user_id)
);

-- Reminders due: one hour before a published drop starts, opted in and not unsubscribed.
create function due_drop_reminders() returns table (drop_id uuid, user_id uuid, email text, token text, set_name text, starts_at timestamptz)
language sql stable as $$
  select r.drop_id, r.user_id, u.email, r.token, s.name, d.starts_at
  from drop_reminders r join drops d on d.id = r.drop_id join users u on u.id = r.user_id join mtg_sets s on s.code = d.set_code
  where d.status = 'published' and r.sent_at is null and r.unsubscribed_at is null
    and app_now() >= d.starts_at - interval '1 hour' and app_now() < d.starts_at
$$;

-- Pack videos: one per opened pack, uploaded straight to storage from the staff browser.
create table pack_videos (
  pack_opening_id uuid primary key references pack_openings(id),
  status          text not null check (status in ('uploading', 'processing', 'ready', 'approved')),
  pathname        text,
  size_bytes      bigint,
  sha256          text check (sha256 ~ '^[0-9a-f]{64}$'),
  duration_ms     int,
  content_type    text,
  thumbnail_pathname text,
  recorded_at     timestamptz,     -- the file's own timestamp, to spot out of order recordings
  uploaded_by     uuid references users(id),
  uploaded_at     timestamptz,
  updated_at      timestamptz not null default now()
);

create table session_masters (
  batch_id    uuid primary key references batches(id),
  pathname    text not null,
  size_bytes  bigint not null,
  sha256      text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  uploaded_by uuid references users(id),
  uploaded_at timestamptz not null default now()
);

create function start_pack_video(p_pack uuid, p_actor uuid) returns void language plpgsql as $$
begin
  if not exists (select 1 from pack_openings where id = p_pack and status = 'opened') then raise exception 'pack_not_opened'; end if;
  if exists (select 1 from pack_videos where pack_opening_id = p_pack and status = 'approved') then raise exception 'video_approved'; end if;
  insert into pack_videos (pack_opening_id, status, uploaded_by) values (p_pack, 'uploading', p_actor)
  on conflict (pack_opening_id) do update set status = 'uploading', uploaded_by = p_actor, updated_at = now();
end $$;

-- The browser uploaded the file; the API verified it exists in storage at this size.
create function finish_pack_video(p_pack uuid, p_pathname text, p_size bigint, p_sha256 text, p_duration_ms int,
                                  p_content_type text, p_thumbnail text, p_recorded_at timestamptz, p_actor uuid)
returns void language plpgsql as $$
declare b uuid;
begin
  if p_content_type not in ('video/mp4', 'video/quicktime') then raise exception 'video_type_unsupported'; end if;
  update pack_videos set status = 'ready', pathname = p_pathname, size_bytes = p_size, sha256 = lower(p_sha256),
         duration_ms = p_duration_ms, content_type = p_content_type, thumbnail_pathname = p_thumbnail,
         recorded_at = p_recorded_at, uploaded_by = p_actor, uploaded_at = app_now(), updated_at = now()
  where pack_opening_id = p_pack and status in ('uploading', 'processing', 'ready');
  if not found then raise exception 'video_not_started'; end if;
  select batch_id into b from pack_openings where id = p_pack;
  perform log_custody(b, 'video_uploaded', jsonb_build_object('pack_opening_id', p_pack, 'sha256', lower(p_sha256),
    'size_bytes', p_size, 'duration_ms', p_duration_ms), p_actor);
end $$;

-- The last step of the night: every pack has a ready video and approved contents, then all
-- videos are approved and every order in the batch is notified.
create function approve_and_notify_batch(p_batch uuid, p_actor uuid) returns int language plpgsql as $$
declare o record; n int := 0;
begin
  perform 1 from batches where id = p_batch for update;
  if exists (select 1 from queue_entries q where q.batch_id = p_batch and q.status = 'queued') then raise exception 'queue_not_exhausted'; end if;
  if exists (select 1 from pack_openings po left join pack_videos v on v.pack_opening_id = po.id
             where po.batch_id = p_batch and po.status = 'opened' and (v.status is null or v.status not in ('ready', 'approved'))) then
    raise exception 'videos_not_ready';
  end if;
  if exists (select 1 from pack_openings po where po.batch_id = p_batch and po.status = 'opened' and po.contents_finalized_at is null) then
    raise exception 'contents_not_finalized';
  end if;
  update pack_videos v set status = 'approved', updated_at = now()
  from pack_openings po where po.id = v.pack_opening_id and po.batch_id = p_batch and v.status = 'ready';
  for o in select id from orders where batch_id = p_batch and status = 'queued' order by purchase_seq loop
    perform notify_order(o.id, p_actor);
    n := n + 1;
  end loop;
  perform log_custody(p_batch, 'batch_approved', jsonb_build_object('orders_notified', n), p_actor);
  return n;
end $$;

-- Notify requires the order's pack videos (not the old per order clip) and approved contents.
create or replace function notify_order(p_order uuid, p_actor uuid) returns uuid language plpgsql as $$
declare o orders; n uuid;
begin
  select * into o from orders where id = p_order for update;
  if o.status <> 'queued' then raise exception 'order_not_notifiable'; end if;
  if exists (select 1 from queue_entries q left join pack_openings po on po.queue_entry_id = q.id
             left join pack_videos v on v.pack_opening_id = po.id
             where q.order_id = p_order and (v.status is null or v.status not in ('ready', 'approved'))) then
    raise exception 'videos_not_ready';
  end if;
  if exists (select 1 from queue_entries q left join pack_openings po on po.queue_entry_id = q.id
             where q.order_id = p_order and po.contents_finalized_at is null) then
    raise exception 'contents_not_finalized';
  end if;
  insert into notifications (user_id, order_id, kind, sent_at) values (o.user_id, p_order, 'cracked', app_now()) returning id into n;
  update orders set status = 'fulfilled', fulfilled_at = app_now() where id = p_order;
  perform log_custody(o.batch_id, 'customer_notified', jsonb_build_object('order_id', p_order, 'notification_id', n), p_actor);
  return n;
end $$;

-- The working test ladder (per pack): 1 pack 1,000, 3 packs 950 each, 6 packs 900 each.
-- Not yet confirmed; staff can change any product's ladder on the Stock screen.
create or replace function default_price_ladder() returns jsonb language sql immutable as $$
  select '[{"min_qty":1,"per_pack_credits":1000},{"min_qty":3,"per_pack_credits":950},{"min_qty":6,"per_pack_credits":900}]'::jsonb
$$;
update system_config set max_packs_per_order = 6;
