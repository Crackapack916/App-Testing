-- Spending limits and breaks, rebuilt (revision brief item 4).
--
-- Root cause of "limits get messed up and get locked": set_spend_limits took both limits in
-- one call and treated a null as "raise to the platform maximum", so lowering one limit while
-- the app sent null for the other queued the whole change as a raise; and every repeat of a
-- raise restarted its 24 hour wait. Limits were never removable.
--
-- Invariants now:
--   * Daily, weekly and monthly limits are each optional (null = no limit) and set one at a
--     time. They count credits spent on pack orders that are not cancelled, in calendar
--     windows in Pacific time: today from midnight, this week from Monday 12:00 AM, this
--     month from the 1st.
--   * Tightening (a new or lower limit) applies at once. Loosening (raise or remove) waits
--     system_config.limit_loosen_delay_hours, default 0. A pending loosening keeps its
--     original time when repeated; a tightening cancels it.
--   * During a break a customer cannot place orders or add credit, cannot loosen a limit,
--     and cannot shorten the break. It ends by itself; only staff can lift it early, with a
--     reason. A customer can ask for an early end, which is recorded for staff.
--   * Every change is in spend_limit_events (append only) with time, old and new values.
-- Enforced by orders_spend_guard, which runs after spend_credits has locked the customer's
-- credit account, so concurrent orders from one customer are checked one at a time.

alter table system_config add column limit_loosen_delay_hours int not null default 0 check (limit_loosen_delay_hours >= 0);

alter table spend_limits
  add column weekly_credits bigint check (weekly_credits > 0),
  add column pending_weekly bigint,
  add column pending_daily_at timestamptz,
  add column pending_weekly_at timestamptz,
  add column pending_monthly_at timestamptz,
  add column break_started_at timestamptz,
  add column break_end_emailed_at timestamptz;

-- Carry over what was set before (the old platform maximums no longer apply).
update spend_limits set pending_daily = null, pending_monthly = null, pending_at = null;
alter table spend_limits drop column pending_at;

create table spend_limit_events (
  id         bigserial primary key,
  user_id    uuid not null references users(id),
  kind       text not null check (kind in ('limit_set', 'limit_pending', 'limit_applied', 'break_started',
                                           'break_end_requested', 'break_lifted')),
  period     text check (period in ('daily', 'weekly', 'monthly')),
  old_value  bigint,
  new_value  bigint,
  effective_at timestamptz,
  reason     text,
  actor      uuid references users(id),
  created_at timestamptz not null default clock_timestamp()
);
create index spend_limit_events_user on spend_limit_events (user_id, id);
create trigger spend_limit_events_immutable before update or delete on spend_limit_events
  for each row execute function reject_mutation();

create table break_end_requests (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users(id),
  break_until timestamptz not null,
  requested_at timestamptz not null,
  resolved_at timestamptz,
  resolved_by uuid references users(id)
);

-- Window starts in Pacific time.
create function spend_window_start(p_period text) returns timestamptz language sql stable as $$
  select (case p_period
            when 'daily' then date_trunc('day', app_now() at time zone (cfg()).timezone)
            when 'weekly' then date_trunc('week', app_now() at time zone (cfg()).timezone)   -- ISO week: Monday
            when 'monthly' then date_trunc('month', app_now() at time zone (cfg()).timezone)
          end) at time zone (cfg()).timezone
$$;

create function spend_window_reset(p_period text) returns timestamptz language sql stable as $$
  select ((spend_window_start(p_period) at time zone (cfg()).timezone)
          + case p_period when 'daily' then interval '1 day' when 'weekly' then interval '7 days' else interval '1 month' end)
         at time zone (cfg()).timezone
$$;

create function spent_in_window(p_user uuid, p_period text) returns bigint language sql stable as $$
  select coalesce(sum(total_credits), 0)::bigint from orders
  where user_id = p_user and status <> 'cancelled' and placed_at >= spend_window_start(p_period)
$$;

