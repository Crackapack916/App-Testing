/** Vercel entry: Vercel detects a default exported Hono app. The staff tool deploys separately. */
import { appFromEnv } from "./build";

export default appFromEnv();
