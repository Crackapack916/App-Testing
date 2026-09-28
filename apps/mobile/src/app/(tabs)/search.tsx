import { useEffect, useMemo, useState } from "react";
import { FlatList, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from "react-native";
import { Text, TextInput } from "../../components/Text";
import { Image } from "expo-image";
import { router } from "expo-router";
import { Screen, Footer } from "../../components/bits";
import { CardImage } from "../../components/CardImage";
import { api } from "../../lib/api";
import { dollars } from "../../lib/format";
import { colors, radius, font } from "../../lib/theme";

export type SearchCard = { id: string; name: string; set_code: string; set_name: string | null; set_icon: string | null;
  collector_number: string; rarity: string; finishes: string[]; type_line: string | null;
  price_cents: number | null; price_finish: string | null; price_asof: string | null; image_url: string | null };

const RARITIES = ["common", "uncommon", "rare", "mythic"];
const COLORS: [string, string][] = [["W", "White"], ["U", "Blue"], ["B", "Black"], ["R", "Red"], ["G", "Green"], ["C", "Colorless"]];
const FINISHES = ["nonfoil", "foil", "etched"];
const FORMATS = ["standard", "pioneer", "modern", "legacy", "vintage", "commander", "pauper"];
const SORTS: [string, string][] = [["relevance", "Best match"], ["name", "Name"], ["price", "Price"], ["release", "Newest"]];
type Filters = { set: string; rarity: string; color: string; type: string; finish: string; min: string; max: string; format: string };
const EMPTY: Filters = { set: "", rarity: "", color: "", type: "", finish: "", min: "", max: "", format: "" };

/** Card search, ManaBox style, from our own card database. Works for guests. */
export default function Search() {
  const { width } = useWindowDimensions();
  const [q, setQ] = useState("");
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [sort, setSort] = useState("relevance");
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<SearchCard[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = Object.values(filters).filter(Boolean).length;

  const query = useMemo(() => {
    const p = new URLSearchParams();
    if (q.trim().length >= 2) p.set("q", q.trim());
    for (const [k, v] of Object.entries(filters)) {
      if (!v) continue;
      p.set(k, k === "min" || k === "max" ? String(Math.round(Number(v) * 100)) : v);
    }
    if (sort !== "relevance") p.set("sort", sort);
    return p;
  }, [q, filters, sort]);

  // 200 ms debounce, 2 character minimum (or at least one filter).
  useEffect(() => {
    if (!query.has("q") && !active) { setResults([]); return; }
    let live = true;
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const r = await api<{ exact: SearchCard | null; cards: SearchCard[] }>("GET", `/cards/search?${query}`);
        if (!live) return;
        // "set 123" goes straight to that printing.
        if (r.exact) { router.push(`/card/${r.exact.id}`); }
        setResults(r.cards); setError(null);
      } catch (e) { if (live) setError((e as Error).message); } finally { if (live) setLoading(false); }
    }, 200);
    return () => { live = false; clearTimeout(t); };
  }, [query, active]);

  const cols = width >= 1024 ? 6 : width >= 700 ? 4 : 2;
  const cardW = Math.floor((Math.min(width, 1200) - 16 * 2 - 12 * (cols - 1)) / cols);
  const set = (k: keyof Filters, v: string) => setFilters((f) => ({ ...f, [k]: f[k] === v ? "" : v }));

  return (
    <Screen>
      <View style={s.head}>
        <Text style={s.h1} accessibilityRole="header">Search</Text>
        <TextInput testID="search" value={q} onChangeText={setQ} placeholder="Card name, or set and number like fdn 87"
          placeholderTextColor={colors.muted} autoCorrect={false} autoCapitalize="none" accessibilityLabel="Search cards"
          style={s.input} inputMode="search" />
        <View style={s.row}>
          <Pressable testID="toggle-filters" onPress={() => setOpen(!open)} style={[s.chip, active > 0 && s.chipOn]} accessibilityRole="button">
            <Text style={[s.chipText, active > 0 && s.chipTextOn]}>Filters{active ? ` (${active})` : ""}</Text>
          </Pressable>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
            {SORTS.map(([k, label]) => (
              <Pressable key={k} testID={`sort-${k}`} onPress={() => setSort(k)} style={[s.chip, sort === k && s.chipOn]} accessibilityRole="button"
                accessibilityState={{ selected: sort === k }}>
                <Text style={[s.chipText, sort === k && s.chipTextOn]}>{label}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
        {open && (
          <View style={s.filters} testID="filters">
            <View style={s.row}>
              <TextInput testID="filter-set" value={filters.set} onChangeText={(v) => setFilters({ ...filters, set: v.toUpperCase() })} placeholder="Set code"
                placeholderTextColor={colors.muted} autoCapitalize="characters" accessibilityLabel="Set code" style={[s.small, { width: 96 }]} />
              <TextInput testID="filter-type" value={filters.type} onChangeText={(v) => setFilters({ ...filters, type: v })} placeholder="Type, e.g. creature"
                placeholderTextColor={colors.muted} accessibilityLabel="Type" style={[s.small, { flex: 1 }]} />
            </View>
            <ChipRow label="Rarity" items={RARITIES.map((r) => [r, r])} value={filters.rarity} onPick={(v) => set("rarity", v)} />
            <ChipRow label="Color" items={COLORS} value={filters.color} onPick={(v) => set("color", v)} />
            <ChipRow label="Finish" items={FINISHES.map((f) => [f, f])} value={filters.finish} onPick={(v) => set("finish", v)} />
            <ChipRow label="Legal in" items={FORMATS.map((f) => [f, f])} value={filters.format} onPick={(v) => set("format", v)} />
            <View style={s.row}>
              <Text style={s.label}>Price $</Text>
              <TextInput testID="filter-min" value={filters.min} onChangeText={(v) => setFilters({ ...filters, min: v.replace(/[^0-9.]/g, "") })}
                placeholder="min" placeholderTextColor={colors.muted} inputMode="decimal" accessibilityLabel="Minimum price in dollars" style={[s.small, { width: 72 }]} />
              <TextInput testID="filter-max" value={filters.max} onChangeText={(v) => setFilters({ ...filters, max: v.replace(/[^0-9.]/g, "") })}
                placeholder="max" placeholderTextColor={colors.muted} inputMode="decimal" accessibilityLabel="Maximum price in dollars" style={[s.small, { width: 72 }]} />
              {active > 0 && <Pressable onPress={() => setFilters(EMPTY)} accessibilityRole="button"><Text style={s.link}>Clear</Text></Pressable>}
            </View>
          </View>
        )}
        {error && <Text style={s.error}>{error}</Text>}
      </View>
      <FlatList
        key={cols}
        data={results}
        numColumns={cols}
        keyExtractor={(r) => r.id}
        keyboardShouldPersistTaps="handled"
        columnWrapperStyle={cols > 1 ? { gap: 12 } : undefined}
        contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 120, maxWidth: 1200, width: "100%", alignSelf: "center" }}
        ListEmptyComponent={<Text style={s.hint}>{!query.has("q") && !active ? "Search every printing. Prices are market prices and update daily." : loading ? "Searching…" : "No cards found."}</Text>}
        renderItem={({ item }) => <ResultTile card={item} width={cardW} />}
        ListFooterComponent={<Footer />}
      />
    </Screen>
  );
}