-- Applies loosenings whose wait has passed. Returns the row as it now stands.
create function apply_due_limit_changes(p_user uuid) returns spend_limits language plpgsql as $$
declare l spend_limits;
begin
  insert into spend_limits (user_id) values (p_user) on conflict do nothing;
  select * into l from spend_limits where user_id = p_user for update;
  if l.pending_daily_at <= app_now() then
    insert into spend_limit_events (user_id, kind, period, old_value, new_value, effective_at)
    values (p_user, 'limit_applied', 'daily', l.daily_credits, l.pending_daily, l.pending_daily_at);
    update spend_limits set daily_credits = pending_daily, pending_daily = null, pending_daily_at = null where user_id = p_user;
  end if;
  if l.pending_weekly_at <= app_now() then
    insert into spend_limit_events (user_id, kind, period, old_value, new_value, effective_at)
    values (p_user, 'limit_applied', 'weekly', l.weekly_credits, l.pending_weekly, l.pending_weekly_at);
    update spend_limits set weekly_credits = pending_weekly, pending_weekly = null, pending_weekly_at = null where user_id = p_user;
  end if;
  if l.pending_monthly_at <= app_now() then
    insert into spend_limit_events (user_id, kind, period, old_value, new_value, effective_at)
    values (p_user, 'limit_applied', 'monthly', l.monthly_credits, l.pending_monthly, l.pending_monthly_at);
    update spend_limits set monthly_credits = pending_monthly, pending_monthly = null, pending_monthly_at = null where user_id = p_user;
  end if;
  select * into l from spend_limits where user_id = p_user;
  return l;
end $$;

-- Sets one limit. p_credits null removes it. Returns 'applied' or 'pending'.
create function set_spend_limit(p_user uuid, p_period text, p_credits bigint) returns text language plpgsql as $$
declare l spend_limits; cur bigint; pend_at timestamptz; delay interval; loosening boolean; on_break boolean;
begin
  if p_period not in ('daily', 'weekly', 'monthly') then raise exception 'invalid_limit_period'; end if;
  if p_credits is not null and p_credits <= 0 then raise exception 'invalid_limit'; end if;
  l := apply_due_limit_changes(p_user);
  cur := case p_period when 'daily' then l.daily_credits when 'weekly' then l.weekly_credits else l.monthly_credits end;
  pend_at := case p_period when 'daily' then l.pending_daily_at when 'weekly' then l.pending_weekly_at else l.pending_monthly_at end;
  loosening := cur is not null and (p_credits is null or p_credits > cur);
  on_break := l.break_until > app_now();
  delay := make_interval(hours => (cfg()).limit_loosen_delay_hours);

  if loosening and on_break then raise exception 'on_break'; end if;

  if loosening and delay > interval '0' then
    -- Repeating a pending loosening keeps its original time instead of restarting the wait.
    pend_at := case when pend_at is not null then pend_at else app_now() + delay end;
    execute format('update spend_limits set pending_%1$s = $1, pending_%1$s_at = $2, updated_at = now() where user_id = $3', p_period)
      using p_credits, pend_at, p_user;
    insert into spend_limit_events (user_id, kind, period, old_value, new_value, effective_at)
    values (p_user, 'limit_pending', p_period, cur, p_credits, pend_at);
    return 'pending';
  end if;

  -- Tightening, or loosening with no delay: applies now and cancels anything pending.
  execute format('update spend_limits set %1$s_credits = $1, pending_%1$s = null, pending_%1$s_at = null, updated_at = now() where user_id = $2', p_period)
    using p_credits, p_user;
  insert into spend_limit_events (user_id, kind, period, old_value, new_value, effective_at)
  values (p_user, 'limit_set', p_period, cur, p_credits, app_now());
  return 'applied';
end $$;

-- The old two limit setter is gone; it caused the bug above.
drop function set_spend_limits(uuid, bigint, bigint);

-- Breaks are 24 hours, 7 days or 30 days. A break can be extended, never shortened.
drop function take_break(uuid, int);
create function take_break(p_user uuid, p_hours int) returns timestamptz language plpgsql as $$
declare l spend_limits; until timestamptz;
begin
  if p_hours not in (24, 168, 720) then raise exception 'invalid_break'; end if;
  l := apply_due_limit_changes(p_user);
  until := greatest(coalesce(l.break_until, app_now()), app_now() + make_interval(hours => p_hours));
  update spend_limits set break_until = until,
         break_started_at = case when l.break_until > app_now() then l.break_started_at else app_now() end,
         break_end_emailed_at = null, updated_at = now()
  where user_id = p_user;
  insert into spend_limit_events (user_id, kind, new_value, effective_at) values (p_user, 'break_started', p_hours, until);
  return until;
