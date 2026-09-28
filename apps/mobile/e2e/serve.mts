/**
 * End to end server for the customer app: a fresh test database with a set on sale and
 * three cards, the API, and the exported web build with single page fallback.
 */
import { spawn } from "node:child_process";
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, resolve } from "node:path";
import setup from "../../../packages/db/test/global-setup";
import { freshDb } from "../../../packages/db/test/db";
import { makeCard, makeProduct } from "../../../packages/db/test/fixtures";
import { hashPassword } from "../../api/src/secrets";
import { importScryfallBulk } from "../../../packages/catalog/src/provider";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";

const API_PORT = Number(process.env.E2E_API_PORT ?? 8789);
const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 8790);

await setup();
const db = await freshDb();
await db.q("insert into mtg_sets (code, name) values ('FDN', 'Foundations') on conflict (code) do update set name = excluded.name");
await makeProduct(db, { setCode: "FDN", boxes: 1 });
const cards = [
  { num: "101", rarity: "mythic", priceCents: 4500, name: "Sheoldred, the Apocalypse" },
  { num: "7", rarity: "common", priceCents: 350, name: "Llanowar Elves" },
  { num: "55", rarity: "uncommon", priceCents: 25, foilPriceCents: 90, name: "Lightning Bolt" },
];
for (const c of cards) {
  // Priced the morning of the test night, as the daily MTGJSON import would.
  const id = await makeCard(db, { set: "FDN", num: c.num, rarity: c.rarity, priceCents: c.priceCents, foilPriceCents: c.foilPriceCents, asof: "2026-10-01T13:00:00Z" });
  await db.q(`update cards set name = $2, legalities = '{"standard":"Legal","modern":"Legal","commander":"Legal"}' where id = $1`, [id, c.name]);
}
// The customer, funded the way a completed checkout would be (through the credit ledger).
const [alice] = await db.q("insert into users (email, display_name, age_verified_at, password_hash) values ('alice@e2e.test', 'alice', now(), $1) returning id",
  [await hashPassword("alice password")]);
await db.q("select record_credit_purchase($1, 5000, 'stripe', 'cs_e2e_seed')", [alice.id]);
// A funded customer for the spending limits spec.
const [lim] = await db.q("insert into users (email, display_name, age_verified_at, password_hash) values ('limits@e2e.test', 'limits', now(), $1) returning id",
  [await hashPassword("limits password")]);
await db.q("select record_credit_purchase($1, 5000, 'stripe', 'cs_e2e_seed_limits')", [lim.id]);
// Real printings for search (Scryfall fixtures), except FDN, whose cards the night spec defines.
const FIX = resolve("../../packages/catalog/test/fixtures/scryfall");
const tmp = mkdtempSync(join(tmpdir(), "scry-"));
writeFileSync(join(tmp, "cards.json"), JSON.stringify(JSON.parse(readFileSync(join(FIX, "cards.json"), "utf8")).filter((c: { set: string }) => c.set !== "fdn")));
await importScryfallBulk(db.pool, { file: join(tmp, "cards.json"), setsFile: join(FIX, "sets.json") });
await db.pool.end();

const api = spawn("npx", ["tsx", resolve("../api/src/server.ts")], {
  stdio: "inherit",
  env: { ...process.env, DATABASE_URL: db.url, JWT_SECRET: "e2e", DOB_ENCRYPTION_KEY: Buffer.alloc(32, 3).toString("base64"), DEV_LOGIN: "1", TEST_CLOCK: "1", DEV_STAFF_EMAILS: "ops@e2e.test", PORT: String(API_PORT),
    VIDEO_DIR: mkdtempSync(join(tmpdir(), "e2e-videos-")) },
});

const TYPES: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png",
  ".ttf": "font/ttf", ".wav": "audio/wav", ".json": "application/json", ".ico": "image/x-icon" };
const dist = resolve("dist");
createServer((req, res) => {
  const path = decodeURIComponent((req.url ?? "/").split("?")[0]);
  let file = join(dist, path);
  if (!file.startsWith(dist) || !existsSync(file) || statSync(file).isDirectory()) file = join(dist, "index.html");
  res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
  createReadStream(file).pipe(res);
}).listen(WEB_PORT);

const stop = () => { api.kill(); process.exit(0); };
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
