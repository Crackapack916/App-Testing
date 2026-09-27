-- Buyback on a versioned, editable buylist, and shipping requests.

create table buylist_schedules (
  id             serial primary key,
  effective_from timestamptz not null,
  note           text,
  created_by     uuid references users(id),
  created_at     timestamptz not null default now()
);

create table buylist_tiers (
  schedule_id      int not null references buylist_schedules(id),
  min_market_cents bigint not null check (min_market_cents >= 0),
  pct              numeric(5,2) check (pct > 0 and pct <= 100),
  flat_credits     bigint check (flat_credits >= 0),
  primary key (schedule_id, min_market_cents),
  check ((pct is null) <> (flat_credits is null))
);

insert into buylist_schedules (id, effective_from, note) values (1, '2000-01-01', 'Launch schedule');
insert into buylist_tiers values (1, 200, 90, null), (1, 50, 50, null), (1, 0, null, 2);
select setval('buylist_schedules_id_seq', 1);

create function current_buylist_schedule() returns int language sql volatile as $$
  select id from buylist_schedules where effective_from <= app_now() order by effective_from desc, id desc limit 1
$$;

create function buylist_quote(p_market_cents bigint, p_schedule int) returns bigint language sql stable as $$
  select case when t.pct is not null then floor(p_market_cents * t.pct / 100)::bigint else t.flat_credits end
  from buylist_tiers t
  where t.schedule_id = p_schedule and t.min_market_cents <= p_market_cents
  order by t.min_market_cents desc limit 1
$$;

create table buyback_requests (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references users(id),
  schedule_id     int not null references buylist_schedules(id),
  total_credits   bigint not null,
  status          text not null check (status in ('held', 'completed')),
  hold_until      timestamptz,
  idempotency_key text unique,
  created_at      timestamptz not null,
  completed_at    timestamptz
);

create table buyback_items (
  request_id         uuid not null references buyback_requests(id),
  line               int not null,
  card_id            uuid not null references cards(id),
  finish             text not null,
  condition          text not null,
  qty                int not null check (qty > 0),
  individual_card_id uuid references individual_cards(id),
  market_cents       bigint not null,
  quote_each         bigint not null,
  primary key (request_id, line)
);

create function fresh_market_cents(p_card uuid, p_finish text) returns bigint language plpgsql as $$
declare p card_prices_current;
begin
  select * into p from card_prices_current where card_id = p_card and finish = p_finish;
  if p.card_id is null then raise exception 'price_missing'; end if;
  if p.price_asof < app_now() - (cfg()).max_price_age then raise exception 'price_stale'; end if;
  return p.market_cents;
end $$;

-- p_items: [{"card_id","finish","condition","qty"}] for fungible, [{"individual_card_id"}] for held cards.
-- Cards leave the vault immediately. Credit lands now, or after the hold window for large payouts.
create function request_buyback(p_user uuid, p_items jsonb, p_idempotency_key text) returns uuid language plpgsql as $$
declare
  c system_config := cfg(); sched int := current_buylist_schedule();
  r uuid; existing uuid; it jsonb; line int := 0; ic individual_cards;
  mkt bigint; q bigint; qty int; total bigint := 0;
begin
  select id into existing from buyback_requests where idempotency_key = p_idempotency_key;
  if existing is not null then return existing; end if;
  if jsonb_array_length(coalesce(p_items, '[]')) = 0 then raise exception 'no_items'; end if;

  r := gen_random_uuid();
  insert into buyback_requests (id, user_id, schedule_id, total_credits, status, idempotency_key, created_at)
  values (r, p_user, sched, 0, 'completed', p_idempotency_key, app_now());

  for it in select * from jsonb_array_elements(p_items) loop
    line := line + 1;
    if it ? 'individual_card_id' then
      select * into ic from individual_cards where id = (it->>'individual_card_id')::uuid for update;
      if ic.id is null or ic.owner_user_id is distinct from p_user or ic.status <> 'vaulted' then
        raise exception 'card_not_in_vault';
      end if;
      mkt := fresh_market_cents(ic.card_id, ic.finish);
      q := buylist_quote(mkt, sched);
      update individual_cards set owner_user_id = null, status = 'house' where id = ic.id;
      insert into buyback_items values (r, line, ic.card_id, ic.finish, ic.condition, 1, ic.id, mkt, q);
      total := total + q;
    else
      qty := (it->>'qty')::int;
      if qty is null or qty < 1 then raise exception 'invalid_quantity'; end if;
      mkt := fresh_market_cents((it->>'card_id')::uuid, it->>'finish');
      q := buylist_quote(mkt, sched);
      -- vault_balance_non_negative rejects selling more than the customer holds.
      insert into vault_entries (user_id, card_id, finish, condition, qty_delta, reason, ref_type, ref_id)
      values (p_user, (it->>'card_id')::uuid, it->>'finish', coalesce(it->>'condition', 'NM'), -qty, 'buyback', 'buyback', r::text);
      insert into buyback_items values (r, line, (it->>'card_id')::uuid, it->>'finish', coalesce(it->>'condition', 'NM'), qty, null, mkt, q);
      total := total + q * qty;
    end if;
  end loop;

  if total >= c.large_payout_min_credits then
    update buyback_requests set total_credits = total, status = 'held', hold_until = app_now() + c.large_payout_hold where id = r;
  else
    update buyback_requests set total_credits = total, completed_at = app_now() where id = r;
    if total > 0 then
      insert into credit_entries (user_id, bucket, amount, kind, ref_type, ref_id)
      values (p_user, 'earned', total, 'buyback', 'buyback', r::text);
    end if;
  end if;
  return r;
