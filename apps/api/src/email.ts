/**
 * Customer and staff email. Everything goes through EmailProvider so the Gmail SMTP sender
 * used for the test run can be swapped for a transactional provider later.
 */
import nodemailer from "nodemailer";
import { renderEmail, SUPPORT_EMAIL } from "./email-templates";

export type EmailKind =
  | "order_confirmation" | "pack_cracked" | "shipping_confirmation" | "sellback_receipt"
  | "limit_changed" | "break_started" | "break_ended" | "drop_reminder" | "password_reset" | "staff_alert";

export type EmailMessage = { kind: EmailKind; to: string; data: Record<string, unknown> };

export interface EmailProvider {
  readonly name: string;
  send(message: EmailMessage): Promise<void>;
}

/** Prints instead of sending (local runs and tests). */
export function logEmail(sink?: EmailMessage[]): EmailProvider {
  return {
    name: "log",
    async send(m) {
      if (sink) sink.push(m);
      else console.log(`[email] ${m.kind} to ${m.to}`);
    },
  };
}

/**
 * Gmail SMTP with an app password (the test run). GMAIL_USER and GMAIL_APP_PASSWORD are set
 * in the hosting environment by Tyson; never in code. Gmail allows about 500 recipients a
 * day from a personal account, which covers the test. Swap for Resend, Postmark or SES once
 * the business has its own domain.
 */
export function gmailEmail(opts: { user: string; appPassword: string; appUrl: string; mailingAddress?: string | null }): EmailProvider {
  const transport = nodemailer.createTransport({ service: "gmail", auth: { user: opts.user, pass: opts.appPassword } });
  return {
    name: "gmail",
    async send(m) {
      const r = renderEmail(m, { appUrl: opts.appUrl, mailingAddress: opts.mailingAddress });
      const unsubscribe = m.kind === "drop_reminder" ? String(m.data.unsubscribe_url) : null;
      await transport.sendMail({
        from: `CrackAPack <${opts.user}>`, replyTo: SUPPORT_EMAIL, to: m.to, subject: r.subject, text: r.text, html: r.html,
        ...(unsubscribe ? { list: { unsubscribe: { url: unsubscribe, comment: "Unsubscribe" } } } : {}),
      });
    },
  };
}
