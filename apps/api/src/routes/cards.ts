import { Hono } from "hono";
import { ApiError } from "../errors";
import { SCRYFALL_ID_SQL, withImages } from "../images";
import type { Env } from "../context";

/** Public card lookup (Search tab) and the platform wide big pulls feed. */
export const cards = new Hono<Env>();

const CARD_COLS = `cd.id, cd.name, cd.set_code, cd.collector_number, cd.rarity, cd.type_line, cd.mana_cost, cd.finishes, cd.legalities,
  s.name as set_name, s.release_date::text,
  (select json_object_agg(p.finish, p.market_cents) from card_prices_current p where p.card_id = cd.id) as prices,
  ${SCRYFALL_ID_SQL}`;

cards.get("/cards/search", async (c) => {
  const q = (c.req.query("q") ?? "").trim();
  const set = c.req.query("set")?.toUpperCase() ?? null;
  const limit = Math.min(Number(c.req.query("limit") ?? 30), 60);
  if (q.length < 2 && !set) return c.json({ cards: [] });
  const { rows } = await c.get("db").query(
    `select ${CARD_COLS}
     from cards cd left join mtg_sets s on s.code = cd.set_code
     where ($2::text is null or cd.set_code = $2)
       and ($1 = '' or cd.name ilike '%' || $1 || '%' or cd.search @@ plainto_tsquery('simple', $1))
     order by (lower(cd.name) = lower($1)) desc, similarity(cd.name, $1) desc, s.release_date desc nulls last
     limit $3`, [q, set, limit]);
  return c.json({ cards: withImages(rows) });
});

cards.get("/cards/:id", async (c) => {
  const db = c.get("db");
  const { rows: [card] } = await db.query(
    `select ${CARD_COLS}, cd.oracle_text from cards cd left join mtg_sets s on s.code = cd.set_code where cd.id = $1`, [c.req.param("id")]);
  if (!card) throw new ApiError("unknown_card", 404);
  const { rows: printings } = await db.query(
    `select ${CARD_COLS} from cards cd left join mtg_sets s on s.code = cd.set_code
     where cd.name = $1 and cd.id <> $2 order by s.release_date desc nulls last limit 50`, [card.name, card.id]);
  return c.json({ card: withImages([card])[0], printings: withImages(printings) });
});

// Big pulls across the platform: card and set only. No customer names and no prices.
cards.get("/feed/big-pulls", async (c) => {
  const { rows } = await c.get("db").query(
    `select po.opened_at, pc.finish, ${CARD_COLS.replace("cd.legalities,", "")}
     from pack_contents pc
     join pack_openings po on po.id = pc.pack_opening_id and po.contents_finalized_at is not null
     join cards cd on cd.id = pc.card_id left join mtg_sets s on s.code = cd.set_code
     join card_prices_current pr on pr.card_id = pc.card_id and pr.finish = pc.finish
     where pr.market_cents >= (select individual_hold_min_cents from system_config)
       and po.opened_at > app_now() - interval '14 days'
     order by po.opened_at desc limit 30`);
  return c.json({ pulls: withImages(rows).map(({ prices, ...r }: any) => r) });
});
