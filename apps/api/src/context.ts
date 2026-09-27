import type pg from "pg";
import type { PaymentProcessor } from "@crackapack/payments";

export type Role = "customer" | "staff" | "admin";
export type User = { id: string; role: Role; display_name: string | null };

export interface Services {
  pool: pg.Pool;
  jwtSecret: string;
  /** Payment processor for checkout and webhooks. Optional so staff only deployments still run. */
  payments?: PaymentProcessor;
  push: PushService;
  /** Enables POST /dev/login. Refused anyway unless the database is in test mode. */
  devLogin: boolean;
  /** Emails dev login may make staff. Nobody else can ask for a role. */
  devStaffEmails?: string[];
  /**
   * Clerk session tokens, verified locally with the instance's public key (no network call).
   * The Clerk session token must carry an `email` claim: {"email": "{{user.primary_email_address}}"}.
   */
  clerk?: { jwtKey: string; authorizedParties?: string[] };
  /** Produces each order's clip from the session recording. */
  clips: ClipService;
  /** Verifies /webhooks/mux. Set when clips are Mux. */
  muxWebhookSecret?: string;
  /** Honors the X-Test-Now header. The database ignores it anyway in live mode. */
  testClock: boolean;
}

/** Sends "You just cracked a pack". Expo push in production; recorded in tests. */
export interface PushService {
  send(userId: string, title: string, body: string, data: Record<string, string>): Promise<void>;
}

export type Env = {
  Variables: { db: pg.PoolClient; user: User; services: Services };
};

export type ClipRequest = { orderId: string; streamRef: string | null; sessionStartedAt: Date; startMs: number; endMs: number };
/** ready: the clip can be played now. pending: the service will call /webhooks/<name> when it is. */
export interface ClipService {
  readonly name: string;
  create(req: ClipRequest): Promise<{ status: "ready"; ref: string } | { status: "pending" }>;
}
