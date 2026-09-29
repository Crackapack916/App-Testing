/**
 * Scryfall bulk import (the test run's card data).
 *   pnpm --filter @crackapack/catalog scryfall                  # download today's default_cards
 *   pnpm --filter @crackapack/catalog scryfall --file cards.json --sets sets.json
 * Requires DATABASE_URL. Exits non zero on failure; the run is logged in import_runs either way.
 */
import pg from "pg";
import { importScryfallBulk } from "./provider";

const arg = (name: string) => { const i = process.argv.indexOf(`--${name}`); return i < 0 ? undefined : process.argv[i + 1]; };
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
const started = Date.now();
try {
  const r = await importScryfallBulk(pool, { file: arg("file"), setsFile: arg("sets"), log: (m) => console.log(m) });
  console.log(`done: ${r.rows} printings in ${Math.round((Date.now() - started) / 1000)}s`);
} catch (e) {
  console.error(`import failed: ${(e as Error).message}`);
  console.error((e as Error).stack);
  process.exitCode = 1;
} finally {
  await pool.end();
}
