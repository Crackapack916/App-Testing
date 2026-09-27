import { useEffect, useState } from "react";
import { FlatList, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Button, ErrorText, Panel, Screen } from "../../components/bits";
import { PackArt } from "../../components/PackArt";
import { CardImage } from "../../components/CardImage";
import { api } from "../../lib/api";
import { useApi } from "../../lib/useApi";
import { useSession } from "../../lib/session";
import { credits, countdown, dollars } from "../../lib/format";
import { haptic } from "../../lib/feedback";
import { colors, radius } from "../../lib/theme";

type Tier = { min_qty: number; per_pack_credits: number };
type Product = { product_id: string; set_code: string; set_name: string; booster_type: string; name: string;
  single_pack_credits: string; available_packs: number; available: boolean; ladder: Tier[] };
type Storefront = { products: Product[]; next_cutoff: string; batch_date: string; now: string };
type BigPull = { name: string; set_code: string; collector_number: string; rarity: string; finish: string; image_url: string | null; set_name: string };

const QUANTITIES = [1, 3, 6, 9, 12];
const perPack = (ladder: Tier[], qty: number) => [...ladder].reverse().find((t) => t.min_qty <= qty)?.per_pack_credits ?? 0;

export default function Packs() {
  const { me } = useSession();
  const store = useApi<Storefront>("/storefront");
  const feed = useApi<{ pulls: BigPull[] }>("/feed/big-pulls");
  const [ordering, setOrdering] = useState<Product | null>(null);
  // Count down on the server's clock: a phone's clock can be minutes (or days) off.
  const [skew, setSkew] = useState(0);
  useEffect(() => { if (store.data?.now) setSkew(new Date(store.data.now).getTime() - Date.now()); }, [store.data?.now]);
  const now = useNow(30_000) + skew;

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        <View style={s.header}>
          <View>
            <Text style={s.h1}>Packs</Text>
            <Text style={s.sub} testID="cutoff">
              {store.data ? `Tonight's queue locks in ${countdown(store.data.next_cutoff, now)} · opened live 7 to 8pm PT` : " "}
            </Text>
          </View>
          <View style={s.balance}>
            <Text style={s.balanceNum} testID="balance">{credits(me?.credits.total)}</Text>
            <Text style={s.balanceLabel}>credits</Text>
          </View>
        </View>

        {!!feed.data?.pulls.length && (
          <View style={{ marginBottom: 12 }}>
            <Text style={s.section}>Big pulls this week</Text>
            <FlatList horizontal data={feed.data.pulls} keyExtractor={(p, i) => `${p.set_code}${p.collector_number}${i}`}
              contentContainerStyle={{ paddingHorizontal: 16, gap: 10 }} showsHorizontalScrollIndicator={false}
              renderItem={({ item }) => <CardImage card={item} width={84} />} />
          </View>
        )}

        <Text style={s.section}>On sale tonight</Text>
        <View style={{ paddingHorizontal: 16, gap: 12 }}>
          {store.data?.products.map((p) => (
            <Pressable key={p.product_id} testID={`product-${p.set_code}`} disabled={!p.available}
              onPress={() => { haptic.tap(); setOrdering(p); }} style={({ pressed }) => [pressed && { opacity: 0.85 }]}>
              <Panel style={s.product}>
                <PackArt setCode={p.set_code} setName={p.set_name} boosterType={p.booster_type} width={92} />
                <View style={{ flex: 1, gap: 6 }}>
                  <Text style={s.pname}>{p.name}</Text>
                  <Text style={s.price}>{credits(Number(p.single_pack_credits))} credits <Text style={s.muted}>per pack</Text></Text>
                  <Text style={s.muted}>From {dollars(Math.min(...p.ladder.map((t) => t.per_pack_credits)))} a pack in bigger orders</Text>
                  <Text style={[s.stock, !p.available && { color: colors.danger }]}>
                    {p.available ? "Sealed stock available" : "Sold out of sealed stock tonight"}
                  </Text>
                </View>
              </Panel>
            </Pressable>
          ))}
          {store.data && !store.data.products.length && <Text style={s.muted}>No sets on sale right now.</Text>}
          <ErrorText>{store.error}</ErrorText>
        </View>

        <Text style={s.how}>
          How it works: your pack stays sealed. Orders before 7pm Pacific join tonight's queue, which locks at the cutoff.
          We open each pack on camera in queue order, and you get your clip and cards by 9pm.
        </Text>
      </ScrollView>

      <OrderSheet product={ordering} onClose={() => setOrdering(null)}
        onPlaced={() => { store.reload(); }} />
    </Screen>
  );
}

