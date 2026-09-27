import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { appFromEnv } from "./build";

const env = process.env;
const app = appFromEnv(env);

// Serve the built staff tool from the same origin, if present.
if (env.STAFF_DIST) app.use("/ops/*", serveStatic({ root: env.STAFF_DIST, rewriteRequestPath: (p) => p.replace(/^\/ops/, "") }));

const port = Number(env.PORT ?? 8787);
serve({ fetch: app.fetch, port });
console.log(`api listening on :${port}`);
