-- Accounts: email and password sign in, 18+ at sign up, the minimum personal data.
--
-- Invariants:
--   * An account is created only for someone 18 or older on the sign up date in Pacific
--     time. The API passes the birthdate in to be checked here, but only the encrypted
--     birthdate (dob_encrypted, AES-GCM from the API) is stored. Plain birthdates are never
--     kept: users.birthdate must be null.
--   * age_verified_at is the time of age confirmation. Once set it never changes.
--   * Every account records the policy versions it accepted and when (sign up and first
--     purchase). Acceptances are append only.
--   * Password reset tokens are stored hashed, expire, and work once.

alter table users
  add column password_hash text,
  add column dob_encrypted text;

-- Plain birthdates are gone for good.
update users set birthdate = null where birthdate is not null;
alter table users add constraint users_no_plain_birthdate check (birthdate is null);

-- Versioned policies (item 18 fills in the pages). A version is immutable once published.
create table policy_versions (
  doc          text not null check (doc in ('terms', 'privacy', 'fairness')),
  version      text not null,
  published_at timestamptz not null default now(),
  title        text not null,
  body_md      text not null,
  primary key (doc, version)
);
create trigger policy_versions_immutable before update or delete on policy_versions
  for each row execute function reject_mutation();

create function current_policy_version(p_doc text) returns text language sql stable as $$
  select version from policy_versions where doc = p_doc and published_at <= app_now()
  order by published_at desc, version desc limit 1
$$;

create table policy_acceptances (
  id          bigserial primary key,
  user_id     uuid not null references users(id),
  doc         text not null,
  version     text not null,
  context     text not null check (context in ('signup', 'first_purchase', 'update')),
  accepted_at timestamptz not null default clock_timestamp(),
  foreign key (doc, version) references policy_versions (doc, version)
);
create index policy_acceptances_user on policy_acceptances (user_id, doc);
create trigger policy_acceptances_immutable before update or delete on policy_acceptances
  for each row execute function reject_mutation();

create function accept_current_policies(p_user uuid, p_context text) returns void language plpgsql as $$
begin
  insert into policy_acceptances (user_id, doc, version, context)
  select p_user, d.doc, current_policy_version(d.doc), p_context
  from (values ('terms'), ('privacy')) d(doc)
  where current_policy_version(d.doc) is not null;
end $$;

-- True when p_birthdate is at least min_age years before today in Pacific time.
create function is_of_age(p_birthdate date) returns boolean language sql stable as $$
  select p_birthdate is not null
     and p_birthdate <= ((app_now() at time zone (cfg()).timezone)::date - make_interval(years => (cfg()).min_age))::date
$$;

create function register_account(p_email text, p_password_hash text, p_birthdate date, p_dob_encrypted text,
                                 p_display_name text) returns uuid language plpgsql as $$
declare id uuid; e text := lower(trim(p_email));
begin
  if e !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'invalid_email'; end if;
  if p_password_hash is null or p_dob_encrypted is null then raise exception 'invalid_signup'; end if;
  if p_birthdate is null or p_birthdate < date '1900-01-01' then raise exception 'invalid_birthdate'; end if;
  if not is_of_age(p_birthdate) then raise exception 'underage'; end if;
  if exists (select 1 from users where email = e) then raise exception 'email_in_use'; end if;
  insert into users (email, display_name, password_hash, dob_encrypted, age_verified_at)
  values (e, coalesce(nullif(trim(p_display_name), ''), split_part(e, '@', 1)), p_password_hash, p_dob_encrypted, app_now())
  returning users.id into id;
  perform accept_current_policies(id, 'signup');
  return id;
end $$;

-- For an existing account that has no age on file (created before sign up asked for it).
create or replace function set_profile(p_user uuid, p_birthdate date, p_state char(2)) returns void language plpgsql as $$
begin
  raise exception 'use_confirm_age';
end $$;

create function confirm_age(p_user uuid, p_birthdate date, p_dob_encrypted text) returns void language plpgsql as $$
declare u users;
begin
  select * into u from users where id = p_user for update;
  if u.id is null then raise exception 'unknown_user'; end if;
  if u.age_verified_at is not null then raise exception 'birthdate_locked'; end if;
  if p_birthdate is null or p_birthdate < date '1900-01-01' then raise exception 'invalid_birthdate'; end if;
  if not is_of_age(p_birthdate) then raise exception 'underage'; end if;
  update users set dob_encrypted = p_dob_encrypted, age_verified_at = app_now() where id = p_user;
  perform accept_current_policies(p_user, 'signup');
end $$;

-- The time of age confirmation never changes once set.
create function users_age_guard() returns trigger language plpgsql as $$
begin
  if old.age_verified_at is not null and new.age_verified_at is distinct from old.age_verified_at then
    raise exception 'birthdate_locked';
  end if;
  return new;
end $$;
create trigger users_age_guard before update on users for each row execute function users_age_guard();

create table password_resets (
  token_hash text primary key,
  user_id    uuid not null references users(id),
  expires_at timestamptz not null,
  used_at    timestamptz,
  created_at timestamptz not null default now()
);

create function create_password_reset(p_email text, p_token_hash text) returns uuid language plpgsql as $$
declare u uuid;
begin
  select id into u from users where email = lower(trim(p_email)) and password_hash is not null;
  if u is null then return null; end if;   -- never reveal whether an email has an account
  insert into password_resets (token_hash, user_id, expires_at) values (p_token_hash, u, app_now() + interval '1 hour');
  return u;
end $$;

create function use_password_reset(p_token_hash text, p_password_hash text) returns uuid language plpgsql as $$
declare r password_resets;
begin
  select * into r from password_resets where token_hash = p_token_hash for update;
  if r.token_hash is null or r.used_at is not null or r.expires_at < app_now() then raise exception 'reset_link_invalid'; end if;
  update password_resets set used_at = app_now() where token_hash = p_token_hash;
  update users set password_hash = p_password_hash where id = r.user_id;
  return r.user_id;
end $$;

-- Draft policy versions so sign up has something to accept. Item 18 publishes the real text.
insert into policy_versions (doc, version, published_at, title, body_md) values
  ('terms', '2026-10-draft', '2026-01-01', 'Terms of Service', 'Draft. TODO for counsel.'),
  ('privacy', '2026-10-draft', '2026-01-01', 'Privacy Policy', 'Draft. TODO for counsel.');
