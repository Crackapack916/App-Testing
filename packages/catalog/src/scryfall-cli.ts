/**
 * Scryfall imports (the test run's card data).
 *   pnpm --filter @crackapack/catalog scryfall                   # daily bulk: every printing
 *   pnpm --filter @crackapack/catalog scryfall --set FDN         # one set, then its check
 *   pnpm --filter @crackapack/catalog scryfall --sets-on-sale    # every set on sale or with a drop coming
 *   pnpm --filter @crackapack/catalog scryfall --file cards.json --sets sets.json
 * Requires DATABASE_URL. Exits non zero on failure. The per set imports run separately from the
 * bulk job (business context section 15), so a failed bulk import never leaves a set on sale unchecked.
 */
import pg from "pg";
import { importScryfallBulk } from "./provider";
import { importSetCardData, scryfallProvider } from "./lookup";

const arg = (name: string) => { const i = process.argv.indexOf(`--${name}`); return i < 0 ? undefined : process.argv[i + 1]; };
const flag = (name: string) => process.argv.includes(`--${name}`);
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
const started = Date.now();
try {
  if (arg("set") || flag("sets-on-sale")) {
    const codes = arg("set") ? [arg("set")!] : (await pool.query("select s as code from sets_needing_card_data() s")).rows.map((r) => r.code as string);
    let failed = 0;
    for (const code of codes) {
      try {
        const r = await importSetCardData(pool, scryfallProvider(), code);
        console.log(`${r.set_code}: ${r.ok ? "ok" : "NOT OK"}, ${r.expected} printings${r.problem ? `, ${r.problem}` : ""}`);
        if (!r.ok) failed++;
      } catch (e) {
        failed++;
        console.error(`${code.toUpperCase()}: import failed: ${(e as Error).message}`);
        // Record the failed check so staff see it, if the set exists.
        await pool.query("select verify_set_card_data($1, 'per_set_import') where exists (select 1 from mtg_sets where code = upper($1))", [code]).catch(() => {});
      }
    }
    if (!codes.length) console.log("no sets on sale or with a drop coming");
    if (failed) process.exitCode = 1;
  } else {
    const r = await importScryfallBulk(pool, { file: arg("file"), setsFile: arg("sets"), log: (m) => console.log(m) });
    console.log(`done: ${r.rows} printings in ${Math.round((Date.now() - started) / 1000)}s`);
  }
} catch (e) {
  console.error(`import failed: ${(e as Error).message}`);
  console.error((e as Error).stack);
  process.exitCode = 1;
} finally {
  await pool.end();
}
