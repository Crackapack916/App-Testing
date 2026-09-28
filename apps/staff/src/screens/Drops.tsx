import { useState } from "react";
import { api } from "../api";
import { useAction, useData } from "../hooks";

type Drop = { id: string; set_code: string; set_name: string; starts_at: string; ends_at: string | null; packs_allocated: number;
  per_customer_limit: number | null; status: string; state: string | null; sold: number; reminders: number };
type Product = { set_code: string; set_name: string; wizards_info_url: string | null; pack_image_url: string | null };
type Override = { id: number; email: string; set_code: string; max_packs: number; reason: string; actor: string; created_at: string };

const PT = "America/Los_Angeles";
const pacific = (iso: string) => new Date(iso).toLocaleString("en-US", { timeZone: PT, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
/** A datetime-local value (typed as Pacific) to an ISO time. */
function fromPacific(local: string) {
  if (!local) return null;
  const guess = new Date(`${local}:00Z`);
  const offset = new Date(guess.toLocaleString("en-US", { timeZone: PT })).getTime() - new Date(guess.toLocaleString("en-US", { timeZone: "UTC" })).getTime();
  return new Date(guess.getTime() - offset).toISOString();
}
function toPacific(iso: string | null) {
  if (!iso) return "";
  const d = new Date(new Date(iso).toLocaleString("en-US", { timeZone: PT }));
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Drops (item 14), set info for the Packs page (item 9), and per customer set limits (item 5). */
export function Drops() {
  const drops = useData<{ drops: Drop[] }>("/staff/drops");
  const products = useData<{ products: Product[] }>("/staff/products");
  const [editing, setEditing] = useState<Partial<Drop> | null>(null);
  const sets = [...new Map((products.data?.products ?? []).map((p) => [p.set_code, p])).values()];
  return (
    <div className="stack">
      <section className="panel">
        <div className="row-between"><h2>Drops</h2><button className="primary" data-testid="new-drop" onClick={() => setEditing({ status: "draft", packs_allocated: 0 })}>New drop</button></div>
        <p className="muted">A set with a published drop sells only during its window. Times are Pacific. Customers see Upcoming, Live now, Sold out or Ended.</p>
        <table>
          <thead><tr><th>Set</th><th>Starts</th><th>Ends</th><th>Packs</th><th>Limit</th><th>Status</th><th>Reminders</th><th /></tr></thead>
          <tbody>
            {drops.data?.drops.map((d) => (
              <tr key={d.id} data-testid={`drop-${d.set_code}`}>
                <td>{d.set_name}</td><td>{pacific(d.starts_at)}</td><td>{d.ends_at ? pacific(d.ends_at) : "open"}</td>
                <td className="num">{d.sold} / {d.packs_allocated}</td><td className="num">{d.per_customer_limit ?? "default"}</td>
                <td>{d.status}{d.state ? `, ${d.state.replace("_", " ")}` : ""}</td><td className="num">{d.reminders}</td>
                <td><button className="link" onClick={() => setEditing(d)}>Edit</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        {editing && <DropEditor drop={editing} sets={sets} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); drops.reload(); }} />}
      </section>
      <SetInfo sets={sets} reload={products.reload} />
      <SetLimits sets={sets} />
    </div>
  );
}

function DropEditor({ drop, sets, onClose, onSaved }: { drop: Partial<Drop>; sets: Product[]; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ set_code: drop.set_code ?? sets[0]?.set_code ?? "", starts: toPacific(drop.starts_at ?? null), ends: toPacific(drop.ends_at ?? null),
    packs_allocated: String(drop.packs_allocated ?? ""), per_customer_limit: drop.per_customer_limit ? String(drop.per_customer_limit) : "", status: drop.status ?? "draft" });
  const { busy, error, run } = useAction();
  const set = sets.find((s) => s.set_code === f.set_code);
  const starts = fromPacific(f.starts);
  const save = () => run(async () => {
    const body = { set_code: f.set_code, starts_at: starts, ends_at: fromPacific(f.ends), packs_allocated: Number(f.packs_allocated),
      per_customer_limit: f.per_customer_limit ? Number(f.per_customer_limit) : null, status: f.status };
    if (drop.id) await api("PUT", `/staff/drops/${drop.id}`, body); else await api("POST", "/staff/drops", body);
    onSaved();
  });
  return (
    <div className="editor" data-testid="drop-editor">
      <div className="grid2">
        <label>Set<select value={f.set_code} onChange={(e) => setF({ ...f, set_code: e.target.value })} data-testid="drop-set">
          {sets.map((s) => <option key={s.set_code} value={s.set_code}>{s.set_name} ({s.set_code})</option>)}</select></label>
        <label>Status<select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })} data-testid="drop-status">
          <option value="draft">Draft (hidden)</option><option value="published">Published</option><option value="cancelled">Cancelled</option></select></label>
        <label>Starts (Pacific)<input type="datetime-local" value={f.starts} onChange={(e) => setF({ ...f, starts: e.target.value })} data-testid="drop-starts" /></label>
        <label>Ends (Pacific, optional)<input type="datetime-local" value={f.ends} onChange={(e) => setF({ ...f, ends: e.target.value })} data-testid="drop-ends" /></label>
        <label>Packs allocated<input inputMode="numeric" value={f.packs_allocated} onChange={(e) => setF({ ...f, packs_allocated: e.target.value.replace(/\D/g, "") })} data-testid="drop-packs" /></label>
        <label>Per customer limit (blank: the default)<input inputMode="numeric" value={f.per_customer_limit} onChange={(e) => setF({ ...f, per_customer_limit: e.target.value.replace(/\D/g, "") })} /></label>
      </div>
      <div className="drop-preview" data-testid="drop-preview" aria-label="Preview">
        <div className="muted small">Preview</div>
        <b>{set?.set_name ?? "Choose a set"}</b>
        <div>{starts ? `${pacific(starts)} PT` : "Pick a start time"}{f.ends && fromPacific(f.ends) ? ` to ${pacific(fromPacific(f.ends)!)} PT` : ""}</div>
        <div className="muted">This is when the set goes live on CrackAPack.</div>
        <div className="muted small">{f.status === "published" ? "Shown on Drops" : "Not shown to customers"}. {f.packs_allocated || 0} packs, {f.per_customer_limit || "default"} per customer.</div>
      </div>
      <div className="row"><button className="ghost" onClick={onClose}>Cancel</button>
        <button className="primary" disabled={busy || !f.set_code || !starts || !f.packs_allocated} onClick={save} data-testid="save-drop">Save drop</button></div>
      {error && <div className="banner error">{error}</div>}
    </div>
  );
}

