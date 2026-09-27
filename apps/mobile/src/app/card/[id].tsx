import { ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { Button, LegalityTags, Screen } from "../../components/bits";
import { CardImage } from "../../components/CardImage";
import { useApi } from "../../lib/useApi";
import { dollars } from "../../lib/format";
import { colors } from "../../lib/theme";

type Card = { id: string; name: string; set_code: string; set_name: string | null; collector_number: string; rarity: string; type_line: string | null;
  mana_cost: string | null; oracle_text: string | null; finishes: string[]; legalities: Record<string, string>; prices: Record<string, number> | null; image_url: string | null };

export default function CardDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data } = useApi<{ card: Card; printings: Card[] }>(`/cards/${id}`);
  const { width } = useWindowDimensions();
  const c = data?.card;
  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 14, alignItems: "center" }}>
        {c && <>
          <CardImage card={c} width={Math.min(width - 64, 320)} glow />
          <View style={{ alignSelf: "stretch", gap: 6 }}>
            <Text style={s.name} testID="card-name">{c.name} <Text style={s.muted}>{c.mana_cost}</Text></Text>
            <Text style={s.muted}>{c.type_line}</Text>
            <Text style={s.muted}>{c.set_name ?? c.set_code} · #{c.collector_number} · {c.rarity}</Text>
            {c.oracle_text ? <Text style={s.body}>{c.oracle_text}</Text> : null}
            <View style={s.prices}>
              {c.finishes.map((f) => <Text key={f} style={s.price}>{f} {dollars(c.prices?.[f] ?? null)}</Text>)}
            </View>
            <View testID="card-legalities"><LegalityTags legalities={c.legalities} /></View>
            {!!data?.printings.length && <Text style={[s.muted, { marginTop: 8 }]}>{data.printings.length} other printings</Text>}
          </View>
        </>}
        <Button kind="ghost" label="Close" onPress={() => router.back()} />
      </ScrollView>
    </Screen>
  );
}

const s = StyleSheet.create({
  name: { color: colors.text, fontSize: 22, fontWeight: "800" },
  muted: { color: colors.muted, fontSize: 13, fontWeight: "400" },
  body: { color: colors.text, fontSize: 15, lineHeight: 22, marginTop: 6 },
  prices: { flexDirection: "row", gap: 16, marginVertical: 8 },
  price: { color: colors.text, fontWeight: "700", textTransform: "capitalize" },
});
