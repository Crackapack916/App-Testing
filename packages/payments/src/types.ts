/** What every processor adapter reduces its webhooks to. */
export type PaymentEvent =
  | { kind: "purchase"; eventId: string; type: string; userId: string; credits: number; paymentRef: string }
  | { kind: "refund"; eventId: string; type: string; userId: string; credits: number; refundRef: string }
  | { kind: "ignored"; eventId: string; type: string; reason: string };

export interface CheckoutRequest {
  userId: string;
  bundleKey: string;
  successUrl: string;
  cancelUrl: string;
}

/** Swap processors by adding an adapter; nothing else in the system changes. */
export interface PaymentProcessor {
  readonly name: string;
  createCheckout(req: CheckoutRequest): Promise<{ url: string; ref: string }>;
  /** Verifies the signature and normalizes the event. Throws on a bad signature. */
  parseWebhook(rawBody: string | Buffer, headers: Record<string, string | undefined>): PaymentEvent;
}
