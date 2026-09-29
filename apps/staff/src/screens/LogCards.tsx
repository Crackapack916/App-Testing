import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { credits, shortId, useAction, useData } from "../hooks";
import type { TonightData } from "../App";

type QueueRow = { position: number; order_id: string; pack_index: number; order_packs: number; set_code: string; product: string;
  slot_count: number | null; pack_id: string | null; approved_at: string | null; cards: number; entries: number };
type Pack = { id: string; position: number; order_id: string; pack_index: number; order_packs: number; set_code: string; product: string;
  slot_count: number | null; approved_at: string | null; count_override_reason: string | null };
type Logged = { slot: number; kind: "card" | "token" | "ad"; card_id: string | null; finish: string | null; name: string | null;
  set_code: string | null; collector_number: string | null; rarity: string | null; market_cents: number | null; image_small: string | null };
type Hist = { created_at: string; slot: number; action: string; kind: string | null; finish: string | null; old_finish: string | null;
  reason: string | null; actor: string | null; card: string | null; num: string | null; old_card: string | null; old_num: string | null };
type Found = { id: string; name: string; set_code: string; collector_number: string; rarity: string; finishes: string[];
  prices: Record<string, number> | null; image_url: string | null };

const FINISHES = ["nonfoil", "foil", "etched"] as const;
const draftKey = (pack: string) => `crackapack.ops.draft.${pack}`;

/**
 * Second staffer's screen. It starts from the locked queue and works one opened pack at a
 * time: collector number, finish, Enter. Only packs opened from the locked queue can be
 * logged; approval locks a pack, and any change after that needs a reason.
 */
export function LogCards({ batch }: { batch: TonightData["batch"] }) {
  const queue = useData<{ queue: QueueRow[] }>(batch ? `/staff/batches/${batch.id}/log-queue` : null, 5000);
  const [selected, setSelected] = useState<string | null>(null);
  const rows = queue.data?.queue ?? [];
  const opened = rows.filter((r) => r.pack_id);
  const currentId = selected ?? opened.find((r) => !r.approved_at)?.pack_id ?? null;

  if (!batch) return <p className="muted">No night in progress.</p>;
  if (batch.status === "open") return <p className="muted">The queue isn't locked yet. Nothing can be logged until it is.</p>;
  return (
    <div className="cols">
      <section className="panel narrow">
        <h2>Locked queue</h2>
        <ul className="packs" data-testid="packs">
          {rows.map((r) => {
            const state = !r.pack_id ? "not opened" : r.approved_at ? "approved" : `${r.cards} logged`;
            return (
              <li key={r.position} className={`${r.pack_id === currentId ? "on" : ""} ${r.approved_at ? "final" : ""} ${r.pack_id ? "" : "disabled"}`}
                onClick={() => r.pack_id && setSelected(r.pack_id)} aria-disabled={!r.pack_id}>
                <span className="num">#{r.position}</span> {r.set_code} <span className="mono muted">{shortId(r.order_id)}</span>
                <span className="right">{state}</span>
              </li>
            );
          })}
          {!rows.length && <li className="muted">The locked queue is empty.</li>}
        </ul>
      </section>
      {currentId
        ? <PackEditor key={currentId} packId={currentId} onChange={queue.reload}
            onApproved={async () => { await queue.reload(); setSelected(null); }} />
        : <section className="panel grow"><p className="muted">{opened.length ? "All opened packs are logged." : "Packs appear here as they're opened on camera."}</p></section>}
    </div>
  );
}

