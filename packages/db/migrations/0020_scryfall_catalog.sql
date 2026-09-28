-- Card data for the test run: Scryfall's daily bulk file (every printing) imported into our
-- own tables, so search and logging never call Scryfall per keystroke (revision brief item 8).
--
-- Invariants:
--   * Cards are matched on (set_code, collector_number), so internal ids never change across
--     imports and every vault, pull and log reference stays valid.
--   * Image links are stored exactly as Scryfall returns them (card_images.uris), never built
--     by hand.
--   * Name search folds accents and case (name_folded) and is indexed for trigram matching.
--   * Every import run is logged with its outcome in import_runs.

create extension if not exists unaccent;

-- unaccent() is only stable; this wrapper pins the dictionary so it can back an index.
create function f_unaccent(text) returns text language sql immutable parallel safe strict as $$
  select public.unaccent('public.unaccent'::regdictionary, $1)
$$;

alter table cards
  add column oracle_id     text,
  add column frame_effects text[] not null default '{}',
  add column promo_types   text[] not null default '{}',
  add column colors        text[] not null default '{}',
  add column layout        text,
  add column card_faces    jsonb,
  add column released_at   date,
  add column name_folded   text;

create function cards_fold_name() returns trigger language plpgsql as $$
begin
  new.name_folded := lower(f_unaccent(new.name));
  return new;
end $$;
create trigger cards_fold_name before insert or update of name on cards for each row execute function cards_fold_name();
update cards set name_folded = lower(f_unaccent(name));

create index cards_name_folded_trgm on cards using gin (name_folded gin_trgm_ops);
create index cards_name_folded_prefix on cards (name_folded text_pattern_ops);
create index cards_oracle on cards (oracle_id);

alter table mtg_sets
  add column set_type     text,
  add column icon_svg_uri text;

create table card_images (
  card_id    uuid primary key references cards(id),
  source     text not null,
  uris       jsonb not null,     -- {small, normal, large, png, art_crop, border_crop} as given
  updated_at timestamptz not null default now()
);

create table import_runs (
  id          bigserial primary key,
  source      text not null,
  kind        text not null,
  status      text not null check (status in ('running', 'succeeded', 'failed')),
  rows        int,
  message     text,
  started_at  timestamptz not null default now(),
  finished_at timestamptz
);

create function start_import_run(p_source text, p_kind text) returns bigint language sql as $$
  insert into import_runs (source, kind, status) values (p_source, p_kind, 'running') returning id
$$;
create function finish_import_run(p_id bigint, p_ok boolean, p_rows int, p_message text) returns void language sql as $$
  update import_runs set status = case when p_ok then 'succeeded' else 'failed' end, rows = p_rows, message = p_message,
         finished_at = now() where id = p_id
$$;

-- Sets from Scryfall's /sets.
create function import_scryfall_sets(p jsonb) returns int language sql as $$
  with up as (
    insert into mtg_sets (code, name, release_date, set_type, icon_svg_uri)
    select upper(x.code), x.name, x.released_at, x.set_type, x.icon_svg_uri
    from jsonb_to_recordset(p) as x(code text, name text, released_at date, set_type text, icon_svg_uri text)
    on conflict (code) do update set name = excluded.name, release_date = excluded.release_date,
      set_type = excluded.set_type, icon_svg_uri = excluded.icon_svg_uri
    returning 1)
  select count(*)::int from up
$$;

