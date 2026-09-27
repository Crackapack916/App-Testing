import { Hono } from "hono";
import { handleWebhook } from "@crackapack/payments";
import { verifyMuxSignature } from "../clips";
import type { Env } from "../context";

export const webhooks = new Hono<Env>();

// Mux: a clip asset is ready (or failed). passthrough carries the order id.
webhooks.post("/mux", async (c) => {
  const secret = c.get("services").muxWebhookSecret;
  if (!secret) return c.json({ error: "unknown_processor" }, 404);
  const raw = await c.req.text();
  if (!verifyMuxSignature(raw, c.req.header("mux-signature"), secret)) return c.json({ error: "bad_signature" }, 400);
  const ev = JSON.parse(raw) as { type: string; data: { passthrough?: string; playback_ids?: { id: string; policy: string }[] } };
  const orderId = ev.data?.passthrough;
  if (!orderId || !/^[0-9a-f-]{36}$/.test(orderId)) return c.json({ status: "ignored" });
  const pool = c.get("services").pool;
  try {
    if (ev.type === "video.asset.ready") {
      const playback = ev.data.playback_ids?.find((p) => p.policy === "public")?.id;
      if (!playback) return c.json({ status: "ignored" });
      await pool.query("select mark_clip_ready($1, $2, null)", [orderId, `https://stream.mux.com/${playback}.m3u8`]);
    } else if (ev.type === "video.asset.errored") {
      await pool.query("select mark_clip_failed($1, 'mux_asset_errored', null)", [orderId]);
    } else {
      return c.json({ status: "ignored" });
    }
  } catch (e) {
    // Replays of an already handled event are fine.
    if (/unknown_clip/.test(String(e))) return c.json({ status: "duplicate" });
    throw e;
  }
  return c.json({ status: "applied" });
});

// Raw body is required for signature verification.
webhooks.post("/:processor", async (c) => {
  const processor = c.get("services").payments;
  if (!processor || processor.name !== c.req.param("processor")) return c.json({ error: "unknown_processor" }, 404);
  const raw = await c.req.text();
  const headers = Object.fromEntries(c.req.raw.headers.entries());
  try {
    const result = await handleWebhook(c.get("services").pool, processor, raw, headers);
    return c.json(result);
  } catch (e) {
    if (/signature|missing_signature/i.test(String((e as Error).message))) return c.json({ error: "bad_signature" }, 400);
    throw e;
  }
});
