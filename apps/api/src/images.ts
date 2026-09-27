/**
 * Card image adapter. Images load from Scryfall's image CDN in the customer's browser or
 * app; we never copy, store or proxy them. Swap this one function to change the source.
 */
export function cardImageUrl(scryfallId: string | null | undefined, size: "small" | "normal" | "large" = "normal") {
  if (!scryfallId) return null;
  return `https://cards.scryfall.io/${size}/front/${scryfallId[0]}/${scryfallId[1]}/${scryfallId}.jpg`;
}

/** Adds image_url to rows that carry a scryfall_id, and drops the vendor id from the response. */
export function withImages<T extends { scryfall_id?: string | null }>(rows: T[]) {
  return rows.map(({ scryfall_id, ...r }) => ({ ...r, image_url: cardImageUrl(scryfall_id) }));
}

/** SQL fragment: the Scryfall id for card alias `cd`. */
export const SCRYFALL_ID_SQL =
  "(select external_id from card_external_ids e where e.card_id = cd.id and e.source = 'scryfall') as scryfall_id";
