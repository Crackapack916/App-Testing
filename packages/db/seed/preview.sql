-- Demo data for the private test site (Neon branch "preview"). Never run on the main branch.
-- One set on sale with two sealed boxes, a small card list with prices, and a funded
-- demo customer. Card data here is hand made, not an MTGJSON import.

-- Demo prices never go stale, so sell back works on any day.
update system_config set max_price_age = '3650 days';

insert into mtg_sets (code, name) values ('FDN', 'Foundations') on conflict (code) do update set name = excluded.name;

do $$
declare p uuid;
begin
  p := create_product('FDN', 'play', null, null, null);
  perform receive_box(p, 'FDN-DEMO-1', 30, 12500, null, null);
  perform receive_box(p, 'FDN-DEMO-2', 30, 12500, null, null);
  perform set_product_active(p, true, null);
end $$;

with c(num, name, rarity, cents, foil_cents) as (values
  ('1',   'Sire of Seven Deaths',       'mythic',   3200, 5500),
  ('2',   'Llanowar Elves',             'common',     35,  150),
  ('3',   'Lightning Bolt',             'uncommon',  120,  400),
  ('4',   'Sheoldred, the Apocalypse',  'mythic',   6800, 9500),
  ('5',   'Counterspell',               'uncommon',   90,  300),
  ('6',   'Serra Angel',                'uncommon',   15,   60),
  ('7',   'Giant Growth',               'common',     10,   40),
  ('8',   'Day of Judgment',            'rare',      250,  700),
  ('9',   'Grim Lavamancer',            'rare',      180,  500),
  ('10',  'Evolving Wilds',             'common',     20,   80),
  ('11',  'Omniscience',                'mythic',   1900, 4200),
  ('12',  'Doubling Season',            'rare',     2400, 3900),
  ('13',  'Cathar Commando',            'common',     12,   45),
  ('14',  'Burst Lightning',            'common',     25,   90),
  ('15',  'Island',                     'common',      5,   30)
), ins as (
  insert into cards (name, set_code, collector_number, rarity, finishes, legalities)
  select name, 'FDN', num, rarity, '{nonfoil,foil}',
         '{"standard":"Legal","pioneer":"Legal","modern":"Legal","commander":"Legal"}'
  from c
  on conflict do nothing
  returning id, collector_number
)
insert into card_prices_current
select ins.id, f.finish, f.cents, 'mtgjson:tcgplayer', now()
from ins join c on c.num = ins.collector_number
cross join lateral (values ('nonfoil', c.cents), ('foil', c.foil_cents)) as f(finish, cents);

-- The demo customer: sign in to the app as player@crackapack.test. $100 of purchased credit.
insert into users (email, display_name) values ('player@crackapack.test', 'player') on conflict (email) do nothing;
select record_credit_purchase((select id from users where email = 'player@crackapack.test'), 10000, 'stripe', 'demo_seed');
