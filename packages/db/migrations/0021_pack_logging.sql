-- Pack logging by collector number (revision brief item 12).
--
-- Invariants:
--   * Only a pack opened from the locked queue can be logged (pack_contents_guard, 0007:
--     a pack_opening exists only via open_next_pack on a locked batch).
--   * A logged card's finish must be one the printing has.
--   * A slot can hold a non card (token or ad), which never reaches a vault.
--   * Every change to a pack's contents is in pack_content_events (append only), with who
--     and when; changes after approval also carry a required reason.
--   * Approval checks the card count against the set's configured slot count; a mismatch
--     needs a written override, which is kept on the pack.
--   * After approval a pack is locked. amend_pack_card is the only way to change it, and it
--     moves the customer's vault to match (only while the card is still in their vault).

alter table mtg_sets add column slot_count int check (slot_count between 1 and 20);   -- Magic cards per pack

alter table pack_contents
  add column kind text not null default 'card' check (kind in ('card', 'token', 'ad')),
  alter column card_id drop not null,
  alter column finish drop not null;
alter table pack_contents add constraint pack_contents_card_kind
  check ((kind = 'card') = (card_id is not null) and (kind = 'card') = (finish is not null));

alter table pack_openings add column count_override_reason text;

alter table individual_cards drop constraint individual_cards_status_check;
alter table individual_cards add constraint individual_cards_status_check
  check (status in ('vaulted', 'shipping', 'shipped', 'house', 'void'));

alter table vault_entries drop constraint vault_entries_reason_check;
alter table vault_entries add constraint vault_entries_reason_check
  check (reason in ('pull', 'buyback', 'ship', 'ship_cancel', 'inactivity', 'adjustment', 'pack_amend'));

create table pack_content_events (
  id              bigserial primary key,
  pack_opening_id uuid not null references pack_openings(id),
  slot            int not null,
  action          text not null check (action in ('logged', 'changed', 'cleared', 'approved', 'amended')),
  kind            text,
  card_id         uuid references cards(id),
  finish          text,
  old_card_id     uuid references cards(id),
  old_finish      text,
  reason          text,
  actor           uuid references users(id),
  created_at      timestamptz not null default clock_timestamp()
);
create index pack_content_events_pack on pack_content_events (pack_opening_id, id);
create trigger pack_content_events_immutable before update or delete on pack_content_events
  for each row execute function reject_mutation();

-- After approval only finalize_pack_contents and amend_pack_card (which set app.finalizing_pack
-- for this pack) may insert, change or remove a slot.
create or replace function pack_contents_guard() returns trigger language plpgsql as $$
declare fin timestamptz; st text; pid uuid := coalesce(new.pack_opening_id, old.pack_opening_id);
begin
  select contents_finalized_at, status into fin, st from pack_openings where id = pid;
  if st is distinct from 'opened' then raise exception 'pack_not_opened'; end if;
  if fin is not null and app_flag('app.finalizing_pack') is distinct from pid::text then
    raise exception 'pack_contents_finalized';
  end if;
  return coalesce(new, old);
end $$;

-- The finish must exist for the printing.
create function pack_contents_finish_guard() returns trigger language plpgsql as $$
begin
  if new.kind = 'card' and not exists (select 1 from cards where id = new.card_id and new.finish = any (finishes)) then
    raise exception 'finish_not_available';
  end if;
  return new;
end $$;
create trigger pack_contents_finish_guard before insert or update on pack_contents
  for each row execute function pack_contents_finish_guard();

drop function log_pack_card(uuid, int, uuid, text, text, text, uuid);
create function log_pack_card(p_pack_opening uuid, p_slot int, p_kind text, p_card uuid, p_finish text,
                              p_condition text, p_serial text, p_actor uuid)
