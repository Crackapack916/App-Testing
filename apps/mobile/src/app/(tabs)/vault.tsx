import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from "react-native";
import { router } from "expo-router";
import { Check, LayoutGrid, List, Play } from "lucide-react-native";
import { Image } from "expo-image";
import { Text, TextInput } from "../../components/Text";
import { SignInPrompt } from "../../components/SignInPrompt";
import { Button, EmptyState, ErrorText, Footer, Panel, RarityPill, Screen, Title } from "../../components/bits";
import { CardImage } from "../../components/CardImage";
import { Carousel } from "../../components/Carousel";
import { api } from "../../lib/api";
import { useApi } from "../../lib/useApi";
import { useSession } from "../../lib/session";
import { credits, dollars } from "../../lib/format";
import { haptic } from "../../lib/feedback";
import { colors, font, palette, radii, rarityRank, type } from "../../lib/theme";

type Holding = { card_id: string; finish: string; condition: string; qty: number; individual_card_id: string | null; market_cents: number | null;
  price_asof: string | null; name: string; set_code: string; set_name: string; collector_number: string; rarity: string; released_at: string | null;
  received_at: string | null; pack_id: string | null; slot: number | null; image_url: string | null; image_small: string | null };
type Cracked = { pack_id: string; order_id: string; pack_index: number; order_packs: number; set_code: string; set_name: string; batch_date: string;
  is_new: boolean; video_status: string | null; cards: number; thumbs: string[] };
type VaultData = { cards: Holding[]; total_market_cents: number; shipping: { free_min: number; fee: number } };

const SORTS = [
  { key: "received", label: "Order received" }, { key: "value_desc", label: "Value, high to low" }, { key: "value_asc", label: "Value, low to high" },
  { key: "set", label: "Set" }, { key: "rarity", label: "Rarity" }, { key: "name", label: "Name" }, { key: "date", label: "Release date" },
] as const;
type SortKey = (typeof SORTS)[number]["key"];
const RARITIES = ["common", "uncommon", "rare", "mythic"];

const keyOf = (h: Holding) => h.individual_card_id ?? `${h.card_id}:${h.finish}:${h.condition}`;
const asItem = (h: Holding, qty: number) => h.individual_card_id
  ? { individual_card_id: h.individual_card_id }
  : { card_id: h.card_id, finish: h.finish, condition: h.condition, qty };

export default function Vault() {
  const { me } = useSession();
  if (!me) return <Screen><SignInPrompt title="Your Vault" body="Cards from your packs land here after tonight's opening. Log in to see yours." /></Screen>;
  return <VaultScreen />;
}

