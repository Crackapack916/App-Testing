import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api, setApiToken } from "./api";
import { storage } from "./storage";

export type Me = { id: string; display_name: string | null; role: string; age_verified: boolean; state: string | null; credits: { total: number; refundable: number; earned: number } };
type Session = {
  ready: boolean;
  me: Me | null;
  signIn: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
};

const Ctx = createContext<Session>(null as unknown as Session);
const KEY = "crackapack.token";

export function SessionProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [me, setMe] = useState<Me | null>(null);

  const refresh = useCallback(async () => {
    try { setMe(await api<Me>("GET", "/me")); } catch { setMe(null); }
  }, []);

  useEffect(() => {
    (async () => {
      const t = await storage.get(KEY);
      if (t) { setApiToken(t); await refresh(); }
      setReady(true);
    })();
  }, [refresh]);

  // Pilot sign in (test mode only). Replace with real auth before launch.
  const signIn = useCallback(async (email: string) => {
    const r = await api<{ token: string }>("POST", "/dev/login", { email, display_name: email.split("@")[0] });
    await storage.set(KEY, r.token);
    setApiToken(r.token);
    await refresh();
  }, [refresh]);

  const signOut = useCallback(async () => {
    await storage.remove(KEY);
    setApiToken(null);
    setMe(null);
  }, []);

  return <Ctx.Provider value={{ ready, me, signIn, signOut, refresh }}>{children}</Ctx.Provider>;
}

export const useSession = () => useContext(Ctx);
