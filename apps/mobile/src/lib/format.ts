/** 1 credit = $0.01. */
export const credits = (n: number | null | undefined) => (n ?? 0).toLocaleString("en-US");
export const dollars = (cents: number | null | undefined) => (cents == null ? "·" : `$${(cents / 100).toFixed(2)}`);

export function countdown(to: string | Date, now = Date.now()) {
  const ms = new Date(to).getTime() - now;
  if (ms <= 0) return "now";
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return h ? `${h}h ${m}m` : `${m}m`;
}

const FORMATS = ["standard", "pioneer", "modern", "legacy", "vintage", "commander", "pauper"] as const;
/** Legality tags for the formats players care most about. */
export function legalityTags(legalities: Record<string, string> | null | undefined) {
  // MTGJSON says "Legal"; Scryfall says "legal" or "not_legal". Show one spelling.
  const norm = (v: string | undefined) => {
    const t = (v ?? "not_legal").toLowerCase().replace("_", " ");
    return t.charAt(0).toUpperCase() + t.slice(1);
  };
  return FORMATS.map((f) => ({ format: f, status: norm(legalities?.[f]) }));
}

/** A time shown in Pacific, which is how every cutoff and window is defined. */
export const pacific = (t: string | Date) =>
  new Date(t).toLocaleString("en-US", { timeZone: "America/Los_Angeles", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** "October 1, 2026": the Last updated date on policy pages. */
export const updated = (t: string) => new Date(t).toLocaleDateString("en-US", { timeZone: "America/Los_Angeles", month: "long", day: "numeric", year: "numeric" });
