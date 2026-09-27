-- The nightly filmed session. Staff never choose a customer or a pack:
--   * batches are opened oldest first, and only after they are locked
--   * open_next_pack takes no customer or entry argument; it always pairs the lowest
--     unopened queue position with the next physical pack from that product's open box
--   * a damaged pack is voided, and the same queue position gets the next pack

create table opening_sessions (
  id            uuid primary key default gen_random_uuid(),
  batch_id      uuid unique not null references batches(id),
  operator_id   uuid not null references users(id),
  stream_ref    text,   -- Mux live stream id
  recording_ref text,   -- Mux asset id of the full recording
  started_at    timestamptz not null,
  ended_at      timestamptz
);

create table pack_openings (
  id                    uuid primary key default gen_random_uuid(),
  session_id            uuid not null references opening_sessions(id),
  batch_id              uuid not null references batches(id),
  queue_entry_id        uuid unique references queue_entries(id),
  box_id                uuid not null references sealed_boxes(id),
  pack_number_in_box    int not null,
  status                text not null check (status in ('opened', 'void')),
  void_reason           text,
  stream_offset_ms      bigint,
  opened_at             timestamptz not null,
  contents_finalized_at timestamptz,
  unique (box_id, pack_number_in_box),
  check ((status = 'opened') = (queue_entry_id is not null))
);

-- One clip per order, cut from the session recording.
create table order_clips (
  order_id        uuid primary key references orders(id),
  session_id      uuid not null references opening_sessions(id),
  start_offset_ms bigint not null,
  end_offset_ms   bigint not null check (end_offset_ms > start_offset_ms),
  clip_ref        text,
  status          text not null default 'pending' check (status in ('pending', 'ready', 'failed')),
  created_at      timestamptz not null default now(),
  ready_at        timestamptz
);

create table notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references users(id),
  order_id   uuid references orders(id),
  kind       text not null,
  sent_at    timestamptz not null,
  opened_at  timestamptz
);

create function active_session(p_session uuid) returns opening_sessions language plpgsql as $$
declare s opening_sessions;
begin
  select * into s from opening_sessions where id = p_session for update;
  if s.id is null then raise exception 'unknown_session'; end if;
  if s.ended_at is not null then raise exception 'session_ended'; end if;
  return s;
end $$;

create function start_session(p_batch uuid, p_operator uuid, p_stream_ref text) returns uuid language plpgsql as $$
declare b batches; s uuid;
begin
  select * into b from batches where id = p_batch for update;
  if b.id is null then raise exception 'unknown_batch'; end if;
  if b.status <> 'locked' then raise exception 'batch_not_locked'; end if;
  if exists (select 1 from batches where batch_date < b.batch_date and status <> 'completed'
             and exists (select 1 from queue_entries q where q.batch_id = batches.id and q.status <> 'cancelled')) then
    raise exception 'earlier_batch_incomplete';
  end if;

  insert into opening_sessions (batch_id, operator_id, stream_ref, started_at)
  values (p_batch, p_operator, p_stream_ref, app_now()) returning id into s;
  update batches set status = 'in_session' where id = p_batch;

  perform log_custody(p_batch, 'session_started', jsonb_build_object(
    'session_id', s, 'stream_ref', p_stream_ref, 'manifest_hash', b.manifest_hash), p_operator);
  return s;
end $$;

-- The seal break must be on camera: record the stream offset.
create function open_box(p_session uuid, p_box uuid, p_stream_offset_ms bigint, p_actor uuid) returns void language plpgsql as $$
declare s opening_sessions := active_session(p_session); x sealed_boxes;
begin
  select * into x from sealed_boxes where id = p_box for update;
  if x.id is null then raise exception 'unknown_box'; end if;
  if x.status <> 'sealed' then raise exception 'box_not_sealed'; end if;
  if exists (select 1 from sealed_boxes where product_id = x.product_id and status = 'opened') then
    raise exception 'another_box_open_for_product';
  end if;
  update sealed_boxes set status = 'opened', opened_at = app_now(), opened_session_id = p_session where id = p_box;
  perform log_custody(s.batch_id, 'box_opened', jsonb_build_object(
    'session_id', p_session, 'box_id', p_box, 'label', x.label, 'product_id', x.product_id,
    'stream_offset_ms', p_stream_offset_ms), p_actor);
