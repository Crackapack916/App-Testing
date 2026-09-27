-- Expo push tokens, one row per device. A token moves to whoever registered it last.
create table push_tokens (
  token        text primary key,
  user_id      uuid not null references users(id),
  platform     text not null check (platform in ('ios', 'android', 'web')),
  updated_at   timestamptz not null default now()
);
create index push_tokens_user on push_tokens (user_id);

create function register_push_token(p_user uuid, p_token text, p_platform text) returns void language plpgsql as $$
begin
  if p_token !~ '^(Expo|Exponent)PushToken\[.+\]$' then raise exception 'invalid_push_token'; end if;
  insert into push_tokens (token, user_id, platform) values (p_token, p_user, p_platform)
  on conflict (token) do update set user_id = excluded.user_id, platform = excluded.platform, updated_at = now();
end $$;

-- Called when Expo reports a token as no longer registered.
create function remove_push_token(p_token text) returns void language sql as $$
  delete from push_tokens where token = p_token
$$;

-- The customer opened their "You just cracked a pack" notification or reveal.
create function mark_notification_opened(p_notification uuid, p_user uuid) returns void language plpgsql as $$
begin
  update notifications set opened_at = coalesce(opened_at, app_now()) where id = p_notification and user_id = p_user;
  if not found then raise exception 'unknown_notification'; end if;
end $$;
