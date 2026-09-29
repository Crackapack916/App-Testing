import { ScrollView, StyleSheet, View, useWindowDimensions } from "react-native";
import { Text } from "../../components/Text";
import { router, useLocalSearchParams } from "expo-router";
import { BackButton, Button, LegalityTags, Screen, Footer } from "../../components/bits";
import { CardImage } from "../../components/CardImage";
import { ResultTile, type SearchCard } from "../(tabs)/search";
import { useApi } from "../../lib/useApi";
import { dollars } from "../../lib/format";
import { colors, font } from "../../lib/theme";

type Card = { id: string; name: string; set_code: string; set_name: string | null; collector_number: string; rarity: string; type_line: string | null;
  mana_cost: string | null; oracle_text: string | null; finishes: string[]; legalities: Record<string, string>;
  prices: Record<string, { cents: number; asof: string }> | null; image_url: string | null };

const asOf = (t: string) => new Date(t).toLocaleDateString("en-US", { timeZone: "America/Los_Angeles", month: "short", day: "numeric", year: "numeric" });

/** Card detail sheet: large image, every printing, legalities, market prices with their date. */
export default function CardDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data } = useApi<{ card: Card; printings: SearchCard[] }>(`/cards/${id}`);
  const { width } = useWindowDimensions();
  const c = data?.card;
  const tile = Math.min(140, Math.floor((Math.min(width, 900) - 32 - 24) / 3));
  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 14, maxWidth: 900, width: "100%", alignSelf: "center" }}>
        <BackButton fallback="/search" />
        {c && <>
          <View style={{ alignItems: "center" }}><CardImage card={c} width={Math.min(width - 64, 320)} /></View>
          <View style={{ gap: 6 }}>
            <Text style={s.name} testID="card-name">{c.name} <Text style={s.muted}>{c.mana_cost}</Text></Text>
            <Text style={s.muted}>{c.type_line}</Text>
            <Text style={s.muted}>{c.set_name ?? c.set_code} · #{c.collector_number} · {c.rarity}</Text>
            {c.oracle_text ? <Text style={s.body}>{c.oracle_text}</Text> : null}
            <Text style={s.section}>Market price</Text>
            <View style={s.prices} testID="card-prices">
              {c.finishes.map((f) => {
                const p = c.prices?.[f];
                return <Text key={f} style={s.price}>{f}: {p ? `${dollars(p.cents)} as of ${asOf(p.asof)}` : "no price"}</Text>;
              })}
            </View>
            <Text style={s.section}>Legality</Text>
            <View testID="card-legalities"><LegalityTags legalities={c.legalities} /></View>
          </View>
          {!!data?.printings.length && (
            <View style={{ gap: 8 }}>
              <Text style={s.section}>Other printings ({data.printings.length})</Text>
              <View style={s.grid}>{data.printings.map((p) => <ResultTile key={p.id} card={p} width={tile} />)}</View>
            </View>
          )}
        </>}
        <Button kind="ghost" label="Close" onPress={() => (router.canGoBack() ? router.back() : router.replace("/search"))} />
        <Footer />
      </ScrollView>
    </Screen>
  );
}

const s = StyleSheet.create({
  name: { color: colors.text, fontSize: 22, fontFamily: font.display },
  muted: { color: colors.muted, fontSize: 13, fontFamily: font.body },
  body: { color: colors.text, fontSize: 15, lineHeight: 22, marginTop: 6 },
  section: { color: colors.muted, fontSize: 12, textTransform: "uppercase", letterSpacing: 1, marginTop: 8 },
  prices: { gap: 4 },
  price: { color: colors.text, fontFamily: font.bodyBold, textTransform: "capitalize" },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
});
