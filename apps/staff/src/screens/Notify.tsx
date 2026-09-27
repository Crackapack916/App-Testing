import { api } from "../api";
import { shortId, useAction, useData } from "../hooks";
import type { TonightData } from "../App";

type Order = { id: string; quantity: number; status: string; customer: string; clip_status: string | null; clip_ref: string | null; packs_logged: number };

/** Last step of the night: send "You just cracked a pack" to every order that is ready. */
export function Notify({ batch }: { batch: TonightData["batch"] }) {
  const orders = useData<{ orders: Order[] }>(batch ? `/staff/batches/${batch.id}/orders` : null, 5000);
  const { busy, error, run } = useAction();
  if (!batch) return <p className="muted">No night in progress.</p>;
  const list = orders.data?.orders ?? [];
  const ready = list.filter(isReady);
  const sent = list.filter((o) => o.status === "fulfilled").length;

  const notify = () => run(async () => { await api("POST", `/staff/batches/${batch.id}/notify`); await orders.reload(); });

  return (
    <div className="stack">
      <section className="panel">
        <div className="stats">
          <div className="stat"><div className="label">Ready</div><div className="value" data-testid="ready">{ready.length}</div></div>
          <div className="stat"><div className="label">Notified</div><div className="value">{sent} / {list.length}</div></div>
        </div>
        <div className="action">
          <p>An order is ready once its clip is published and every pack in it is logged.</p>
          <button className="primary big" disabled={busy || !ready.length} onClick={notify} data-testid="notify">
            Notify {ready.length} {ready.length === 1 ? "customer" : "customers"}
          </button>
        </div>
        {error && <div className="banner error">{error}</div>}
      </section>
      <section className="panel">
        <table data-testid="orders">
          <thead><tr><th>Order</th><th>Customer</th><th>Packs</th><th>Logged</th><th>Clip</th><th>Status</th></tr></thead>
          <tbody>
            {list.map((o) => (
              <tr key={o.id} className={o.status}>
                <td className="mono">{shortId(o.id)}</td>
                <td>{o.customer}</td>
                <td className="num">{o.quantity}</td>
                <td className="num">{o.packs_logged} / {o.quantity}</td>
                <td>{o.clip_status ?? "waiting"}</td>
                <td>{o.status === "fulfilled" ? "notified" : isReady(o) ? "ready" : "pending"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

const isReady = (o: Order) => o.status === "queued" && o.clip_status === "ready" && o.packs_logged === o.quantity;
