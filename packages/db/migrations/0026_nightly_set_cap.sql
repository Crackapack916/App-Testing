-- Six packs per set per night (Tyson, replacing the per customer limit from 0022).
--
-- Invariants:
--   * Each night's queue holds at most max_packs_per_set_per_night packs of any one set, across
--     every customer, counting orders not cancelled. There is no limit on any single customer.
--   * The count is taken under a transaction lock per (night, set), so two customers ordering the
--     last packs at the same moment can never pass the cap together.
--   * A set with a published drop still sells only while the drop is live and within its packs
--     allocated (unchanged from 0022).
--   * set_limit_overrides and drops.per_customer_limit stay for history but no longer apply.

alter table system_config add column max_packs_per_set_per_night int not null default 6 check (max_packs_per_set_per_night > 0);

create function packs_in_night_for_set(p_batch uuid, p_set text) returns int language sql stable as $$
  select coalesce(sum(o.quantity), 0)::int from orders o join products p on p.id = o.product_id
  where o.batch_id = p_batch and p.set_code = p_set and o.status <> 'cancelled'
$$;

create or replace function orders_set_guard() returns trigger language plpgsql as $$
declare v_set text; lim int := (cfg()).max_packs_per_set_per_night; d drops; has_drops boolean;
begin
  select p.set_code into v_set from products p where p.id = new.product_id;
  -- One order at a time per night and set, so concurrent orders are counted one after another.
  perform pg_advisory_xact_lock(hashtext('night_set:' || new.batch_id::text || ':' || v_set));
  if packs_in_night_for_set(new.batch_id, v_set) + new.quantity > lim then raise exception 'night_set_limit_reached'; end if;

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
