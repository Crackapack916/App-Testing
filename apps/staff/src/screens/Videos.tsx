import { useState } from "react";
import { api } from "../api";
import { shortId, useAction, useData } from "../hooks";
import { uploadPackVideo, uploadSessionMaster, VIDEO_ACCEPT, type Kind } from "../upload";
import type { TonightData } from "../App";

type Row = { position: number; order_id: string; pack_index: number; order_packs: number; set_code: string; set_name: string; customer: string;
  order_status: string; pack_id: string | null; approved_at: string | null; cards: number; video_status: string; size_bytes: number | null;
  duration_ms: number | null; sha256: string | null; recorded_at: string | null; uploaded_at: string | null; uploaded_by: string | null; out_of_order: boolean };
type Overview = { packs: Row[]; session_master: { size_bytes: number; sha256: string; uploaded_at: string } | null; ready_to_approve: boolean; videos_kind: Kind | null };

const mb = (n: number | null) => (n == null ? "" : `${(n / 1024 / 1024).toFixed(1)} MB`);
const mins = (ms: number | null) => (ms == null ? "" : `${Math.floor(ms / 60000)}:${String(Math.round((ms % 60000) / 1000)).padStart(2, "0")}`);

/**
 * Videos and approval (item 11): one video per opened pack, uploaded from the queue view,
 * then "Approve and notify customers" once every pack has a ready video and approved cards.
 */
