import { useEffect, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import { Screen } from "../../components/bits";
import { CardImage } from "../../components/CardImage";
import { api } from "../../lib/api";
import { dollars } from "../../lib/format";
import { colors, radius } from "../../lib/theme";

type Result = { id: string; name: string; set_code: string; set_name: string | null; collector_number: string; rarity: string;
  type_line: string | null; mana_cost: string | null; prices: Record<string, number> | null; image_url: string | null };

/** Card lookup across every paper printing, from MTGJSON. */
export default function Search() {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (q.trim().length < 2) { setResults([]); return; }
    const t = setTimeout(() => {
      api<{ cards: Result[] }>("GET", `/cards/search?q=${encodeURIComponent(q.trim())}`)
        .then((r) => { setResults(r.cards); setError(null); }).catch((e) => setError(e.message));
    }, 200);
    return () => clearTimeout(t);
  }, [q]);

  return (
    <Screen>
      <Text style={s.h1}>Search</Text>
      <TextInput testID="search" value={q} onChangeText={setQ} placeholder="Card name, type or rules text" placeholderTextColor={colors.muted}
        autoCorrect={false} style={s.input} clearButtonMode="while-editing" />
      {error && <Text style={s.error}>{error}</Text>}
      <FlatList
        data={results}
        keyExtractor={(r) => r.id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: 40 }}
        ListEmptyComponent={<Text style={s.hint}>{q.trim().length < 2 ? "Search every printing. Prices update daily." : "No cards found."}</Text>}
        renderItem={({ item }) => (
          <Pressable testID={`result-${item.set_code}-${item.collector_number}`} onPress={() => router.push(`/card/${item.id}`)} style={s.row}>
            <CardImage card={item} width={52} />
            <View style={{ flex: 1 }}>
              <Text style={s.name}>{item.name}</Text>
              <Text style={s.muted}>{item.type_line}</Text>
              <Text style={s.muted}>{item.set_name ?? item.set_code} · #{item.collector_number}</Text>
            </View>
            <View style={{ alignItems: "flex-end" }}>
              <Text style={s.price}>{dollars(item.prices?.nonfoil ?? null)}</Text>
              {item.prices?.foil != null && <Text style={s.foil}>foil {dollars(item.prices.foil)}</Text>}
            </View>
          </Pressable>
        )}
      />
    </Screen>
  );
}

const s = StyleSheet.create({
  h1: { color: colors.text, fontSize: 30, fontWeight: "900", paddingHorizontal: 16, paddingTop: 16 },
  input: { margin: 16, backgroundColor: colors.panel, color: colors.text, borderColor: colors.line, borderWidth: 1, borderRadius: radius, padding: 14, fontSize: 16 },
  row: { flexDirection: "row", gap: 12, paddingHorizontal: 16, paddingVertical: 10, alignItems: "center", borderBottomWidth: 1, borderBottomColor: colors.line },
  name: { color: colors.text, fontWeight: "700", fontSize: 15 },
  muted: { color: colors.muted, fontSize: 12 },
  price: { color: colors.text, fontWeight: "800" },
  foil: { color: "#c9a8ff", fontSize: 12 },
  hint: { color: colors.muted, padding: 16, textAlign: "center" },
  error: { color: "#FFB4B6", paddingHorizontal: 16 },
});
