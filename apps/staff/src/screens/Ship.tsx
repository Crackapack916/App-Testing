import { useState } from "react";
import { api } from "../api";
import { credits, shortId, useAction, useData } from "../hooks";

type Item = { line: number; qty: number; finish: string; condition: string; name: string; set_code: string; collector_number: string;
  rarity: string; individual: boolean; bin: string | null };
type Shipment = { id: string; customer: string; address: Record<string, string>; value_cents: number; fee_credits: number;
  created_at: string; items: Item[] };

/** Shipment requests: pick by bin, pack, enter tracking. Stock leaves the vault only when marked shipped. */
export function Ship() {
  const list = useData<{ shipments: Shipment[] }>("/staff/shipments", 15000);
  const shipments = list.data?.shipments ?? [];
  return (
    <div className="stack">
      {!shipments.length && <section className="panel"><p className="muted">No shipments waiting.</p></section>}
      {shipments.map((s) => <ShipmentCard key={s.id} s={s} onShipped={list.reload} />)}
    </div>
  );
}

function ShipmentCard({ s, onShipped }: { s: Shipment; onShipped: () => void }) {
  const [tracking, setTracking] = useState("");
  const { busy, error, run } = useAction();
  const a = s.address;
  const ship = () => run(async () => { await api("POST", `/staff/shipments/${s.id}/shipped`, { tracking }); onShipped(); });
  const count = s.items.reduce((n, i) => n + i.qty, 0);
  return (
    <section className="panel" data-testid={`shipment-${shortId(s.id)}`}>
      <div className="row-between">
        <h2>{s.customer} · {count} card{count > 1 ? "s" : ""} <span className="mono muted">{shortId(s.id)}</span></h2>
        <span className="muted">{new Date(s.created_at).toLocaleString()} · value {credits(s.value_cents)} · {s.fee_credits ? `paid ${credits(s.fee_credits)} shipping` : "free shipping"}</span>
      </div>
      <div className="cols">
        <div className="grow">
          <table>
            <thead><tr><th>Bin</th><th>Qty</th><th>Card</th><th>Set</th><th>Finish</th><th>Cond</th></tr></thead>
            <tbody>
              {s.items.map((i) => (
                <tr key={i.line}>
                  <td className="mono">{i.bin ?? <span className="muted">unbinned</span>}</td>
                  <td className="num">{i.qty}</td>
                  <td><span className={`rarity ${i.rarity}`} />{i.name}{i.individual && <span className="muted"> · held card</span>}</td>
                  <td className="mono">{i.set_code} #{i.collector_number}</td>
                  <td className={i.finish !== "nonfoil" ? "foil" : ""}>{i.finish}</td>
                  <td>{i.condition}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="narrow">
          <pre className="address">{[a.name, a.line1, a.line2, `${a.city ?? ""}, ${a.state ?? ""} ${a.zip ?? ""}`].filter(Boolean).join("\n")}</pre>
          <div className="entry">
            <input data-testid="tracking" value={tracking} onChange={(e) => setTracking(e.target.value)} placeholder="Tracking number" />
          </div>
          <button className="primary" disabled={busy || !tracking.trim()} onClick={ship} data-testid="mark-shipped">Mark shipped</button>
          {error && <div className="banner error">{error}</div>}
        </div>
      </div>
    </section>
  );
}
