import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { credits, shortId, useAction, useData } from "../hooks";
import type { TonightData } from "../App";

type Pack = { id: string; position: number; order_id: string; set_code: string; product: string; contents_finalized_at: string | null; logged: number };
type Logged = { slot: number; card_id: string; finish: string; name: string; collector_number: string; rarity: string; market_cents: number | null };
type Card = { id: string; name: string; set_code: string; collector_number: string; rarity: string };

const FINISH_SUFFIX: Record<string, string> = { f: "foil", e: "etched" };

/**
 * Second staffer's screen. The pack's set is known, so logging is typing collector
 * numbers: "123" + Enter logs slot by slot; "123f" logs a foil, "123e" an etched foil.
 * Ctrl+Enter finalizes the pack and moves on.
 */
export function LogCards({ batch }: { batch: TonightData["batch"] }) {
  const packs = useData<{ packs: Pack[] }>(batch ? `/staff/batches/${batch.id}/packs` : null, 5000);
  const [selected, setSelected] = useState<string | null>(null);
  const list = packs.data?.packs ?? [];
  const current = list.find((p) => p.id === selected) ?? list.find((p) => !p.contents_finalized_at) ?? null;

  if (!batch) return <p className="muted">No night in progress.</p>;
  return (
    <div className="cols">
      <section className="panel narrow">
        <h2>Opened packs</h2>
        <ul className="packs" data-testid="packs">
          {list.map((p) => (
            <li key={p.id} className={`${p.id === current?.id ? "on" : ""} ${p.contents_finalized_at ? "final" : ""}`} onClick={() => setSelected(p.id)}>
              <span className="num">#{p.position}</span> {p.set_code} <span className="mono muted">{shortId(p.order_id)}</span>
              <span className="right">{p.contents_finalized_at ? "✓" : `${p.logged}`}</span>
            </li>
          ))}
          {!list.length && <li className="muted">Packs appear here as they're opened.</li>}
        </ul>
      </section>
      {current
        ? <PackEditor key={current.id} pack={current} onFinalized={async () => { await packs.reload(); setSelected(null); }} onChange={packs.reload} />
        : <section className="panel grow"><p className="muted">All opened packs are logged.</p></section>}
    </div>
  );
}

function PackEditor({ pack, onFinalized, onChange }: { pack: Pack; onFinalized: () => Promise<void>; onChange: () => void }) {
  const cards = useData<{ cards: Logged[] }>(`/staff/packs/${pack.id}`);
  const [entry, setEntry] = useState("");
  const { busy, error, run, setError } = useAction();
  const input = useRef<HTMLInputElement>(null);
  const logged = cards.data?.cards ?? [];
  const nextSlot = (logged.at(-1)?.slot ?? 0) + 1;
  const final = !!pack.contents_finalized_at;
  const total = logged.reduce((s, c) => s + (c.market_cents ?? 0), 0);

  // Keystrokes are only accepted once this pack's slots are loaded, so the next slot is known.
  const ready = !!cards.data && !busy;
  useEffect(() => { if (ready) input.current?.focus(); }, [pack.id, ready]);

  const add = () => run(async () => {
    // A trailing f or e is the finish; other letters stay part of the number (e.g. 123a).
    const m = /^\s*([0-9]+[a-dg-z]?)([fe])?\s*$/i.exec(entry);
    if (!m) { setError("Type a collector number, like 123 or 123f for foil."); return; }
    const finish = m[2] ? FINISH_SUFFIX[m[2].toLowerCase()] : "nonfoil";
    const { cards: found } = await api<{ cards: Card[] }>("GET", `/staff/cards?set=${pack.set_code}&num=${encodeURIComponent(m[1])}`);
    if (!found.length) { setError(`No ${pack.set_code} #${m[1]}.`); return; }
    await api("PUT", `/staff/packs/${pack.id}/cards/${nextSlot}`, { card_id: found[0].id, finish });
    setEntry("");
    await cards.reload();
    onChange();
  });
  const remove = (slot: number) => run(async () => { await api("DELETE", `/staff/packs/${pack.id}/cards/${slot}`); await cards.reload(); onChange(); });
  // Stays busy until the list has moved on, so nothing typed lands on the finalized pack.
  const finalize = () => run(async () => { await api("POST", `/staff/packs/${pack.id}/finalize`); await onFinalized(); });

  return (
    <section className="panel grow">
      <h2>Pack #{pack.position} · {pack.product} <span className="mono muted">order {shortId(pack.order_id)}</span></h2>
      {!final && (
        <div className="entry">
          <span className="set">{pack.set_code}</span>
          <input ref={input} data-testid="collector" value={entry} disabled={!ready} placeholder={`slot ${nextSlot}: collector #`}
            onChange={(e) => setEntry(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); finalize(); }
              else if (e.key === "Enter" && entry.trim()) { e.preventDefault(); add(); }
            }} />
          <button className="primary" disabled={busy || !logged.length} onClick={finalize} data-testid="finalize">Finalize <kbd>Ctrl+Enter</kbd></button>
        </div>
      )}
      {error && <div className="banner error">{error}</div>}
      <table data-testid="contents">
        <thead><tr><th>Slot</th><th>#</th><th>Card</th><th>Finish</th><th>Market</th><th></th></tr></thead>
        <tbody>
          {logged.map((c) => (
            <tr key={c.slot}>
              <td className="num">{c.slot}</td>
              <td className="mono">{c.collector_number}</td>
              <td><span className={`rarity ${c.rarity}`} />{c.name}</td>
              <td className={c.finish !== "nonfoil" ? "foil" : ""}>{c.finish}</td>
              <td className="num">{c.market_cents == null ? "·" : credits(c.market_cents)}</td>
              <td>{!final && <button className="link" onClick={() => remove(c.slot)}>remove</button>}</td>
            </tr>
          ))}
        </tbody>
        <tfoot><tr><td colSpan={4}>{logged.length} cards</td><td className="num">{credits(total)}</td><td /></tr></tfoot>
      </table>
    </section>
  );
}
