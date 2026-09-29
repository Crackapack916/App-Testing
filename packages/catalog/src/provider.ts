/**
 * All card data goes through CardDataProvider. The test run uses Scryfall; before a real
 * launch the plan is MTGJSON (business context section 8), which already has an importer
 * in this package. Swapping providers changes nothing else in the app.
 */
import { Readable } from "node:stream";
import { createReadStream } from "node:fs";
import type pg from "pg";
import { mapScryfallCard, scryfallClient, type ScryfallRow } from "./scryfall";
import { streamBulk } from "./scryfall-bulk";
export { scryfallProvider, type CardDataProvider, type LookupResult } from "./lookup";

const BATCH = 2000;

/** Daily bulk import. Logs the run (start, rows, success or failure) in import_runs. */
export async function importScryfallBulk(pool: pg.Pool, opts: { file?: string; setsFile?: string; fetchImpl?: typeof fetch; log?: (m: string) => void } = {}) {
  const log = opts.log ?? (() => {});
  const client = scryfallClient(opts.fetchImpl ?? fetch);
  const { rows: [run] } = await pool.query("select start_import_run('scryfall', 'default_cards') as id");
  let n = 0;
  try {
    // Sets first, so every card has its set's name and icon.
    log("fetching sets");
    const sets = opts.setsFile ? JSON.parse(await readAll(createReadStream(opts.setsFile))).data : await client.sets();
    await pool.query("select import_scryfall_sets($1)", [JSON.stringify(sets.filter((s: { digital?: boolean }) => !s.digital))]);

    let body: Readable; let asof: string;
    if (opts.file) { body = createReadStream(opts.file); asof = new Date().toISOString(); }
    else {
      log(`imported ${sets.length} sets; finding today's bulk file`);
      const bulk = await client.bulkUri();
      log(`downloading ${bulk.uri}`);
      const res = await client.fetch(bulk.uri);
      if (!res.ok || !res.body) throw new Error(`bulk download ${res.status}`);
      body = Readable.fromWeb(res.body as never); asof = bulk.updated_at;
    }
    let batch: ScryfallRow[] = [];
    const flush = async () => {
      if (!batch.length) return;
      const { rows: [r] } = await pool.query("select import_scryfall_cards($1, $2) as n", [JSON.stringify(batch), asof]);
      n += r.n; batch = [];
      log(`imported ${n} printings`);
    };
    for await (const card of streamBulk(body)) {
      const row = mapScryfallCard(card);
      if (!row) continue;
      batch.push(row);
      if (batch.length >= BATCH) await flush();
    }
    await flush();
    await pool.query("select finish_import_run($1, true, $2, null)", [run.id, n]);
    return { rows: n };
  } catch (e) {
    await pool.query("select finish_import_run($1, false, $2, $3)", [run.id, n, String((e as Error).message).slice(0, 500)]);
    throw e;
  }
}

async function readAll(s: Readable) {
  const chunks: Buffer[] = [];
  for await (const c of s) chunks.push(Buffer.from(c));
  return Buffer.concat(chunks).toString("utf8");
}
