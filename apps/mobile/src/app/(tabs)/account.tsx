import { useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { router } from "expo-router";
import { Text } from "../../components/Text";
import { SignInPrompt } from "../../components/SignInPrompt";
import { Button, ErrorText, Footer, Panel, Screen, Title } from "../../components/bits";
import { CreditsPanel } from "../../components/Credits";
import { LimitsPanel } from "../../components/Limits";
import { api } from "../../lib/api";
import { useApi } from "../../lib/useApi";
import { useSession } from "../../lib/session";
import { credits } from "../../lib/format";
import { colors, font, type } from "../../lib/theme";

type Order = { id: string; quantity: number; total_credits: number; status: string; product: string; batch_date: string; batch_status: string;
  positions: number[] | null; packs_opened: number };

/** Account: credits, spending limits and breaks, orders, and the policies. */
export default function Account() {
  const { me } = useSession();
  if (!me) return <Screen><SignInPrompt title="Account" body="Log in to see your credits, orders and spending settings." /></Screen>;
  return <AccountScreen />;
}

function AccountScreen() {
  const { me, signOut, refresh } = useSession();
  const orders = useApi<{ orders: Order[] }>("/orders");
  const [error, setError] = useState<string | null>(null);
  const cancel = async (o: Order) => {
    try { await api("POST", `/orders/${o.id}/cancel`); await Promise.all([orders.reload(), refresh()]); }
    catch (e) { setError((e as Error).message); }
  };
  return (
    <Screen>
      <ScrollView>
        <View style={s.wrap}>
          <Title sub={me?.email}>Account</Title>
          <View style={s.cols}>
            <View style={s.col}>
              <CreditsPanel />
            </View>
            <View style={s.col}>
              <LimitsPanel />
              <Panel style={{ gap: 8 }}>
                <Text style={type.label} accessibilityRole="header">Orders</Text>
                {orders.data && !orders.data.orders.length ? <Text style={type.small}>No orders yet.</Text> : null}
                {orders.data?.orders.map((o) => (
                  <View key={o.id} style={s.order} testID={`order-${o.status}`}>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={s.body}>{o.quantity} x {o.product}</Text>
                      <Text style={type.small}>{o.batch_date}, {statusText(o)}{o.positions?.length ? `, queue ${o.positions.join(", ")}` : ""}</Text>
                      <Text style={type.mono}>{credits(o.total_credits)} credits</Text>
                    </View>
                    {o.status === "queued" && o.batch_status === "open" && <Button kind="ghost" label="Cancel" onPress={() => cancel(o)} />}
                  </View>
                ))}
                <ErrorText>{error}</ErrorText>
              </Panel>
              <Panel style={{ gap: 8 }}>
                <Text style={type.label} accessibilityRole="header">Policies</Text>
                <Button kind="ghost" label="Fairness and policies" onPress={() => router.push("/policies")} />
              </Panel>
              <Button kind="ghost" label="Sign out" onPress={signOut} />
            </View>
          </View>
        </View>
        <Footer />
      </ScrollView>
    </Screen>
  );
}

function statusText(o: Order) {
  if (o.status === "cancelled") return "cancelled, credits returned";
  if (o.status === "fulfilled") return "cracked, in your Vault";
  if (o.batch_status === "open") return "sealed, in tonight's queue";
  if (o.batch_status === "locked") return "queue locked, opening tonight";
  return `opening now (${o.packs_opened} of ${o.quantity})`;
}

const s = StyleSheet.create({
  wrap: { maxWidth: 1100, width: "100%", alignSelf: "center" },
  cols: { flexDirection: "row", flexWrap: "wrap", gap: 16, paddingHorizontal: 16 },
  col: { flexGrow: 1, flexBasis: 340, gap: 16 },
  order: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.line },
  body: { fontFamily: font.bodySemi, fontSize: 15, color: colors.text },
});
