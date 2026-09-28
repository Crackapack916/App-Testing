import { Hono } from "hono";
import { ApiError } from "../errors";
import { IMAGE_SQL, withImages } from "../images";
import type { Env } from "../context";

/**
 * Card search and detail, open to guests (Scryfall's terms: its data may not be gated behind
 * payment). Everything reads our own tables; nothing calls Scryfall per request.
 */
export const cards = new Hono<Env>();

// The price shown under a card: nonfoil when it has one, else its foil or etched price.
const SHOWN_PRICE = `left join lateral (
    select p.finish, p.market_cents::int, p.price_asof from card_prices_current p where p.card_id = cd.id
    order by (p.finish = 'nonfoil') desc, (p.finish = 'foil') desc limit 1) pr on true`;

const LIST_COLS = `cd.id, cd.name, cd.set_code, s.name as set_name, s.icon_svg_uri as set_icon, cd.collector_number, cd.rarity,
  cd.finishes, cd.type_line, pr.market_cents as price_cents, pr.finish as price_finish, pr.price_asof, ${IMAGE_SQL}`;

const SORTS: Record<string, string> = {
  name: "cd.name_folded collate \"C\", s.release_date desc nulls last",
  price: "pr.market_cents desc nulls last, cd.name_folded",
  release: "cd.released_at desc nulls last, cd.name_folded",
};
const FORMATS = new Set(["standard", "pioneer", "modern", "legacy", "vintage", "commander", "pauper", "brawl", "historic", "timeless"]);
const COLORS = new Set(["W", "U", "B", "R", "G", "C"]);

cards.get("/cards/search", async (c) => {
  const db = c.get("db");
  const q = (c.req.query("q") ?? "").trim();
  const f = {
    set: c.req.query("set")?.toUpperCase() || null,
    rarity: c.req.query("rarity") || null,
    color: c.req.query("color")?.toUpperCase() || null,
    type: c.req.query("type") || null,
    finish: c.req.query("finish") || null,
    min: c.req.query("min") ? Number(c.req.query("min")) : null,
    max: c.req.query("max") ? Number(c.req.query("max")) : null,
    format: c.req.query("format")?.toLowerCase() || null,
  };
  const sort = c.req.query("sort") ?? "relevance";
  const limit = Math.min(Number(c.req.query("limit") ?? 40), 100);
  const offset = Math.max(Number(c.req.query("offset") ?? 0), 0);
  const filtered = Object.values(f).some((v) => v != null);
  if (q.length < 2 && !filtered) return c.json({ exact: null, cards: [] });

  // "set 123" (set code plus collector number) goes straight to that printing.
  const m = /^([a-z0-9]{2,6})\s+([^\s]{1,12})$/i.exec(q);
  if (m) {
    const { rows: [hit] } = await db.query(
      `select ${LIST_COLS} from cards cd left join mtg_sets s on s.code = cd.set_code ${SHOWN_PRICE}
       where cd.set_code = upper($1) and lower(cd.collector_number) = lower($2)`, [m[1], m[2]]);
    if (hit) return c.json({ exact: withImages([hit])[0], cards: withImages([hit]) });
  }

  if (f.format && !FORMATS.has(f.format)) throw new ApiError("invalid_filter");
  if (f.color && !COLORS.has(f.color)) throw new ApiError("invalid_filter");
  const order = SORTS[sort] ?? `(cd.name_folded = t.q) desc, (cd.name_folded like t.q || '%') desc,
    word_similarity(t.q, cd.name_folded) desc, s.release_date desc nulls last`;
  const { rows } = await db.query(
    `with t as (select lower(f_unaccent($1::text)) as q)
     select ${LIST_COLS}
     from cards cd cross join t left join mtg_sets s on s.code = cd.set_code ${SHOWN_PRICE}
     where (t.q = '' or cd.name_folded like '%' || t.q || '%' or t.q <% cd.name_folded)
       and ($2::text is null or cd.set_code = $2)
       and ($3::text is null or cd.rarity = $3)
       and ($4::text is null or ($4 = 'C' and cardinality(cd.colors) = 0) or $4 = any (cd.colors))
       and ($5::text is null or cd.type_line ilike '%' || $5 || '%')
       and ($6::text is null or $6 = any (cd.finishes))
       and ($7::int is null or pr.market_cents >= $7)
       and ($8::int is null or pr.market_cents <= $8)
       and ($9::text is null or lower(cd.legalities ->> $9) = 'legal')
     order by ${order}
     limit $10 offset $11`,
    [q.length >= 2 ? q : "", f.set, f.rarity, f.color, f.type, f.finish, f.min, f.max, f.format, limit, offset]);
  return c.json({ exact: null, cards: withImages(rows) });
});

cards.get("/cards/:id", async (c) => {
  const db = c.get("db");
  const { rows: [card] } = await db.query(
    `select cd.id, cd.name, cd.set_code, s.name as set_name, s.icon_svg_uri as set_icon, cd.collector_number, cd.rarity,
            cd.finishes, cd.type_line, cd.mana_cost, cd.oracle_text, cd.legalities, cd.oracle_id, cd.card_faces,
            (select json_object_agg(p.finish, json_build_object('cents', p.market_cents, 'asof', p.price_asof))
               from card_prices_current p where p.card_id = cd.id) as prices,
            ${IMAGE_SQL}
     from cards cd left join mtg_sets s on s.code = cd.set_code where cd.id = $1`, [c.req.param("id")]);
  if (!card) throw new ApiError("unknown_card", 404);
  // Every printing of the same card.
  const { rows: printings } = await db.query(
    `select ${LIST_COLS} from cards cd left join mtg_sets s on s.code = cd.set_code ${SHOWN_PRICE}
     where cd.id <> $1 and (cd.oracle_id = $2 or ($2 is null and cd.name = $3))
     order by cd.released_at desc nulls last limit 100`, [card.id, card.oracle_id, card.name]);
  const { oracle_id, ...rest } = card;
  return c.json({ card: withImages([rest])[0], printings: withImages(printings) });
});