export function ResultTile({ card, width }: { card: SearchCard; width: number }) {
  return (
    <Pressable testID={`result-${card.set_code}-${card.collector_number}`} onPress={() => router.push(`/card/${card.id}`)} style={{ width, gap: 4 }}
      accessibilityRole="button" accessibilityLabel={`${card.name}, ${card.set_name ?? card.set_code} number ${card.collector_number}`}>
      <CardImage card={card} width={width} />
      <Text style={s.name} numberOfLines={1}>{card.name}</Text>
      <View style={s.meta}>
        {card.set_icon ? <Image source={card.set_icon} style={s.icon} tintColor={colors.muted} accessibilityLabel={card.set_name ?? card.set_code} /> : null}
        <Text style={s.muted} numberOfLines={1}>{card.set_code} #{card.collector_number}</Text>
      </View>
      <Text style={s.price}>{card.price_cents == null ? "No price" : dollars(card.price_cents)}{card.price_finish && card.price_finish !== "nonfoil" ? <Text style={s.muted}> {card.price_finish}</Text> : null}</Text>
    </Pressable>
  );
}

function ChipRow({ label, items, value, onPick }: { label: string; items: [string, string][]; value: string; onPick: (v: string) => void }) {
  return (
    <View style={s.row}>
      <Text style={s.label}>{label}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
        {items.map(([k, text]) => (
          <Pressable key={k} testID={`filter-${label.toLowerCase().replace(/\s/g, "")}-${k}`} onPress={() => onPick(k)} style={[s.chip, value === k && s.chipOn]}
            accessibilityRole="button" accessibilityState={{ selected: value === k }}>
            <Text style={[s.chipText, value === k && s.chipTextOn]}>{text}</Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  head: { paddingHorizontal: 16, paddingTop: 16, gap: 10, maxWidth: 1200, width: "100%", alignSelf: "center" },
  h1: { color: colors.text, fontSize: 28, fontFamily: font.display },
  input: { backgroundColor: colors.panel, color: colors.text, borderColor: colors.line, borderWidth: 1, borderRadius: radius, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16 },
  row: { flexDirection: "row", gap: 8, alignItems: "center" },
  chip: { borderWidth: 1, borderColor: colors.line, borderRadius: 99, paddingHorizontal: 12, paddingVertical: 6 },
  chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { color: colors.text, fontSize: 13, fontFamily: font.bodySemi, textTransform: "capitalize" },
  chipTextOn: { color: colors.accentInk },
  filters: { gap: 8, paddingVertical: 4 },
  label: { color: colors.muted, fontSize: 12, width: 56 },
  small: { minWidth: 0, backgroundColor: colors.panel, color: colors.text, borderColor: colors.line, borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, fontSize: 14 },
  link: { color: colors.link, fontFamily: font.bodyBold, textDecorationLine: "underline" },
  name: { color: colors.text, fontFamily: font.bodyBold, fontSize: 14 },
  meta: { flexDirection: "row", gap: 4, alignItems: "center" },
  icon: { width: 14, height: 14 },
  muted: { color: colors.muted, fontSize: 12 },
  price: { color: colors.text, fontFamily: font.display, fontSize: 14 },
  hint: { color: colors.muted, padding: 16, textAlign: "center" },
  error: { color: colors.danger },
});
