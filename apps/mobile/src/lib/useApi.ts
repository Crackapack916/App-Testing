import { useCallback, useEffect, useState } from "react";
import { useFocusEffect } from "expo-router";
import { api } from "./api";

/** GET with loading and error state; refetches whenever the screen regains focus. */
export function useApi<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const load = useCallback(async () => {
    if (!path) return;
    setLoading(true);
    try { setData(await api<T>("GET", path)); setError(null); }
    catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }, [path]);
  useEffect(() => { load(); }, [load]);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  return { data, error, loading, reload: load };
}
