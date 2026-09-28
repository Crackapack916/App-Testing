/** Streaming the bulk file needs stream-json (CommonJS); kept apart so the API bundle never loads it. */
import type { Readable } from "node:stream";
import { createRequire } from "node:module";
import type { ScryfallCard } from "./scryfall";

// stream-json is CommonJS.
const require = createRequire(import.meta.url);
const { chain } = require("stream-chain");
const { parser } = require("stream-json");
const { streamArray } = require("stream-json/streamers/StreamArray");

/** Streams a bulk file (a top level JSON array) one card at a time. */
export async function* streamBulk(body: Readable): AsyncGenerator<ScryfallCard> {
  const pipeline = chain([body, parser(), streamArray()]);
  for await (const { value } of pipeline) yield value as ScryfallCard;
}
