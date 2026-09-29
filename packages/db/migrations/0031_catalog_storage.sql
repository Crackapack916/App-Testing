-- Keep the card catalog inside the database's storage limit (Neon free plan, 512 MB).
--
-- Invariants:
--   * import_scryfall_cards writes a card, image or vendor id row only when something in it
--     changed. Results are the same as before; unchanged printings are left alone instead of
--     being rewritten on every daily import.
--   * Two indexes that no query uses are dropped (full text search on cards.search and a
--     trigram index on cards.name; search runs on name_folded), along with the search column.

drop index if exists cards_search;
drop index if exists cards_name_trgm;
alter table cards drop column if exists search;

create or replace function import_scryfall_cards(p jsonb, p_price_asof timestamptz) returns int language plpgsql as $$
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

  -- Only rows that actually changed are written: rewriting all 100,000+ printings every day
  -- bloated the tables past the database's storage limit.
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
  where (cards.name, cards.rarity, cards.type_line, cards.mana_cost, cards.oracle_text, cards.finishes, cards.is_serialized,
         cards.legalities, cards.oracle_id, cards.frame_effects, cards.promo_types, cards.colors, cards.layout,
         cards.card_faces, cards.released_at)
    is distinct from
        (excluded.name, excluded.rarity, excluded.type_line, excluded.mana_cost, excluded.oracle_text, excluded.finishes,
         excluded.is_serialized, excluded.legalities, excluded.oracle_id, excluded.frame_effects, excluded.promo_types,
         excluded.colors, excluded.layout, excluded.card_faces, excluded.released_at);
  update scry_src s set card_id = c.id from cards c where c.set_code = s.set_code and c.collector_number = s.collector_number;
  get diagnostics n = row_count;

  insert into card_images (card_id, source, uris, updated_at)
  select card_id, 'scryfall', image_uris, now() from scry_src where image_uris is not null
  on conflict (card_id) do update set source = excluded.source, uris = excluded.uris, updated_at = excluded.updated_at
  where (card_images.source, card_images.uris) is distinct from (excluded.source, excluded.uris);

  -- Vendor ids stay in card_external_ids.
  insert into card_external_ids (source, external_id, card_id)
  select 'scryfall', scryfall_id, card_id from scry_src
  on conflict (card_id, source) do update set external_id = excluded.external_id
  where card_external_ids.external_id is distinct from excluded.external_id;
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