function PackEditor({ packId, onApproved, onChange }: { packId: string; onApproved: () => Promise<void>; onChange: () => void }) {
  const data = useData<{ pack: Pack; cards: Logged[]; history: Hist[] }>(`/staff/packs/${packId}`);
  const pack = data.data?.pack;
  const logged = data.data?.cards ?? [];
  const approved = !!pack?.approved_at;
  const [setCode, setSetCode] = useState("");
  const [num, setNum] = useState(() => localStorage.getItem(draftKey(packId)) ?? "");
  const [finish, setFinish] = useState<string>("nonfoil");
  const [found, setFound] = useState<Found | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [override, setOverride] = useState("");
  const [amend, setAmend] = useState<{ slot: number; reason: string } | null>(null);
  const { busy, error, run } = useAction();
  const numRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (pack && !setCode) setSetCode(pack.set_code); }, [pack, setCode]);
  // Autosave the entry being typed, so a reload or a crash doesn't lose it.
  useEffect(() => { try { num ? localStorage.setItem(draftKey(packId), num) : localStorage.removeItem(draftKey(packId)); } catch {} }, [num, packId]);
  useEffect(() => { if (data.data && !busy) numRef.current?.focus(); }, [packId, !!data.data, busy]);

  // Resolve as the number is typed: image, name and price to confirm the treatment at a glance.
  useEffect(() => {
    const n = num.trim();
    setFound(null); setLookupError(null);
    if (!n || !setCode) return;
    let live = true;
    const t = setTimeout(async () => {
      try {
        const r = await api<{ card: Found }>("GET", `/staff/cards/lookup?set=${encodeURIComponent(setCode)}&num=${encodeURIComponent(n)}`);
        if (!live) return;
        setFound(r.card);
        setFinish((f) => (r.card.finishes.includes(f) ? f : r.card.finishes[0]));
      } catch { if (live) setLookupError(`No ${setCode.toUpperCase()} #${n}.`); }
    }, 150);
    return () => { live = false; clearTimeout(t); };
  }, [num, setCode]);

  const nextSlot = amend?.slot ?? (logged.at(-1)?.slot ?? 0) + 1;
  const cardCount = logged.filter((c) => c.kind === "card").length;
  const total = logged.reduce((s, c) => s + (c.market_cents ?? 0), 0);
  const expected = pack?.slot_count ?? null;
  const mismatch = expected != null && cardCount !== expected;
  const reload = async () => { await data.reload(); onChange(); };

  const save = (body: Record<string, unknown>) => run(async () => {
    if (amend) {
      await api("POST", `/staff/packs/${packId}/amend`, { slot: amend.slot, reason: amend.reason, ...body });
      setAmend(null);
    } else {
      await api("PUT", `/staff/packs/${packId}/cards/${nextSlot}`, body);
    }
    setNum(""); setFound(null);
    await reload();
  });
  const add = () => { if (found && found.finishes.includes(finish)) save({ kind: "card", card_id: found.id, finish }); };
  const addNonCard = (kind: "token" | "ad") => save({ kind });
  const remove = (slot: number) => run(async () => { await api("DELETE", `/staff/packs/${packId}/cards/${slot}`); await reload(); });
  const approve = () => run(async () => {
    await api("POST", `/staff/packs/${packId}/finalize`, mismatch ? { count_override_reason: override } : {});
    try { localStorage.removeItem(draftKey(packId)); } catch {}
    await onApproved();
  });

  if (!pack) return <section className="panel grow"><p className="muted">Loading…</p></section>;
  const canEnter = !approved || (amend && amend.reason.trim());
  return (
    <section className="panel grow">
      <h2>
        Queue #{pack.position} · {pack.product} · pack {pack.pack_index} of {pack.order_packs}{" "}
        <span className="mono muted">order {shortId(pack.order_id)}</span>
      </h2>

      {approved && !amend && <div className="banner" data-testid="approved-banner">Approved and locked. Changing a card needs a reason, and moves the customer's vault to match.</div>}
      {amend && (
        <div className="entry">
          <label>Reason for changing slot {amend.slot}
            <input data-testid="amend-reason" value={amend.reason} onChange={(e) => setAmend({ ...amend, reason: e.target.value })} />
          </label>
          <button className="link" onClick={() => setAmend(null)}>cancel</button>
        </div>
      )}

      {canEnter && (
        <div className="entry" role="group" aria-label={`Log slot ${nextSlot}`}>
          <label className="setcode">Set
            <input data-testid="set-code" value={setCode} size={5} onChange={(e) => setSetCode(e.target.value.toUpperCase())} />
          </label>
          <label>Collector # (slot {nextSlot})
            <input ref={numRef} data-testid="collector" value={num} disabled={busy} autoComplete="off"
              onChange={(e) => setNum(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); if (!approved) approve(); }
                else if (e.key === "Enter") { e.preventDefault(); add(); }
                // Leave the box so the screen keys (T, S, L, N, D, K, P) work again.
                else if (e.key === "Escape") e.currentTarget.blur();
              }} />
          </label>
          <div className="finishes" role="radiogroup" aria-label="Finish">
            {FINISHES.map((f) => {
              const has = !found || found.finishes.includes(f);
              return (
                <label key={f} className={`finish ${finish === f ? "on" : ""} ${has ? "" : "off"}`}>
                  <input type="radio" name={`finish-${packId}`} value={f} checked={finish === f} disabled={!has} data-testid={`finish-${f}`}
                    onChange={() => setFinish(f)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }} />
                  {f}
                </label>
              );
            })}
          </div>
          <button className="primary" data-testid="add" disabled={busy || !found || !found.finishes.includes(finish)} onClick={add}>Add <kbd>Enter</kbd></button>
          {!amend && <>
            <button onClick={() => addNonCard("token")} disabled={busy} data-testid="add-token">Token slot</button>
            <button onClick={() => addNonCard("ad")} disabled={busy} data-testid="add-ad">Ad slot</button>
          </>}
        </div>
      )}
      {canEnter && (
        <div className="preview" data-testid="preview" aria-live="polite">
          {found ? (
            <>
              {found.image_url ? <img src={found.image_url} alt={found.name} width={110} /> : null}
              <div>
                <b>{found.name}</b> <span className="mono muted">{found.set_code} #{found.collector_number}</span>
                <div>{found.finishes.join(", ")}</div>
                <div data-testid="preview-price">{found.prices?.[finish] != null ? credits(found.prices[finish]) : "no price"} ({finish})</div>
              </div>
            </>
          ) : lookupError ? <span className="muted">{lookupError}</span> : <span className="muted">Type a collector number. Letters and symbols are fine (12a, 1638★, IFIYW-2). Esc leaves the box so screen keys work.</span>}
        </div>
      )}

      {error && <div className="banner error">{error}</div>}
      <table data-testid="contents">
        <thead><tr><th>Slot</th><th /><th>#</th><th>Card</th><th>Finish</th><th>Market</th><th /></tr></thead>
        <tbody>
          {logged.map((c) => (
            <tr key={c.slot}>
              <td className="num">{c.slot}</td>
              <td>{c.image_small ? <img src={c.image_small} alt="" width={36} /> : null}</td>
              <td className="mono">{c.kind === "card" ? `${c.set_code} ${c.collector_number}` : "·"}</td>
              <td>{c.kind === "card" ? <><span className={`rarity ${c.rarity}`} />{c.name}</> : <i>{c.kind} slot</i>}</td>
              <td className={c.finish && c.finish !== "nonfoil" ? "foil" : ""}>{c.finish ?? ""}</td>
              <td className="num">{c.kind !== "card" ? "" : c.market_cents == null ? "no price" : credits(c.market_cents)}</td>
              <td>
                {!approved && <button className="link" onClick={() => remove(c.slot)}>remove</button>}
                {approved && !amend && <button className="link" data-testid={`amend-${c.slot}`} onClick={() => { setAmend({ slot: c.slot, reason: "" }); setNum(""); }}>change</button>}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={5} data-testid="count">{cardCount} cards{expected != null ? ` of ${expected} expected` : ""}{logged.length > cardCount ? ` + ${logged.length - cardCount} other` : ""}</td>
            <td className="num" data-testid="total">{credits(total)}</td><td />
          </tr>
        </tfoot>
      </table>

      {!approved && (
        <div className="action">
          {mismatch && (
            <label className="warn" data-testid="count-warning">
              {cardCount} cards logged, {expected} expected for this set. Recount, or give a reason to approve anyway:
              <input data-testid="count-override" value={override} onChange={(e) => setOverride(e.target.value)} />
            </label>
          )}
          <button className="primary big" data-testid="finalize" disabled={busy || !logged.length || (mismatch && !override.trim())} onClick={approve}>
            Approve pack <kbd>Ctrl+Enter</kbd>
          </button>
        </div>
      )}
      {pack.count_override_reason && <p className="muted">Approved with a count override: {pack.count_override_reason}</p>}

      <details className="history" data-testid="history">
        <summary>Edit history ({data.data?.history.length ?? 0})</summary>
        <ul>
          {data.data?.history.map((h, i) => (
            <li key={i}>
              <span className="mono muted">{new Date(h.created_at).toLocaleTimeString()}</span> {h.actor ?? "system"} {h.action}
              {h.action === "approved" ? "" : ` slot ${h.slot}`}
              {h.old_card ? ` from ${h.old_card} #${h.old_num} (${h.old_finish})` : ""}
              {h.card ? ` to ${h.card} #${h.num} (${h.finish})` : h.kind && h.kind !== "card" ? ` (${h.kind})` : ""}
              {h.reason ? `: ${h.reason}` : ""}
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}
