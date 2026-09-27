-- Age gate and spending limits (business context section 9: standard mitigations).
--   * Ordering requires a verified age of at least min_age. A verified birthdate is locked.
--   * Every customer has rolling 24 hour and 30 day spend caps on pack orders: their own
--     limit, never above the platform maximum. Lowering takes effect now; raising waits
--     limit_raise_delay (a cooling off period).
--   * A customer can take a break from ordering. A break can be extended, never shortened.
-- Enforced by a trigger on orders, so place_order (and the queue lock) are unchanged. The
-- trigger runs after spend_credits has locked the customer's credit account, so concurrent
-- orders from one customer are checked one at a time.

alter table system_config
  add column min_age int not null default 18,
  add column max_daily_spend_credits bigint not null default 25000,     -- $250
  add column max_monthly_spend_credits bigint not null default 100000,  -- $1,000
  add column limit_raise_delay interval not null default '24 hours';

create table spend_limits (
  user_id            uuid primary key references users(id),
  daily_credits      bigint check (daily_credits > 0),
  monthly_credits    bigint check (monthly_credits > 0),
  pending_daily      bigint,
  pending_monthly    bigint,
  pending_at         timestamptz,
  break_until        timestamptz,
  updated_at         timestamptz not null default now()
);

-- Birthdate and state. Self attested in the pilot; swap in document verification before launch.
create function set_profile(p_user uuid, p_birthdate date, p_state char(2)) returns void language plpgsql as $$
declare u users; c system_config := cfg();
begin
  select * into u from users where id = p_user for update;
  if u.id is null then raise exception 'unknown_user'; end if;
  if u.age_verified_at is not null and u.birthdate is distinct from p_birthdate then raise exception 'birthdate_locked'; end if;
  if p_birthdate > ((app_now() at time zone c.timezone)::date - make_interval(years => c.min_age)) then raise exception 'underage'; end if;
  update users set birthdate = p_birthdate, state_code = upper(p_state),
         age_verified_at = coalesce(age_verified_at, app_now())
  where id = p_user;
end $$;

-- Applies a pending raise once its cooling off period has passed.
create function effective_spend_limits(p_user uuid, out daily bigint, out monthly bigint, out break_until timestamptz)
language plpgsql as $$
declare l spend_limits; c system_config := cfg();
begin
  select * into l from spend_limits where user_id = p_user;
  if l.pending_at is not null and l.pending_at <= app_now() then
    update spend_limits set daily_credits = pending_daily, monthly_credits = pending_monthly,
           pending_daily = null, pending_monthly = null, pending_at = null, updated_at = now()
    where user_id = p_user returning * into l;
  end if;
  daily := least(coalesce(l.daily_credits, c.max_daily_spend_credits), c.max_daily_spend_credits);
  monthly := least(coalesce(l.monthly_credits, c.max_monthly_spend_credits), c.max_monthly_spend_credits);
  break_until := l.break_until;
end $$;

-- null means "the platform maximum".
create function set_spend_limits(p_user uuid, p_daily bigint, p_monthly bigint) returns void language plpgsql as $$
declare cur record; c system_config := cfg(); raising boolean;
begin
  select * into cur from effective_spend_limits(p_user);
  raising := coalesce(p_daily, c.max_daily_spend_credits) > cur.daily or coalesce(p_monthly, c.max_monthly_spend_credits) > cur.monthly;
  insert into spend_limits (user_id) values (p_user) on conflict do nothing;
  if raising then
    -- Any lowering in the same request still applies now; the raise waits.
    update spend_limits set
      daily_credits = case when coalesce(p_daily, c.max_daily_spend_credits) < cur.daily then p_daily else daily_credits end,
      monthly_credits = case when coalesce(p_monthly, c.max_monthly_spend_credits) < cur.monthly then p_monthly else monthly_credits end,
      pending_daily = p_daily, pending_monthly = p_monthly, pending_at = app_now() + c.limit_raise_delay, updated_at = now()
    where user_id = p_user;
  else
    update spend_limits set daily_credits = p_daily, monthly_credits = p_monthly,
           pending_daily = null, pending_monthly = null, pending_at = null, updated_at = now()
    where user_id = p_user;
  end if;
end $$;

create function take_break(p_user uuid, p_days int) returns timestamptz language plpgsql as $$
declare until timestamptz;
begin
  if p_days < 1 or p_days > 365 then raise exception 'invalid_break'; end if;
  insert into spend_limits (user_id) values (p_user) on conflict do nothing;
  update spend_limits set break_until = greatest(coalesce(break_until, app_now()), app_now() + make_interval(days => p_days)),
         updated_at = now()
  where user_id = p_user returning break_until into until;
  return until;
end $$;

create function spent_on_packs(p_user uuid, p_window interval) returns bigint language sql stable as $$
  select coalesce(sum(total_credits), 0)::bigint from orders
  where user_id = p_user and status <> 'cancelled' and placed_at > app_now() - p_window
$$;

create function orders_spend_guard() returns trigger language plpgsql as $$
declare l record;
begin
  select * into l from effective_spend_limits(new.user_id);
  if l.break_until is not null and l.break_until > app_now() then raise exception 'on_break'; end if;
  if spent_on_packs(new.user_id, interval '24 hours') + new.total_credits > l.daily then raise exception 'daily_limit_reached'; end if;
  if spent_on_packs(new.user_id, interval '30 days') + new.total_credits > l.monthly then raise exception 'monthly_limit_reached'; end if;
  return new;
end $$;
create trigger orders_spend_guard before insert on orders for each row execute function orders_spend_guard();
