import type { Db } from "./db";

/** Ladder from the business context, in credits (1 credit = $0.01). */
export const LADDER: [number, number][] = [[1, 900], [3, 850], [6, 825], [9, 800], [12, 775]];

export async function makeUser(db: Db, opts: { credits?: number; verified?: boolean; state?: string; role?: string } = {}) {
  const u = await db.one(
    `insert into users (email, display_name, role, age_verified_at, state_code)
     values (gen_random_uuid() || '@test.local', 'tester', $1, $2, $3) returning id`,
    [opts.role ?? "customer", opts.verified === false ? null : new Date(), opts.state ?? "CA"],
  );
  if (opts.credits) await db.q("select purchase_credits($1, $2, gen_random_uuid()::text)", [u.id, opts.credits]);
  return u.id as string;
}

export async function makeProduct(db: Db, opts: { setCode?: string; boxes?: number; packsPerBox?: number; buffer?: number } = {}) {
  const code = opts.setCode ?? "FDN";
  await db.q("insert into mtg_sets (code, name) values ($1, $1) on conflict do nothing", [code]);
  const p = await db.one(
    `insert into products (set_code, booster_type, name, active, safety_buffer_packs)
     values ($1, 'play', $1 || ' Play Booster', true, $2) returning id`,
    [code, opts.buffer ?? 1],
  );
  for (const [minQty, credits] of LADDER) {
    await db.q("insert into price_tiers values ($1, $2, $3)", [p.id, minQty, credits]);
  }
  for (let i = 0; i < (opts.boxes ?? 1); i++) {
    await db.q("select receive_box($1, $2, $3, 12500, null, null)", [p.id, `${code}-BOX-${i + 1}`, opts.packsPerBox ?? 30]);
  }
  return p.id as string;
}

export async function makeCard(db: Db, opts: { set?: string; num?: string; rarity?: string; priceCents?: number | null; foilPriceCents?: number; asof?: string } = {}) {
  const c = await db.one(
    `insert into cards (name, set_code, collector_number, rarity, finishes)
     values ($1, $2, $3, $4, '{nonfoil,foil}') returning id`,
    [`Card ${opts.num ?? Math.random()}`, opts.set ?? "FDN", opts.num ?? String(Math.floor(Math.random() * 1e9)), opts.rarity ?? "common"],
  );
  const asof = opts.asof ?? new Date().toISOString();
  if (opts.priceCents !== null) {
    await db.q("insert into card_prices_current values ($1, 'nonfoil', $2, 'mtgjson:tcgplayer', $3)", [c.id, opts.priceCents ?? 10, asof]);
  }
  if (opts.foilPriceCents !== undefined) {
    await db.q("insert into card_prices_current values ($1, 'foil', $2, 'mtgjson:tcgplayer', $3)", [c.id, opts.foilPriceCents, asof]);
  }
  return c.id as string;
}

export async function makeStaff(db: Db) {
  return makeUser(db, { role: "staff" });
}

/** 2026-10-01 in Los Angeles. Cutoff 19:00 PDT = 02:00Z on the 2nd. */
export const DAY = "2026-10-01";
export const BEFORE_CUTOFF = "2026-10-01T18:30:00-07:00";
export const JUST_BEFORE = "2026-10-01T18:59:59.999-07:00";
export const AT_CUTOFF = "2026-10-01T19:00:00-07:00";
export const AFTER_CUTOFF = "2026-10-01T19:05:00-07:00";
