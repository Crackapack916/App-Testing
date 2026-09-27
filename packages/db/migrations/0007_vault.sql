-- The vault: one sorted fungible inventory plus a per customer ledger, except foils,
-- serialized cards and anything at or above individual_hold_min_cents, which are held
-- as the specific physical card.
--
-- Invariant: for every (card, finish, condition), the sum of customer balances never
-- exceeds physical qty_on_hand. The remainder is house stock.

create table inventory_lots (
  card_id     uuid not null references cards(id),
  finish      text not null check (finish in ('nonfoil', 'foil', 'etched')),
  condition   text not null default 'NM' check (condition in ('NM', 'LP', 'MP', 'HP', 'DMG')),
  qty_on_hand int not null default 0 check (qty_on_hand >= 0),
  bin         text,
  primary key (card_id, finish, condition)
);

create table vault_balances (
  user_id   uuid not null references users(id),
  card_id   uuid not null references cards(id),
  finish    text not null,
  condition text not null,
  qty       int not null default 0 constraint vault_balance_non_negative check (qty >= 0),
  primary key (user_id, card_id, finish, condition)
);

create table vault_entries (
  id         bigserial primary key,
  user_id    uuid not null references users(id),
  card_id    uuid not null references cards(id),
  finish     text not null,
  condition  text not null,
  qty_delta  int not null check (qty_delta <> 0),
  reason     text not null check (reason in ('pull', 'buyback', 'ship', 'ship_cancel', 'inactivity', 'adjustment')),
  ref_type   text,
  ref_id     text,
  created_at timestamptz not null default clock_timestamp()
);
create index vault_entries_user on vault_entries (user_id, id);

create function vault_entries_apply() returns trigger language plpgsql as $$
begin
  -- Update first: CHECK runs on a proposed insert row before ON CONFLICT resolves,
  -- so a negative delta must never be proposed as a new row.
  update vault_balances set qty = qty + new.qty_delta
  where user_id = new.user_id and card_id = new.card_id and finish = new.finish and condition = new.condition;
  if not found then
    insert into vault_balances (user_id, card_id, finish, condition, qty)
    values (new.user_id, new.card_id, new.finish, new.condition, new.qty_delta);
  end if;
  return new;
end $$;
create trigger vault_entries_apply after insert on vault_entries
  for each row execute function vault_entries_apply();
create trigger vault_entries_immutable before update or delete on vault_entries
  for each row execute function reject_mutation();

create table individual_cards (
  id              uuid primary key default gen_random_uuid(),
  card_id         uuid not null references cards(id),
  finish          text not null,
  condition       text not null default 'NM',
  serial_number   text,
  photo_ref       text,   -- own photo of this exact card
  bin             text,
  owner_user_id   uuid references users(id),   -- null = house
  status          text not null check (status in ('vaulted', 'shipping', 'shipped', 'house')),
  pack_opening_id uuid references pack_openings(id),
  market_cents_at_pull bigint,
  created_at      timestamptz not null default now()
);
create index individual_cards_owner on individual_cards (owner_user_id) where status = 'vaulted';

-- What the second staff member logs per pack, spreadsheet style.
create table pack_contents (
  pack_opening_id    uuid not null references pack_openings(id),
  slot               int not null check (slot between 1 and 20),
  card_id            uuid not null references cards(id),
  finish             text not null check (finish in ('nonfoil', 'foil', 'etched')),
  condition          text not null default 'NM',
  serial_number      text,
  individual_card_id uuid references individual_cards(id),
  logged_by          uuid references users(id),
  logged_at          timestamptz not null default now(),
  primary key (pack_opening_id, slot)
);

create function pack_contents_guard() returns trigger language plpgsql as $$
declare fin timestamptz; st text;
begin
  select contents_finalized_at, status into fin, st from pack_openings
  where id = coalesce(new.pack_opening_id, old.pack_opening_id);
  if st <> 'opened' then raise exception 'pack_not_opened'; end if;
  -- After finalizing, only the individual_card_id link written by finalize may change.
  if fin is not null and not (tg_op = 'UPDATE' and app_flag('app.finalizing_pack') = old.pack_opening_id::text) then
    raise exception 'pack_contents_finalized';
  end if;
  return coalesce(new, old);
end $$;
create trigger pack_contents_guard before insert or update or delete on pack_contents
  for each row execute function pack_contents_guard();

create function log_pack_card(p_pack_opening uuid, p_slot int, p_card uuid, p_finish text,
                              p_condition text, p_serial text, p_actor uuid)
