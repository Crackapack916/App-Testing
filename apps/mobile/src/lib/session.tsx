import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api, setTokenProvider } from "./api";
import { storage } from "./storage";

export type Me = { id: string; display_name: string | null; email: string; role: string; age_verified: boolean;
  credits: { total: number; refundable: number; earned: number }; features: { buyback: boolean }; unseen_cracked: number };
export type Dob = { month: string; day: string; year: string };
type Session = {
  ready: boolean;
  me: Me | null;
  logIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, dob: Dob) => Promise<void>;
  /** Signs in with a token from a password reset. */
  useToken: (token: string) => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
};

const Ctx = createContext<Session>(null as unknown as Session);
export const useSession = () => useContext(Ctx);

// The staff tool keeps its own key, so signing in on one never signs you in on the other.
const KEY = "crackapack.customer.token";

export function SessionProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [ready, setReady] = useState(false);

  const refresh = useCallback(async () => {
    try { setMe(await api<Me>("GET", "/me")); }
    catch (e) {
      // An expired or revoked token signs you out; a network blip keeps the session.
      if ((e as { status?: number }).status === 401) { await storage.remove(KEY); setMe(null); }
    }
  }, []);

  useEffect(() => {
    setTokenProvider(() => storage.get(KEY));
    (async () => { if (await storage.get(KEY)) await refresh(); setReady(true); })();
  }, [refresh]);

  const useToken = useCallback(async (token: string) => { await storage.set(KEY, token); await refresh(); }, [refresh]);
  const logIn = useCallback(async (email: string, password: string) => {
    const r = await api<{ token: string }>("POST", "/auth/login", { email, password });
    await useToken(r.token);
  }, [useToken]);
  const signUp = useCallback(async (email: string, password: string, dob: Dob) => {
    const r = await api<{ token: string }>("POST", "/auth/signup", { email, password, dob, accept_terms: true });
    await useToken(r.token);
  }, [useToken]);
  const signOut = useCallback(async () => { await storage.remove(KEY); setMe(null); }, []);

  return <Ctx.Provider value={{ ready, me, logIn, signUp, useToken, signOut, refresh }}>{children}</Ctx.Provider>;
}
