/**
 * Card images load from Scryfall's CDN in the customer's browser; we never copy, store or
 * proxy them. Links come only from the image_uris Scryfall returned (card_images); nothing
 * builds an image URL by hand.
 */
type Uris = Record<string, string> | null | undefined;

/** Replaces image_uris with image_url (normal) and image_small, as Scryfall gave them. */
export function withImages<T extends { image_uris?: Uris }>(rows: T[]) {
  return rows.map(({ image_uris, ...r }) => ({ ...r, image_url: image_uris?.normal ?? null, image_small: image_uris?.small ?? null }));
}

/** SQL fragment: the stored image links for card alias `cd`. */
export const IMAGE_SQL = "(select uris from card_images ci where ci.card_id = cd.id) as image_uris";
