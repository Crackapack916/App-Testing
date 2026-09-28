import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import * as Linking from "expo-linking";
import { SignInPrompt } from "../../components/SignInPrompt";
import { Button, ErrorText, Panel, Screen } from "../../components/bits";
import { LimitsPanel } from "../../components/Limits";
import { api } from "../../lib/api";
import { useApi } from "../../lib/useApi";
import { useSession } from "../../lib/session";
import { credits, dollars } from "../../lib/format";
import { colors } from "../../lib/theme";

type Bundle = { key: string; credits: number; packs: number };
type Order = { id: string; quantity: number; total_credits: number; status: string; product: string; batch_date: string; batch_status: string;
  positions: number[] | null; packs_opened: number; clip_ref: string | null };
type Note = { id: string; kind: string; order_id: string; sent_at: string; opened_at: string | null; clip_ref: string | null };

export default function Account() {
  const { me: signedIn } = useSession();
  if (!signedIn) return <Screen><SignInPrompt title="Account" body="Log in to see your credits, orders and spending settings." /></Screen>;
  return <AccountScreen />;
}

function AccountScreen() {
  const { me, signOut, refresh } = useSession();
  const bundles = useApi<{ bundles: Bundle[] }>("/bundles");
  const orders = useApi<{ orders: Order[] }>("/orders");
  const notes = useApi<{ notifications: Note[] }>("/me/notifications");
  const [error, setError] = useState<string | null>(null);

  // Credits are bought on the web checkout, never as an in app purchase.
  const buy = async (b: Bundle) => {
    setError(null);
    try {
      const back = Linking.createURL("/account");
      const r = await api<{ url: string }>("POST", "/checkout", { bundle_key: b.key, success_url: back, cancel_url: back });
      await WebBrowser.openAuthSessionAsync(r.url, back);
      await refresh();
    } catch (e) { setError((e as Error).message); }
  };
  const cancel = async (o: Order) => {
    try { await api("POST", `/orders/${o.id}/cancel`); await Promise.all([orders.reload(), refresh()]); }
    catch (e) { setError((e as Error).message); }
  };

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 40 }}>
        <Text style={s.h1}>Account</Text>

        <Panel>
          <Text style={s.label}>Credit balance</Text>
          <Text style={s.big} testID="account-credits">{credits(me?.credits.total)}</Text>
          <Text style={s.muted}>{credits(me?.credits.refundable)} purchased (refundable while unspent){me?.features.buyback ? ` · ${credits(me?.credits.earned)} from sell backs` : ""}</Text>
          <View style={s.bundles}>
            {bundles.data?.bundles.map((b) => (
              <Pressable key={b.key} onPress={() => buy(b)} style={s.bundle}>
                <Text style={s.bundleCredits}>{credits(b.credits)}</Text>
                <Text style={s.muted}>{dollars(b.credits)} · {b.packs} pack{b.packs > 1 ? "s" : ""}</Text>
              </Pressable>
            ))}
          </View>
          <ErrorText>{error}</ErrorText>
        </Panel>

        <LimitsPanel />

        <Text style={s.section}>Cracked</Text>
        {notes.data?.notifications.length ? notes.data.notifications.map((n) => (
          <Panel key={n.id} style={s.noteRow}>
            <View style={{ flex: 1 }}>
              <Text style={s.body}>You just cracked a pack</Text>
              <Text style={s.muted}>{new Date(n.sent_at).toLocaleString()}</Text>
            </View>
            <Button kind="ghost" label="Reveal" onPress={() => router.push({ pathname: "/reveal", params: { notification: n.id } })} />
            {n.clip_ref && <Button kind="ghost" label="Clip" onPress={() => router.push({ pathname: "/clip", params: { src: n.clip_ref! } })} />}
          </Panel>
        )) : <Text style={s.muted}>Your nightly clips appear here after your packs are opened.</Text>}

        <Text style={s.section}>Orders</Text>
        {orders.data?.orders.map((o) => (
          <Panel key={o.id} style={s.noteRow}>
            <View style={{ flex: 1 }} testID={`order-${o.status}`}>
              <Text style={s.body}>{o.quantity} × {o.product}</Text>
              <Text style={s.muted}>
                {o.batch_date} · {statusText(o)}{o.positions?.length ? ` · queue #${o.positions.join(", #")}` : ""}
              </Text>
            </View>
            {o.status === "queued" && o.batch_status === "open" && <Button kind="ghost" label="Cancel" onPress={() => cancel(o)} />}
          </Panel>
        ))}

        <Button kind="ghost" label="Sign out" onPress={signOut} />
      </ScrollView>
    </Screen>
  );
}

function statusText(o: Order) {
  if (o.status === "cancelled") return "cancelled, credits returned";
  if (o.status === "fulfilled") return "cracked";
  if (o.batch_status === "open") return "sealed, in tonight's queue";
  if (o.batch_status === "locked") return "queue locked, opening soon";
  return `opening now (${o.packs_opened}/${o.quantity})`;
}

const s = StyleSheet.create({
  h1: { color: colors.text, fontSize: 30, fontWeight: "900" },
  label: { color: colors.muted, fontSize: 12, textTransform: "uppercase", letterSpacing: 1 },
  big: { color: colors.accent, fontSize: 36, fontWeight: "900" },
  muted: { color: colors.muted, fontSize: 12 },
  body: { color: colors.text, fontSize: 15, fontWeight: "600" },
  section: { color: colors.muted, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1, fontSize: 12 },
  bundles: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 },
  bundle: { borderWidth: 1, borderColor: colors.line, borderRadius: 12, padding: 10, minWidth: 96 },
  bundleCredits: { color: colors.text, fontWeight: "800", fontSize: 16 },
  noteRow: { flexDirection: "row", alignItems: "center", gap: 8 },
});