end $$;

-- Take the next physical pack from a product's open box.
create function take_pack(p_product uuid, out box_id uuid, out pack_number int) language plpgsql as $$
declare x sealed_boxes;
begin
  select * into x from sealed_boxes where product_id = p_product and status = 'opened' for update;
  if x.id is null then raise exception 'no_open_box_for_product'; end if;
  pack_number := x.packs_opened + 1;
  box_id := x.id;
  update sealed_boxes set packs_opened = pack_number,
         status = case when pack_number = x.pack_count then 'depleted' else 'opened' end
  where id = x.id;
end $$;

create function open_next_pack(p_session uuid, p_stream_offset_ms bigint, p_actor uuid,
  out pack_opening_id uuid, out queue_entry_id uuid, out order_id uuid, out user_id uuid,
  out product_id uuid, out queue_position int, out box_id uuid, out pack_number int)
language plpgsql as $$
declare s opening_sessions := active_session(p_session); e queue_entries; taken record;
begin
  select * into e from queue_entries q
  where q.batch_id = s.batch_id and q.status = 'queued' and q.position is not null
  order by q.position limit 1 for update;
  if e.id is null then raise exception 'queue_exhausted'; end if;

  select * into taken from take_pack(e.product_id);
  update product_stock set packs_on_hand = packs_on_hand - 1, packs_reserved = packs_reserved - 1
  where product_stock.product_id = e.product_id;

  perform set_config('app.opening_entry', e.id::text, true);
  update queue_entries set status = 'opened' where id = e.id;
  perform set_config('app.opening_entry', '', true);

  insert into pack_openings (session_id, batch_id, queue_entry_id, box_id, pack_number_in_box, status, stream_offset_ms, opened_at)
  values (p_session, s.batch_id, e.id, taken.box_id, taken.pack_number, 'opened', p_stream_offset_ms, app_now())
  returning id into pack_opening_id;

  perform log_custody(s.batch_id, 'pack_opened', jsonb_build_object(
    'pack_opening_id', pack_opening_id, 'queue_entry_id', e.id, 'order_id', e.order_id,
    'position', e.position, 'product_id', e.product_id, 'box_id', taken.box_id,
    'pack_number_in_box', taken.pack_number, 'stream_offset_ms', p_stream_offset_ms), p_actor);

  queue_entry_id := e.id; order_id := e.order_id; user_id := e.user_id; product_id := e.product_id;
  queue_position := e.position; box_id := taken.box_id; pack_number := taken.pack_number;
end $$;

-- A damaged or defective pack. It consumes physical stock but no queue position.
-- The safety buffer absorbs it; if the buffer is gone, stock_covers_reservations fails
-- and staff must receive another sealed box before continuing.
create function void_pack(p_session uuid, p_product uuid, p_reason text, p_stream_offset_ms bigint, p_actor uuid)
returns uuid language plpgsql as $$
declare s opening_sessions := active_session(p_session); taken record; v uuid;
begin
  if coalesce(trim(p_reason), '') = '' then raise exception 'void_reason_required'; end if;
  select * into taken from take_pack(p_product);
  update product_stock set packs_on_hand = packs_on_hand - 1 where product_id = p_product;
  insert into pack_openings (session_id, batch_id, box_id, pack_number_in_box, status, void_reason, stream_offset_ms, opened_at)
  values (p_session, s.batch_id, taken.box_id, taken.pack_number, 'void', p_reason, p_stream_offset_ms, app_now())
  returning id into v;
  perform log_custody(s.batch_id, 'pack_voided', jsonb_build_object(
    'pack_opening_id', v, 'box_id', taken.box_id, 'pack_number_in_box', taken.pack_number,
    'reason', p_reason, 'stream_offset_ms', p_stream_offset_ms), p_actor);
  return v;
