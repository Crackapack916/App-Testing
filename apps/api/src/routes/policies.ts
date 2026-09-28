import { Hono } from "hono";
import { ApiError } from "../errors";
import type { Env } from "../context";

/** Fairness and policies (item 18): public, versioned, dated. */
export const policies = new Hono<Env>();

const DOCS = ["fairness", "terms", "privacy"];

policies.get("/policies", async (c) => {
  const { rows } = await c.get("db").query(
    `select v.doc, v.title, v.version, v.published_at from policy_versions v
     where v.version = current_policy_version(v.doc) order by array_position($1::text[], v.doc)`, [DOCS]);
  return c.json({ policies: rows });
});

policies.get("/policies/:doc", async (c) => {
  const db = c.get("db");
  const { rows: [p] } = await db.query(
    "select doc, title, version, published_at, body_md from policy_versions where doc = $1 and version = current_policy_version($1)", [c.req.param("doc")]);
  if (!p) throw new ApiError("unknown_policy", 404);
  const { rows: [cfg] } = await db.query("select buyback_enabled from system_config");
  return c.json({ ...p, body_md: sections(p.body_md, { buyback: cfg.buyback_enabled }) });
});

/** Drops a "## Heading {flag}" section while its flag is off, and strips the marker when on. */
export function sections(md: string, flags: Record<string, boolean>) {
  return md.split(/\n(?=## )/).filter((part) => {
    const m = /^## .*\{(\w+)\}\s*$/m.exec(part.split("\n")[0]);
    return !m || flags[m[1]];
  }).map((part) => part.replace(/^(## .*?)\s*\{\w+\}\s*$/m, "$1")).join("\n").trim();
}