function OrderSheet({ product, onClose, onPlaced }: { product: Product | null; onClose: () => void; onPlaced: () => void }) {
  const { me, refresh } = useSession();
  const [qty, setQty] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [placed, setPlaced] = useState<string | null>(null);
  useEffect(() => { setQty(1); setError(null); setPlaced(null); }, [product?.product_id]);
  if (!product) return null;
  const each = perPack(product.ladder, qty);
  const total = each * qty;
  const short = (me?.credits.total ?? 0) < total;

  const place = async () => {
    setBusy(true); setError(null);
    try {
      const r = await api<{ order_id: string }>("POST", "/orders", { product_id: product.product_id, quantity: qty });
      haptic.bigHit();
      setPlaced(r.order_id);
      await refresh();
      onPlaced();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={s.scrim} onPress={onClose} />
      <View style={s.sheet} testID="order-sheet">
        {placed ? (
          <View style={{ gap: 12 }}>
            <Text style={s.h2}>You're in tonight's queue</Text>
            <Text style={s.body} testID="placed">
              {qty} {product.name}{qty > 1 ? "s" : ""}, still sealed. Your spot locks at 7pm Pacific, we open it on camera between 7 and 8,
              and you'll get "You just cracked a pack" by 9.
            </Text>
            <Button label="Done" onPress={onClose} />
          </View>
        ) : (
          <View style={{ gap: 14 }}>
            <Text style={s.h2}>{product.name}</Text>
            <View style={s.qtyRow}>
              {QUANTITIES.map((q) => (
                <Pressable key={q} testID={`qty-${q}`} onPress={() => { haptic.tap(); setQty(q); }}
                  style={[s.qty, qty === q && s.qtyOn]}>
                  <Text style={[s.qtyNum, qty === q && { color: colors.accentInk }]}>{q}</Text>
                  <Text style={[s.qtyEach, qty === q && { color: colors.accentInk }]}>{dollars(perPack(product.ladder, q))}</Text>
                </Pressable>
              ))}
            </View>
            <View style={s.totalRow}>
              <Text style={s.body}>{qty} pack{qty > 1 ? "s" : ""} · {dollars(each)} each</Text>
              <Text style={s.total} testID="total">{credits(total)} credits</Text>
            </View>
            {short && <Text style={s.warn}>You have {credits(me?.credits.total)} credits. Add credits in Account.</Text>}
            <Button testID="place-order" label="Join tonight's queue" onPress={place} busy={busy} disabled={short} />
            <Text style={s.fine}>Cancel any time before 7pm Pacific for a full credit refund. After the cutoff the queue is locked.</Text>
            <ErrorText>{error}</ErrorText>
          </View>
        )}
      </View>
    </Modal>
  );
}

function useNow(ms: number) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(t); }, [ms]);
  return now;
}

const s = StyleSheet.create({
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", padding: 16 },
  h1: { color: colors.text, fontSize: 30, fontWeight: "900" },
  h2: { color: colors.text, fontSize: 22, fontWeight: "800" },
  sub: { color: colors.muted, marginTop: 2, maxWidth: 240 },
  balance: { alignItems: "flex-end" },
  balanceNum: { color: colors.accent, fontSize: 22, fontWeight: "900" },
  balanceLabel: { color: colors.muted, fontSize: 11 },
  section: { color: colors.muted, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1, fontSize: 12, paddingHorizontal: 16, marginBottom: 8 },
  product: { flexDirection: "row", gap: 14, alignItems: "center" },
  pname: { color: colors.text, fontSize: 18, fontWeight: "800" },
  price: { color: colors.accent, fontSize: 16, fontWeight: "800" },
  muted: { color: colors.muted, fontWeight: "400", fontSize: 13 },
  stock: { color: colors.ok, fontSize: 12, fontWeight: "600" },
  how: { color: colors.muted, fontSize: 12, lineHeight: 18, padding: 16, marginTop: 8 },
  scrim: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)" },
  sheet: { backgroundColor: colors.panel, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 20, paddingBottom: 36, borderColor: colors.line, borderWidth: 1 },
  qtyRow: { flexDirection: "row", gap: 8 },
  qty: { flex: 1, borderRadius: radius, borderWidth: 1, borderColor: colors.line, paddingVertical: 10, alignItems: "center" },
  qtyOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  qtyNum: { color: colors.text, fontSize: 20, fontWeight: "900" },
  qtyEach: { color: colors.muted, fontSize: 11 },
  totalRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  total: { color: colors.text, fontSize: 20, fontWeight: "900" },
  body: { color: colors.text, fontSize: 15, lineHeight: 21 },
  warn: { color: colors.accent },
  fine: { color: colors.muted, fontSize: 12 },
});
