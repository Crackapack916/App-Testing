import type pg from "pg";
import type { PushService } from "./context";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

/**
 * Sends through Expo's push service to every device the customer registered.
 * Tokens Expo reports as DeviceNotRegistered are removed.
 */
export function expoPush(pool: pg.Pool, fetchImpl: typeof fetch = fetch, accessToken?: string): PushService {
  return {
    async send(userId, title, body, data) {
      const { rows } = await pool.query<{ token: string }>("select token from push_tokens where user_id = $1", [userId]);
      if (!rows.length) return;
      const messages = rows.map((r) => ({ to: r.token, title, body, data, sound: "default", priority: "high" }));
      const res = await fetchImpl(EXPO_PUSH_URL, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json",
          ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}) },
        body: JSON.stringify(messages),
      });
      if (!res.ok) throw new Error(`expo_push_failed ${res.status}`);
      const out = (await res.json()) as { data?: { status: string; details?: { error?: string } }[] };
      for (const [i, ticket] of (out.data ?? []).entries()) {
        if (ticket.status === "error" && ticket.details?.error === "DeviceNotRegistered") {
          await pool.query("select remove_push_token($1)", [rows[i].token]);
        }
      }
    },
  };
}
