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
