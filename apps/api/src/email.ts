/**
 * Customer and staff email. Everything goes through EmailProvider so the Gmail SMTP sender
 * used for the test run can be swapped for a transactional provider later.
 */
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
