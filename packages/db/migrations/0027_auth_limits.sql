-- Limits on sign in and password reset (persona testing: unlimited wrong passwords and reset emails).
--
-- Invariants:
--   * After login_max_failures wrong passwords for one email within login_window_minutes, that
--     email can't sign in until the oldest failure ages out of the window. A correct password
--     is refused too while locked, so guessing gains nothing. A password reset ends the lock.
--   * At most reset_max_per_hour reset emails go to one email per hour. Extra requests get the
--     same reply as a normal one, so the limit never reveals whether an account exists.
--   * Attempts are append only.

alter table system_config
  add column login_max_failures int not null default 10 check (login_max_failures > 0),
  add column login_window_minutes int not null default 15 check (login_window_minutes > 0),
  add column reset_max_per_hour int not null default 3 check (reset_max_per_hour > 0);

create table auth_attempts (
  id     bigserial primary key,
  kind   text not null check (kind in ('login_failed', 'reset_requested')),
  email  text not null,
  at     timestamptz not null
);
create index auth_attempts_lookup on auth_attempts (email, kind, at);
create trigger auth_attempts_immutable before update or delete on auth_attempts
  for each row execute function reject_mutation();

create function assert_login_allowed(p_email text) returns void language plpgsql as $$
declare c system_config := cfg();
begin
  if (select count(*) from auth_attempts where email = lower(trim(p_email)) and kind = 'login_failed'
      and at > app_now() - make_interval(mins => c.login_window_minutes)
      -- A password reset clears the lock.
      and at > coalesce((select max(r.used_at) from password_resets r join users u on u.id = r.user_id
                         where u.email = lower(trim(p_email))), '-infinity')) >= c.login_max_failures then
    raise exception 'too_many_attempts';
  end if;
end $$;

create function record_login_failure(p_email text) returns void language sql as $$
  insert into auth_attempts (kind, email, at) values ('login_failed', lower(trim(p_email)), app_now())
$$;

-- Returns the user only when a reset email should be sent.
create or replace function create_password_reset(p_email text, p_token_hash text) returns uuid language plpgsql as $$
declare u uuid; v_email text := lower(trim(p_email));
begin
  perform pg_advisory_xact_lock(hashtext('reset:' || v_email));
  if (select count(*) from auth_attempts where email = v_email and kind = 'reset_requested'
      and at > app_now() - interval '1 hour') >= (cfg()).reset_max_per_hour then
    return null;
  end if;
  insert into auth_attempts (kind, email, at) values ('reset_requested', v_email, app_now());
  select id into u from users where email = v_email and password_hash is not null;
  if u is null then return null; end if;   -- never reveal whether an email has an account
  insert into password_resets (token_hash, user_id, expires_at) values (p_token_hash, u, app_now() + interval '1 hour');
  return u;
end $$;
