import { useState } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { router } from "expo-router";
import * as Linking from "expo-linking";
import { X } from "lucide-react-native";
import { Text } from "../components/Text";
import { Button, ErrorText, Footer, Screen, Title } from "../components/bits";
import { RATE_SENTENCE } from "../components/Credits";
import { api } from "../lib/api";
import { useApi } from "../lib/useApi";
import { useSession } from "../lib/session";
import { credits, dollars } from "../lib/format";
import { colors, font, palette, radii, type } from "../lib/theme";

type Bundle = { key: string; credits: number; packs: number };

/** Add credits: web checkout only. The rate is stated here and in Account. */
export default function AddCredits() {
  const { me } = useSession();
  const bundles = useApi<{ bundles: Bundle[] }>("/bundles");
  const [choice, setChoice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pay = async () => {
    if (!choice) return;
    setBusy(true); setError(null);
    try {
      const back = Platform.OS === "web" ? `${window.location.origin}/account` : Linking.createURL("/account");
      const r = await api<{ url: string }>("POST", "/checkout", { bundle_key: choice, success_url: back, cancel_url: back });
      if (Platform.OS === "web") window.location.assign(r.url); else await Linking.openURL(r.url);
    } catch (e) { setError((e as Error).message); setBusy(false); }
  };
  return (
    <Screen>
      <ScrollView>
        <View style={s.wrap}>
          <View style={s.head}>
            <Title>Add credits</Title>
            <Pressable accessibilityRole="button" accessibilityLabel="Close" style={s.close}
              onPress={() => (router.canGoBack() ? router.back() : router.replace("/account"))}><X size={22} color={colors.text} /></Pressable>
          </View>
          <View style={{ paddingHorizontal: 16, gap: 14 }}>
            <Text style={type.body}>1 credit = 1 cent. 100 credits = $1.</Text>
            <Text style={type.small}>{RATE_SENTENCE}</Text>
            {!me && <Button label="Log in to add credits" onPress={() => router.push("/sign-in")} />}
            <View style={{ gap: 10 }} accessibilityRole="radiogroup">
              {bundles.data?.bundles.map((b) => {
                const on = choice === b.key;
                return (
                  <Pressable key={b.key} testID={`bundle-${b.key}`} onPress={() => setChoice(b.key)} accessibilityRole="radio" accessibilityState={{ checked: on }}
                    style={[s.bundle, on && s.bundleOn]}>
                    <View style={{ flex: 1 }}>
                      <Text style={s.num}>{credits(b.credits)} credits</Text>
                      <Text style={type.small}>Enough for {b.packs} pack{b.packs > 1 ? "s" : ""} at the {b.packs} pack price</Text>
                    </View>
                    <Text style={s.price}>{dollars(b.credits)}</Text>
                  </Pressable>
                );
              })}
            </View>
            {me && <Button testID="checkout" label={choice ? "Continue to secure checkout" : "Choose an amount"} onPress={pay} busy={busy} disabled={!choice} />}
            <Text style={type.small}>Payment is handled by Stripe on a secure page. The price shown is the price you pay.</Text>
            <Text style={[type.small, { color: colors.link, textDecorationLine: "underline" }]} accessibilityRole="link" onPress={() => router.push("/policies")}>Fairness and policies</Text>
            <ErrorText>{error}</ErrorText>
          </View>
        </View>
        <Footer />
      </ScrollView>
    </Screen>
  );
}

const s = StyleSheet.create({
  wrap: { maxWidth: 560, width: "100%", alignSelf: "center" },
  head: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingRight: 16 },
  close: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  bundle: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: radii.tile, borderWidth: 1.5, borderColor: colors.line, backgroundColor: palette.ink[100] },
  bundleOn: { borderColor: palette.blue[500], backgroundColor: palette.sky[100] },
  num: { fontFamily: font.monoMedium, fontSize: 18, color: colors.text },
  price: { fontFamily: font.displaySemi, fontSize: 18, color: colors.text },
});
