/**
 * Credit bundles. Each matches a tier of the pack pricing ladder, so a bundle buys
 * exactly that many packs. 1 credit = $0.01, so credits always equal cents paid.
 * Stripe prices are looked up by `key` (the Stripe lookup_key), never by id.
 */
export const BUNDLES = [
  { key: "credits_900", credits: 900, packs: 1 },
  { key: "credits_2550", credits: 2550, packs: 3 },
  { key: "credits_4950", credits: 4950, packs: 6 },
  { key: "credits_7200", credits: 7200, packs: 9 },
  { key: "credits_9300", credits: 9300, packs: 12 },
] as const;

export type BundleKey = (typeof BUNDLES)[number]["key"];

export function bundle(key: string) {
  const b = BUNDLES.find((x) => x.key === key);
  if (!b) throw new Error("unknown_bundle");
  return b;
}
