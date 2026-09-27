import { useEffect, useMemo, useState } from "react";
import { FlatList, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import { Button, ErrorText, LegalityTags, Screen } from "../../components/bits";
import { CardImage } from "../../components/CardImage";
import { api } from "../../lib/api";
import { useApi } from "../../lib/useApi";
import { useSession } from "../../lib/session";
import { credits, dollars } from "../../lib/format";
import { haptic } from "../../lib/feedback";
import { colors, radius } from "../../lib/theme";

type Holding = { card_id: string; finish: string; condition: string; qty: number; individual_card_id: string | null; market_cents: number | null;
  name: string; set_code: string; collector_number: string; rarity: string; legalities: Record<string, string>; image_url: string | null };
type Pull = { name: string; set_code: string; collector_number: string; rarity: string; finish: string; image_url: string | null; market_cents: number | null; batch_date: string };

const keyOf = (h: Holding) => h.individual_card_id ?? `${h.card_id}:${h.finish}:${h.condition}`;
const asItem = (h: Holding, qty: number) => h.individual_card_id
  ? { individual_card_id: h.individual_card_id }
  : { card_id: h.card_id, finish: h.finish, condition: h.condition, qty };

export default function Vault() {
  const vault = useApi<{ cards: Holding[]; total_market_cents: number }>("/me/vault");
  const pulls = useApi<{ pulls: Pull[] }>("/me/pulls");
  const [selected, setSelected] = useState<Record<string, number>>({});
  const [action, setAction] = useState<null | "sell" | "ship">(null);
  const cards = vault.data?.cards ?? [];
  const chosen = useMemo(() => cards.filter((h) => selected[keyOf(h)]).map((h) => ({ h, qty: selected[keyOf(h)] })), [cards, selected]);

  const toggle = (h: Holding) => {
    haptic.tap();
    setSelected((s) => { const k = keyOf(h); const n = { ...s }; if (n[k]) delete n[k]; else n[k] = h.qty; return n; });
  };
  const done = () => { setSelected({}); setAction(null); vault.reload(); pulls.reload(); };

  const tonight = pulls.data?.pulls ?? [];
  return (
    <Screen>
      <FlatList
        data={cards}
        keyExtractor={keyOf}
        contentContainerStyle={{ paddingBottom: chosen.length ? 120 : 40 }}
        ListHeaderComponent={
          <View>
            <View style={s.header}>
              <Text style={s.h1}>Vault</Text>
              <View style={{ alignItems: "flex-end" }}>
                <Text style={s.value} testID="vault-value">{dollars(vault.data?.total_market_cents ?? 0)}</Text>
                <Text style={s.muted}>market value</Text>
              </View>
            </View>
            {tonight.length > 0 && (
              <View style={s.pulls} testID="todays-pulls">
                <View style={s.pullsHead}>
                  <Text style={s.section}>Today's pulls · {tonight[0].batch_date}</Text>
                  <Pressable testID="replay" onPress={() => router.push("/reveal")}><Text style={s.link}>Replay reveal</Text></Pressable>
                </View>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: 16 }}>
                  {tonight.map((p, i) => <CardImage key={i} card={p} width={72} />)}
                </ScrollView>
              </View>
            )}
            <Text style={[s.section, { paddingHorizontal: 16, marginTop: 8 }]}>Held for you · {cards.reduce((n, c) => n + c.qty, 0)} cards</Text>
          </View>
        }
        ListEmptyComponent={vault.data ? <Text style={[s.muted, { padding: 16 }]}>Nothing here yet. Your cards land here after tonight's opening.</Text> : null}
        renderItem={({ item }) => {
          const on = !!selected[keyOf(item)];
          return (
            <Pressable testID={`holding-${item.set_code}-${item.collector_number}`} onPress={() => toggle(item)}
              onLongPress={() => router.push(`/card/${item.card_id}`)} style={[s.row, on && s.rowOn]}>
              <CardImage card={item} width={56} />
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={s.name}>{item.name}{item.qty > 1 ? <Text style={s.muted}>  ×{item.qty}</Text> : null}</Text>
                <Text style={s.muted}>{item.set_code} #{item.collector_number} · {item.finish}{item.individual_card_id ? " · held individually" : ""}</Text>
                <LegalityTags legalities={item.legalities} />
              </View>
              <Text style={s.price}>{dollars(item.market_cents)}</Text>
            </Pressable>
          );
        }}
      />
      <ErrorText>{vault.error}</ErrorText>

      {chosen.length > 0 && (
        <View style={s.bar}>
          <Text style={s.body}>{chosen.reduce((n, c) => n + c.qty, 0)} selected</Text>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Button testID="ship" kind="ghost" label="Ship" onPress={() => setAction("ship")} />
            <Button testID="sell" label="Sell for credit" onPress={() => setAction("sell")} />
          </View>
        </View>
      )}
      {action === "sell" && <SellSheet items={chosen} onClose={() => setAction(null)} onDone={done} />}
      {action === "ship" && <ShipSheet items={chosen} onClose={() => setAction(null)} onDone={done} />}
    </Screen>
  );
}

