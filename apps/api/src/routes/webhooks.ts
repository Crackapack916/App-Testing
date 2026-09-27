import { Hono } from "hono";
import { handleWebhook } from "@crackapack/payments";
import type { Env } from "../context";

export const webhooks = new Hono<Env>();

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
