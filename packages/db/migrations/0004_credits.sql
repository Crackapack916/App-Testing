-- Credits. Two buckets:
--   purchased: bought with a card, refundable to that card while unspent
--   earned:    buyback proceeds, never withdrawable
-- Spending draws earned first. The ledger is append only; balances are a cache kept
-- in the same transaction, and CHECKs make a negative balance impossible.

create table credit_accounts (
  user_id    uuid primary key references users(id),
  purchased  bigint not null default 0 constraint purchased_non_negative check (purchased >= 0),
  earned     bigint not null default 0 constraint earned_non_negative check (earned >= 0),
  updated_at timestamptz not null default now()
);

create table credit_entries (
  id              bigserial primary key,
  user_id         uuid not null references users(id),
  bucket          text not null check (bucket in ('purchased', 'earned')),
  amount          bigint not null check (amount <> 0),
  kind            text not null check (kind in (
                    'purchase', 'card_refund', 'pack_order', 'order_cancel_refund',
                    'buyback', 'shipping_fee', 'inactivity_conversion', 'adjustment')),
  ref_type        text,
  ref_id          text,
  idempotency_key text unique,
  created_at      timestamptz not null default clock_timestamp()
);
create index credit_entries_user on credit_entries (user_id, id);

create function credit_entries_apply() returns trigger language plpgsql as $$
begin
  insert into credit_accounts (user_id) values (new.user_id) on conflict do nothing;
  if new.bucket = 'purchased' then
    update credit_accounts set purchased = purchased + new.amount, updated_at = now() where user_id = new.user_id;
  else
    update credit_accounts set earned = earned + new.amount, updated_at = now() where user_id = new.user_id;
  end if;
  return new;
end $$;
create trigger credit_entries_apply after insert on credit_entries
  for each row execute function credit_entries_apply();
create trigger credit_entries_immutable before update or delete on credit_entries
  for each row execute function reject_mutation();

-- Called from the Stripe webhook. Replaying the same event is a no-op.
create function purchase_credits(p_user uuid, p_credits bigint, p_stripe_ref text)
returns boolean language plpgsql as $$
declare n int;
begin
  if p_credits <= 0 then raise exception 'invalid_amount'; end if;
  insert into credit_entries (user_id, bucket, amount, kind, ref_type, ref_id, idempotency_key)
  values (p_user, 'purchased', p_credits, 'purchase', 'stripe', p_stripe_ref, 'stripe:' || p_stripe_ref)
  on conflict (idempotency_key) do nothing;
  get diagnostics n = row_count;
  return n = 1;
end $$;

-- Debit credits, earned first. Returns (earned_used, purchased_used).
create function spend_credits(p_user uuid, p_total bigint, p_kind text, p_ref_type text, p_ref_id text,
                              out earned_used bigint, out purchased_used bigint)
language plpgsql as $$
declare a credit_accounts;
begin
  insert into credit_accounts (user_id) values (p_user) on conflict do nothing;
  select * into a from credit_accounts where user_id = p_user for update;
  if a.earned + a.purchased < p_total then
    raise exception 'insufficient_credits';
  end if;
  earned_used := least(a.earned, p_total);
  purchased_used := p_total - earned_used;
  if earned_used > 0 then
    insert into credit_entries (user_id, bucket, amount, kind, ref_type, ref_id)
    values (p_user, 'earned', -earned_used, p_kind, p_ref_type, p_ref_id);
  end if;
  if purchased_used > 0 then
    insert into credit_entries (user_id, bucket, amount, kind, ref_type, ref_id)
    values (p_user, 'purchased', -purchased_used, p_kind, p_ref_type, p_ref_id);
  end if;
end $$;
