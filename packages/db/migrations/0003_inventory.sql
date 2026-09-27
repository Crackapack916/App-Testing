-- Sealed inventory. Boxes are the unit (retail buying means no guaranteed cases).
-- product_stock is the single source of availability: an order reserves packs in the
-- same transaction, and the CHECK makes overselling impossible.

create table sealed_cases (
  id          uuid primary key default gen_random_uuid(),
  label       text unique not null,
  product_id  uuid not null references products(id),
  cost_cents  bigint,
  acquired_at timestamptz not null default now()
);

create table sealed_boxes (
  id                uuid primary key default gen_random_uuid(),
  label             text unique not null,
  product_id        uuid not null references products(id),
  case_id           uuid references sealed_cases(id),
  pack_count        int not null check (pack_count > 0),
  packs_opened      int not null default 0,
  status            text not null default 'sealed' check (status in ('sealed', 'opened', 'depleted')),
  cost_cents        bigint,
  received_at       timestamptz not null default now(),
  opened_at         timestamptz,
  opened_session_id uuid,
  check (packs_opened between 0 and pack_count)
);
-- At most one open box per product, so "the next pack" is never ambiguous.
create unique index one_open_box_per_product on sealed_boxes (product_id) where status = 'opened';

create table product_stock (
  product_id     uuid primary key references products(id),
  packs_on_hand  int not null default 0 check (packs_on_hand >= 0),
  packs_reserved int not null default 0 check (packs_reserved >= 0),
  constraint stock_covers_reservations check (packs_reserved <= packs_on_hand)
);

create function receive_box(p_product uuid, p_label text, p_pack_count int, p_cost_cents bigint, p_case uuid, p_actor uuid)
returns uuid language plpgsql as $$
declare b uuid;
begin
  insert into sealed_boxes (label, product_id, case_id, pack_count, cost_cents)
  values (p_label, p_product, p_case, p_pack_count, p_cost_cents)
  returning id into b;

  insert into product_stock (product_id, packs_on_hand) values (p_product, p_pack_count)
  on conflict (product_id) do update set packs_on_hand = product_stock.packs_on_hand + excluded.packs_on_hand;

  perform log_custody(null, 'box_received',
    jsonb_build_object('box_id', b, 'label', p_label, 'product_id', p_product, 'pack_count', p_pack_count), p_actor);
  return b;
end $$;

create function product_available_packs(p_product uuid) returns int language sql stable as $$
  select greatest(0, s.packs_on_hand - s.packs_reserved - p.safety_buffer_packs)
  from products p join product_stock s on s.product_id = p.id
  where p.id = p_product
$$;

create view storefront as
select p.id as product_id, p.set_code, s.name as set_name, p.booster_type, p.name,
       (select per_pack_credits from price_tiers t where t.product_id = p.id order by min_qty limit 1) as single_pack_credits,
       coalesce(product_available_packs(p.id), 0) as available_packs,
       coalesce(product_available_packs(p.id), 0) > 0 as available
from products p join mtg_sets s on s.code = p.set_code
where p.active;
