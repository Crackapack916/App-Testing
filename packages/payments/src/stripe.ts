import Stripe from "stripe";
import { bundle } from "./bundles";
import type { CheckoutRequest, PaymentEvent, PaymentProcessor } from "./types";

export interface StripeConfig {
  secretKey: string;
  webhookSecret: string;
  /** Refuse events from the other mode, so test events can never credit a live account. */
  livemode: boolean;
}

export class StripeProcessor implements PaymentProcessor {
  readonly name = "stripe";
  private stripe: Stripe;

  constructor(private config: StripeConfig) {
    this.stripe = new Stripe(config.secretKey);
  }

  async createCheckout(req: CheckoutRequest) {
    const b = bundle(req.bundleKey);
    const prices = await this.stripe.prices.list({ lookup_keys: [b.key], active: true, limit: 1 });
    const price = prices.data[0];
    if (!price || price.unit_amount !== b.credits) throw new Error("bundle_price_mismatch");

    const metadata = { user_id: req.userId, credits: String(b.credits), bundle: b.key };
    const session = await this.stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [{ price: price.id, quantity: 1 }],
      client_reference_id: req.userId,
      metadata,
      // Copied onto the charge, so refunds can be traced back to the customer.
      payment_intent_data: { metadata },
      success_url: req.successUrl,
      cancel_url: req.cancelUrl,
    });
    return { url: session.url!, ref: session.id };
  }

  parseWebhook(rawBody: string | Buffer, headers: Record<string, string | undefined>): PaymentEvent {
    const sig = headers["stripe-signature"];
    if (!sig) throw new Error("missing_signature");
    const event = this.stripe.webhooks.constructEvent(rawBody, sig, this.config.webhookSecret);
    const base = { eventId: event.id, type: event.type };

    if (event.livemode !== this.config.livemode) return { kind: "ignored", ...base, reason: "wrong_mode" };

    switch (event.type) {
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded": {
        const s = event.data.object as Stripe.Checkout.Session;
        if (s.payment_status !== "paid") return { kind: "ignored", ...base, reason: "not_paid" };
        const userId = s.metadata?.user_id ?? s.client_reference_id;
        const credits = Number(s.metadata?.credits);
        if (!userId || !Number.isInteger(credits) || credits <= 0) return { kind: "ignored", ...base, reason: "missing_metadata" };
        // Credits must equal what was actually paid.
        if (s.amount_total !== credits || s.currency !== "usd") return { kind: "ignored", ...base, reason: "amount_mismatch" };
        return { kind: "purchase", ...base, userId, credits, paymentRef: s.id };
      }
      case "charge.refunded": {
        const c = event.data.object as Stripe.Charge;
        const prev = (event.data.previous_attributes as Partial<Stripe.Charge> | undefined)?.amount_refunded ?? 0;
        const credits = c.amount_refunded - prev;
        const userId = c.metadata?.user_id;
        if (!userId || credits <= 0) return { kind: "ignored", ...base, reason: "missing_metadata" };
        return { kind: "refund", ...base, userId, credits, refundRef: `${c.id}:${c.amount_refunded}` };
      }
      default:
        return { kind: "ignored", ...base, reason: "unhandled_type" };
    }
  }
}
