-- Guaranteed card data for every set on sale (business context section 15).
--
-- Invariants:
--   * A set has card data only once a check confirms every printing Scryfall lists for it is in
--     `cards` with an image link. The list comes from a per set import (record_set_printings),
--     separate from the big daily bulk job, so a failed daily import can't leave a set half done.
--   * A set that hasn't passed its check can't be put on sale, can't get a published drop, and
--     can't be ordered. If a later check fails, orders stop until it passes again.
--   * Every check is kept (set_card_data_checks, append only), so staff can see when and why.

alter table mtg_sets
  add column card_data_ok boolean not null default false,
  add column card_data_checked_at timestamptz,
  add column card_data_problem text;

-- The printings the latest per set import found. Replaced on each import of that set.
create table set_expected_printings (
  set_code         text not null references mtg_sets(code),
  collector_number text not null,
  primary key (set_code, collector_number)
);

create table set_card_data_checks (
  id              bigserial primary key,
  set_code        text not null references mtg_sets(code),
  expected        int not null,
  missing         int not null,
  missing_images  int not null,
  ok              boolean not null,
  source          text not null,
  checked_at      timestamptz not null default clock_timestamp()
);
create trigger set_card_data_checks_immutable before update or delete on set_card_data_checks
  for each row execute function reject_mutation();

-- Called by the per set import with every collector number Scryfall returned for the set.
create function record_set_printings(p_set text, p_numbers text[]) returns int language plpgsql as $$
begin
  if not exists (select 1 from mtg_sets where code = upper(p_set)) then raise exception 'unknown_set'; end if;
  if coalesce(array_length(p_numbers, 1), 0) = 0 then raise exception 'no_printings'; end if;
  delete from set_expected_printings where set_code = upper(p_set);
  insert into set_expected_printings (set_code, collector_number)
  select distinct upper(p_set), n from unnest(p_numbers) n;
  return (select count(*) from set_expected_printings where set_code = upper(p_set));
end $$;

-- Every expected printing is a card with a normal size image. Runs anywhere, any time.
create function verify_set_card_data(p_set text, p_source text default 'check') returns jsonb language plpgsql as $$
declare v_set text := upper(p_set); exp int; miss text[]; noimg text[]; ok boolean; problem text;
begin
  select count(*) into exp from set_expected_printings where set_code = v_set;
  select coalesce(array_agg(e.collector_number order by e.collector_number), '{}') into miss
  from set_expected_printings e left join cards c on c.set_code = e.set_code and lower(c.collector_number) = lower(e.collector_number)
  where e.set_code = v_set and c.id is null;
  select coalesce(array_agg(c.collector_number order by c.collector_number), '{}') into noimg
  from set_expected_printings e join cards c on c.set_code = e.set_code and lower(c.collector_number) = lower(e.collector_number)
  left join card_images i on i.card_id = c.id
  where e.set_code = v_set and coalesce(i.uris ->> 'normal', i.uris ->> 'large', i.uris ->> 'png') is null;
  ok := exp > 0 and cardinality(miss) = 0 and cardinality(noimg) = 0;
  problem := case
    when exp = 0 then 'No per set import yet'
    when not ok then concat_ws('; ',
      case when cardinality(miss) > 0 then cardinality(miss) || ' printings missing' end,
      case when cardinality(noimg) > 0 then cardinality(noimg) || ' printings without an image' end)
  end;
  update mtg_sets set card_data_ok = ok, card_data_checked_at = clock_timestamp(), card_data_problem = problem where code = v_set;
  if not found then raise exception 'unknown_set'; end if;
  insert into set_card_data_checks (set_code, expected, missing, missing_images, ok, source)
  values (v_set, exp, cardinality(miss), cardinality(noimg), ok, p_source);
  return jsonb_build_object('set_code', v_set, 'ok', ok, 'expected', exp, 'problem', problem,
    'missing', to_jsonb(miss[1:20]), 'missing_images', to_jsonb(noimg[1:20]));
end $$;

-- Sets that need checking: on sale now, or with a published drop that hasn't ended.
create function sets_needing_card_data() returns setof text language sql stable as $$
  select distinct set_code from products where active
  union
  select distinct set_code from drops where status = 'published' and (ends_at is null or ends_at > app_now())
$$;

-- Gates: putting a set on sale and publishing a drop.
create or replace function set_product_active(p_product uuid, p_active boolean, p_actor uuid) returns void language plpgsql as $$
begin
  if p_active and not exists (select 1 from price_tiers where product_id = p_product and min_qty = 1) then
    raise exception 'ladder_must_start_at_one';
  end if;
  if p_active and not exists (select 1 from products p join mtg_sets s on s.code = p.set_code where p.id = p_product and s.card_data_ok) then
    raise exception 'card_data_unverified';
  end if;
  update products set active = p_active where id = p_product;
  if not found then raise exception 'unknown_product'; end if;
  perform log_custody(null, case when p_active then 'product_activated' else 'product_deactivated' end,
                      jsonb_build_object('product_id', p_product), p_actor);
end $$;

create function drops_card_data_guard() returns trigger language plpgsql as $$
begin
  if new.status = 'published' and not exists (select 1 from mtg_sets where code = new.set_code and card_data_ok) then
    raise exception 'card_data_unverified';
  end if;
  return new;
end $$;
create trigger drops_card_data_guard before insert or update on drops for each row execute function drops_card_data_guard();

-- Gate: ordering. Runs alongside orders_set_guard.
create function orders_card_data_guard() returns trigger language plpgsql as $$
begin
  if not exists (select 1 from products p join mtg_sets s on s.code = p.set_code where p.id = new.product_id and s.card_data_ok) then
    raise exception 'card_data_unverified';
  end if;
  return new;
end $$;
create trigger orders_card_data_guard before insert on orders for each row execute function orders_card_data_guard();