function VaultScreen() {
  const { me, refresh } = useSession();
  const canSell = !!me?.features.buyback;
  const vault = useApi<VaultData>("/me/vault");
  const cracked = useApi<{ packs: Cracked[] }>("/me/cracked");
  const { width } = useWindowDimensions();

  // Seeing the Vault clears the tab dot; the New marks stay for this visit.
  useEffect(() => {
    if (cracked.data?.packs.some((p) => p.is_new)) api("POST", "/me/cracked/seen").then(refresh).catch(() => {});
  }, [cracked.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const [view, setView] = useState<"grid" | "list">("grid");
  const [sort, setSort] = useState<SortKey>("received");
  const [groupBySet, setGroupBySet] = useState(false);
  const [q, setQ] = useState("");
  const [set, setSet] = useState<string | null>(null);
  const [rarity, setRarity] = useState<string | null>(null);
  const [foilOnly, setFoilOnly] = useState(false);
  const [min, setMin] = useState("");
  const [max, setMax] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Record<string, number>>({});
  const [action, setAction] = useState<null | "sell" | "ship">(null);
  const [detail, setDetail] = useState<Holding | null>(null);

  const all = vault.data?.cards ?? [];
  const sets = useMemo(() => [...new Map(all.map((c) => [c.set_code, c.set_name])).entries()], [all]);
  const cards = useMemo(() => {
    const text = q.trim().toLowerCase();
    const lo = min ? Number(min) * 100 : null;
    const hi = max ? Number(max) * 100 : null;
    const list = all.filter((c) => (!text || c.name.toLowerCase().includes(text)) && (!set || c.set_code === set) && (!rarity || c.rarity === rarity)
      && (!foilOnly || c.finish !== "nonfoil") && (lo == null || (c.market_cents ?? 0) >= lo) && (hi == null || (c.market_cents ?? 0) <= hi));
    const by: Record<SortKey, (a: Holding, b: Holding) => number> = {
      received: () => 0,   // the server's order: newest pack first, cards in pulled order
      value_desc: (a, b) => (b.market_cents ?? -1) - (a.market_cents ?? -1),
      value_asc: (a, b) => (a.market_cents ?? Infinity) - (b.market_cents ?? Infinity),
      set: (a, b) => a.set_name.localeCompare(b.set_name) || a.collector_number.localeCompare(b.collector_number, undefined, { numeric: true }),
      rarity: (a, b) => (rarityRank[b.rarity] ?? 0) - (rarityRank[a.rarity] ?? 0),
      name: (a, b) => a.name.localeCompare(b.name),
      date: (a, b) => (b.released_at ?? "").localeCompare(a.released_at ?? ""),
    };
    return [...list].sort(by[sort]);
  }, [all, q, set, rarity, foilOnly, min, max, sort]);
  const groups = useMemo(() => groupBySet
    ? sets.map(([code, name]) => ({ title: name, cards: cards.filter((c) => c.set_code === code) })).filter((g) => g.cards.length)
    : [{ title: null as string | null, cards }], [groupBySet, sets, cards]);

  const chosen = all.filter((h) => selected[keyOf(h)]).map((h) => ({ h, qty: selected[keyOf(h)] }));
  const toggle = (h: Holding) => {
    haptic.tap();
    setSelected((s) => { const k = keyOf(h); const n = { ...s }; if (n[k]) delete n[k]; else n[k] = h.qty; return n; });
  };
  const done = () => { setSelected({}); setSelecting(false); setAction(null); vault.reload(); };
  const cols = width >= 1100 ? 5 : width >= 760 ? 4 : width >= 520 ? 3 : 2;
  const contentWidth = Math.min(width, 1100) - 32;
  const tile = Math.floor((contentWidth - (cols - 1) * 12) / cols);
  const packs = cracked.data?.packs ?? [];

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ paddingBottom: chosen.length ? 110 : 24 }}>
        <View style={s.wrap}>
          <Title>Vault</Title>

          {packs.length > 0 && (
            <View style={s.cracked} testID="cracked-today">
              <View style={s.rowBetween}>
                <Text style={[type.label, { color: palette.blue[200] }]}>{packs[0].batch_date === new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" }) ? "Cracked today" : `Cracked ${packs[0].batch_date}`}</Text>
                {packs.some((p) => p.is_new) && <View style={s.newBanner} testID="new-banner"><Text style={s.newText}>New</Text></View>}
              </View>
              <Carousel label="Cracked today" items={packs} keyOf={(p) => p.pack_id} labelOf={(p) => `${p.set_name}, pack ${p.pack_index} of ${p.order_packs}`}
                itemWidth={Math.min(300, width * 0.78)} height={200} render={(p) => <PackTile p={p} />} />
            </View>
          )}

          <View style={s.header}>
            <View style={s.value}>
              <Text style={type.label}>Estimated market value (not credit)</Text>
              <Text style={s.valueNum} testID="vault-value">{dollars(vault.data?.total_market_cents ?? 0)}</Text>
              <Text style={type.small}>{all.reduce((n, c) => n + c.qty, 0)} cards. Market prices from Scryfall, updated daily.</Text>
            </View>
          </View>

          <View style={s.tools}>
            <TextInput value={q} onChangeText={setQ} placeholder="Search your vault" placeholderTextColor={colors.muted} style={s.search}
              accessibilityLabel="Search your vault" testID="vault-search" />
            <View style={s.toolRow}>
              <Chip on={showFilters} onPress={() => setShowFilters(!showFilters)} label="Filters" testID="vault-filters" />
              <Chip on={groupBySet} onPress={() => setGroupBySet(!groupBySet)} label="Group by set" testID="group-by-set" />
              <Chip on={selecting} onPress={() => { setSelecting(!selecting); setSelected({}); }} label={selecting ? "Done selecting" : "Select"} testID="select-mode" />
              <View style={{ flexDirection: "row", marginLeft: "auto" }}>
                <IconToggle on={view === "grid"} label="Grid" onPress={() => setView("grid")}><LayoutGrid size={18} color={colors.text} /></IconToggle>
                <IconToggle on={view === "list"} label="List" onPress={() => setView("list")}><List size={18} color={colors.text} /></IconToggle>
              </View>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }} accessibilityLabel="Sort">
              {SORTS.map((o) => <Chip key={o.key} on={sort === o.key} onPress={() => setSort(o.key)} label={o.label} testID={`sort-${o.key}`} />)}
            </ScrollView>
            {showFilters && (
              <Panel style={{ gap: 10 }}>
                <Text style={type.label}>Set</Text>
                <View style={s.wrapRow}>
                  <Chip on={!set} onPress={() => setSet(null)} label="All" />
                  {sets.map(([code, name]) => <Chip key={code} on={set === code} onPress={() => setSet(code)} label={name} />)}
                </View>
                <Text style={type.label}>Rarity</Text>
                <View style={s.wrapRow}>
                  <Chip on={!rarity} onPress={() => setRarity(null)} label="All" />
                  {RARITIES.map((r) => <Chip key={r} on={rarity === r} onPress={() => setRarity(r)} label={r[0].toUpperCase() + r.slice(1)} />)}
                </View>
                <View style={s.wrapRow}><Chip on={foilOnly} onPress={() => setFoilOnly(!foilOnly)} label="Foil only" testID="foil-only" /></View>
                <Text style={type.label}>Price, dollars</Text>
                <View style={s.wrapRow}>
                  <TextInput value={min} onChangeText={(v) => setMin(v.replace(/[^0-9.]/g, ""))} placeholder="Min" inputMode="decimal" style={[s.search, { flex: 1 }]} accessibilityLabel="Minimum price" />
                  <TextInput value={max} onChangeText={(v) => setMax(v.replace(/[^0-9.]/g, ""))} placeholder="Max" inputMode="decimal" style={[s.search, { flex: 1 }]} accessibilityLabel="Maximum price" />
                </View>
              </Panel>
            )}
          </View>

          {vault.data && !all.length ? (
            <EmptyState title="Nothing here yet" body="Your cards land here after tonight's opening." action={<Button kind="ghost" label="See packs" onPress={() => router.push("/packs")} />} />
          ) : vault.data && !cards.length ? <EmptyState title="No cards match" body="Try clearing a filter." /> : null}

          {groups.map((g) => (
            <View key={g.title ?? "all"} style={{ paddingHorizontal: 16, gap: 10, marginBottom: 12 }}>
              {g.title ? <Text style={type.h3}>{g.title}</Text> : null}
              <View style={view === "grid" ? s.grid : { gap: 0 }}>
                {g.cards.map((c) => {
                  const on = !!selected[keyOf(c)];
                  const press = () => (selecting ? toggle(c) : setDetail(c));
                  return view === "grid" ? (
                    <Pressable key={keyOf(c)} onPress={press} style={[{ width: tile }, on && s.on]} testID={`holding-${c.set_code}-${c.collector_number}`}
                      accessibilityRole={selecting ? "checkbox" : "button"} accessibilityState={selecting ? { checked: on } : undefined}>
                      <CardImage card={{ ...c, image_url: c.image_url }} width={tile} />
                      <View style={s.under}>
                        <Text style={s.price}>{dollars(c.market_cents)}</Text>
                        {c.finish !== "nonfoil" ? <Text style={s.foil}>{c.finish === "etched" ? "Etched" : "Foil"}</Text> : null}
                        {c.qty > 1 ? <Text style={s.qty}>x{c.qty}</Text> : null}
                        {on ? <Check size={16} color={colors.link} /> : null}
                      </View>
                    </Pressable>
                  ) : (
                    <Pressable key={keyOf(c)} onPress={press} style={[s.listRow, on && s.on]} testID={`holding-${c.set_code}-${c.collector_number}`}
                      accessibilityRole={selecting ? "checkbox" : "button"} accessibilityState={selecting ? { checked: on } : undefined}>
                      <CardImage card={{ ...c, image_url: c.image_small ?? c.image_url }} width={52} />
                      <View style={{ flex: 1, gap: 3 }}>
                        <Text style={s.name}>{c.name}{c.qty > 1 ? `  x${c.qty}` : ""}</Text>
                        <Text style={type.small}>{c.set_code} {c.collector_number}{c.finish !== "nonfoil" ? `, ${c.finish}` : ""}</Text>
                        <RarityPill rarity={c.rarity} />
                      </View>
                      <Text style={s.price}>{dollars(c.market_cents)}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ))}
          <ErrorText>{vault.error}</ErrorText>
        </View>
        <Footer />
      </ScrollView>

      {chosen.length > 0 && (
        <View style={s.bar}>
          <Text style={s.name}>{chosen.reduce((n, c) => n + c.qty, 0)} selected</Text>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Button testID="ship" label="Ship" onPress={() => setAction("ship")} />
            {canSell && <Button testID="sell" kind="ghost" label="Sell back" onPress={() => setAction("sell")} />}
          </View>
        </View>
      )}
      {action === "sell" && <SellSheet items={chosen} onClose={() => setAction(null)} onDone={done} />}
      {action === "ship" && vault.data && <ShipSheet items={chosen} shipping={vault.data.shipping} onClose={() => setAction(null)} onDone={done} />}
      {detail && <DetailSheet c={detail} canSell={canSell} onClose={() => setDetail(null)} />}
    </Screen>
  );
}

function PackTile({ p }: { p: Cracked }) {
  return (
    <View style={s.packTile} testID={`pack-${p.pack_id}`}>
      <View style={s.rowBetween}>
        <View style={{ flex: 1 }}>
          <Text style={type.h3} numberOfLines={1}>{p.set_name}</Text>
          <Text style={type.small}>Pack {p.pack_index} of {p.order_packs}, {p.cards} cards</Text>
        </View>
        {p.is_new && <View style={s.newBanner}><Text style={s.newText}>New</Text></View>}
      </View>
      <View style={s.thumbs}>
        {p.thumbs.slice(0, 7).map((t, i) => <Image key={i} source={t} style={s.thumb} contentFit="cover" accessibilityIgnoresInvertColors />)}
      </View>
      <Button testID={`watch-${p.pack_id}`} label="Watch" onPress={() => router.push({ pathname: "/pack/[id]", params: { id: p.pack_id } })}
        style={{ alignSelf: "flex-start" }} disabled={p.video_status !== "approved"} />
    </View>
  );
}

function Chip({ on, onPress, label, testID }: { on: boolean; onPress: () => void; label: string; testID?: string }) {
  return (
    <Pressable onPress={onPress} style={[s.chip, on && s.chipOn]} accessibilityRole="button" accessibilityState={{ selected: on }} testID={testID}>
      <Text style={[s.chipText, on && { color: colors.skyInk }]}>{label}</Text>
    </Pressable>
  );
}

function IconToggle({ on, label, onPress, children }: { on: boolean; label: string; onPress: () => void; children: ReactNode }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: on }}
      style={[s.iconBtn, on && s.chipOn]}>{children}</Pressable>
  );
}

