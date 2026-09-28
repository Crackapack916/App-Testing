import { Platform } from "react-native";

export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:8787";

export class ApiError extends Error {
  constructor(public code: string, message: string, public status: number) { super(message); }
}

// The session token, read fresh per request.
let getToken: () => Promise<string | null> = async () => null;
export const setTokenProvider = (fn: () => Promise<string | null>) => { getToken = fn; };

/** JSON API call. Errors carry the server's customer readable message. */
export async function api<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  const token = await getToken();
  if (token) headers.authorization = `Bearer ${token}`;
  // End to end tests pin the server clock (honored only by a test mode database).
  if (Platform.OS === "web") {
    const now = globalThis.localStorage?.getItem("crackapack.testNow");
    if (now) headers["x-test-now"] = now;
  }
  let res: Response;
  try {
    res = await fetch(API_URL + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError("offline", "Can't reach CrackAPack. Check your connection.", 0);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error ?? "error", data.message ?? "Something went wrong.", res.status);
  return data as T;
}
