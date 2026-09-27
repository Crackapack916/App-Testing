import { useState } from "react";
import { api, token } from "./api";
import { useAction, useData, useHotkeys } from "./hooks";
import { Tonight } from "./screens/Tonight";
import { Session } from "./screens/Session";
import { LogCards } from "./screens/LogCards";
import { Notify } from "./screens/Notify";
import { Stock } from "./screens/Stock";

export type TonightData = {
  now: string;
  batch: null | {
    id: string; batch_date: string; cutoff_at: string; status: string; manifest_hash: string | null;
    entry_count: number | null; session_id: string | null;
  };
  upcoming: { id: string; batch_date: string; cutoff_at: string; packs: number };
  queue: { id: string; position: number | null; status: string; pack_index: number; quantity: number; order_id: string; customer: string; product: string }[];
  stock: { product_id: string; name: string; packs_on_hand: number; packs_reserved: number; safety_buffer_packs: number; sealed_boxes: number }[];
};

const TABS = [
  { key: "t", id: "tonight", label: "Tonight" },
  { key: "s", id: "session", label: "Session" },
  { key: "l", id: "log", label: "Log cards" },
  { key: "n", id: "notify", label: "Notify" },
  { key: "k", id: "stock", label: "Stock" },
] as const;
type Tab = (typeof TABS)[number]["id"];

export function App() {
  const [authed, setAuthed] = useState(!!token.get());
  if (!authed) return <Login onDone={() => setAuthed(true)} />;
  return <Shell onSignOut={() => { token.clear(); setAuthed(false); }} />;
}

function Shell({ onSignOut }: { onSignOut: () => void }) {
  const [tab, setTab] = useState<Tab>("tonight");
  const tonight = useData<TonightData>("/staff/tonight", 5000);
  const batch = tonight.data?.batch ?? null;
  // useHotkeys ignores keys typed into inputs, so tab keys never fire while logging.
  useHotkeys(Object.fromEntries(TABS.map((t) => [t.key, () => setTab(t.id)])));

  return (
    <div className="shell">
      <header className="top">
        <div className="brand">CrackAPack <span>Ops</span></div>
        <nav>
          {TABS.map((t) => (
            <button key={t.id} className={tab === t.id ? "tab on" : "tab"} onClick={() => setTab(t.id)}>
              {t.label} <kbd>{t.key.toUpperCase()}</kbd>
            </button>
          ))}
        </nav>
        <div className="night">
          {batch ? <><b>{batch.batch_date}</b> <span className={`chip ${batch.status}`}>{batch.status.replace("_", " ")}</span></> : <span className="muted">No night to run</span>}
          <button className="link" onClick={onSignOut}>Sign out</button>
        </div>
      </header>
      {tonight.error && <div className="banner error">{tonight.error}</div>}
      <main>
        {tab === "tonight" && <Tonight data={tonight.data} reload={tonight.reload} goSession={() => setTab("session")} />}
        {tab === "session" && <Session batch={batch} reload={tonight.reload} />}
        {tab === "log" && <LogCards batch={batch} />}
        {tab === "notify" && <Notify batch={batch} />}
        {tab === "stock" && <Stock />}
      </main>
    </div>
  );
}

function Login({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState("");
  const { busy, error, run } = useAction();
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = await run(() => api<{ token: string; role: string }>("POST", "/dev/login", { email, role: "staff" }));
    if (r) { token.set(r.token); onDone(); }
  };
  return (
    <form className="login" onSubmit={submit}>
      <h1>CrackAPack Ops</h1>
      <p className="muted">Pilot sign in (test mode only)</p>
      <input autoFocus type="email" placeholder="staff email" value={email} onChange={(e) => setEmail(e.target.value)} />
      <button className="primary" disabled={busy || !email}>Sign in</button>
      {error && <div className="banner error">{error}</div>}
    </form>
  );
}
