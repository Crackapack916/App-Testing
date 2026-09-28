import { Hono } from "hono";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { ApiError } from "../errors";
import type { Env } from "../context";
import type { localVideos } from "../videos";

const TYPES: Record<string, string> = { mp4: "video/mp4", mov: "video/quicktime", jpg: "image/jpeg" };

/** Playback for local storage (pilot and tests): signed, expiring, with byte ranges for scrubbing. */
export const localVideoFiles = new Hono<Env>();
localVideoFiles.get("/videos/local/*", async (c) => {
  const videos = c.get("services").videos as ReturnType<typeof localVideos> | undefined;
  if (videos?.kind !== "local") throw new ApiError("videos_unavailable", 503);
  const pathname = c.req.path.replace(/^.*\/videos\/local\//, "");
  if (!videos.verify(pathname, c.req.query("exp") ?? "0", c.req.query("sig") ?? "")) throw new ApiError("forbidden");
  const file = videos.file(pathname);
  const size = await stat(file).then((s) => s.size).catch(() => null);
  if (size == null) throw new ApiError("unknown_video", 404);
  const type = TYPES[pathname.split(".").pop() ?? ""] ?? "application/octet-stream";
  const range = /bytes=(\d*)-(\d*)/.exec(c.req.header("range") ?? "");
  if (range) {
    const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start >= size || start > end) return c.body(null, 416, { "content-range": `bytes */${size}` });
    return c.body(Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream, 206, {
      "content-type": type, "accept-ranges": "bytes", "content-range": `bytes ${start}-${end}/${size}`, "content-length": String(end - start + 1) });
  }
  return c.body(Readable.toWeb(createReadStream(file)) as ReadableStream, 200, { "content-type": type, "accept-ranges": "bytes", "content-length": String(size) });
});