function DetailSheet({ c, canSell, onClose }: { c: Holding; canSell: boolean; onClose: () => void }) {
  const [offer, setOffer] = useState<number | null>(null);
  useEffect(() => {
    if (canSell) api<{ total_credits: number }>("POST", "/me/buyback/quote", { items: [{ card_id: c.card_id, finish: c.finish, qty: 1 }] })
      .then((r) => setOffer(r.total_credits)).catch(() => {});
  }, [c, canSell]);
  return (
    <Sheet onClose={onClose}>
      <View style={{ flexDirection: "row", gap: 16, flexWrap: "wrap" }} testID="card-detail">
        <CardImage card={c} width={180} />
        <View style={{ flex: 1, minWidth: 160, gap: 8 }}>
          <Text style={type.h2}>{c.name}</Text>
          <Text style={type.small}>{c.set_name}, {c.set_code} {c.collector_number}</Text>
          <RarityPill rarity={c.rarity} />
          <Text style={type.body}>
            Market price{c.finish !== "nonfoil" ? ` (${c.finish})` : ""}: <Text style={s.price}>{dollars(c.market_cents)}</Text>
          </Text>
          {c.price_asof && <Text style={type.small}>As of {new Date(c.price_asof).toLocaleDateString("en-US", { timeZone: "America/Los_Angeles" })}</Text>}
          {canSell && offer != null && <Text style={type.body}>Sell back offer: {credits(offer)} credits</Text>}
          <Button kind="ghost" label="All printings" onPress={() => { onClose(); router.push(`/card/${c.card_id}`); }} />
        </View>
      </View>
    </Sheet>
  );
}

