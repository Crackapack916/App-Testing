-- Writes behind the new pages (revision brief items 3, 9, 10, 11, 14).
--
-- Invariants:
--   * Drops are saved only through save_drop: the set must exist, the window must be valid, and a
--     published drop can't overlap another published drop of the same set.
--   * A drop reminder is opt in, one per customer per drop, and an unsubscribe token stops it for good.
--   * Marking cracked packs seen touches only the customer's own notifications.
--   * A session master is recorded once per batch, after the batch is locked, and logged to custody.

-- Official pack photo per set (Tyson supplies these). Unset: the app draws a plain frame with the set symbol.
alter table mtg_sets add column pack_image_url text;

create function save_drop(p_id uuid, p_set text, p_starts timestamptz, p_ends timestamptz, p_allocated int,
                          p_limit int, p_status text, p_actor uuid) returns uuid language plpgsql as $$
declare v_id uuid := p_id;
begin
  if not exists (select 1 from mtg_sets where code = upper(p_set)) then raise exception 'unknown_set'; end if;
  if p_starts is null or (p_ends is not null and p_ends <= p_starts) then raise exception 'invalid_drop_window'; end if;
  if p_status = 'published' and exists (
      select 1 from drops d where d.set_code = upper(p_set) and d.status = 'published' and d.id is distinct from p_id
        and tstzrange(d.starts_at, d.ends_at) && tstzrange(p_starts, p_ends)) then
    raise exception 'drop_overlap';
  end if;
  if v_id is null then
    insert into drops (set_code, starts_at, ends_at, packs_allocated, per_customer_limit, status, created_by)
    values (upper(p_set), p_starts, p_ends, p_allocated, p_limit, p_status, p_actor) returning id into v_id;
  else
    update drops set set_code = upper(p_set), starts_at = p_starts, ends_at = p_ends, packs_allocated = p_allocated,
           per_customer_limit = p_limit, status = p_status, updated_at = now()
    where id = v_id;
    if not found then raise exception 'unknown_drop'; end if;
  end if;
  return v_id;
end $$;

create function set_set_info(p_set text, p_wizards_url text, p_pack_image_url text) returns void language plpgsql as $$
begin
  update mtg_sets set wizards_info_url = nullif(trim(p_wizards_url), ''), pack_image_url = nullif(trim(p_pack_image_url), '')
  where code = upper(p_set);
  if not found then raise exception 'unknown_set'; end if;
end $$;

create function request_drop_reminder(p_drop uuid, p_user uuid, p_token text) returns void language plpgsql as $$
begin
  if not exists (select 1 from drops where id = p_drop and status = 'published' and starts_at > app_now()) then
    raise exception 'drop_not_upcoming';
  end if;
  insert into drop_reminders (drop_id, user_id, token) values (p_drop, p_user, p_token)
  on conflict (drop_id, user_id) do update set unsubscribed_at = null where drop_reminders.sent_at is null;
end $$;

create function unsubscribe_drop_reminder(p_token text) returns void language plpgsql as $$
begin
  update drop_reminders set unsubscribed_at = coalesce(unsubscribed_at, app_now()) where token = p_token;
  if not found then raise exception 'unknown_reminder'; end if;
end $$;

create function mark_drop_reminder_sent(p_drop uuid, p_user uuid) returns void language plpgsql as $$
begin
  update drop_reminders set sent_at = app_now() where drop_id = p_drop and user_id = p_user and sent_at is null;
end $$;

-- Opening the Vault clears the red dot: every cracked notification is marked opened.
create function mark_cracked_seen(p_user uuid) returns int language plpgsql as $$
declare n int;
begin
  update notifications set opened_at = app_now() where user_id = p_user and kind = 'cracked' and opened_at is null;
  get diagnostics n = row_count;
  return n;
end $$;

create function record_session_master(p_batch uuid, p_pathname text, p_size bigint, p_sha256 text, p_actor uuid)
returns void language plpgsql as $$
begin
  if not exists (select 1 from batches where id = p_batch and status in ('locked', 'in_session', 'completed')) then
    raise exception 'batch_not_locked';
  end if;
  insert into session_masters (batch_id, pathname, size_bytes, sha256, uploaded_by) values (p_batch, p_pathname, p_size, lower(p_sha256), p_actor);
  perform log_custody(p_batch, 'session_master_uploaded', jsonb_build_object('sha256', lower(p_sha256), 'size_bytes', p_size), p_actor);
exception when unique_violation then raise exception 'session_master_exists';
end $$;