returns void language plpgsql as $$
declare old pack_contents;
begin
  select * into old from pack_contents where pack_opening_id = p_pack_opening and slot = p_slot;
  insert into pack_contents (pack_opening_id, slot, kind, card_id, finish, condition, serial_number, logged_by)
  values (p_pack_opening, p_slot, coalesce(p_kind, 'card'),
          case when coalesce(p_kind, 'card') = 'card' then p_card end,
          case when coalesce(p_kind, 'card') = 'card' then coalesce(p_finish, 'nonfoil') end,
          coalesce(p_condition, 'NM'), p_serial, p_actor)
  on conflict (pack_opening_id, slot) do update
    set kind = excluded.kind, card_id = excluded.card_id, finish = excluded.finish, condition = excluded.condition,
        serial_number = excluded.serial_number, logged_by = excluded.logged_by, logged_at = now();
  insert into pack_content_events (pack_opening_id, slot, action, kind, card_id, finish, old_card_id, old_finish, actor)
  values (p_pack_opening, p_slot, case when old.slot is null then 'logged' else 'changed' end, coalesce(p_kind, 'card'),
          p_card, p_finish, old.card_id, old.finish, p_actor);
end $$;

drop function clear_pack_card(uuid, int);
create function clear_pack_card(p_pack_opening uuid, p_slot int, p_actor uuid) returns void language plpgsql as $$
declare old pack_contents;
begin
  delete from pack_contents where pack_opening_id = p_pack_opening and slot = p_slot returning * into old;
  if old.slot is not null then
    insert into pack_content_events (pack_opening_id, slot, action, kind, old_card_id, old_finish, actor)
    values (p_pack_opening, p_slot, 'cleared', old.kind, old.card_id, old.finish, p_actor);
  end if;
end $$;

-- Puts one logged card into its owner's vault (shared by approval and amendment).
create function vault_pack_card(p_pack_opening uuid, p_slot int, p_owner uuid, p_reason text) returns void language plpgsql as $$
declare pc pack_contents; cd cards; mkt bigint; ic uuid;
begin
  select * into pc from pack_contents where pack_opening_id = p_pack_opening and slot = p_slot;
  if pc.kind <> 'card' then return; end if;
  select * into cd from cards where id = pc.card_id;
  select market_cents into mkt from card_prices_current where card_id = pc.card_id and finish = pc.finish;
  if holds_individually(cd, pc.finish, pc.serial_number, mkt) then
    insert into individual_cards (card_id, finish, condition, serial_number, owner_user_id, status, pack_opening_id, market_cents_at_pull)
    values (pc.card_id, pc.finish, pc.condition, pc.serial_number, p_owner, 'vaulted', p_pack_opening, mkt)
    returning id into ic;
    update pack_contents set individual_card_id = ic where pack_opening_id = p_pack_opening and slot = p_slot;
  else
    insert into inventory_lots (card_id, finish, condition, qty_on_hand) values (pc.card_id, pc.finish, pc.condition, 1)
    on conflict (card_id, finish, condition) do update set qty_on_hand = inventory_lots.qty_on_hand + 1;
    insert into vault_entries (user_id, card_id, finish, condition, qty_delta, reason, ref_type, ref_id)
    values (p_owner, pc.card_id, pc.finish, pc.condition, 1, p_reason, 'pack_opening', p_pack_opening::text);
  end if;
end $$;

-- Approval: the count check, then every card to the customer's vault, then the pack locks.
drop function finalize_pack_contents(uuid, uuid);
create function finalize_pack_contents(p_pack_opening uuid, p_actor uuid, p_count_override text default null)
returns int language plpgsql as $$
declare po pack_openings; owner uuid; expected int; cards_n int; n int := 0; pc pack_contents;
begin
  select * into po from pack_openings where id = p_pack_opening for update;
  if po.id is null or po.status <> 'opened' then raise exception 'pack_not_opened'; end if;
  if po.contents_finalized_at is not null then raise exception 'pack_contents_finalized'; end if;
  select user_id into owner from queue_entries where id = po.queue_entry_id;

  select count(*) filter (where kind = 'card'), count(*) into cards_n, n from pack_contents where pack_opening_id = p_pack_opening;
  if n = 0 then raise exception 'pack_contents_empty'; end if;
  select s.slot_count into expected from queue_entries q join products p on p.id = q.product_id
    join mtg_sets s on s.code = p.set_code where q.id = po.queue_entry_id;
  if expected is not null and cards_n <> expected and nullif(trim(p_count_override), '') is null then
    raise exception 'card_count_mismatch';
  end if;

  update pack_openings set contents_finalized_at = app_now(),
         count_override_reason = case when expected is not null and cards_n <> expected then trim(p_count_override) end
  where id = p_pack_opening;
  perform set_config('app.finalizing_pack', p_pack_opening::text, true);
  for pc in select * from pack_contents where pack_opening_id = p_pack_opening order by slot loop
    perform vault_pack_card(p_pack_opening, pc.slot, owner, 'pull');
  end loop;
  perform set_config('app.finalizing_pack', '', true);

  insert into pack_content_events (pack_opening_id, slot, action, reason, actor)
  values (p_pack_opening, 0, 'approved', case when expected is not null and cards_n <> expected then trim(p_count_override) end, p_actor);
  perform log_custody(po.batch_id, 'contents_finalized', jsonb_build_object(
    'pack_opening_id', p_pack_opening, 'card_count', cards_n, 'expected', expected, 'count_override', p_count_override,
    'contents', (select jsonb_agg(jsonb_build_array(slot, kind, card_id, finish, condition) order by slot)
                 from pack_contents where pack_opening_id = p_pack_opening)), p_actor);
  return n;
