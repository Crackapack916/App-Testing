import { createHmac, timingSafeEqual } from "node:crypto";
import type { ClipService } from "./context";

/**
 * Pilot clips: a media fragment into the session recording (`<recording>#t=start,end`).
 * Ready immediately; nothing is re-encoded.
 */
export const linkClips: ClipService = {
  name: "link",
  async create({ streamRef, startMs, endMs }) {
    return { status: "ready", ref: `${streamRef ?? "recording"}#t=${(startMs / 1000).toFixed(1)},${(endMs / 1000).toFixed(1)}` };
  },
};

export type MuxConfig = { tokenId: string; tokenSecret: string; liveStreamId: string; webhookSecret: string };
const MUX = "https://api.mux.com/video/v1";

/**
 * Mux clips. OBS streams to one permanent Mux live stream; each order's clip is a new asset
 * cut from that stream's recording. Session offsets are converted through wall clock time,
 * because the recording starts when OBS connects, not when staff press Start. Mux calls
 * /webhooks/mux when the clip is ready, with the order id in `passthrough`.
 */
export function muxClips(cfg: MuxConfig, fetchImpl: typeof fetch = fetch): ClipService {
  const auth = "Basic " + Buffer.from(`${cfg.tokenId}:${cfg.tokenSecret}`).toString("base64");
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await fetchImpl(MUX + path, { method, headers: { authorization: auth, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body) });
    if (!res.ok) throw new Error(`mux_${res.status}`);
    return ((await res.json()) as { data: any }).data;
  };
  return {
    name: "mux",
    async create({ orderId, sessionStartedAt, startMs, endMs }) {
      const live = await call("GET", `/live-streams/${cfg.liveStreamId}`);
      const assetId: string | undefined = live.active_asset_id ?? live.recent_asset_ids?.at(-1);
      if (!assetId) throw new Error("mux_no_recording");
      const asset = await call("GET", `/assets/${assetId}`);
      const recordingStart = Number(asset.created_at) * 1000;
      const toAsset = (ms: number) => Math.max(0, (sessionStartedAt.getTime() + ms - recordingStart) / 1000);
      await call("POST", "/assets", {
        inputs: [{ url: `mux://assets/${assetId}`, start_time: toAsset(startMs), end_time: toAsset(endMs) }],
        playback_policies: ["public"],
        video_quality: "basic",
        passthrough: orderId,
      });
      return { status: "pending" };
    },
  };
}

/** Verifies a Mux-Signature header (t=<unix>,v1=<hex hmac of "t.body">) within a 5 minute window. */
export function verifyMuxSignature(rawBody: string, header: string | undefined, secret: string, nowSec = Math.floor(Date.now() / 1000)) {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(",").map((kv) => kv.split("=") as [string, string]));
  const t = Number(parts.t);
  if (!t || !parts.v1 || Math.abs(nowSec - t) > 300) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${rawBody}`).digest();
  const given = Buffer.from(parts.v1, "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}
