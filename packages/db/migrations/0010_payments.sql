-- Processor agnostic payments.
--   * record_credit_purchase: credits a completed payment exactly once per (processor, ref)
--   * refund_purchased_credits: removes refunded credit from the purchased bucket only;
--     earned (buyback) credit is never refundable, and credit already spent cannot be refunded
--   * payment_events: one row per processor webhook event, for audit and replay safety

create table payment_events (
  processor   text not null,
  event_id    text not null,
  event_type  text not null,
  user_id     uuid references users(id),
  credits     bigint,
  payment_ref text,
  status      text not null check (status in ('applied', 'ignored', 'needs_review')),
  detail      text,
  received_at timestamptz not null default clock_timestamp(),
  primary key (processor, event_id)
);
create trigger payment_events_immutable before update or delete on payment_events
  for each row execute function reject_mutation();

create function record_credit_purchase(p_user uuid, p_credits bigint, p_processor text, p_payment_ref text)
returns boolean language plpgsql as $$
declare n int;
begin
  if p_credits <= 0 then raise exception 'invalid_amount'; end if;
  if coalesce(p_processor, '') = '' or coalesce(p_payment_ref, '') = '' then raise exception 'payment_ref_required'; end if;
  insert into credit_entries (user_id, bucket, amount, kind, ref_type, ref_id, idempotency_key)
  values (p_user, 'purchased', p_credits, 'purchase', p_processor, p_payment_ref, p_processor || ':' || p_payment_ref)
  on conflict (idempotency_key) do nothing;
  get diagnostics n = row_count;
  return n = 1;
end $$;

-- Kept for existing callers.
create or replace function purchase_credits(p_user uuid, p_credits bigint, p_stripe_ref text)
returns boolean language sql as $$
  select record_credit_purchase(p_user, p_credits, 'stripe', p_stripe_ref)
$$;

-- p_refund_ref identifies this refund at the processor, so a replayed event is a no-op.
-- purchased_non_negative rejects refunding credit the customer already spent.
create function refund_purchased_credits(p_user uuid, p_credits bigint, p_processor text, p_refund_ref text)
returns boolean language plpgsql as $$
declare n int;
begin
  if p_credits <= 0 then raise exception 'invalid_amount'; end if;
  insert into credit_entries (user_id, bucket, amount, kind, ref_type, ref_id, idempotency_key)
  values (p_user, 'purchased', -p_credits, 'card_refund', p_processor, p_refund_ref, p_processor || ':refund:' || p_refund_ref)
  on conflict (idempotency_key) do nothing;
  get diagnostics n = row_count;
  return n = 1;
end $$;

-- Largest amount a customer can have refunded to their card right now.
create function refundable_credits(p_user uuid) returns bigint language sql stable as $$
  select coalesce((select purchased from credit_accounts where user_id = p_user), 0)
$$;