function SetInfo({ sets, reload }: { sets: Product[]; reload: () => void }) {
  return (
    <section className="panel">
      <h2>Set info for the Packs page</h2>
      <p className="muted">"What's in a pack" links to Wizards' published page for the product. Pack photo: the official image URL for that pack. Both are placeholders until supplied.</p>
      {sets.map((s) => <SetInfoRow key={s.set_code} s={s} reload={reload} />)}
    </section>
  );
}

function SetInfoRow({ s, reload }: { s: Product; reload: () => void }) {
  const [info, setInfo] = useState(s.wizards_info_url ?? "");
  const [photo, setPhoto] = useState(s.pack_image_url ?? "");
  const { busy, error, run } = useAction();
  return (
    <div className="grid3">
      <b>{s.set_name}</b>
      <label>What's in a pack (Wizards URL)<input value={info} onChange={(e) => setInfo(e.target.value)} placeholder="https://magic.wizards.com/..." /></label>
      <label>Pack photo URL<input value={photo} onChange={(e) => setPhoto(e.target.value)} placeholder="Official pack image" /></label>
      <button disabled={busy} onClick={() => run(async () => { await api("PUT", `/staff/sets/${s.set_code}`, { wizards_info_url: info, pack_image_url: photo }); reload(); })}>Save</button>
      {error && <div className="banner error">{error}</div>}
    </div>
  );
}

function SetLimits({ sets }: { sets: Product[] }) {
  const data = useData<{ overrides: Override[]; default_limit: number }>("/staff/set-limits");
  const [f, setF] = useState({ email: "", set_code: "", max_packs: "", reason: "" });
  const { busy, error, run } = useAction();
  const save = () => run(async () => {
    await api("POST", "/staff/set-limits", { ...f, set_code: f.set_code || sets[0]?.set_code, max_packs: Number(f.max_packs) });
    setF({ email: "", set_code: "", max_packs: "", reason: "" }); await data.reload();
  });
  return (
    <section className="panel">
      <h2>Per set limit overrides</h2>
      <p className="muted">Default: {data.data?.default_limit ?? 6} packs per set per customer for the whole test run. An override needs a reason and is logged.</p>
      <div className="grid4">
        <label>Customer email<input value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></label>
        <label>Set<select value={f.set_code} onChange={(e) => setF({ ...f, set_code: e.target.value })}>{sets.map((s) => <option key={s.set_code} value={s.set_code}>{s.set_code}</option>)}</select></label>
        <label>Max packs<input inputMode="numeric" value={f.max_packs} onChange={(e) => setF({ ...f, max_packs: e.target.value.replace(/\D/g, "") })} /></label>
        <label>Reason<input value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></label>
      </div>
      <div className="row"><button className="primary" disabled={busy || !f.email || !f.max_packs || !f.reason.trim()} onClick={save}>Save override</button></div>
      {error && <div className="banner error">{error}</div>}
      <table>
        <thead><tr><th>When</th><th>Customer</th><th>Set</th><th>Max</th><th>Reason</th><th>By</th></tr></thead>
        <tbody>{data.data?.overrides.map((o) => (
          <tr key={o.id}><td>{pacific(o.created_at)}</td><td>{o.email}</td><td>{o.set_code}</td><td className="num">{o.max_packs}</td><td>{o.reason}</td><td>{o.actor}</td></tr>
        ))}</tbody>
      </table>
    </section>
  );
}
