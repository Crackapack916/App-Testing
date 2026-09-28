/**
 * Every scheduled job: the database jobs (lock queues, release held buybacks), then the
 * email jobs. Run by .github/workflows/jobs.yml every 15 minutes.
 */
import pg from "pg";
import { runJobs } from "../../../packages/db/scripts/jobs";
import { runEmailJobs } from "../src/jobs";
import { gmailEmail, logEmail } from "../src/email";

const env = process.env;
if (!env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const appUrl = (env.APP_URL ?? "https://crackapack-preview.vercel.app").replace(/\/$/, "");
const email = env.GMAIL_APP_PASSWORD
  ? gmailEmail({ user: env.GMAIL_USER ?? "crackapack.business@gmail.com", appPassword: env.GMAIL_APP_PASSWORD, appUrl, mailingAddress: env.MAILING_ADDRESS })
  : logEmail();
const pool = new pg.Pool({ connectionString: env.DATABASE_URL, max: 1 });
try {
  console.log(JSON.stringify({ ...(await runJobs(pool)), ...(await runEmailJobs(pool, email, appUrl)) }));
} finally {
  await pool.end();
}
