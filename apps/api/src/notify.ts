import type { EmailMessage } from "./email";
import { SUPPORT_EMAIL } from "./email-templates";
import type { Services } from "./context";

/**
 * Sends an email after the change it reports is already saved. A failed send is logged and
 * never undoes or blocks the change: the site itself shows the same state.
 */
export async function sendSafely(services: Pick<Services, "email">, m: EmailMessage) {
  try { await services.email.send(m); }
  catch (e) { console.error(`email ${m.kind} failed`, (e as Error).message); }
}

/** Staff alerts go to the business inbox (brief item 16). */
export const staffAlert = (services: Pick<Services, "email">, title: string, body: string) =>
  sendSafely(services, { kind: "staff_alert", to: SUPPORT_EMAIL, data: { title, body } });
