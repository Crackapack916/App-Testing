import type pg from "pg";
import type { PaymentProcessor } from "@crackapack/payments";
import type { EmailProvider } from "./email";
import type { CardDataProvider } from "@crackapack/catalog";

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
  /** Encrypts birthdates at rest (AES-256-GCM). Sign up is refused without it. */
  dobKey: Buffer | null;
  /** Customer and staff email. */
  email: EmailProvider;
  /** Looks up a printing our table doesn't have yet (very new sets), for pack logging. */
  cardData?: CardDataProvider;
  /** Public site origin for links in emails, e.g. https://crackapack-preview.vercel.app */
  appUrl: string;
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

/** What callers pass to createApp; email, dobKey and appUrl have safe defaults for tests. */
export type ServiceOptions = Omit<Services, "email" | "dobKey" | "appUrl"> & Partial<Pick<Services, "email" | "dobKey" | "appUrl">>;

export type Env = {
  Variables: { db: pg.PoolClient; user: User; services: Services };
};

export type ClipRequest = { orderId: string; streamRef: string | null; sessionStartedAt: Date; startMs: number; endMs: number };
/** ready: the clip can be played now. pending: the service will call /webhooks/<name> when it is. */
export interface ClipService {
  readonly name: string;
  create(req: ClipRequest): Promise<{ status: "ready"; ref: string } | { status: "pending" }>;
}
