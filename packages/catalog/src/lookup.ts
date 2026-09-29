/**
 * All card data goes through CardDataProvider. The test run uses Scryfall; before a real
 * launch the plan is MTGJSON (business context section 8). This module has no streaming
 * dependencies, so the API can bundle it.
 */
import { mapScryfallCard, scryfallClient, type ScryfallRow } from "./scryfall";

export type LookupResult = ScryfallRow;

export interface CardDataProvider {
  readonly name: string;
  /** One printing by set code and collector number, or null. Used by logging when our table has no row. */
  lookup(setCode: string, collectorNumber: string): Promise<LookupResult | null>;
  /** The set itself (name, release date, symbol), or null. */
  set(setCode: string): Promise<{ code: string; name: string; released_at?: string; set_type: string; icon_svg_uri: string } | null>;
  /** Every printing in a set, for the per set import (business context section 15). */
  setPrintings(setCode: string): Promise<LookupResult[]>;
}

type Query = { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }> };

/**
 * The per set import (section 15): fetch every printing of one set, store it, record the
 * list, then check it. Independent of the daily bulk job. Returns the check result.
 */
export async function importSetCardData(db: Query, provider: CardDataProvider, setCode: string) {
  const code = setCode.trim().toLowerCase();
  const set = await provider.set(code);
  if (!set) throw new Error("unknown_set");
  await db.query("select import_scryfall_sets($1)", [JSON.stringify([set])]);
  const rows = await provider.setPrintings(code);
  if (!rows.length) throw new Error("no_printings");
  for (let i = 0; i < rows.length; i += 500) {
    await db.query("select import_scryfall_cards($1, now())", [JSON.stringify(rows.slice(i, i + 500))]);
  }
  await db.query("select record_set_printings($1, $2)", [code, rows.map((r) => r.collector_number)]);
  const { rows: [r] } = await db.query("select verify_set_card_data($1, 'per_set_import') as r", [code]);
  return r.r as { set_code: string; ok: boolean; expected: number; problem: string | null; missing: string[]; missing_images: string[] };
}

export function scryfallProvider(fetchImpl: typeof fetch = fetch, base?: string): CardDataProvider {
  const client = scryfallClient(fetchImpl, base);
  return {
    name: "scryfall",
    async lookup(set, number) {
      const c = await client.cardBySetNumber(set, number);
      return c ? mapScryfallCard(c) : null;
    },
    set: (code) => client.set(code),
    async setPrintings(code) {
      return (await client.setPrintings(code)).map(mapScryfallCard).filter((r): r is ScryfallRow => !!r);
    },
  };
}