end $$;

create function request_break_end(p_user uuid) returns uuid language plpgsql as $$
declare l spend_limits; r uuid;
begin
  select * into l from spend_limits where user_id = p_user;
  if l.break_until is null or l.break_until <= app_now() then raise exception 'not_on_break'; end if;
  select id into r from break_end_requests where user_id = p_user and resolved_at is null;
  if r is null then
    insert into break_end_requests (user_id, break_until, requested_at) values (p_user, l.break_until, app_now()) returning id into r;
    insert into spend_limit_events (user_id, kind, effective_at) values (p_user, 'break_end_requested', l.break_until);
  end if;
  return r;
end $$;

-- Staff only (the API checks the role). A reason is required and logged.
create function lift_break(p_user uuid, p_reason text, p_actor uuid) returns void language plpgsql as $$
declare l spend_limits;
begin
  if nullif(trim(p_reason), '') is null then raise exception 'reason_required'; end if;
  select * into l from spend_limits where user_id = p_user for update;
  if l.break_until is null or l.break_until <= app_now() then raise exception 'not_on_break'; end if;
  update spend_limits set break_until = app_now(), updated_at = now() where user_id = p_user;
  update break_end_requests set resolved_at = app_now(), resolved_by = p_actor where user_id = p_user and resolved_at is null;
  insert into spend_limit_events (user_id, kind, old_value, effective_at, reason, actor)
  values (p_user, 'break_lifted', extract(epoch from l.break_until)::bigint, app_now(), trim(p_reason), p_actor);
end $$;

-- Breaks that have ended and not yet been emailed about (the scheduled job sends "break ended").
create function due_break_end_emails() returns table (user_id uuid, email text, break_until timestamptz) language sql stable as $$
  select l.user_id, u.email, l.break_until from spend_limits l join users u on u.id = l.user_id
  where l.break_until <= app_now() and l.break_started_at is not null and l.break_end_emailed_at is null
$$;
create function mark_break_end_emailed(p_user uuid) returns void language sql as $$
  update spend_limits set break_end_emailed_at = app_now() where user_id = p_user
$$;

create or replace function orders_spend_guard() returns trigger language plpgsql as $$
declare l spend_limits;
begin
  l := apply_due_limit_changes(new.user_id);
  if l.break_until > app_now() then raise exception 'on_break'; end if;
  if l.daily_credits is not null and spent_in_window(new.user_id, 'daily') + new.total_credits > l.daily_credits then
    raise exception 'daily_limit_reached'; end if;
  if l.weekly_credits is not null and spent_in_window(new.user_id, 'weekly') + new.total_credits > l.weekly_credits then
    raise exception 'weekly_limit_reached'; end if;
  if l.monthly_credits is not null and spent_in_window(new.user_id, 'monthly') + new.total_credits > l.monthly_credits then
    raise exception 'monthly_limit_reached'; end if;
  return new;
end $$;

-- Adding credit is also blocked during a break (checked by the checkout route and here).
create function assert_not_on_break(p_user uuid) returns void language plpgsql as $$
begin
  if exists (select 1 from spend_limits where user_id = p_user and break_until > app_now()) then raise exception 'on_break'; end if;
end $$;

-- What the Account screen shows.
create function spending_summary(p_user uuid) returns table (
  period text, limit_credits bigint, spent bigint, resets_at timestamptz, pending_credits bigint, pending_at timestamptz, has_pending boolean
) language plpgsql as $$
declare l spend_limits;
begin
  l := apply_due_limit_changes(p_user);
  return query
  select p, lim, spent_in_window(p_user, p), spend_window_reset(p), pv, pa, pa is not null
  from (values ('daily', l.daily_credits, l.pending_daily, l.pending_daily_at),
               ('weekly', l.weekly_credits, l.pending_weekly, l.pending_weekly_at),
               ('monthly', l.monthly_credits, l.pending_monthly, l.pending_monthly_at)) x(p, lim, pv, pa);
end $$;

drop function effective_spend_limits(uuid);
drop function spent_on_packs(uuid, interval);