end $$;

create function record_order_clip(p_order uuid, p_start_ms bigint, p_end_ms bigint, p_actor uuid)
returns void language plpgsql as $$
declare s opening_sessions; o orders;
begin
  select * into o from orders where id = p_order;
  select * into s from opening_sessions where batch_id = o.batch_id;
  if s.id is null then raise exception 'no_session_for_order'; end if;
  if exists (select 1 from queue_entries where order_id = p_order and status <> 'opened') then
    raise exception 'order_not_fully_opened';
  end if;
  insert into order_clips (order_id, session_id, start_offset_ms, end_offset_ms)
  values (p_order, s.id, p_start_ms, p_end_ms);
end $$;

create function mark_clip_ready(p_order uuid, p_clip_ref text, p_actor uuid) returns void language plpgsql as $$
declare c order_clips; o orders;
begin
  update order_clips set status = 'ready', clip_ref = p_clip_ref, ready_at = app_now()
  where order_id = p_order returning * into c;
  if c.order_id is null then raise exception 'unknown_clip'; end if;
  select * into o from orders where id = p_order;
  perform log_custody(o.batch_id, 'clip_generated', jsonb_build_object(
    'order_id', p_order, 'clip_ref', p_clip_ref,
    'start_offset_ms', c.start_offset_ms, 'end_offset_ms', c.end_offset_ms), p_actor);
end $$;

-- "You just cracked a pack." Requires the clip and every pack's contents to be logged.
create function notify_order(p_order uuid, p_actor uuid) returns uuid language plpgsql as $$
declare o orders; n uuid;
begin
  select * into o from orders where id = p_order for update;
  if o.status <> 'queued' then raise exception 'order_not_notifiable'; end if;
  if not exists (select 1 from order_clips where order_id = p_order and status = 'ready') then
    raise exception 'clip_not_ready';
  end if;
  if exists (select 1 from queue_entries q left join pack_openings po on po.queue_entry_id = q.id
             where q.order_id = p_order and po.contents_finalized_at is null) then
    raise exception 'contents_not_finalized';
  end if;
  insert into notifications (user_id, order_id, kind, sent_at) values (o.user_id, p_order, 'cracked', app_now())
  returning id into n;
  update orders set status = 'fulfilled', fulfilled_at = app_now() where id = p_order;
  perform log_custody(o.batch_id, 'customer_notified', jsonb_build_object('order_id', p_order, 'notification_id', n), p_actor);
  return n;
end $$;

create function complete_session(p_session uuid, p_recording_ref text, p_actor uuid) returns void language plpgsql as $$
declare s opening_sessions := active_session(p_session);
begin
  if exists (select 1 from queue_entries where batch_id = s.batch_id and status = 'queued') then
    raise exception 'queue_not_exhausted';
  end if;
  update opening_sessions set ended_at = app_now(), recording_ref = p_recording_ref where id = p_session;
  update batches set status = 'completed', completed_at = app_now() where id = s.batch_id;
  perform log_custody(s.batch_id, 'session_completed', jsonb_build_object(
    'session_id', p_session, 'recording_ref', p_recording_ref), p_actor);
end $$;

create trigger pack_openings_no_delete before delete on pack_openings for each row execute function reject_mutation();

-- A pack opening is permanent. The only later change is stamping contents as finalized.
create function pack_openings_guard() returns trigger language plpgsql as $$
begin
  if (new.session_id, new.batch_id, new.queue_entry_id, new.box_id, new.pack_number_in_box,
      new.status, new.void_reason, new.stream_offset_ms, new.opened_at)
     is distinct from
     (old.session_id, old.batch_id, old.queue_entry_id, old.box_id, old.pack_number_in_box,
      old.status, old.void_reason, old.stream_offset_ms, old.opened_at)
     or (old.contents_finalized_at is not null and new.contents_finalized_at is distinct from old.contents_finalized_at) then
    raise exception 'pack_opening_immutable';
  end if;
  return new;
end $$;
create trigger pack_openings_guard before update on pack_openings
  for each row execute function pack_openings_guard();
