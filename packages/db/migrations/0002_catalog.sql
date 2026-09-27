-- Catalog: sets, sellable products, the internal card record, and the MTGJSON price cache.
-- Vendor identifiers live only in card_external_ids. Nothing else references a vendor.

create table mtg_sets (
  code          text primary key,
  name          text not null,
  release_date  date,
  pack_art_ref  text,   -- own photography of the physical pack
  symbol_ref    text
);

create table products (
  id                  uuid primary key default gen_random_uuid(),
  set_code            text not null references mtg_sets(code),
  booster_type        text not null check (booster_type in ('play', 'collector')),
  name                text not null,
  active              boolean not null default false,
  safety_buffer_packs int not null default 1 check (safety_buffer_packs >= 0),
  unique (set_code, booster_type)
);

-- Pricing ladder. An order of qty packs pays the tier with the largest min_qty <= qty.
create table price_tiers (
  product_id       uuid not null references products(id),
  min_qty          int  not null check (min_qty >= 1),
  per_pack_credits bigint not null check (per_pack_credits > 0),
  primary key (product_id, min_qty)
);

create table cards (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  set_code         text not null,
  collector_number text not null,
  rarity           text not null check (rarity in ('common', 'uncommon', 'rare', 'mythic', 'special', 'bonus')),
  type_line        text,
  mana_cost        text,
  oracle_text      text,
  finishes         text[] not null default '{nonfoil}',
  is_serialized    boolean not null default false,
  legalities       jsonb not null default '{}',
  search           tsvector generated always as (
                     to_tsvector('simple', coalesce(name, '') || ' ' || coalesce(type_line, '') || ' ' || coalesce(oracle_text, ''))
                   ) stored,
  unique (set_code, collector_number)
);
create index cards_search on cards using gin (search);
create index cards_name_trgm on cards using gin (name gin_trgm_ops);

create table card_external_ids (
  source      text not null,   -- 'mtgjson', 'scryfall', 'tcgplayer'
  external_id text not null,
  card_id     uuid not null references cards(id),
  primary key (source, external_id),
  unique (card_id, source)
);

create table card_prices_current (
  card_id      uuid not null references cards(id),
  finish       text not null check (finish in ('nonfoil', 'foil', 'etched')),
  market_cents bigint not null check (market_cents >= 0),
  price_source text not null,
  price_asof   timestamptz not null,
  primary key (card_id, finish)
);

create table price_snapshots (
  card_id      uuid not null references cards(id),
  finish       text not null,
  as_of        date not null,
  price_source text not null,
  market_cents bigint not null,
  primary key (card_id, finish, as_of, price_source)
);