returns void language plpgsql as $$
begin
  insert into pack_contents (pack_opening_id, slot, card_id, finish, condition, serial_number, logged_by)
  values (p_pack_opening, p_slot, p_card, p_finish, coalesce(p_condition, 'NM'), p_serial, p_actor)
  on conflict (pack_opening_id, slot) do update
    set card_id = excluded.card_id, finish = excluded.finish, condition = excluded.condition,
        serial_number = excluded.serial_number, logged_by = excluded.logged_by, logged_at = now();
end $$;

create function holds_individually(p_card cards, p_finish text, p_serial text, p_market bigint)
returns boolean language sql stable as $$
  select p_finish <> 'nonfoil'
      or p_card.is_serialized
      or p_serial is not null
      or p_market >= (cfg()).individual_hold_min_cents
      -- No price on file: treat rares and mythics as valuable until priced.
      or (p_market is null and p_card.rarity in ('rare', 'mythic'))
$$;

create function finalize_pack_contents(p_pack_opening uuid, p_actor uuid) returns int language plpgsql as $$
declare po pack_openings; owner uuid; pc pack_contents; cd cards; mkt bigint; ic uuid; n int := 0;
begin
  select * into po from pack_openings where id = p_pack_opening for update;
  if po.id is null or po.status <> 'opened' then raise exception 'pack_not_opened'; end if;
  if po.contents_finalized_at is not null then raise exception 'pack_contents_finalized'; end if;
  select user_id into owner from queue_entries where id = po.queue_entry_id;

  update pack_openings set contents_finalized_at = app_now() where id = p_pack_opening;
  perform set_config('app.finalizing_pack', p_pack_opening::text, true);

  for pc in select * from pack_contents where pack_opening_id = p_pack_opening order by slot loop
    select * into cd from cards where id = pc.card_id;
    select market_cents into mkt from card_prices_current where card_id = pc.card_id and finish = pc.finish;
    if holds_individually(cd, pc.finish, pc.serial_number, mkt) then
      insert into individual_cards (card_id, finish, condition, serial_number, owner_user_id, status, pack_opening_id, market_cents_at_pull)
      values (pc.card_id, pc.finish, pc.condition, pc.serial_number, owner, 'vaulted', p_pack_opening, mkt)
      returning id into ic;
      update pack_contents set individual_card_id = ic where pack_opening_id = p_pack_opening and slot = pc.slot;
    else
      insert into inventory_lots (card_id, finish, condition, qty_on_hand) values (pc.card_id, pc.finish, pc.condition, 1)
      on conflict (card_id, finish, condition) do update set qty_on_hand = inventory_lots.qty_on_hand + 1;
      insert into vault_entries (user_id, card_id, finish, condition, qty_delta, reason, ref_type, ref_id)
      values (owner, pc.card_id, pc.finish, pc.condition, 1, 'pull', 'pack_opening', p_pack_opening::text);
    end if;
    n := n + 1;
  end loop;
  perform set_config('app.finalizing_pack', '', true);
  if n = 0 then raise exception 'pack_contents_empty'; end if;

  perform log_custody(po.batch_id, 'contents_finalized', jsonb_build_object(
    'pack_opening_id', p_pack_opening, 'card_count', n,
    'contents', (select jsonb_agg(jsonb_build_array(slot, card_id, finish, condition) order by slot)
                 from pack_contents where pack_opening_id = p_pack_opening)), p_actor);
  return n;
end $$;

-- Rows where customers are owed more copies than physically exist. Must always be empty.
create view vault_invariant_violations as
select b.card_id, b.finish, b.condition, sum(b.qty) as owed, coalesce(max(l.qty_on_hand), 0) as on_hand
from vault_balances b
left join inventory_lots l using (card_id, finish, condition)
group by b.card_id, b.finish, b.condition
having sum(b.qty) > coalesce(max(l.qty_on_hand), 0);

-- Everything a customer currently holds, fungible and individual, with live value.
create view vault_holdings as
select b.user_id, b.card_id, b.finish, b.condition, b.qty, null::uuid as individual_card_id, p.market_cents, p.price_asof
from vault_balances b
left join card_prices_current p on p.card_id = b.card_id and p.finish = b.finish
where b.qty > 0
union all
select i.owner_user_id, i.card_id, i.finish, i.condition, 1, i.id, p.market_cents, p.price_asof
from individual_cards i
left join card_prices_current p on p.card_id = i.card_id and p.finish = i.finish
where i.status = 'vaulted';