end $$;

-- Change a slot after approval: a reason is required, and the vault follows.
-- p_card null clears the slot. The old card must still be in the customer's vault.
create function amend_pack_card(p_pack_opening uuid, p_slot int, p_kind text, p_card uuid, p_finish text,
                                p_reason text, p_actor uuid) returns void language plpgsql as $$
declare po pack_openings; owner uuid; old pack_contents; ic individual_cards;
begin
  if nullif(trim(p_reason), '') is null then raise exception 'reason_required'; end if;
  select * into po from pack_openings where id = p_pack_opening for update;
  if po.contents_finalized_at is null then raise exception 'pack_not_approved'; end if;
  select user_id into owner from queue_entries where id = po.queue_entry_id;
  select * into old from pack_contents where pack_opening_id = p_pack_opening and slot = p_slot;

  perform set_config('app.finalizing_pack', p_pack_opening::text, true);
  -- Take the old card back out of the vault.
  if old.kind = 'card' then
    if old.individual_card_id is not null then
      select * into ic from individual_cards where id = old.individual_card_id for update;
      if ic.status <> 'vaulted' or ic.owner_user_id is distinct from owner then raise exception 'card_left_vault'; end if;
      update individual_cards set status = 'void' where id = ic.id;
    else
      -- vault_balance_non_negative refuses this if the customer no longer holds the copy.
      begin
        insert into vault_entries (user_id, card_id, finish, condition, qty_delta, reason, ref_type, ref_id)
        values (owner, old.card_id, old.finish, old.condition, -1, 'pack_amend', 'pack_opening', p_pack_opening::text);
      exception when check_violation then raise exception 'card_left_vault';
      end;
      update inventory_lots set qty_on_hand = qty_on_hand - 1
      where card_id = old.card_id and finish = old.finish and condition = old.condition;
    end if;
  end if;

  if p_kind is null and p_card is null then
    delete from pack_contents where pack_opening_id = p_pack_opening and slot = p_slot;
  else
    insert into pack_contents (pack_opening_id, slot, kind, card_id, finish, condition, logged_by)
    values (p_pack_opening, p_slot, coalesce(p_kind, 'card'),
            case when coalesce(p_kind, 'card') = 'card' then p_card end,
            case when coalesce(p_kind, 'card') = 'card' then coalesce(p_finish, 'nonfoil') end, 'NM', p_actor)
    on conflict (pack_opening_id, slot) do update
      set kind = excluded.kind, card_id = excluded.card_id, finish = excluded.finish, individual_card_id = null,
          logged_by = excluded.logged_by, logged_at = now();
    perform vault_pack_card(p_pack_opening, p_slot, owner, 'pack_amend');
  end if;
  perform set_config('app.finalizing_pack', '', true);

  insert into pack_content_events (pack_opening_id, slot, action, kind, card_id, finish, old_card_id, old_finish, reason, actor)
  values (p_pack_opening, p_slot, 'amended', p_kind, p_card, p_finish, old.card_id, old.finish, trim(p_reason), p_actor);
  perform log_custody(po.batch_id, 'contents_amended', jsonb_build_object(
    'pack_opening_id', p_pack_opening, 'slot', p_slot, 'old', jsonb_build_array(old.kind, old.card_id, old.finish),
    'new', jsonb_build_array(p_kind, p_card, p_finish), 'reason', trim(p_reason)), p_actor);
end $$;
