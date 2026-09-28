/** Thin client for the staff API. Same origin in production, /api proxy in dev. */
const BASE = import.meta.env.VITE_API_BASE ?? (import.meta.env.DEV ? "/api" : "");
// Separate from the customer site's key, so the two never share a session.
const TOKEN_KEY = "crackapack.ops.token";
// Playwright pins the server clock with this in test mode. Ignored by a live database.
const TEST_NOW_KEY = "crackapack.testNow";
// "Jump to cutoff" on a test site: a clock offset, so time keeps moving during the session.
const TEST_OFFSET_KEY = "crackapack.testOffsetMs";

export const testClock = {
  offset: () => Number(localStorage.getItem(TEST_OFFSET_KEY) ?? 0),
  jumpTo: (iso: string) => localStorage.setItem(TEST_OFFSET_KEY, String(Date.parse(iso) - Date.now())),
  reset: () => localStorage.removeItem(TEST_OFFSET_KEY),
};

export class ApiError extends Error {
  constructor(public code: string, message: string) { super(message); }
}

export const token = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (t: string) => localStorage.setItem(TOKEN_KEY, t),
  clear: () => localStorage.removeItem(TOKEN_KEY),
};


export async function api<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  const t = token.get();
  if (t) headers.authorization = `Bearer ${t}`;
  const now = localStorage.getItem(TEST_NOW_KEY) ?? (testClock.offset() ? new Date(Date.now() + testClock.offset()).toISOString() : null);
  if (now) headers["x-test-now"] = now;
  const res = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error ?? "error", data.message ?? res.statusText);
  return data as T;
}
