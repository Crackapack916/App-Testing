-- Foundation: runtime config, the clock, users, and the chain of custody log.
-- All money is integer credits. 1 credit = $0.01.

create extension if not exists pgcrypto;
create extension if not exists pg_trgm;

create table system_config (
  singleton                 boolean primary key default true check (singleton),
  mode                      text not null default 'test' check (mode in ('test', 'live')),
  timezone                  text not null default 'America/Los_Angeles',
  cutoff_local              time not null default '19:00',
  blocked_states            text[] not null default '{}',
  max_packs_per_order       int  not null default 12,
  individual_hold_min_cents bigint not null default 2000,   -- $20: hold the specific physical card
  large_payout_min_credits  bigint not null default 10000,  -- $100: buyback goes to a hold window
  large_payout_hold         interval not null default '72 hours',
  max_price_age             interval not null default '48 hours',
  free_ship_min_value_cents bigint not null default 7500,
  ship_fee_credits          bigint not null default 499
);
insert into system_config default values;

-- Once live, the clock override can never be turned back on.
create function system_config_guard() returns trigger language plpgsql as $$
begin
  if old.mode = 'live' and new.mode <> 'live' then
    raise exception 'live_mode_is_permanent';
  end if;
  return new;
end $$;
create trigger system_config_guard before update on system_config
  for each row execute function system_config_guard();

-- The only clock business logic may read. In test mode a session may pin it with
-- set_config('app.now_override', ...). In live mode the override is ignored.
-- custody_events.recorded_at always stores the real wall clock regardless.
create function app_now() returns timestamptz language plpgsql volatile as $$
declare o text;
begin
  if (select mode from system_config) = 'test' then
    o := current_setting('app.now_override', true);
    if o is not null and o <> '' then
      return o::timestamptz;
    end if;
  end if;
  return clock_timestamp();
end $$;

-- Transaction scoped flags set by trusted functions. Never null, so a missing flag
-- can never slip through a comparison in a guard trigger.
create function app_flag(name text) returns text language sql stable as $$
  select coalesce(current_setting(name, true), '')
$$;

create function epoch_us(t timestamptz) returns text language sql immutable as $$
  select (extract(epoch from t) * 1000000)::bigint::text
$$;

create function cfg() returns system_config language sql stable as $$
  select * from system_config
$$;

create table users (
  id              uuid primary key default gen_random_uuid(),
  auth_user_id    text unique,
  email           text unique not null,
  display_name    text,
  role            text not null default 'customer' check (role in ('customer', 'staff', 'admin')),
  birthdate       date,
  age_verified_at timestamptz,
  state_code      char(2),
  created_at      timestamptz not null default now()
);

-- Append only, hash chained. Every row commits to the one before it, so any edit,
-- deletion or reordering breaks verify_custody_chain().
create table custody_events (
  seq         bigint primary key,
  batch_id    uuid,
  event_type  text not null,
  payload     jsonb not null default '{}',
  actor_id    uuid references users(id),
  app_time    timestamptz not null,
  recorded_at timestamptz not null,
  prev_hash   text not null,
  hash        text not null
);
create index custody_events_batch on custody_events (batch_id, seq);

create function custody_hash(e custody_events) returns text language sql immutable as $$
  select encode(digest(concat_ws('|',
    e.seq::text, coalesce(e.batch_id::text, ''), e.event_type, e.payload::text,
    coalesce(e.actor_id::text, ''), epoch_us(e.app_time), epoch_us(e.recorded_at), e.prev_hash
  ), 'sha256'), 'hex')
$$;

create function custody_events_chain() returns trigger language plpgsql as $$
declare last custody_events;
begin
  -- Serialize writers so seq and prev_hash follow commit order.
  perform pg_advisory_xact_lock(hashtext('custody_events'));
  select * into last from custody_events order by seq desc limit 1;
  new.seq         := coalesce(last.seq, 0) + 1;
  new.prev_hash   := coalesce(last.hash, repeat('0', 64));
  new.app_time    := coalesce(new.app_time, app_now());
  new.recorded_at := clock_timestamp();
  new.hash        := custody_hash(new);
  return new;
end $$;
create trigger custody_events_chain before insert on custody_events
  for each row execute function custody_events_chain();

create function reject_mutation() returns trigger language plpgsql as $$
begin
  raise exception '%_is_append_only', tg_table_name;
end $$;
create trigger custody_events_immutable before update or delete on custody_events
  for each row execute function reject_mutation();
create trigger custody_events_no_truncate before truncate on custody_events
  for each statement execute function reject_mutation();

create function log_custody(p_batch uuid, p_type text, p_payload jsonb, p_actor uuid)
returns bigint language plpgsql as $$
declare s bigint;
begin
  insert into custody_events (seq, batch_id, event_type, payload, actor_id, app_time, recorded_at, prev_hash, hash)
  values (0, p_batch, p_type, coalesce(p_payload, '{}'), p_actor, app_now(), clock_timestamp(), '', '')
  returning seq into s;
  return s;
end $$;

-- Returns the first seq whose hash or link does not verify, or null if the chain is intact.
create function verify_custody_chain() returns bigint language plpgsql stable as $$
declare e custody_events; prev text := repeat('0', 64); expect bigint := 1;
begin
  for e in select * from custody_events order by seq loop
    if e.seq <> expect or e.prev_hash <> prev or e.hash <> custody_hash(e) then
      return e.seq;
    end if;
    prev := e.hash;
    expect := expect + 1;
  end loop;
  return null;
end $$;
