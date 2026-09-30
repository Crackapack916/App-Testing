import { useEffect, useState } from "react";
import { api, ApiError, token } from "./api";
import { useAction, useData, useHotkeys } from "./hooks";
import { Tonight } from "./screens/Tonight";
import { Session } from "./screens/Session";
import { LogCards } from "./screens/LogCards";
import { Videos } from "./screens/Videos";
import { Drops } from "./screens/Drops";
import { Stock } from "./screens/Stock";
import { Ship } from "./screens/Ship";

export type TonightData = {
  now: string;
  test_clock: boolean;
  batch: null | {
    id: string; batch_date: string; cutoff_at: string; status: string; manifest_hash: string | null;
    entry_count: number | null; session_id: string | null;
  };
  upcoming: { id: string; batch_date: string; cutoff_at: string; packs: number };
  /** Earlier nights whose session ended but whose orders still wait on videos, logging or approval. */
  unfinished: (NonNullable<TonightData["batch"]> & { orders_waiting: number })[];
  queue: { id: string; position: number | null; status: string; pack_index: number; quantity: number; order_id: string; customer: string; product: string }[];
  stock: { product_id: string; name: string; packs_on_hand: number; packs_reserved: number; safety_buffer_packs: number; sealed_boxes: number }[];
};

const TABS = [
  { key: "t", id: "tonight", label: "Tonight" },
  { key: "s", id: "session", label: "Opening" },
  { key: "l", id: "log", label: "Log cards" },
  { key: "n", id: "videos", label: "Videos" },
  { key: "d", id: "drops", label: "Drops" },
  { key: "k", id: "stock", label: "Stock" },
  { key: "p", id: "ship", label: "Ship" },
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
  // Log cards and Videos can work on tonight or on an earlier night that still needs finishing.
  const nights = [...(tonight.data?.unfinished ?? []), ...(batch ? [batch] : [])].filter((b, i, all) => all.findIndex((x) => x.id === b.id) === i);
  const [pickedId, setPickedId] = useState<string | null>(null);
  const workBatch = nights.find((b) => b.id === pickedId) ?? batch ?? nights[0] ?? null;
  // useHotkeys ignores keys typed into inputs, so tab keys never fire while logging.
  useHotkeys(Object.fromEntries(TABS.map((t) => [t.key, () => setTab(t.id)])));

  return (
    <div className="shell">
      <header className="top">
        <div className="brand"><img src={`${import.meta.env.BASE_URL}mark.png`} alt="" />Crack<b>A</b>Pack <span>Ops</span></div>
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
        {tab === "session" && <Session batch={batch ?? tonight.data?.unfinished.at(-1) ?? null} reload={tonight.reload} />}
        {(tab === "log" || tab === "videos") && nights.length > 1 && (
          <div className="banner warn night-picker">
            <label>Night
              <select value={workBatch?.id ?? ""} onChange={(e) => setPickedId(e.target.value)} data-testid="night-picker">
                {nights.map((b) => <option key={b.id} value={b.id}>{b.batch_date}{b.status === "completed" ? " (session ended, still to finish)" : " (tonight)"}</option>)}
              </select>
            </label>
          </div>
        )}
        {tab === "log" && <LogCards batch={workBatch} />}
        {tab === "videos" && <Videos batch={workBatch} />}
        {tab === "drops" && <Drops />}
        {tab === "stock" && <Stock />}
        {tab === "ship" && <Ship />}
      </main>
    </div>
  );
}

/** Staff log in with the same email and password as the site. Only staff and admin accounts get past /staff. */
function Login({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const { busy, error, run, setError } = useAction();
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    await run(async () => {
      const r = await api<{ token: string }>("POST", "/auth/login", { email, password });
      token.set(r.token);
      try { await api("GET", "/staff/tonight"); onDone(); }
      catch (err) {
        token.clear();
        if (err instanceof ApiError && err.code === "forbidden") setError("This account isn't staff. Ask an admin to add you.");
        else throw err;
      }
    });
  };
  return (
    <form className="login" onSubmit={submit}>
      <h1 className="brand login-brand"><img src={`${import.meta.env.BASE_URL}mark.png`} alt="" />Crack<b>A</b>Pack <span>Ops</span></h1>
      <label>Email<input autoFocus type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
      <label>Password<input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
      <button className="primary" disabled={busy || !email || !password}>Log in</button>
      {error && <div className="banner error">{error}</div>}
    </form>
  );
}
