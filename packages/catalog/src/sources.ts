import { createReadStream } from "node:fs";
import { createRequire } from "node:module";
import { Readable } from "node:stream";
import { createGunzip } from "node:zlib";
import type { MtgjsonSet, PriceFormats } from "./mtgjson";

// stream-json is CommonJS.
const require = createRequire(import.meta.url);
const { chain } = require("stream-chain");
const { parser } = require("stream-json");
const { pick } = require("stream-json/filters/Pick");
const { streamObject } = require("stream-json/streamers/StreamObject");

export const MTGJSON_BASE = "https://mtgjson.com/api/v5";

/** A local path or an https URL, gunzipped when it ends in .gz. */
async function open(source: string): Promise<Readable> {
  let stream: Readable;
  if (/^https?:\/\//.test(source)) {
    const res = await fetch(source);
    if (!res.ok || !res.body) throw new Error(`download failed ${res.status} ${source}`);
    stream = Readable.fromWeb(res.body as any);
  } else {
    stream = createReadStream(source);
  }
  return source.endsWith(".gz") ? stream.pipe(createGunzip()) : stream;
}

/** Streams each entry of the top level `data` object without loading the whole file. */
async function* entries<T>(source: string): AsyncGenerator<{ key: string; value: T }> {
  const pipeline = chain([await open(source), parser(), pick({ filter: "data" }), streamObject()]);
  for await (const item of pipeline) yield item as { key: string; value: T };
}

/** AllPrintings: { meta, data: { [setCode]: Set } }. */
export async function* allPrintings(source: string) {
  for await (const { value } of entries<MtgjsonSet>(source)) yield value;
}

/** A single set file: { meta, data: Set }. Small enough to parse whole. */
export async function readSetFile(source: string): Promise<MtgjsonSet> {
  const chunks: Buffer[] = [];
  for await (const c of await open(source)) chunks.push(Buffer.from(c));
  const doc = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!doc?.data?.cards) throw new Error(`not a set file: ${source}`);
  return doc.data as MtgjsonSet;
}

/** AllPricesToday / AllPrices: { meta, data: { [uuid]: PriceFormats } }. */
export async function* allPrices(source: string) {
  for await (const e of entries<PriceFormats>(source)) yield e;
}
