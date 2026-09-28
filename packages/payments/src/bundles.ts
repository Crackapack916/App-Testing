/**
 * Credit bundles. Each matches a tier of the pack pricing ladder, so a bundle buys
 * exactly that many packs. 1 credit = $0.01, so credits always equal cents paid.
 * Stripe prices are looked up by `key` (the Stripe lookup_key), never by id.
 */
// Working test ladder (brief item 9, not yet confirmed): 1 pack 1,000, 3 at 950, 6 at 900.
// Stripe sandbox prices with these lookup keys exist on product prod_VL0BnbAdob27Ft.
export const BUNDLES = [
  { key: "credits_1000", credits: 1000, packs: 1 },
  { key: "credits_2850", credits: 2850, packs: 3 },
  { key: "credits_5400", credits: 5400, packs: 6 },
] as const;

export type BundleKey = (typeof BUNDLES)[number]["key"];

export function bundle(key: string) {
  const b = BUNDLES.find((x) => x.key === key);
  if (!b) throw new Error("unknown_bundle");
  return b;
}
