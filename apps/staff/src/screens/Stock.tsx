import { useState } from "react";
import { api } from "../api";
import { credits, useAction, useData } from "../hooks";

type Tier = { min_qty: number; per_pack_credits: number };
type Product = {
  id: string; name: string; set_code: string; set_name: string; booster_type: string; active: boolean;
  packs_on_hand: number; packs_reserved: number; sealed_boxes: number; safety_buffer_packs: number; ladder: Tier[] | null;
};
type SetRow = { code: string; name: string; release_date: string | null };

// Packs per sealed box by booster type (business context: $125 play box = 30 packs).
const PACKS_PER_BOX: Record<string, number> = { play: 30, collector: 12 };

/** Sets on sale, their price ladders, and sealed boxes received. */
export function Stock() {
  const products = useData<{ products: Product[] }>("/staff/products");
  const list = products.data?.products ?? [];
  return (
    <div className="stack">
      <NewProduct onCreated={products.reload} />
      {list.map((p) => <ProductCard key={p.id} p={p} reload={products.reload} />)}
      {!list.length && <p className="muted">No products yet. Put a set on sale above.</p>}
    </div>
  );
}

function NewProduct({ onCreated }: { onCreated: () => void }) {
  const [q, setQ] = useState("");
  const [type, setType] = useState("play");
  const sets = useData<{ sets: SetRow[] }>(q.length >= 2 ? `/staff/sets?q=${encodeURIComponent(q)}` : null);
  const { busy, error, run } = useAction();
  const create = (code: string) => run(async () => {
    await api("POST", "/staff/products", { set_code: code, booster_type: type });
    setQ("");
    onCreated();
  });
  return (
    <section className="panel">
      <h2>Put a set on sale</h2>
      <div className="entry">
        <input data-testid="set-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Set name or code (from MTGJSON)" />
        <select value={type} onChange={(e) => setType(e.target.value)}>
          <option value="play">Play booster</option>
          <option value="collector">Collector booster</option>
        </select>
      </div>
      {q.length >= 2 && (
        <ul className="packs">
          {(sets.data?.sets ?? []).map((s) => (
            <li key={s.code} onClick={() => !busy && create(s.code)} data-testid={`set-${s.code}`}>
              <span className="mono">{s.code}</span> {s.name} <span className="right muted">{s.release_date}</span>
            </li>
          ))}
          {sets.data && !sets.data.sets.length && <li className="muted">No matching set. Has the MTGJSON import run?</li>}
        </ul>
      )}
      <p className="muted">New products start off sale with the launch ladder. Receive sealed boxes, then turn it on.</p>
      {error && <div className="banner error">{error}</div>}
    </section>
  );
}

function ProductCard({ p, reload }: { p: Product; reload: () => void }) {
  const [label, setLabel] = useState("");
  const [packs, setPacks] = useState(String(PACKS_PER_BOX[p.booster_type] ?? 30));
  const [ladder, setLadder] = useState<Tier[] | null>(null);
  const { busy, error, run } = useAction();
  const available = Math.max(0, p.packs_on_hand - p.packs_reserved - p.safety_buffer_packs);

  const toggle = () => run(async () => { await api("POST", `/staff/products/${p.id}/active`, { active: !p.active }); reload(); });
  const receive = () => run(async () => {
    await api("POST", "/staff/boxes", { product_id: p.id, label, pack_count: Number(packs) });
    setLabel("");
    reload();
  });
  const saveLadder = () => run(async () => { await api("PUT", `/staff/products/${p.id}/ladder`, { ladder }); setLadder(null); reload(); });

  return (
    <section className="panel" data-testid={`product-${p.set_code}`}>
      <div className="row-between">
        <h2>{p.name} <span className="mono muted">{p.set_code}</span></h2>
        <button className={p.active ? "ghost" : "primary"} disabled={busy} onClick={toggle} data-testid="toggle">
          {p.active ? "Take off sale" : "Put on sale"}
        </button>
      </div>
      <div className="stats">
        <div className="stat"><div className="label">Status</div><div className="value">{p.active ? (available ? "On sale" : "Sold out") : "Off sale"}</div></div>
        <div className="stat"><div className="label">Sellable packs</div><div className="value" data-testid="sellable">{available}</div></div>
        <div className="stat"><div className="label">Owed tonight</div><div className="value">{p.packs_reserved}</div></div>
        <div className="stat"><div className="label">Sealed boxes</div><div className="value">{p.sealed_boxes}</div></div>
      </div>

      <div className="cols">
        <div className="grow">
          <h2>Price ladder</h2>
          <table>
            <thead><tr><th>Packs</th><th className="num">Per pack</th><th className="num">Order</th></tr></thead>
            <tbody>
              {(ladder ?? p.ladder ?? []).map((t, i) => (
                <tr key={t.min_qty}>
                  <td>{t.min_qty}+</td>
                  <td className="num">
                    {ladder
                      ? <input className="small" value={(t.per_pack_credits / 100).toFixed(2)}
                          onChange={(e) => setLadder(ladder.map((x, j) => j === i ? { ...x, per_pack_credits: Math.round(Number(e.target.value) * 100) || 0 } : x))} />
                      : credits(t.per_pack_credits)}
                  </td>
                  <td className="num">{credits(t.per_pack_credits * t.min_qty)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {ladder
            ? <div className="row"><button className="ghost" onClick={() => setLadder(null)}>Cancel</button><button className="primary" disabled={busy} onClick={saveLadder}>Save ladder</button></div>
            : <button className="link" onClick={() => setLadder(p.ladder ?? [])}>Edit prices</button>}
        </div>
        <div className="grow">
          <h2>Receive a sealed box</h2>
          <div className="entry">
            <input data-testid="box-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Box label, e.g. EOE-0412" />
            <input className="small" value={packs} onChange={(e) => setPacks(e.target.value)} aria-label="Packs in box" />
            <button className="primary" disabled={busy || !label.trim() || !Number(packs)} onClick={receive} data-testid="receive">Receive</button>
          </div>
          <p className="muted">Receiving logs the box to the custody chain. It stays sealed until it's opened on camera.</p>
        </div>
      </div>
      {error && <div className="banner error">{error}</div>}
    </section>
  );
}
