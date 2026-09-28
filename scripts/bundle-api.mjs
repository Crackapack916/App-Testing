/** Bundles the API (Hono app mounted under /api) into one ES module for a Vercel function. */
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export async function bundleApi(outfile) {
  await build({
    stdin: {
      contents: `
        import { Hono } from "hono";
        import { handle } from "@hono/node-server/vercel";
        import { appFromEnv } from "./src/build";
        export default handle(new Hono().route("/api", appFromEnv()));`,
      resolveDir: join(root, "apps/api"),
      loader: "ts",
    },
    bundle: true,
    platform: "node",
    target: "node22",
    format: "esm",
    outfile,
    logLevel: "warning",
    // pg loads pg-native only when asked; CommonJS dependencies need require inside an ES module.
    external: ["pg-native"],
    // Distinct names, so bundled modules that import createRequire themselves don't collide.
    banner: { js: "import { createRequire as __cjs_createRequire } from 'node:module'; const require = __cjs_createRequire(import.meta.url);" },
  });
}
