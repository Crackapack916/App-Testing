// Writes each migration as a JSON array of statements (plus its schema_migrations insert)
// for applying through the Neon MCP when a direct Postgres connection is unavailable.
// Usage: node scripts/split-statements.mjs migrations <out-dir>
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
// Split SQL on top level semicolons, respecting $$ bodies, quotes and -- comments.
function split(src) {
  const out = []; let cur = ""; let i = 0; let dollar = false, quote = false;
  while (i < src.length) {
    const ch = src[i], two = src.slice(i, i + 2);
    if (!dollar && !quote && two === "--") { const nl = src.indexOf("\n", i); i = nl < 0 ? src.length : nl; continue; }
    if (!quote && two === "$$") { dollar = !dollar; cur += two; i += 2; continue; }
    if (!dollar && ch === "'") quote = !quote;
    if (!dollar && !quote && ch === ";") { if (cur.trim()) out.push(cur.trim()); cur = ""; i++; continue; }
    cur += ch; i++;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
const dir = process.argv[2], outDir = process.argv[3];
for (const f of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
  const stmts = split(readFileSync(`${dir}/${f}`, "utf8"));
  stmts.push(`insert into schema_migrations (name) values ('${f}')`);
  writeFileSync(`${outDir}/${f}.json`, JSON.stringify(stmts));
  console.log(f, stmts.length);
}
