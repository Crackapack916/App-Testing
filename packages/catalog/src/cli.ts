/**
 * MTGJSON import.
 *
 *   pnpm --filter @crackapack/catalog import --printings        # every paper set (AllPrintings.json.gz)
 *   pnpm --filter @crackapack/catalog import --sets FDN,EOE     # just these sets
 *   pnpm --filter @crackapack/catalog import --prices           # today's prices (AllPricesToday.json.gz)
 *
 * Each flag takes an optional path or URL to use instead of the MTGJSON default.
 * Cards must be imported before prices for them are applied. Requires DATABASE_URL.
 */
import pg from "pg";
import { Importer } from "./importer";
import { MTGJSON_BASE, allPrices, allPrintings, readSetFile } from "./sources";

function arg(name: string): string | true | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return undefined;
  const v = process.argv[i + 1];
  return v && !v.startsWith("--") ? v : true;
}

const printings = arg("printings");
const sets = arg("sets");
const prices = arg("prices");
if (!printings && !sets && !prices) {
  console.error("nothing to do: pass --printings, --sets and/or --prices");
  process.exit(2);
}
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
const importer = new Importer(pool, (m) => console.log(m));
const started = Date.now();
try {
  if (printings) {
    for await (const set of allPrintings(printings === true ? `${MTGJSON_BASE}/AllPrintings.json.gz` : printings)) await importer.addSet(set);
  }
  if (typeof sets === "string") {
    for (const code of sets.split(",").map((s) => s.trim()).filter(Boolean)) {
      const src = /[/.]/.test(code) ? code : `${MTGJSON_BASE}/${code.toUpperCase()}.json`;
      await importer.addSet(await readSetFile(src));
    }
  }
  await importer.flushCards();
  if (prices) {
    for await (const { key, value } of allPrices(prices === true ? `${MTGJSON_BASE}/AllPricesToday.json.gz` : prices)) await importer.addPrices(key, value);
  }
  const stats = await importer.finish();
  console.log(JSON.stringify({ ...stats, seconds: Math.round((Date.now() - started) / 1000) }));
  // An import that matched nothing means the upstream format changed. Fail loudly.
  if ((printings || sets) && stats.cards === 0) throw new Error("no cards imported");
  if (prices && stats.prices === 0) throw new Error("no prices applied");
} finally {
  await pool.end();
}
