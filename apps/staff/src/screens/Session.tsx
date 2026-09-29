import { RecDot } from "../icons";
import { useEffect, useState } from "react";
import { api } from "../api";
import { shortId, useAction, useData, useHotkeys } from "../hooks";
import type { TonightData } from "../App";

type SessionData = {
  session: { id: string; batch_date: string; manifest_hash: string; offset_ms: string; opened: number; total: number; ended_at: string | null; duration_ms: string | null };
  next: null | {
    position: number; pack_index: number; quantity: number; order_id: string; product_id: string; product: string; customer: string;
    open_box: null | { id: string; label: string; packs_opened: number; pack_count: number };
    sealed_boxes: { id: string; label: string; pack_count: number }[];
  };
  recent: { id: string; status: string; void_reason: string | null; stream_offset_ms: number; position: number | null; order_id: string | null; box: string; pack_number_in_box: number }[];
};

/**
 * The on camera screen. One key does the next thing:
 *   Space  open the next pack (paired by the server, never chosen here)
 *   B      open the next sealed box on camera when the product has no open box
 *   V      replace a damaged pack (set it aside on camera; the next sealed pack takes its place)
 */
export function Session({ batch, reload }: { batch: TonightData["batch"]; reload: () => void }) {
  const sessionId = batch?.session_id ?? null;
  const s = useData<SessionData>(sessionId ? `/staff/sessions/${sessionId}` : null);
  const { busy, error, run } = useAction();
  const [voiding, setVoiding] = useState(false);
  const [reason, setReason] = useState("");
  const ended = !!s.data?.session.ended_at;
  const elapsed = useElapsed(s.data?.session.offset_ms, ended ? s.data?.session.duration_ms ?? 0 : undefined);

  const next = s.data?.next ?? null;
  const needsBox = !!next && !next.open_box;

  const openPack = () => !busy && next && !needsBox && run(async () => { await api("POST", `/staff/sessions/${sessionId}/next`); await s.reload(); });
  const openBox = () => !busy && next && needsBox && next.sealed_boxes[0] &&
    run(async () => { await api("POST", `/staff/sessions/${sessionId}/boxes/${next.sealed_boxes[0].id}/open`); await s.reload(); });
  const voidPack = () => run(async () => {
    await api("POST", `/staff/sessions/${sessionId}/void`, { product_id: next!.product_id, reason });
    setVoiding(false); setReason(""); await s.reload();
  });
  const complete = () => run(async () => { await api("POST", `/staff/sessions/${sessionId}/complete`); await s.reload(); reload(); });

  useHotkeys({ space: () => openPack(), b: () => openBox(), v: () => next?.open_box && setVoiding(true) }, !voiding);

  if (!sessionId) return <p className="muted">No session running. Lock the queue and start the session from Tonight.</p>;
  if (!s.data) return <p className="muted">Loading…</p>;
  const { session, recent } = s.data;

  return (
    <div className="session">
      <div className="session-bar">
        {ended
          ? <span className="ended" data-testid="session-ended">Session ended {new Date(session.ended_at!).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} · {elapsed} recorded</span>
          : <span className="rec"><RecDot /> REC {elapsed}</span>}
        <span>{session.opened} / {session.total} packs</span>
        <div className="progress"><div style={{ width: `${(100 * session.opened) / Math.max(1, session.total)}%` }} /></div>
        <span className="mono muted" title="Queue manifest hash">#{session.manifest_hash.slice(0, 12)}</span>
      </div>

      {next ? (
        <section className="next" data-testid="next">
          <div className="pos">#{next.position}</div>
          <div className="who">
            <div className="product">{next.product}</div>
            <div className="customer">{next.customer} · order {shortId(next.order_id)} · pack {next.pack_index} of {next.quantity}</div>
            <div className="box">
              {next.open_box
                ? <>Box {next.open_box.label} · pack {next.open_box.packs_opened + 1} of {next.open_box.pack_count}</>
                : next.sealed_boxes[0]
                  ? <>Show the seal on camera, then open box <b>{next.sealed_boxes[0].label}</b></>
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
        <section className="next done">
          <div className="who">
            <div className="product">{ended ? "Session ended" : "Queue complete"}</div>
            <div className="customer">{ended
              ? "Every pack was opened. Finish on Log cards (L) and Videos (N), then approve and notify customers."
              : "Every pack tonight has been opened. End the session to stop the recording."}</div>
          </div>
          {!session.ended_at && <button className="primary huge" disabled={busy} onClick={complete} data-testid="complete">End session</button>}
        </section>
      )}

      {voiding && (
        <div className="modal">
          <div className="panel">
            <h2>Replace a damaged pack from {next?.open_box?.label}</h2>
            <p className="muted">Hold the damaged pack up to the camera and set it aside. The next sealed pack takes its place in the queue. The reason is logged.</p>
            <p className="muted">The pack is consumed on camera. Position #{next?.position} gets the following pack.</p>
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
                <td className="mono">{fmt(r.stream_offset_ms)}</td>
                <td className="num">{r.position ?? "void"}</td>
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

function fmt(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Recording clock, anchored to the server's offset so it matches clip marks. */
function useElapsed(serverOffsetMs?: string, fixedMs?: string | number) {
  const [base, setBase] = useState({ ms: 0, at: Date.now() });
  const [, tick] = useState(0);
  useEffect(() => { if (serverOffsetMs) setBase({ ms: Number(serverOffsetMs), at: Date.now() }); }, [serverOffsetMs]);
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 1000); return () => clearInterval(t); }, []);
  if (fixedMs != null) return fmt(Number(fixedMs));
  return fmt(base.ms + Date.now() - base.at);
}
