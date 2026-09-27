-- Sign in with an identity provider (Clerk), and clip failures.
--   * Each provider account maps to exactly one user. A first sign in creates the user, or
--     links an existing user with the same verified email that isn't linked yet. An email
--     already linked to a different provider account is refused.
--   * A clip the video service fails to produce is marked failed and logged; staff can see
--     it on the Notify screen. Customers are never notified without a ready clip.

create function upsert_auth_user(p_auth_id text, p_email text) returns uuid language plpgsql as $$
declare u users;
begin
  if coalesce(p_auth_id, '') = '' then raise exception 'auth_id_required'; end if;
  select * into u from users where auth_user_id = p_auth_id;
  if u.id is not null then return u.id; end if;
  if coalesce(p_email, '') = '' then raise exception 'email_required'; end if;
  select * into u from users where lower(email) = lower(p_email) for update;
  if u.id is not null then
    if u.auth_user_id is not null then raise exception 'email_in_use'; end if;
    update users set auth_user_id = p_auth_id where id = u.id;
    return u.id;
  end if;
  insert into users (auth_user_id, email) values (p_auth_id, lower(p_email)) returning id into u.id;
  return u.id;
end $$;

create function mark_clip_failed(p_order uuid, p_reason text, p_actor uuid) returns void language plpgsql as $$
declare c order_clips; o orders;
begin
  update order_clips set status = 'failed' where order_id = p_order and status = 'pending' returning * into c;
  if c.order_id is null then raise exception 'unknown_clip'; end if;
  select * into o from orders where id = p_order;
  perform log_custody(o.batch_id, 'clip_failed', jsonb_build_object('order_id', p_order, 'reason', p_reason), p_actor);
end $$;

-- Retry after a failure: back to pending so a new clip can be requested.
create function retry_clip(p_order uuid) returns void language plpgsql as $$
begin
  update order_clips set status = 'pending' where order_id = p_order and status = 'failed';
  if not found then raise exception 'unknown_clip'; end if;
end $$;

-- Staff are promoted by an admin after their first sign in. Logged to the custody chain.
create function set_user_role(p_email text, p_role text, p_actor uuid) returns void language plpgsql as $$
declare u users;
begin
  if p_role not in ('customer', 'staff', 'admin') then raise exception 'invalid_role'; end if;
  update users set role = p_role where lower(email) = lower(p_email) returning * into u;
  if u.id is null then raise exception 'unknown_user'; end if;
  perform log_custody(null, 'role_changed', jsonb_build_object('user_id', u.id, 'role', p_role), p_actor);
end $$;

-- Idempotent: a replayed "ready" (e.g. a duplicate Mux webhook) changes nothing and logs nothing.
create or replace function mark_clip_ready(p_order uuid, p_clip_ref text, p_actor uuid) returns void language plpgsql as $$
declare c order_clips; o orders;
begin
  update order_clips set status = 'ready', clip_ref = p_clip_ref, ready_at = app_now()
  where order_id = p_order and status <> 'ready' returning * into c;
  if c.order_id is null then raise exception 'unknown_clip'; end if;
  select * into o from orders where id = p_order;
  perform log_custody(o.batch_id, 'clip_generated', jsonb_build_object(
    'order_id', p_order, 'clip_ref', p_clip_ref,
    'start_offset_ms', c.start_offset_ms, 'end_offset_ms', c.end_offset_ms), p_actor);
end $$;
