import { useState } from "react";
import { api } from "../api";
import { useAction, useData } from "../hooks";

type Req = { id: string; user_id: string; email: string; break_until: string; requested_at: string };

const pt = (t: string) => new Date(t).toLocaleString("en-US", { timeZone: "America/Los_Angeles", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** Customers asking to end a break early. Lifting needs a reason, which is logged. */
export function BreakRequests() {
  const reqs = useData<{ requests: Req[] }>("/staff/break-requests", 30000);
  const [reason, setReason] = useState<Record<string, string>>({});
  const { busy, error, run } = useAction();
  const list = reqs.data?.requests ?? [];
  if (!list.length) return null;
  const lift = (r: Req) => run(async () => {
    await api("POST", `/staff/users/${r.user_id}/lift-break`, { reason: reason[r.id] ?? "" });
    await reqs.reload();
  });
  return (
    <section className="panel" data-testid="break-requests">
      <h2>Break end requests</h2>
      <table>
        <thead><tr><th>Customer</th><th>Break ends</th><th>Asked</th><th>Reason (required)</th><th /></tr></thead>
        <tbody>
          {list.map((r) => (
            <tr key={r.id}>
              <td>{r.email}</td>
              <td>{pt(r.break_until)} PT</td>
              <td>{pt(r.requested_at)} PT</td>
              <td><input aria-label={`Reason for lifting ${r.email}'s break`} value={reason[r.id] ?? ""} onChange={(e) => setReason({ ...reason, [r.id]: e.target.value })} /></td>
              <td><button className="primary" disabled={busy || !(reason[r.id] ?? "").trim()} onClick={() => lift(r)}>Lift break</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      {error && <div className="banner error">{error}</div>}
    </section>
  );
}
