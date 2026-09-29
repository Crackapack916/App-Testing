/** Streaming the bulk file needs stream-json (CommonJS); kept apart so the API bundle never loads it. */
import { Readable } from "node:stream";
import { createGunzip } from "node:zlib";
import { createInterface } from "node:readline";
import { createRequire } from "node:module";
import type { ScryfallCard } from "./scryfall";

// stream-json is CommonJS.
const require = createRequire(import.meta.url);
const { chain } = require("stream-chain");
const { parser } = require("stream-json");
const { streamArray } = require("stream-json/streamers/StreamArray");

/**
 * Streams a bulk file one card at a time. Scryfall publishes JSON Lines (one card per line,
 * jsonl_download_uri), and older files were one top level JSON array; both work, gzipped or not.
 */
export async function* streamBulkAny(body: Readable): AsyncGenerator<ScryfallCard> {
  const [head, input] = await peek(body, 64);
  // gzip magic bytes: fetch only decompresses Content-Encoding, not a .gz file served as is.
  const plain = head[0] === 0x1f && head[1] === 0x8b ? input.pipe(createGunzip()) : input;
  const first = (head[0] === 0x1f ? "" : head.toString("utf8")).trimStart()[0];
  if (first === "[") { yield* streamBulk(plain); return; }
  const lines = createInterface({ input: plain, crlfDelay: Infinity });
  for await (const line of lines) {
    const t = line.trim();
    if (t) yield JSON.parse(t) as ScryfallCard;
  }
}

/** The first bytes of a stream, and a stream that still yields every byte. */
async function peek(body: Readable, n: number): Promise<[Buffer, Readable]> {
  const chunks: Buffer[] = [];
  let size = 0;
  const it = body[Symbol.asyncIterator]();
  while (size < n) {
    const r = await it.next();
    if (r.done) break;
    const b = Buffer.from(r.value);
    chunks.push(b); size += b.length;
  }
  const head = Buffer.concat(chunks);
  async function* rest() { yield head; for (let r = await it.next(); !r.done; r = await it.next()) yield r.value; }
  return [head, Readable.from(rest())];
}

/** Streams a bulk file (a top level JSON array) one card at a time. */
export async function* streamBulk(body: Readable): AsyncGenerator<ScryfallCard> {
  const pipeline = chain([body, parser(), streamArray()]);
  for await (const { value } of pipeline) yield value as ScryfallCard;
}
