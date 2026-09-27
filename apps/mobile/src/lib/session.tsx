import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { ClerkProvider, useAuth } from "@clerk/expo";
import { tokenCache } from "@clerk/expo/token-cache";
import { api, setTokenProvider } from "./api";
import { storage } from "./storage";

export type Me = { id: string; display_name: string | null; role: string; age_verified: boolean; state: string | null;
  credits: { total: number; refundable: number; earned: number } };
type Session = {
  ready: boolean;
  me: Me | null;
  /** "clerk" in production; "pilot" when no Clerk key is configured (tests, local). */
  mode: "clerk" | "pilot";
  signIn: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
};

const Ctx = createContext<Session>(null as unknown as Session);
export const useSession = () => useContext(Ctx);
export const CLERK_KEY = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY;

export function SessionProvider({ children }: { children: ReactNode }) {
  if (CLERK_KEY) {
    return (
      <ClerkProvider publishableKey={CLERK_KEY} tokenCache={tokenCache}>
        <ClerkSession>{children}</ClerkSession>
      </ClerkProvider>
    );
  }
  return <PilotSession>{children}</PilotSession>;
}

function useMe() {
  const [me, setMe] = useState<Me | null>(null);
  const refresh = useCallback(async () => {
    try { setMe(await api<Me>("GET", "/me")); } catch { setMe(null); }
  }, []);
  return { me, setMe, refresh };
}

/** Clerk: the API verifies Clerk's session token and links the account on first sign in. */
function ClerkSession({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn, getToken, signOut: clerkSignOut } = useAuth();
  const { me, setMe, refresh } = useMe();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setTokenProvider(() => (isSignedIn ? getToken() : Promise.resolve(null)));
    if (!isLoaded) return;
    (async () => {
      if (isSignedIn) await refresh(); else setMe(null);
      setReady(true);
    })();
  }, [isLoaded, isSignedIn, getToken, refresh, setMe]);

  const signOut = useCallback(async () => { await clerkSignOut(); setMe(null); }, [clerkSignOut, setMe]);
  const signIn = useCallback(async () => { throw new Error("Use the Clerk sign in screen."); }, []);
  return <Ctx.Provider value={{ ready, me, mode: "clerk", signIn, signOut, refresh }}>{children}</Ctx.Provider>;
}

/** Pilot sign in (test mode only). The API refuses it on a live database or in production. */
function PilotSession({ children }: { children: ReactNode }) {
  const KEY = "crackapack.token";
  const { me, setMe, refresh } = useMe();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setTokenProvider(() => storage.get(KEY));
    (async () => { if (await storage.get(KEY)) await refresh(); setReady(true); })();
  }, [refresh]);

  const signIn = useCallback(async (email: string) => {
    const r = await api<{ token: string }>("POST", "/dev/login", { email, display_name: email.split("@")[0] });
    await storage.set(KEY, r.token);
    await refresh();
  }, [refresh]);
  const signOut = useCallback(async () => { await storage.remove(KEY); setMe(null); }, [setMe]);
  return <Ctx.Provider value={{ ready, me, mode: "pilot", signIn, signOut, refresh }}>{children}</Ctx.Provider>;
}
