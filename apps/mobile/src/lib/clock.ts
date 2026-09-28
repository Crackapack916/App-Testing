import { useEffect, useState } from "react";

/**
 * Server time for countdowns: the API sends its clock, and we keep the offset, so a phone
 * set to the wrong time still counts down correctly.
 */
export function useServerNow(serverNow: string | undefined, tickMs = 1000) {
  const [skew, setSkew] = useState(0);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { if (serverNow) setSkew(new Date(serverNow).getTime() - Date.now()); }, [serverNow]);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), tickMs); return () => clearInterval(t); }, [tickMs]);
  return now + skew;
}

/** Days, hours, minutes, seconds until `to`. */
export function parts(to: string | Date, now: number) {
  const ms = Math.max(0, new Date(to).getTime() - now);
  return { d: Math.floor(ms / 86_400_000), h: Math.floor((ms % 86_400_000) / 3_600_000), m: Math.floor((ms % 3_600_000) / 60_000),
    s: Math.floor((ms % 60_000) / 1000), done: ms === 0 };
}

/** "2d 4h 12m 9s", dropping leading zero units. */
export function countdownText(to: string | Date, now: number) {
  const p = parts(to, now);
  if (p.done) return "now";
  const out = [];
  if (p.d) out.push(`${p.d}d`);
  if (p.d || p.h) out.push(`${p.h}h`);
  out.push(`${p.m}m`, `${String(p.s).padStart(2, "0")}s`);
  return out.join(" ");
}
