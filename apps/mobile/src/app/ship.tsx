import { useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { Redirect, router } from "expo-router";
import { Text, TextInput } from "../components/Text";
import { Button, ErrorText, Footer, Panel, Screen, Title } from "../components/bits";
import { CardImage } from "../components/CardImage";
import { api } from "../lib/api";
import { useSession } from "../lib/session";
import { getShipCart } from "../lib/shipCart";
import { credits, dollars } from "../lib/format";
import { brand, colors, font, radii, type } from "../lib/theme";

type Address = { name: string; line1: string; line2: string; city: string; state: string; zip: string };

/**
 * Shipping checkout: the cards picked in the Vault, the shipping cost in credits, the address,
 * and one Confirm. Free at the free shipping value or more; otherwise a flat fee in credits.
 */
export default function Ship() {
  const cart = getShipCart();
  const { me, refresh } = useSession();
  const [addr, setAddr] = useState<Address>({ name: "", line1: "", line2: "", city: "", state: "", zip: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ fee_credits: number } | null>(null);
  if (!cart || !cart.items.length) return <Redirect href="/vault" />;

  const count = cart.items.reduce((n, i) => n + i.qty, 0);
  const value = cart.items.reduce((n, i) => n + (i.market_cents ?? 0) * i.qty, 0);
  const free = value >= cart.shipping.free_min;
  const fee = free ? 0 : cart.shipping.fee;
  const balance = me?.credits.total ?? 0;
  const short = fee > balance;
  const ready = !!(addr.name && addr.line1 && addr.city && addr.state && addr.zip);

  const confirm = async () => {
    setBusy(true); setError(null);
    try {
      const items = cart.items.map((i) => i.individual_card_id ? { individual_card_id: i.individual_card_id }
        : { card_id: i.card_id, finish: i.finish, condition: i.condition, qty: i.qty });
      setResult(await api("POST", "/me/shipments", { items, address: addr }));
      cart.shipped = true;
      await refresh();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const field = (k: keyof Address, label: string, auto: string) => (
    <TextInput testID={`addr-${k}`} value={addr[k]} onChangeText={(v) => setAddr({ ...addr, [k]: v })} placeholder={label}
      accessibilityLabel={label} placeholderTextColor={colors.fieldHint} style={s.field} autoComplete={auto as never} />
  );

  if (result) {
    return (
      <Screen>
        <View style={s.wrap}>
          <Title balance={false}>Shipping requested</Title>
          <Panel style={{ gap: 10, marginHorizontal: 16 }} testID="ship-done">
            <Text style={type.body}>{result.fee_credits ? `${credits(result.fee_credits)} credits for shipping.` : "Free shipping."} We'll pack your {count} card{count > 1 ? "s" : ""} and email you tracking.</Text>
            <Button label="Back to my Vault" testID="ship-back" onPress={() => (router.canGoBack() ? router.back() : router.replace("/vault"))} />
          </Panel>
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ paddingBottom: 32 }} keyboardShouldPersistTaps="handled">
        <View style={s.wrap}>
          <Title back="/vault" sub={`${count} card${count > 1 ? "s" : ""} to ship`}>Shipping checkout</Title>
          <View style={{ paddingHorizontal: 16, gap: 14 }}>
            <Panel style={{ gap: 0 }} testID="ship-items">
              <Text style={[type.label, { marginBottom: 6 }]}>Your cards</Text>
              {cart.items.map((i) => (
                <View key={i.key} style={s.item}>
                  <CardImage card={i} width={40} />
                  <View style={{ flex: 1 }}>
                    <Text style={s.name} numberOfLines={1}>{i.name}{i.qty > 1 ? `  x${i.qty}` : ""}</Text>
                    <Text style={type.small}>{i.set_name} · #{i.collector_number}{i.finish !== "nonfoil" ? ` · ${i.finish}` : ""}</Text>
                  </View>
                  <Text style={s.price}>{dollars(i.market_cents)}</Text>
                </View>
              ))}
            </Panel>

            <Panel style={{ gap: 10 }}>
              <Text style={type.label}>Ship to</Text>
              {field("name", "Full name", "name")}
              {field("line1", "Street address", "address-line1")}
              {field("line2", "Apartment, suite (optional)", "address-line2")}
              <View style={{ flexDirection: "row", gap: 8 }}>
                <View style={{ flex: 2 }}>{field("city", "City", "address-level2")}</View>
                <View style={{ flex: 1 }}>{field("state", "State", "address-level1")}</View>
                <View style={{ flex: 1.3 }}>{field("zip", "ZIP", "postal-code")}</View>
              </View>
            </Panel>

            <Panel style={{ gap: 8 }} testID="ship-summary">
              <Text style={type.label}>Summary</Text>
              <Row label="Shipping" value={free ? "Free" : `${credits(fee)} credits`} testID="ship-fee" />
              <Text style={type.small}>Free on {dollars(cart.shipping.free_min)} or more in market value. Otherwise {dollars(cart.shipping.fee)} ({credits(cart.shipping.fee)} credits).</Text>
              <Row label="Your credits" value={credits(balance)} />
              {fee > 0 && <Row label="After shipping" value={credits(Math.max(0, balance - fee))} />}
              {short && (
                <Text style={[type.small, { color: colors.text }]}>
                  You need {credits(fee - balance)} more credits.{" "}
                  <Text style={s.link} accessibilityRole="link" onPress={() => router.push("/add-credits")}>Add credits</Text>
                </Text>
              )}
            </Panel>

            <Button testID="request-shipment" label={free ? "Confirm free shipping" : `Confirm · ${credits(fee)} credits`}
              onPress={confirm} busy={busy} disabled={!ready || short} />
            <ErrorText>{error}</ErrorText>
          </View>
        </View>
        <Footer />
      </ScrollView>
    </Screen>
  );
}

function Row({ label, value, testID }: { label: string; value: string; testID?: string }) {
  return (
    <View style={s.row}>
      <Text style={type.body}>{label}</Text>
      <Text style={s.value} testID={testID}>{value}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { maxWidth: 640, width: "100%", alignSelf: "center" },
  item: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.line },
  name: { fontFamily: font.bodySemi, fontSize: 14, color: colors.text },
  price: { fontFamily: font.bodyMedium, fontSize: 13, color: colors.muted },
  field: { backgroundColor: colors.field, color: colors.fieldInk, borderRadius: radii.control, paddingHorizontal: 14, minHeight: 46, fontSize: 15 },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  value: { fontFamily: font.bodyBold, fontSize: 15, color: brand.gold },
  link: { color: colors.link, textDecorationLine: "underline", fontFamily: font.bodySemi },
});
