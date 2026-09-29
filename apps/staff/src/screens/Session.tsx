import { useState } from "react";
import { api } from "../api";
import { shortId, useAction, useData, useHotkeys } from "../hooks";
import type { TonightData } from "../App";

type OpeningData = {
  batch: { id: string; batch_date: string; status: string; manifest_hash: string | null; opened: number; total: number };
  finished_at: string | null;
  next: null | {
    position: number; pack_index: number; quantity: number; order_id: string; product_id: string; product: string; customer: string;
    open_box: null | { id: string; label: string; packs_opened: number; pack_count: number };
    sealed_boxes: { id: string; label: string; pack_count: number }[];
  };
  recent: { id: string; status: string; void_reason: string | null; position: number | null; order_id: string | null; box: string; pack_number_in_box: number; opened_at: string }[];
};

/**
 * Opening packs for a locked night. Nothing to start or end: the first box or pack starts the
 * night's opening and the last pack finishes it. Record each pack on your phone and upload it
 * on Videos (N) afterwards. One key does the next thing:
 *   Space  open the next pack (paired with the next queue position by the server, never chosen here)
 *   B      open the next sealed box when the product has no open box
 *   V      replace a damaged pack (set it aside; the next sealed pack takes its place)
 */
export function Session({ batch, reload }: { batch: TonightData["batch"]; reload: () => void }) {
  const ready = batch && ["locked", "in_session", "completed"].includes(batch.status);
  // Refreshes every few seconds so a second screen stays on the right next pack.
  const s = useData<OpeningData>(ready ? `/staff/batches/${batch!.id}/opening` : null, 4000);
  const { busy, error, run } = useAction();
  const [voiding, setVoiding] = useState(false);
  const [reason, setReason] = useState("");
  const base = batch ? `/staff/batches/${batch.id}/opening` : "";

  const next = s.data?.next ?? null;
  const needsBox = !!next && !next.open_box;
  const after = async (finished?: boolean) => { await s.reload(); if (finished) reload(); };

  const openPack = () => !busy && next && !needsBox && run(async () => {
    const r = await api<{ finished: boolean }>("POST", `${base}/next`);
    await after(r.finished);
  });
  const openBox = () => !busy && next && needsBox && next.sealed_boxes[0] &&
    run(async () => { await api("POST", `${base}/boxes/${next.sealed_boxes[0].id}/open`); await after(); });
  const voidPack = () => run(async () => {
    await api("POST", `${base}/void`, { product_id: next!.product_id, reason });
    setVoiding(false); setReason(""); await after();
  });

  useHotkeys({ space: () => openPack(), b: () => openBox(), v: () => next?.open_box && setVoiding(true) }, !voiding);

  if (!batch) return <p className="muted">Nothing to open. After the 7:00 PM cutoff, lock the queue on Tonight (T). A night that's finished opening is completed on Log cards (L) and Videos (N).</p>;
  if (batch.status === "open") return <p className="muted">Lock tonight's queue on Tonight (T) first. Nothing can be opened until it's locked.</p>;
  if (!s.data) return <p className="muted">Loading…</p>;
  const { batch: b, recent } = s.data;

  return (
    <div className="session">
      <div className="session-bar">
        <span className="ended">Opening {b.batch_date}</span>
        <span>{b.opened} / {b.total} packs</span>
        <div className="progress"><div style={{ width: `${(100 * b.opened) / Math.max(1, b.total)}%` }} /></div>
        {b.manifest_hash && <span className="mono muted" title="Queue manifest hash">#{b.manifest_hash.slice(0, 12)}</span>}
      </div>

      {next ? (
        <section className="next" data-testid="next">
          <div className="pos">#{next.position}</div>
          <div className="who">
            <div className="product">{next.product}</div>
            <div className="customer">{next.customer} · order {shortId(next.order_id)} · pack {next.pack_index} of {next.quantity}</div>
            <div className="box">
              {next.open_box
                ? <>Box {next.open_box.label} · pack {next.open_box.packs_opened + 1} of {next.open_box.pack_count}. Start recording this pack on your phone, then crack it.</>
                : next.sealed_boxes[0]
                  ? <>Open sealed box <b>{next.sealed_boxes[0].label}</b></>
                  : <span className="warn-text">No sealed box left for this product. Receive stock.</span>}
            </div>
          </div>
          <div className="keys">
            {needsBox
              ? <button className="primary huge" disabled={busy || !next.sealed_boxes[0]} onClick={openBox} data-testid="open-box">Open box <kbd>B</kbd></button>
              : <button className="primary huge" disabled={busy} onClick={openPack} data-testid="open-pack">Crack pack <kbd>Space</kbd></button>}
            <button className="ghost" disabled={!next.open_box} onClick={() => setVoiding(true)}>Replace damaged pack <kbd>V</kbd></button>
          </div>
        </section>
      ) : (
        <section className="next done" data-testid="opening-done">
          <div className="who">
            <div className="product">All packs opened</div>
            <div className="customer">Log each pack's cards on Log cards (L) and upload each pack's video on Videos (N), then approve and notify customers.</div>
          </div>
        </section>
      )}

      {voiding && (
        <div className="modal">
          <div className="panel">
            <h2>Replace a damaged pack from {next?.open_box?.label}</h2>
            <p className="muted">Set the damaged pack aside. The next sealed pack takes its place for position #{next?.position}. The reason is logged.</p>
            <input autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (torn wrapper, crushed…)"
              onKeyDown={(e) => { if (e.key === "Enter" && reason.trim()) voidPack(); if (e.key === "Escape") setVoiding(false); }} />
            <div className="row"><button className="ghost" onClick={() => setVoiding(false)}>Cancel</button>
              <button className="danger" disabled={!reason.trim() || busy} onClick={voidPack}>Set aside and replace</button></div>
          </div>
        </div>
      )}

      {error && <div className="banner error" data-testid="error">{error}</div>}

      <section className="panel">
        <h2>Just opened</h2>
        <table>
          <thead><tr><th>At</th><th>#</th><th>Order</th><th>Box · pack</th><th></th></tr></thead>
          <tbody>
            {recent.map((r) => (
              <tr key={r.id} className={r.status}>
                <td className="mono">{new Date(r.opened_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</td>
                <td className="num">{r.position ?? "set aside"}</td>
                <td className="mono">{r.order_id ? shortId(r.order_id) : ""}</td>
                <td>{r.box} · {r.pack_number_in_box}</td>
                <td className="muted">{r.void_reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
