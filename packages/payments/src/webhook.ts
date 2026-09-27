import type pg from "pg";
import type { PaymentProcessor } from "./types";

export type WebhookResult = { status: "applied" | "ignored" | "needs_review" | "duplicate"; detail?: string };

/**
 * Verifies, normalizes and applies one webhook. Safe to replay: the event is recorded
 * once in payment_events, and the credit functions are idempotent on the payment ref.
 * Throws only on a bad signature (respond 400); every other outcome is a 200.
 */
export async function handleWebhook(
  db: pg.Pool,
  processor: PaymentProcessor,
  rawBody: string | Buffer,
  headers: Record<string, string | undefined>,
): Promise<WebhookResult> {
  const ev = processor.parseWebhook(rawBody, headers);
  const client = await db.connect();
  try {
    await client.query("begin");
    const seen = await client.query("select 1 from payment_events where processor = $1 and event_id = $2", [processor.name, ev.eventId]);
    if (seen.rowCount) {
      await client.query("rollback");
      return { status: "duplicate" };
    }

    let result: WebhookResult;
    let userId: string | null = null, credits: number | null = null, ref: string | null = null;

    if (ev.kind === "purchase") {
      ({ userId, credits } = ev);
      ref = ev.paymentRef;
      const { rows } = await client.query("select record_credit_purchase($1, $2, $3, $4) as ok", [ev.userId, ev.credits, processor.name, ev.paymentRef]);
      result = rows[0].ok ? { status: "applied" } : { status: "ignored", detail: "already_credited" };
    } else if (ev.kind === "refund") {
      ({ userId, credits } = ev);
      ref = ev.refundRef;
      await client.query("savepoint refund");
      try {
        const { rows } = await client.query("select refund_purchased_credits($1, $2, $3, $4) as ok", [ev.userId, ev.credits, processor.name, ev.refundRef]);
        result = rows[0].ok ? { status: "applied" } : { status: "ignored", detail: "already_refunded" };
      } catch (e) {
        // Refunded at the processor after the credit was spent. A person decides what happens next.
        await client.query("rollback to savepoint refund");
        if (!/purchased_non_negative/.test(String(e))) throw e;
        result = { status: "needs_review", detail: "credit_already_spent" };
      }
    } else {
      result = { status: "ignored", detail: ev.reason };
    }

    await client.query(
      `insert into payment_events (processor, event_id, event_type, user_id, credits, payment_ref, status, detail)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [processor.name, ev.eventId, ev.type, userId, credits, ref, result.status, result.detail ?? null],
    );
    await client.query("commit");
    return result;
  } catch (e) {
    await client.query("rollback");
    // The same event delivered twice at once: the other delivery already recorded it.
    if ((e as { code?: string }).code === "23505") return { status: "duplicate" };
    throw e;
  } finally {
    client.release();
  }
}
