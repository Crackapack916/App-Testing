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
}

export function scryfallProvider(fetchImpl: typeof fetch = fetch, base?: string): CardDataProvider {
  const client = scryfallClient(fetchImpl, base);
  return {
    name: "scryfall",
    async lookup(set, number) {
      const c = await client.cardBySetNumber(set, number);
      return c ? mapScryfallCard(c) : null;
    },
  };
}