export function Videos({ batch }: { batch: TonightData["batch"] }) {
  const data = useData<Overview>(batch ? `/staff/batches/${batch.id}/overview` : null, 8000);
  const [missingOnly, setMissingOnly] = useState(false);
  const [preview, setPreview] = useState<Row | null>(null);
  const { busy, error, run } = useAction();
  const [notified, setNotified] = useState<number | null>(null);
  if (!batch) return <p className="muted">No night in progress.</p>;
  const o = data.data;
  const rows = (o?.packs ?? []).filter((r) => !missingOnly || r.video_status === "missing" || !r.approved_at);
  const outOfOrder = o?.packs.filter((r) => r.out_of_order) ?? [];
  const ready = o?.packs.filter((r) => ["ready", "approved"].includes(r.video_status)).length ?? 0;
  const logged = o?.packs.filter((r) => r.approved_at).length ?? 0;
  const approve = () => run(async () => {
    const r = await api<{ notified: number }>("POST", `/staff/batches/${batch.id}/approve`);
    setNotified(r.notified);
    await data.reload();
  });

  return (
    <div className="stack">
      <section className="panel">
        <div className="stats">
          <div className="stat"><div className="label">Videos ready</div><div className="value" data-testid="videos-ready">{ready} / {o?.packs.length ?? 0}</div></div>
          <div className="stat"><div className="label">Cards approved</div><div className="value">{logged} / {o?.packs.length ?? 0}</div></div>
        </div>
        {o && !o.videos_kind && <div className="banner warn">Video storage isn't set up. Add BLOB_READ_WRITE_TOKEN in Vercel (see docs/SETUP.md).</div>}
        {outOfOrder.length > 0 && (
          <div className="banner warn" data-testid="out-of-order">
            Recorded out of queue order: position {outOfOrder.map((r) => r.position).join(", ")}. Check each file matches its pack before approving.
          </div>
        )}
        <div className="action">
          <p>Customers are emailed and see their packs only after every pack has a ready video and approved cards.</p>
          <button className="primary big" data-testid="approve" disabled={busy || !o?.ready_to_approve} onClick={approve}>Approve and notify customers</button>
          {notified != null && <div className="banner" data-testid="notified">Notified {notified} {notified === 1 ? "order" : "orders"}.</div>}
        </div>
        {error && <div className="banner error">{error}</div>}
      </section>

      <section className="panel">
        <div className="row-between">
          <h2>Queue</h2>
          <label className="check"><input type="checkbox" checked={missingOnly} onChange={(e) => setMissingOnly(e.target.checked)} data-testid="missing-only" /> Only packs missing something</label>
        </div>
        <p className="muted">One file per pack, mp4 or mov. On iPhone set Settings, Camera, Formats to Most Compatible so every browser can play it.</p>
        <table data-testid="overview">
          <thead><tr><th>#</th><th>Order</th><th>Pack</th><th>Set</th><th>Video</th><th>Cards</th><th>Upload</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.position} className={r.out_of_order ? "flag" : undefined} data-testid={`row-${r.position}`}>
                <td className="num">{r.position}</td>
                <td className="mono">{shortId(r.order_id)}</td>
                <td>pack {r.pack_index} of {r.order_packs}</td>
                <td>{r.set_code}</td>
                <td>
                  <span className={`chip v-${r.video_status}`} data-testid={`video-status-${r.position}`}>{r.video_status}</span>
                  {r.size_bytes ? <div className="muted small">{mb(r.size_bytes)} {mins(r.duration_ms)} {r.uploaded_by}</div> : null}
                  {["ready", "approved"].includes(r.video_status) && <button className="link" onClick={() => setPreview(r)} data-testid={`preview-${r.position}`}>Preview</button>}
                </td>
                <td>{r.approved_at ? `${r.cards} approved` : r.pack_id ? "logging" : "not opened"}</td>
                <td>{r.pack_id && r.video_status !== "approved" && o?.videos_kind
                  ? <UploadCell kind={o.videos_kind} row={r} onDone={data.reload} />
                  : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {o?.videos_kind && <SessionMaster kind={o.videos_kind} batchId={batch.id} master={o.session_master} onDone={data.reload} />}
      {preview && <Preview row={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}

function UploadCell({ kind, row, onDone }: { kind: Kind; row: Row; onDone: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [stage, setStage] = useState<{ label: string; pct: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const label = `Video for queue ${row.position}, order ${shortId(row.order_id)}, pack ${row.pack_index} of ${row.order_packs}`;
  const go = async (f: File) => {
    setFile(f); setError(null);
    try {
      await uploadPackVideo(kind, row.pack_id!, f, (l, pct) => setStage({ label: l, pct }));
      setStage(null); setFile(null); onDone();
    } catch (e) {
      setStage(null); setError((e as Error).message);
      api("POST", "/staff/alerts/upload-failed", { position: row.position, message: (e as Error).message }).catch(() => {});
    }
  };
  return (
    <div className="upload">
      {stage ? (
        <div data-testid={`progress-${row.position}`}>
          <div className="muted small">{stage.label} {stage.pct}%</div>
          <div className="progress" role="progressbar" aria-valuenow={stage.pct} aria-valuemin={0} aria-valuemax={100} aria-label={label}><div style={{ width: `${stage.pct}%` }} /></div>
        </div>
      ) : (
        <label className="file">
          <span>{row.video_status === "missing" ? "Upload" : "Replace"}</span>
          <input type="file" accept={VIDEO_ACCEPT} aria-label={label} data-testid={`upload-${row.position}`}
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) go(f); }} />
        </label>
      )}
      {error && (
        <div className="banner error small" data-testid={`upload-error-${row.position}`}>
          {error} {file && <button className="link" onClick={() => go(file)}>Retry</button>}
        </div>
      )}
    </div>
  );
}

function Preview({ row, onClose }: { row: Row; onClose: () => void }) {
  const v = useData<{ url: string; poster: string | null }>(`/staff/packs/${row.pack_id}/video`);
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label={`Preview queue ${row.position}`} onClick={onClose}>
      <div className="panel wide" onClick={(e) => e.stopPropagation()}>
        <div className="row-between">
          <h2>Queue {row.position}: {row.set_name}, pack {row.pack_index} of {row.order_packs}</h2>
          <button className="ghost" onClick={onClose}>Close</button>
        </div>
        {v.data ? <video data-testid="preview-player" src={v.data.url} poster={v.data.poster ?? undefined} controls playsInline style={{ width: "100%", borderRadius: 8, background: "#0A101A" }} /> : <p className="muted">Loading</p>}
        <p className="muted small mono">SHA-256 {row.sha256}</p>
        {v.error && <div className="banner error">{v.error}</div>}
      </div>
    </div>
  );
}

function SessionMaster({ kind, batchId, master, onDone }: { kind: Kind; batchId: string; master: Overview["session_master"]; onDone: () => void }) {
  const [stage, setStage] = useState<{ label: string; pct: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const go = async (f: File) => {
    setError(null);
    try { await uploadSessionMaster(kind, batchId, f, (l, pct) => setStage({ label: l, pct })); setStage(null); onDone(); }
    catch (e) { setStage(null); setError((e as Error).message); }
  };
  return (
    <section className="panel">
      <h2>Session recording (optional)</h2>
      <p className="muted">The whole 7 to 8 PM recording as one private file, for chain of custody. Customers never see it.</p>
      {master ? <p data-testid="master-done">Uploaded {mb(master.size_bytes)}, SHA-256 <span className="mono">{master.sha256.slice(0, 16)}</span></p>
        : stage ? <div className="progress" role="progressbar" aria-valuenow={stage.pct}><div style={{ width: `${stage.pct}%` }} /></div>
        : <label className="file"><span>Upload session recording</span><input type="file" accept={VIDEO_ACCEPT} onChange={(e) => { const f = e.target.files?.[0]; if (f) go(f); }} /></label>}
      {error && <div className="banner error">{error}</div>}
    </section>
  );
}
