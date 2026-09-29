/**
 * Scryfall card data for the test run. Every call to api.scryfall.com sends an accurate
 * User-Agent and an Accept header, and goes through a limiter that stays under Scryfall's
 * rate limits (10 per second for lookups; bulk files are served from a separate host).
 * Card data is imported in bulk daily; nothing here is called per keystroke.
 */

export const SCRYFALL_API = "https://api.scryfall.com";
export const USER_AGENT = "CrackAPack/0.1 (crackapack.business@gmail.com)";
export const HEADERS = { "User-Agent": USER_AGENT, Accept: "application/json;q=0.9,*/*;q=0.8" };

/** The fields of a Scryfall card object we use. */
export type ScryfallCard = {
  id: string; oracle_id?: string; name: string; set: string; set_name: string; collector_number: string; rarity: string;
  finishes: string[]; frame_effects?: string[]; promo_types?: string[]; colors?: string[]; layout: string;
  image_uris?: Record<string, string>; card_faces?: { name: string; image_uris?: Record<string, string>; colors?: string[]; type_line?: string; mana_cost?: string; oracle_text?: string }[];
  prices: { usd?: string | null; usd_foil?: string | null; usd_etched?: string | null };
  legalities: Record<string, string>; released_at: string; type_line?: string; mana_cost?: string; oracle_text?: string;
  games?: string[]; digital?: boolean; tcgplayer_id?: number; lang?: string;
};

export type ScryfallSet = { code: string; name: string; released_at?: string; set_type: string; icon_svg_uri: string; digital?: boolean };

/** One row for import_scryfall_cards. */
export type ScryfallRow = {
  scryfall_id: string; oracle_id: string | null; name: string; set_code: string; collector_number: string; rarity: string;
  type_line: string | null; mana_cost: string | null; oracle_text: string | null; finishes: string[]; frame_effects: string[];
  promo_types: string[]; colors: string[]; layout: string; card_faces: unknown; released_at: string; legalities: Record<string, string>;
  is_serialized: boolean; image_uris: Record<string, string> | null; prices: Record<string, number>; tcgplayer_id: string | null;
};

/** "12.34" dollars to 1234 cents; null stays null. */
export function toCents(v: string | null | undefined): number | null {
  if (v == null || v === "") return null;
  const n = Math.round(Number(v) * 100);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Maps a paper printing; digital only cards are skipped. */
export function mapScryfallCard(c: ScryfallCard): ScryfallRow | null {
  if (c.digital || (c.games && !c.games.includes("paper"))) return null;
  const finishes = (c.finishes ?? []).filter((f) => ["nonfoil", "foil", "etched"].includes(f));
  if (!finishes.length) return null;
  const prices: Record<string, number> = {};
  const pairs: [string, string | null | undefined][] = [["nonfoil", c.prices?.usd], ["foil", c.prices?.usd_foil], ["etched", c.prices?.usd_etched]];
  for (const [f, v] of pairs) { const cents = toCents(v); if (cents != null) prices[f] = cents; }
  // Double faced cards keep their images per face; the front face stands for the card.
  const images = c.image_uris ?? c.card_faces?.[0]?.image_uris ?? null;
  return {
    scryfall_id: c.id, oracle_id: c.oracle_id ?? null, name: c.name, set_code: c.set.toUpperCase(),
    collector_number: c.collector_number, rarity: c.rarity,
    type_line: c.type_line ?? c.card_faces?.map((f) => f.type_line).filter(Boolean).join(" // ") ?? null,
    mana_cost: c.mana_cost ?? c.card_faces?.[0]?.mana_cost ?? null,
    oracle_text: c.oracle_text ?? c.card_faces?.map((f) => f.oracle_text).filter(Boolean).join("\n//\n") ?? null,
    finishes, frame_effects: c.frame_effects ?? [], promo_types: c.promo_types ?? [],
    colors: c.colors ?? c.card_faces?.[0]?.colors ?? [], layout: c.layout,
    card_faces: c.card_faces ? c.card_faces.map((f) => ({ name: f.name, image_uris: f.image_uris ?? null })) : null,
    released_at: c.released_at, legalities: c.legalities ?? {},
    is_serialized: (c.promo_types ?? []).includes("serialized"),
    image_uris: images, prices, tcgplayer_id: c.tcgplayer_id != null ? String(c.tcgplayer_id) : null,
  };
}

/** Spaces calls at least `intervalMs` apart (100 ms = 10 per second). */
export function limiter(intervalMs: number) {
  let next = 0;
  return async <T>(fn: () => Promise<T>): Promise<T> => {
    const wait = Math.max(0, next - Date.now());
    next = Math.max(Date.now(), next) + intervalMs;
    if (wait) await new Promise((r) => setTimeout(r, wait));
    return fn();
  };
}

/** Scryfall API client with required headers and a 10 per second limit. */
export function scryfallClient(fetchImpl: typeof fetch = fetch, base = SCRYFALL_API) {
  const limit = limiter(100);
  const get = (path: string) => limit(() => fetchImpl(`${base}${path}`, { headers: HEADERS }));
  return {
    /** /cards/:code/:number, in the 10 per second class. Null when Scryfall has no such printing. */
    async cardBySetNumber(set: string, number: string): Promise<ScryfallCard | null> {
      const r = await get(`/cards/${encodeURIComponent(set.toLowerCase())}/${encodeURIComponent(number)}`);
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`scryfall ${r.status}`);
      return (await r.json()) as ScryfallCard;
    },
    async sets(): Promise<ScryfallSet[]> {
      const r = await get("/sets");
      if (!r.ok) throw new Error(`scryfall sets ${r.status}`);
      return ((await r.json()) as { data: ScryfallSet[] }).data;
    },
    /** The daily "default_cards" bulk file: every printing, English where it exists. */
    async bulkUri(type = "default_cards"): Promise<{ uri: string; updated_at: string }> {
      const r = await get("/bulk-data");
      if (!r.ok) throw new Error(`scryfall bulk-data ${r.status}`);
      type Item = { type: string; download_uri?: string; uri?: string; updated_at: string };
      const body = (await r.json()) as { data?: Item[] };
      let item = body.data?.find((d) => d.type === type);
      if (!item) throw new Error(`no bulk file ${type} (got ${JSON.stringify(Object.keys(body))})`);
      // The list entry normally carries download_uri; if not, its own uri returns the full object.
      if (!item.download_uri && item.uri) {
        const one = await limit(() => fetchImpl(item!.uri!, { headers: HEADERS }));
        if (!one.ok) throw new Error(`scryfall bulk item ${one.status}`);
        item = { ...item, ...((await one.json()) as Item) };
      }
      if (!item.download_uri) throw new Error(`bulk file ${type} has no download link (fields: ${Object.keys(item).join(", ")})`);
      return { uri: item.download_uri, updated_at: item.updated_at };
    },
    fetch: (url: string) => limit(() => fetchImpl(url, { headers: HEADERS })),
  };
}

