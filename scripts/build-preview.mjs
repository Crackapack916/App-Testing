/**
 * Builds the private test site for Vercel as Build Output API files in .vercel/output:
 *   /       the customer app (Expo web export)
 *   /ops/   the staff tool
 *   /api/*  the API as one Node function
 * Vercel runs this as the build command (see docs/SETUP.md, "Private test site").
 */
import { execSync } from "node:child_process";
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { bundleApi } from "./bundle-api.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, ".vercel/output");
const run = (cmd, cwd, env = {}) => execSync(cmd, { cwd: join(root, cwd), stdio: "inherit", env: { ...process.env, ...env } });

// On Vercel, bring the site's database up to date before shipping code that needs it.
// Migrations are transactional and recorded in schema_migrations, so reruns are no-ops.
if (process.env.VERCEL && process.env.DATABASE_URL) run("npx tsx scripts/migrate.ts", "packages/db");

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, "static"), { recursive: true });

// Customer app at /, calling the API on the same origin.
run("npx expo export --platform web --output-dir dist --clear", "apps/mobile", { EXPO_PUBLIC_API_URL: "/api", EXPO_OFFLINE: "1", EXPO_NO_TELEMETRY: "1" });
cpSync(join(root, "apps/mobile/dist"), join(out, "static"), { recursive: true });

// Staff tool at /ops/.
run("npx vite build", "apps/staff", { VITE_BASE: "/ops/", VITE_API_BASE: "/api" });
cpSync(join(root, "apps/staff/dist"), join(out, "static/ops"), { recursive: true });

// API function: the Hono app mounted under /api.
const fn = join(out, "functions/api.func");
mkdirSync(fn, { recursive: true });
await bundleApi(join(fn, "index.mjs"));
writeFileSync(join(fn, ".vc-config.json"), JSON.stringify({ runtime: "nodejs22.x", handler: "index.mjs", launcherType: "Nodejs", shouldAddHelpers: false }));

// Routes: API first, then real files, then each app's single page fallback.
writeFileSync(join(out, "config.json"), JSON.stringify({
  version: 3,
  routes: [
    { src: "^/api(/.*)?$", dest: "/api" },
    { handle: "filesystem" },
    { src: "^/ops(/.*)?$", dest: "/ops/index.html" },
    { src: "^/.*$", dest: "/index.html" },
  ],
}, null, 2));
console.log(`preview built in ${out}`);