end $$;

-- Run on a schedule. Credits held buybacks whose window has passed.
create function release_held_buybacks() returns int language plpgsql as $$
declare r buyback_requests; n int := 0;
begin
  for r in select * from buyback_requests where status = 'held' and hold_until <= app_now() for update skip locked loop
    update buyback_requests set status = 'completed', completed_at = app_now() where id = r.id;
    insert into credit_entries (user_id, bucket, amount, kind, ref_type, ref_id)
    values (r.user_id, 'earned', r.total_credits, 'buyback', 'buyback', r.id::text);
    n := n + 1;
  end loop;
  return n;
end $$;

create table shipment_requests (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references users(id),
  status       text not null default 'requested' check (status in ('requested', 'shipped')),
  address      jsonb not null,
  value_cents  bigint not null,
  fee_credits  bigint not null,
  tracking_ref text,
  created_at   timestamptz not null,
  shipped_at   timestamptz
);

create table shipment_items (
  shipment_id        uuid not null references shipment_requests(id),
  line               int not null,
  card_id            uuid not null references cards(id),
  finish             text not null,
  condition          text not null,
  qty                int not null check (qty > 0),
  individual_card_id uuid references individual_cards(id),
  primary key (shipment_id, line)
);

create function request_shipment(p_user uuid, p_items jsonb, p_address jsonb) returns uuid language plpgsql as $$
declare c system_config := cfg(); s uuid := gen_random_uuid(); it jsonb; line int := 0;
        ic individual_cards; qty int; val bigint := 0; mkt bigint; fee bigint;
begin
  if jsonb_array_length(coalesce(p_items, '[]')) = 0 then raise exception 'no_items'; end if;
  insert into shipment_requests (id, user_id, address, value_cents, fee_credits, created_at)
  values (s, p_user, p_address, 0, 0, app_now());

  for it in select * from jsonb_array_elements(p_items) loop
    line := line + 1;
    if it ? 'individual_card_id' then
      select * into ic from individual_cards where id = (it->>'individual_card_id')::uuid for update;
      if ic.id is null or ic.owner_user_id is distinct from p_user or ic.status <> 'vaulted' then
        raise exception 'card_not_in_vault';
      end if;
      update individual_cards set status = 'shipping' where id = ic.id;
      insert into shipment_items values (s, line, ic.card_id, ic.finish, ic.condition, 1, ic.id);
      select coalesce(market_cents, 0) into mkt from card_prices_current where card_id = ic.card_id and finish = ic.finish;
      val := val + coalesce(mkt, 0);
    else
      qty := (it->>'qty')::int;
      if qty is null or qty < 1 then raise exception 'invalid_quantity'; end if;
      insert into vault_entries (user_id, card_id, finish, condition, qty_delta, reason, ref_type, ref_id)
      values (p_user, (it->>'card_id')::uuid, it->>'finish', coalesce(it->>'condition', 'NM'), -qty, 'ship', 'shipment', s::text);
      insert into shipment_items values (s, line, (it->>'card_id')::uuid, it->>'finish', coalesce(it->>'condition', 'NM'), qty, null);
      select coalesce(market_cents, 0) into mkt from card_prices_current where card_id = (it->>'card_id')::uuid and finish = it->>'finish';
      val := val + coalesce(mkt, 0) * qty;
    end if;
  end loop;

  fee := case when val >= c.free_ship_min_value_cents then 0 else c.ship_fee_credits end;
  update shipment_requests set value_cents = val, fee_credits = fee where id = s;
  if fee > 0 then perform spend_credits(p_user, fee, 'shipping_fee', 'shipment', s::text); end if;
  return s;
end $$;

-- Physical stock leaves only when the box actually ships.
create function mark_shipped(p_shipment uuid, p_tracking text) returns void language plpgsql as $$
declare sr shipment_requests; si shipment_items;
begin
  select * into sr from shipment_requests where id = p_shipment for update;
  if sr.status <> 'requested' then raise exception 'shipment_not_pending'; end if;
  for si in select * from shipment_items where shipment_id = p_shipment loop
    if si.individual_card_id is not null then
      update individual_cards set status = 'shipped' where id = si.individual_card_id;
    else
      update inventory_lots set qty_on_hand = qty_on_hand - si.qty
      where card_id = si.card_id and finish = si.finish and condition = si.condition;
    end if;
  end loop;
  update shipment_requests set status = 'shipped', shipped_at = app_now(), tracking_ref = p_tracking where id = p_shipment;
end $$;
