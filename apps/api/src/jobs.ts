/**
 * Email jobs, run every 15 minutes with the database jobs (.github/workflows/jobs.yml):
 * drop reminders an hour before a drop (opt in only), and "your break has ended".
 * Each is marked sent right after it goes out, so a rerun never sends twice.
 */
import type pg from "pg";
import type { EmailProvider } from "./email";
import { sendSafely } from "./notify";

export async function runEmailJobs(pool: pg.Pool, email: EmailProvider, appUrl: string) {
  let reminders = 0;
  let breaks = 0;
  const { rows: due } = await pool.query("select * from due_drop_reminders()");
  for (const r of due) {
    await pool.query("select mark_drop_reminder_sent($1, $2)", [r.drop_id, r.user_id]);
    await sendSafely({ email }, { kind: "drop_reminder", to: r.email,
      data: { set_name: r.set_name, starts_at: r.starts_at, unsubscribe_url: `${appUrl}/api/drops/unsubscribe/${r.token}` } });
    reminders++;
  }
  const { rows: ended } = await pool.query("select * from due_break_end_emails()");
  for (const r of ended) {
    await pool.query("select mark_break_end_emailed($1)", [r.user_id]);
    await sendSafely({ email }, { kind: "break_ended", to: r.email, data: { lifted: false } });
    breaks++;
  }
  return { reminders, breaks };
}