function SellSheet({ items, onClose, onDone }: { items: { h: Holding; qty: number }[]; onClose: () => void; onDone: () => void }) {
  const { refresh } = useSession();
  const [total, setTotal] = useState<number | null>(null);
  const [stale, setStale] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ status: string; total_credits: number; hold_until: string | null } | null>(null);
  const [key] = useState(() => `${Date.now()}-${Math.random().toString(36).slice(2)}`);

  useEffect(() => {
    api<{ total_credits: number; stale: boolean }>("POST", "/me/buyback/quote", { items: items.map(({ h, qty }) => ({ card_id: h.card_id, finish: h.finish, qty })) })
      .then((q) => { setTotal(q.total_credits); setStale(q.stale); }).catch((e) => setError(e.message));
  }, [items]);

  const sell = async () => {
    setBusy(true); setError(null);
    try {
      const r = await api("POST", "/me/buyback", { items: items.map(({ h, qty }) => asItem(h, qty)), idempotency_key: key });
      haptic.bigHit();
      setResult(r);
      await refresh();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <Sheet onClose={onClose}>
      {result ? (
        <>
          <Text style={s.h2}>{result.status === "held" ? "Sale received" : "Sold"}</Text>
          <Text style={s.body} testID="sold">
            {result.status === "held"
              ? `${credits(result.total_credits)} credits will be added after the processing window, by ${new Date(result.hold_until!).toLocaleDateString()}.`
              : `${credits(result.total_credits)} credits added. Store credit only: use it on packs and shipping.`}
          </Text>
          <Button label="Done" onPress={onDone} />
        </>
      ) : (
        <>
          <Text style={s.h2}>Sell back for credit</Text>
          <Text style={s.body}>90% of market at $2 and up, 50% from 50¢ to $2, and 2 credits for anything below.</Text>
          <Text style={s.total} testID="quote">{total == null ? "Quoting…" : `${credits(total)} credits`}</Text>
          {stale && <Text style={s.body}>Prices are refreshing for one or more of these cards. Try again shortly.</Text>}
          <Button testID="confirm-sell" label="Confirm sale" onPress={sell} busy={busy} disabled={total == null || stale} />
          <ErrorText>{error}</ErrorText>
        </>
      )}
    </Sheet>
  );
}

function ShipSheet({ items, onClose, onDone }: { items: { h: Holding; qty: number }[]; onClose: () => void; onDone: () => void }) {
  const { refresh } = useSession();
  const [addr, setAddr] = useState({ name: "", line1: "", city: "", state: "", zip: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ fee_credits: number } | null>(null);
  const value = items.reduce((n, { h, qty }) => n + (h.market_cents ?? 0) * qty, 0);
  const ship = async () => {
    setBusy(true); setError(null);
    try {
      setResult(await api("POST", "/me/shipments", { items: items.map(({ h, qty }) => asItem(h, qty)), address: addr }));
      await refresh();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const field = (k: keyof typeof addr, label: string) => (
    <TextInput testID={`addr-${k}`} value={addr[k]} onChangeText={(v) => setAddr({ ...addr, [k]: v })} placeholder={label}
      placeholderTextColor={colors.muted} style={s.input} />
  );
  return (
    <Sheet onClose={onClose}>
      {result ? (
        <>
          <Text style={s.h2}>Shipping requested</Text>
          <Text style={s.body}>{result.fee_credits ? `${credits(result.fee_credits)} credits shipping.` : "Free shipping."} We'll pull your cards and send tracking.</Text>
          <Button label="Done" onPress={onDone} />
        </>
      ) : (
        <>
          <Text style={s.h2}>Ship to me</Text>
          <Text style={s.body}>{value >= 5000 ? "Free shipping on $50 or more." : `$4.99 shipping under $50 (this is ${dollars(value)}).`}</Text>
          {field("name", "Full name")}{field("line1", "Street address")}
          <View style={{ flexDirection: "row", gap: 8 }}>
            <View style={{ flex: 2 }}>{field("city", "City")}</View>
            <View style={{ flex: 1 }}>{field("state", "State")}</View>
            <View style={{ flex: 1 }}>{field("zip", "ZIP")}</View>
          </View>
          <Button label="Request shipment" onPress={ship} busy={busy} disabled={!addr.name || !addr.line1 || !addr.zip} />
          <ErrorText>{error}</ErrorText>
        </>
      )}
    </Sheet>
  );
}

function Sheet({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={s.scrim} onPress={onClose} />
      <View style={s.sheet}>{children}</View>
    </Modal>
  );
}

const s = StyleSheet.create({
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", padding: 16 },
  h1: { color: colors.text, fontSize: 30, fontWeight: "900" },
  h2: { color: colors.text, fontSize: 22, fontWeight: "800" },
  value: { color: colors.accent, fontSize: 22, fontWeight: "900" },
  muted: { color: colors.muted, fontSize: 12 },
  section: { color: colors.muted, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1, fontSize: 12 },
  link: { color: colors.accent, fontWeight: "700" },
  pulls: { backgroundColor: colors.panel, borderColor: colors.line, borderTopWidth: 1, borderBottomWidth: 1, paddingVertical: 12, marginBottom: 8 },
  pullsHead: { flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 16, marginBottom: 10 },
  row: { flexDirection: "row", gap: 12, alignItems: "center", paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.line },
  rowOn: { backgroundColor: colors.panelHi },
  name: { color: colors.text, fontWeight: "700", fontSize: 15 },
  price: { color: colors.text, fontWeight: "800", fontSize: 15 },
  bar: { position: "absolute", left: 12, right: 12, bottom: 12, backgroundColor: colors.panel, borderRadius: radius, borderWidth: 1, borderColor: colors.accent,
    padding: 12, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  body: { color: colors.text, fontSize: 15, lineHeight: 21 },
  total: { color: colors.accent, fontSize: 26, fontWeight: "900" },
  scrim: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)" },
  sheet: { backgroundColor: colors.panel, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 20, paddingBottom: 36, gap: 12, borderColor: colors.line, borderWidth: 1 },
  input: { backgroundColor: colors.bg, color: colors.text, borderColor: colors.line, borderWidth: 1, borderRadius: radius, padding: 12 },
});
