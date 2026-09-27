-- MTGJSON import. Batches arrive as jsonb arrays from packages/catalog.
--   * Cards are matched on (set_code, collector_number), so a card's internal id never
--     changes across re-imports and every vault, pull and buyback reference stays valid.
--   * Vendor ids go only into card_external_ids.
--   * A price only replaces the current price if it is at least as new.
--   * Daily history (price_snapshots) is kept only for cards that matter to the business:
--     sets we sell, and cards someone holds. Keeping it for every printing would outgrow
--     the database within months.

create function import_sets(p jsonb) returns int language sql as $$
  with up as (
    insert into mtg_sets (code, name, release_date)
    select x.code, x.name, x.release_date
    from jsonb_to_recordset(p) as x(code text, name text, release_date date)
    on conflict (code) do update set name = excluded.name, release_date = excluded.release_date
    returning 1)
  select count(*)::int from up
$$;

create function import_cards(p jsonb) returns int language plpgsql as $$
declare n int;
begin
  create temp table if not exists import_card_src (
    mtgjson_uuid text, name text, set_code text, collector_number text, rarity text, type_line text,
    mana_cost text, oracle_text text, finishes text[], is_serialized boolean, legalities jsonb,
    scryfall_id text, tcgplayer_id text, card_id uuid
  ) on commit drop;
  truncate import_card_src;

  insert into import_card_src
  select distinct on (x.set_code, x.collector_number) x.*, null::uuid
  from jsonb_to_recordset(p) as x(mtgjson_uuid text, name text, set_code text, collector_number text, rarity text,
       type_line text, mana_cost text, oracle_text text, finishes text[], is_serialized boolean, legalities jsonb,
       scryfall_id text, tcgplayer_id text)
  order by x.set_code, x.collector_number, x.mtgjson_uuid;

  with up as (
    insert into cards (name, set_code, collector_number, rarity, type_line, mana_cost, oracle_text, finishes, is_serialized, legalities)
    select name, set_code, collector_number, rarity, type_line, mana_cost, oracle_text, finishes, is_serialized, legalities
    from import_card_src
    on conflict (set_code, collector_number) do update set
      name = excluded.name, rarity = excluded.rarity, type_line = excluded.type_line, mana_cost = excluded.mana_cost,
      oracle_text = excluded.oracle_text, finishes = excluded.finishes, is_serialized = excluded.is_serialized,
      legalities = excluded.legalities
    returning id, set_code, collector_number)
  update import_card_src s set card_id = up.id from up
  where s.set_code = up.set_code and s.collector_number = up.collector_number;
  get diagnostics n = row_count;

  -- Replace this batch's vendor ids, so a changed upstream id never collides.
  delete from card_external_ids e using import_card_src s where e.card_id = s.card_id;
  insert into card_external_ids (source, external_id, card_id)
  select source, external_id, card_id from (
    select 'mtgjson' as source, mtgjson_uuid as external_id, card_id from import_card_src
    union all select 'scryfall', scryfall_id, card_id from import_card_src where scryfall_id is not null
    union all select 'tcgplayer', tcgplayer_id, card_id from import_card_src where tcgplayer_id is not null
  ) ids
  on conflict (source, external_id) do update set card_id = excluded.card_id;
  return n;
end $$;

create function import_prices(p jsonb) returns int language sql as $$
  with src as (
    select e.card_id, x.finish, x.market_cents, x.as_of, x.price_source
    from jsonb_to_recordset(p) as x(mtgjson_uuid text, finish text, market_cents bigint, as_of date, price_source text)
    join card_external_ids e on e.source = 'mtgjson' and e.external_id = x.mtgjson_uuid
    where x.finish in ('nonfoil', 'foil', 'etched') and x.market_cents >= 0),
  snap as (
    insert into price_snapshots (card_id, finish, as_of, price_source, market_cents)
    select distinct on (card_id, finish, as_of, price_source) card_id, finish, as_of, price_source, market_cents from src
    where exists (select 1 from cards c join products p on p.set_code = c.set_code where c.id = src.card_id)
       or exists (select 1 from vault_balances v where v.card_id = src.card_id and v.qty > 0)
       or exists (select 1 from individual_cards i where i.card_id = src.card_id and i.status in ('vaulted', 'shipping'))
    order by card_id, finish, as_of, price_source
    on conflict do nothing),
  cur as (
    insert into card_prices_current (card_id, finish, market_cents, price_source, price_asof)
    select distinct on (card_id, finish) card_id, finish, market_cents, price_source, (as_of::timestamp at time zone 'UTC')
    from src order by card_id, finish, as_of desc
    on conflict (card_id, finish) do update set
      market_cents = excluded.market_cents, price_source = excluded.price_source, price_asof = excluded.price_asof
    where card_prices_current.price_asof <= excluded.price_asof
    returning 1)
  select count(*)::int from cur
$$;
