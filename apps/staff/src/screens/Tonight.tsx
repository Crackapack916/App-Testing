import { useState } from "react";
import { api, testClock } from "../api";
import { shortId, useAction } from "../hooks";
import type { TonightData } from "../App";

/** Pre session: the queue for tonight, sealed stock, and the lock. */
export function Tonight({ data, reload, goSession }: { data: TonightData | null; reload: () => void; goSession: () => void }) {
  const [streamRef, setStreamRef] = useState("");
  const { busy, error, run } = useAction();
  if (!data) return <p className="muted">Loading…</p>;
  const { batch, queue, stock, upcoming } = data;

  // Test sites only: move the staff clock just past the cutoff to run a night at any hour.
  const jump = () => { testClock.jumpTo(new Date(Date.parse(upcoming.cutoff_at) + 60_000).toISOString()); reload(); };
  const realTime = () => { testClock.reset(); reload(); };

  const lock = () => run(async () => { await api("POST", `/staff/batches/${batch!.id}/lock`); reload(); });
  const start = () => run(async () => {
    await api("POST", `/staff/batches/${batch!.id}/sessions`, { stream_ref: streamRef || null });
    reload();
    goSession();
  });

  const orders = new Set(queue.map((q) => q.order_id)).size;
  const short = stock.filter((s) => s.packs_on_hand - s.packs_reserved < s.safety_buffer_packs);

  return (
    <div className="stack">
      {!batch && (
        <section className="panel">
          <h2>Nothing to open yet</h2>
          <p className="muted">
            Next cutoff {new Date(upcoming.cutoff_at).toLocaleString()} · {upcoming.packs} packs ordered so far for {upcoming.batch_date}
          </p>
          {data.test_clock && (
            <div className="action">
              <p className="muted">Test mode: run tonight now instead of waiting for the cutoff. Orders close for this night.</p>
              <button className="primary" onClick={jump} data-testid="jump-cutoff">Jump to cutoff</button>
            </div>
          )}
        </section>
      )}

      {data.test_clock && testClock.offset() !== 0 && (
        <p className="muted">
          Test clock: {new Date(data.now).toLocaleString()} <button className="link" onClick={realTime}>back to real time</button>
        </p>
      )}

      {batch && (
        <section className="panel">
          <div className="stats">
            <Stat label="Packs owed" value={queue.length} />
            <Stat label="Orders" value={orders} />
            <Stat label="Cutoff" value={new Date(batch.cutoff_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} />
            <Stat label="Status" value={batch.status.replace("_", " ")} />
          </div>

          {batch.status === "open" && (
            <div className="action">
              <p>The cutoff has passed. Locking fixes every position before any pack is touched.</p>
              <button className="primary big" disabled={busy} onClick={lock} data-testid="lock">Lock tonight's queue</button>
            </div>
          )}
          {batch.status === "locked" && (
            <div className="action">
              <p>Queue locked. Manifest <code data-testid="manifest">{batch.manifest_hash}</code></p>
              <label>Stream or recording URL
                <input value={streamRef} onChange={(e) => setStreamRef(e.target.value)} placeholder="https://… (from OBS / Mux)" />
              </label>
              <button className="primary big" disabled={busy} onClick={start} data-testid="start">Start filmed session</button>
            </div>
          )}
          {batch.status === "in_session" && (
            <div className="action"><button className="primary big" onClick={goSession}>Go to session</button></div>
          )}
          {error && <div className="banner error">{error}</div>}
        </section>
      )}

      {short.length > 0 && (
        <div className="banner warn">Low sealed stock: {short.map((s) => s.name).join(", ")}. Receive another box before the session.</div>
      )}

      <div className="cols">
        <section className="panel grow">
          <h2>Queue {batch?.status === "open" ? "(provisional until locked)" : ""}</h2>
          <table data-testid="queue">
            <thead><tr><th>#</th><th>Customer</th><th>Order</th><th>Product</th><th>Status</th></tr></thead>
            <tbody>
              {queue.map((q) => (
                <tr key={q.id} className={q.status}>
                  <td className="num">{q.position ?? "·"}</td>
                  <td>{q.customer}</td>
                  <td className="mono">{shortId(q.order_id)} {q.quantity > 1 && <span className="muted">{q.pack_index}/{q.quantity}</span>}</td>
                  <td>{q.product}</td>
                  <td>{q.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <section className="panel">
          <h2>Sealed stock</h2>
          <table>
            <thead><tr><th>Product</th><th>On hand</th><th>Owed</th><th>Boxes</th></tr></thead>
            <tbody>
              {stock.map((s) => (
                <tr key={s.product_id}>
                  <td>{s.name}</td><td className="num">{s.packs_on_hand}</td><td className="num">{s.packs_reserved}</td><td className="num">{s.sealed_boxes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return <div className="stat"><div className="label">{label}</div><div className="value">{value}</div></div>;
}