-- A batch of printings, already mapped by packages/catalog (prices in cents, finishes, images).
create function import_scryfall_cards(p jsonb, p_price_asof timestamptz) returns int language plpgsql as $$
declare n int;
begin
  create temp table if not exists scry_src (
    scryfall_id text, oracle_id text, name text, set_code text, collector_number text, rarity text, type_line text,
    mana_cost text, oracle_text text, finishes text[], frame_effects text[], promo_types text[], colors text[],
    layout text, card_faces jsonb, released_at date, legalities jsonb, is_serialized boolean, image_uris jsonb,
    prices jsonb, tcgplayer_id text, card_id uuid
  ) on commit drop;
  truncate scry_src;

  insert into scry_src
  select distinct on (upper(x.set_code), x.collector_number)
         x.scryfall_id, x.oracle_id, x.name, upper(x.set_code), x.collector_number, x.rarity, x.type_line, x.mana_cost,
         x.oracle_text, x.finishes, coalesce(x.frame_effects, '{}'), coalesce(x.promo_types, '{}'), coalesce(x.colors, '{}'),
         x.layout, x.card_faces, x.released_at, coalesce(x.legalities, '{}'), coalesce(x.is_serialized, false), x.image_uris,
         x.prices, x.tcgplayer_id, null::uuid
  from jsonb_to_recordset(p) as x(scryfall_id text, oracle_id text, name text, set_code text, collector_number text, rarity text,
       type_line text, mana_cost text, oracle_text text, finishes text[], frame_effects text[], promo_types text[], colors text[],
       layout text, card_faces jsonb, released_at date, legalities jsonb, is_serialized boolean, image_uris jsonb,
       prices jsonb, tcgplayer_id text)
  where x.rarity in ('common', 'uncommon', 'rare', 'mythic', 'special', 'bonus')
  order by upper(x.set_code), x.collector_number, x.scryfall_id;

  -- Sets referenced but not yet imported get a placeholder row (the sets import fills it in).
  insert into mtg_sets (code, name) select distinct set_code, set_code from scry_src on conflict do nothing;

  with up as (
    insert into cards (name, set_code, collector_number, rarity, type_line, mana_cost, oracle_text, finishes, is_serialized,
                       legalities, oracle_id, frame_effects, promo_types, colors, layout, card_faces, released_at)
    select name, set_code, collector_number, rarity, type_line, mana_cost, oracle_text, finishes, is_serialized,
           legalities, oracle_id, frame_effects, promo_types, colors, layout, card_faces, released_at
    from scry_src
    on conflict (set_code, collector_number) do update set
      name = excluded.name, rarity = excluded.rarity, type_line = excluded.type_line, mana_cost = excluded.mana_cost,
      oracle_text = excluded.oracle_text, finishes = excluded.finishes, is_serialized = excluded.is_serialized,
      legalities = excluded.legalities, oracle_id = excluded.oracle_id, frame_effects = excluded.frame_effects,
      promo_types = excluded.promo_types, colors = excluded.colors, layout = excluded.layout,
      card_faces = excluded.card_faces, released_at = excluded.released_at
    returning id, set_code, collector_number)
  update scry_src s set card_id = up.id from up where s.set_code = up.set_code and s.collector_number = up.collector_number;
  get diagnostics n = row_count;

  insert into card_images (card_id, source, uris, updated_at)
  select card_id, 'scryfall', image_uris, now() from scry_src where image_uris is not null
  on conflict (card_id) do update set source = excluded.source, uris = excluded.uris, updated_at = excluded.updated_at;

  -- Vendor ids stay in card_external_ids.
  insert into card_external_ids (source, external_id, card_id)
  select 'scryfall', scryfall_id, card_id from scry_src
  on conflict (card_id, source) do update set external_id = excluded.external_id;
  insert into card_external_ids (source, external_id, card_id)
  select 'tcgplayer', tcgplayer_id, card_id from scry_src where tcgplayer_id is not null
  on conflict do nothing;

  -- Prices: {"nonfoil": cents, "foil": cents, "etched": cents}, newest wins.
  insert into card_prices_current (card_id, finish, market_cents, price_source, price_asof)
  select s.card_id, f.key, (f.value #>> '{}')::bigint, 'scryfall', p_price_asof
  from scry_src s, jsonb_each(coalesce(s.prices, '{}')) f
  where f.key in ('nonfoil', 'foil', 'etched') and jsonb_typeof(f.value) = 'number'
  on conflict (card_id, finish) do update set
    market_cents = excluded.market_cents, price_source = excluded.price_source, price_asof = excluded.price_asof
  where card_prices_current.price_asof <= excluded.price_asof;

  -- History only for sets we sell and cards someone holds.
  insert into price_snapshots (card_id, finish, as_of, price_source, market_cents)
  select s.card_id, f.key, p_price_asof::date, 'scryfall', (f.value #>> '{}')::bigint
  from scry_src s, jsonb_each(coalesce(s.prices, '{}')) f
  where f.key in ('nonfoil', 'foil', 'etched') and jsonb_typeof(f.value) = 'number'
    and (exists (select 1 from products pr where pr.set_code = s.set_code)
      or exists (select 1 from vault_balances v where v.card_id = s.card_id and v.qty > 0)
      or exists (select 1 from individual_cards i where i.card_id = s.card_id and i.status in ('vaulted', 'shipping')))
  on conflict do nothing;
  return n;
end $$;