function SellSheet({ items, onClose, onDone }: { items: { h: Holding; qty: number }[]; onClose: () => void; onDone: () => void }) {
  const { refresh } = useSession();
  const [quote, setQuote] = useState<{ items: { card_id: string; quote_each: number | null; qty: number }[]; total_credits: number; stale: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ status: string; total_credits: number; hold_until: string | null } | null>(null);
  const [key] = useState(() => `${Date.now()}-${Math.random().toString(36).slice(2)}`);
  useEffect(() => {
    api("POST", "/me/buyback/quote", { items: items.map(({ h, qty }) => ({ card_id: h.card_id, finish: h.finish, qty })) })
      .then(setQuote).catch((e) => setError(e.message));
  }, [items]);
  const sell = async () => {
    setBusy(true); setError(null);
    try {
      setResult(await api("POST", "/me/buyback", { items: items.map(({ h, qty }) => asItem(h, qty)), idempotency_key: key }));
      await refresh();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Sheet onClose={onClose}>
      {result ? (
        <View style={{ gap: 12 }}>
          <Text style={type.h2}>{result.status === "held" ? "Sale received" : "Sold back"}</Text>
          <Text style={type.body} testID="sold">{result.status === "held"
            ? `${credits(result.total_credits)} credits will be added by ${new Date(result.hold_until!).toLocaleDateString()}.`
            : `${credits(result.total_credits)} credits added. Credits are used on CrackAPack packs only.`}</Text>
          <Button label="Done" onPress={onDone} />
        </View>
      ) : (
        <View style={{ gap: 12 }}>
          <Text style={type.h2}>Sell back for credits</Text>
          {items.map(({ h, qty }, i) => (
            <View key={keyOf(h)} style={s.rowBetween}>
              <Text style={type.body}>{h.name}{qty > 1 ? ` x${qty}` : ""}</Text>
              <Text style={s.mono}>{quote?.items[i]?.quote_each != null ? `${credits(quote.items[i].quote_each! * qty)} credits` : ""}</Text>
            </View>
          ))}
          <View style={s.rowBetween}><Text style={s.name}>Total</Text><Text style={s.mono} testID="quote">{quote ? `${credits(quote.total_credits)} credits` : "Quoting"}</Text></View>
          {quote?.stale && <Text style={type.small}>Prices are refreshing for one or more of these cards. Try again shortly.</Text>}
          <Text style={type.small}>Sold back cards leave your Vault. This can't be undone.</Text>
          <Button testID="confirm-sell" label="Confirm sell back" onPress={sell} busy={busy} disabled={!quote || quote.stale} />
          <ErrorText>{error}</ErrorText>
        </View>
      )}
    </Sheet>
  );
}

function ShipSheet({ items, shipping, onClose, onDone }: { items: { h: Holding; qty: number }[]; shipping: { free_min: number; fee: number };
  onClose: () => void; onDone: () => void }) {
  const { refresh } = useSession();
  const [addr, setAddr] = useState({ name: "", line1: "", line2: "", city: "", state: "", zip: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ fee_credits: number } | null>(null);
  const value = items.reduce((n, { h, qty }) => n + (h.market_cents ?? 0) * qty, 0);
  const ship = async () => {
    setBusy(true); setError(null);
    try { setResult(await api("POST", "/me/shipments", { items: items.map(({ h, qty }) => asItem(h, qty)), address: addr })); await refresh(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const field = (k: keyof typeof addr, label: string, auto: string) => (
    <TextInput testID={`addr-${k}`} value={addr[k]} onChangeText={(v) => setAddr({ ...addr, [k]: v })} placeholder={label} accessibilityLabel={label}
      placeholderTextColor={colors.muted} style={s.search} autoComplete={auto as never} />
  );
  return (
    <Sheet onClose={onClose}>
      {result ? (
        <View style={{ gap: 12 }}>
          <Text style={type.h2}>Shipping requested</Text>
          <Text style={type.body}>{result.fee_credits ? `${credits(result.fee_credits)} credits for shipping.` : "Free shipping."} We'll pack your cards and email tracking.</Text>
          <Button label="Done" onPress={onDone} />
        </View>
      ) : (
        <View style={{ gap: 10 }}>
          <Text style={type.h2}>Ship to me</Text>
          <Text style={type.body}>
            {value >= shipping.free_min ? `Free shipping on ${dollars(shipping.free_min)} or more.`
              : `${dollars(shipping.fee)} shipping (${credits(shipping.fee)} credits) under ${dollars(shipping.free_min)}. These cards are ${dollars(value)}.`}
          </Text>
          {field("name", "Full name", "name")}{field("line1", "Street address", "address-line1")}{field("line2", "Apartment, suite (optional)", "address-line2")}
          <View style={{ flexDirection: "row", gap: 8 }}>
            <View style={{ flex: 2 }}>{field("city", "City", "address-level2")}</View>
            <View style={{ flex: 1 }}>{field("state", "State", "address-level1")}</View>
            <View style={{ flex: 1.2 }}>{field("zip", "ZIP", "postal-code")}</View>
          </View>
          <Button testID="request-shipment" label="Request shipment" onPress={ship} busy={busy} disabled={!addr.name || !addr.line1 || !addr.city || !addr.state || !addr.zip} />
          <ErrorText>{error}</ErrorText>
        </View>
      )}
    </Sheet>
  );
}

function Sheet({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={s.scrim} onPress={onClose} accessibilityLabel="Close" />
      <View style={s.sheet} accessibilityViewIsModal><ScrollView>{children}</ScrollView></View>
    </Modal>
  );
}

const s = StyleSheet.create({
  wrap: { maxWidth: 1100, width: "100%", alignSelf: "center" },
  cracked: { marginHorizontal: 16, marginBottom: 12, padding: 12, gap: 8, backgroundColor: palette.blue[700], borderRadius: radii.panel },
  packTile: { flex: 1, backgroundColor: palette.ink[100], borderRadius: radii.tile, padding: 12, gap: 8, borderWidth: 1, borderColor: palette.blue[300] },
  thumbs: { flexDirection: "row", gap: 4 },
  thumb: { width: 30, height: 42, borderRadius: 2, backgroundColor: palette.blue[100] },
  newBanner: { backgroundColor: palette.sky[200], borderRadius: radii.pill, paddingHorizontal: 10, paddingVertical: 2 },
  newText: { fontFamily: font.bodyBold, fontSize: 12, color: palette.blue[700], letterSpacing: 0.6 },
  header: { paddingHorizontal: 16, marginBottom: 8 },
  value: { gap: 2, borderLeftWidth: 4, borderLeftColor: colors.sky, paddingLeft: 12, paddingVertical: 4 },
  valueNum: { fontFamily: font.monoMedium, fontSize: 24, color: colors.text },
  tools: { paddingHorizontal: 16, gap: 8, marginBottom: 12 },
  toolRow: { flexDirection: "row", gap: 6, alignItems: "center", flexWrap: "wrap" },
  wrapRow: { flexDirection: "row", gap: 6, flexWrap: "wrap" },
  search: { backgroundColor: palette.ink[100], borderWidth: 1, borderColor: colors.lineStrong, borderRadius: radii.control, paddingHorizontal: 12,
    minHeight: 44, fontSize: 16, color: colors.text },
  chip: { borderWidth: 1, borderColor: colors.lineStrong, borderRadius: radii.pill, paddingHorizontal: 12, minHeight: 36, justifyContent: "center", backgroundColor: palette.ink[100] },
  chipOn: { backgroundColor: colors.sky, borderColor: colors.sky },
  chipText: { fontFamily: font.bodySemi, fontSize: 13, color: colors.text },
  iconBtn: { width: 40, height: 36, alignItems: "center", justifyContent: "center", borderRadius: 6 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  under: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 },
  price: { fontFamily: font.displaySemi, fontSize: 15, color: colors.text },
  foil: { fontFamily: font.bodySemi, fontSize: 11, color: colors.muted, borderWidth: 1, borderColor: colors.lineStrong, borderRadius: 3, paddingHorizontal: 4 },
  qty: { fontFamily: font.mono, fontSize: 12, color: colors.muted },
  on: { backgroundColor: palette.sky[100], borderRadius: 6 },
  listRow: { flexDirection: "row", gap: 12, alignItems: "center", paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.line },
  name: { fontFamily: font.bodySemi, fontSize: 15, color: colors.text },
  rowBetween: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 },
  mono: { fontFamily: font.monoMedium, fontSize: 14, color: colors.text },
  bar: { position: "absolute", left: 12, right: 12, bottom: 12, backgroundColor: palette.ink[100], borderRadius: radii.control, borderWidth: 1.5,
    borderColor: palette.blue[400], padding: 12, flexDirection: "row", justifyContent: "space-between", alignItems: "center", maxWidth: 700, alignSelf: "center" },
  scrim: { flex: 1, backgroundColor: "rgba(10, 16, 26, 0.6)" },
  sheet: { backgroundColor: palette.ink[100], borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 20, paddingBottom: 32, maxHeight: "88%",
    maxWidth: 640, width: "100%", alignSelf: "center" },
});
