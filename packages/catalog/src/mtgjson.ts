/**
 * The subset of MTGJSON v5 this project reads, and the mapping to our internal records.
 * Per the business context, production card data and prices come only from MTGJSON.
 * See https://mtgjson.com/data-models/ (Card (Set), Set, Price Formats).
 */

export interface MtgjsonCard {
  uuid: string;
  name: string;
  number: string;
  setCode: string;
  rarity: string;
  side?: string;
  type?: string;
  manaCost?: string;
  text?: string;
  finishes?: string[];
  promoTypes?: string[];
  legalities?: Record<string, string>;
  availability?: string[];
  isOnlineOnly?: boolean;
  identifiers?: { scryfallId?: string; tcgplayerProductId?: string | number; tcgPlayerId?: string | number };
}

export interface MtgjsonSet {
  code: string;
  name: string;
  releaseDate?: string;
  isOnlineOnly?: boolean;
  cards: MtgjsonCard[];
}

type PricePoints = Partial<Record<"normal" | "foil" | "etched", Record<string, number>>>;
type PriceList = { retail?: PricePoints; buylist?: PricePoints; currency?: string };
export interface PriceFormats {
  paper?: Partial<Record<"tcgplayer" | "cardkingdom" | "cardmarket" | "cardsphere", PriceList>>;
}

export type CardRow = {
  mtgjson_uuid: string; name: string; set_code: string; collector_number: string; rarity: string;
  type_line: string | null; mana_cost: string | null; oracle_text: string | null; finishes: string[];
  is_serialized: boolean; legalities: Record<string, string>; scryfall_id: string | null; tcgplayer_id: string | null;
};
export type SetRow = { code: string; name: string; release_date: string | null };
export type PriceRow = { mtgjson_uuid: string; finish: string; market_cents: number; as_of: string; price_source: string };

const RARITIES = new Set(["common", "uncommon", "rare", "mythic", "special", "bonus"]);
const FINISHES = new Set(["nonfoil", "foil", "etched"]);

/** Paper printings only. Double faced cards import once, from their front face. */
export function mapSet(set: MtgjsonSet): { set: SetRow; cards: CardRow[] } | null {
  if (set.isOnlineOnly) return null;
  const cards: CardRow[] = [];
  for (const c of set.cards ?? []) {
    if (c.isOnlineOnly) continue;
    if (c.availability && !c.availability.includes("paper")) continue;
    if (c.side && c.side !== "a") continue;
    const tcg = c.identifiers?.tcgplayerProductId ?? c.identifiers?.tcgPlayerId;
    const finishes = (c.finishes ?? ["nonfoil"]).filter((f) => FINISHES.has(f));
    cards.push({
      mtgjson_uuid: c.uuid,
      name: c.name,
      set_code: (c.setCode ?? set.code).toUpperCase(),
      collector_number: c.number,
      rarity: RARITIES.has(c.rarity) ? c.rarity : "special",
      type_line: c.type ?? null,
      mana_cost: c.manaCost ?? null,
      oracle_text: c.text ?? null,
      finishes: finishes.length ? finishes : ["nonfoil"],
      is_serialized: c.promoTypes?.includes("serialized") ?? false,
      legalities: c.legalities ?? {},
      scryfall_id: c.identifiers?.scryfallId ?? null,
      tcgplayer_id: tcg == null ? null : String(tcg),
    });
  }
  return { set: { code: set.code.toUpperCase(), name: set.name, release_date: set.releaseDate ?? null }, cards };
}

/** Preferred price sources, in order. Retail (what a buyer pays) is the market value. */
const SOURCES = ["tcgplayer", "cardkingdom"] as const;
const FINISH_KEY = { nonfoil: "normal", foil: "foil", etched: "etched" } as const;

/** One row per finish: the newest USD retail price from the first source that has one. */
export function mapPrices(uuid: string, formats: PriceFormats): PriceRow[] {
  const rows: PriceRow[] = [];
  for (const finish of Object.keys(FINISH_KEY) as (keyof typeof FINISH_KEY)[]) {
    for (const source of SOURCES) {
      const list = formats.paper?.[source];
      if (!list || (list.currency && list.currency !== "USD")) continue;
      const points = list.retail?.[FINISH_KEY[finish]];
      const latest = points && Object.keys(points).sort().at(-1);
      if (!latest || typeof points![latest] !== "number") continue;
      rows.push({ mtgjson_uuid: uuid, finish, market_cents: Math.round(points![latest] * 100), as_of: latest, price_source: `mtgjson:${source}` });
      break;
    }
  }
  return rows;
}
