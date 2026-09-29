import { useEffect, useMemo, useState } from "react";
import { FlatList, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from "react-native";
import { Text, TextInput } from "../../components/Text";
import { Image } from "expo-image";
import { router } from "expo-router";
import { Screen, Footer, Title } from "../../components/bits";
import { Search as SearchIcon } from "../../components/icons";
import { CardImage } from "../../components/CardImage";
import { api } from "../../lib/api";
import { dollars } from "../../lib/format";
import { brand, colors, font, radii, rarityColor } from "../../lib/theme";

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

  const set = (k: keyof Filters, v: string) => setFilters((f) => ({ ...f, [k]: f[k] === v ? "" : v }));

  return (
    <Screen>
      <Title>Search</Title>
      <View style={s.head}>
        <View style={s.field}>
          <SearchIcon size={18} color={brand.violet} />
          <TextInput testID="search" value={q} onChangeText={setQ} placeholder="Search any card by name, or set and number"
            placeholderTextColor={colors.fieldHint} autoCorrect={false} autoCapitalize="none" accessibilityLabel="Search cards"
            style={s.input} inputMode="search" />
        </View>
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
        data={results}
        keyExtractor={(r) => r.id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 120, maxWidth: 900, width: "100%", alignSelf: "center" }}
        ListHeaderComponent={results.length ? <Text style={[s.resultsLabel]}>Results</Text> : null}
        ListEmptyComponent={<Text style={s.hint}>{!query.has("q") && !active ? "Search every printing. Prices are market prices and update daily." : loading ? "Searching…" : "No cards found."}</Text>}
        renderItem={({ item }) => <ResultRow card={item} />}
        ListFooterComponent={<Footer />}
      />
    </Screen>
  );
}

/** One result per row, as in the kit: the real card image, name, set and rarity, price in gold. */
function ResultRow({ card }: { card: SearchCard }) {
  return (
    <Pressable testID={`result-${card.set_code}-${card.collector_number}`} onPress={() => router.push(`/card/${card.id}`)} style={s.resultRow}
      accessibilityRole="button" accessibilityLabel={`${card.name}, ${card.set_name ?? card.set_code} number ${card.collector_number}`}>
      <CardImage card={card} width={44} />
      <View style={{ flex: 1, gap: 1 }}>
        <Text style={s.name} numberOfLines={1}>{card.name}</Text>
        <View style={s.meta}>
          <View style={[s.rarity, { backgroundColor: rarityColor[card.rarity] ?? colors.faint }]} />
          <Text style={s.muted} numberOfLines={1}>{card.set_name ?? card.set_code} · #{card.collector_number} · <Text style={[s.muted, { textTransform: "capitalize" }]}>{card.rarity}</Text></Text>
        </View>
      </View>
      <Text style={s.price}>{card.price_cents == null ? "No price" : dollars(card.price_cents)}{card.price_finish && card.price_finish !== "nonfoil" ? <Text style={s.muted}> {card.price_finish}</Text> : null}</Text>
    </Pressable>
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
  head: { paddingHorizontal: 16, gap: 10, maxWidth: 900, width: "100%", alignSelf: "center" },
  field: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: colors.field, borderRadius: radii.control, paddingHorizontal: 14, minHeight: 50 },
  input: { flex: 1, color: colors.fieldInk, paddingVertical: 12, fontSize: 15, fontFamily: font.body, outlineStyle: "none", outlineWidth: 0 } as object,
  row: { flexDirection: "row", gap: 8, alignItems: "center" },
  chip: { borderWidth: 1, borderColor: colors.lineStrong, borderRadius: 99, paddingHorizontal: 14, paddingVertical: 7, backgroundColor: colors.panel },
  chipOn: { backgroundColor: brand.magenta, borderColor: brand.magenta },
  chipText: { color: colors.text, fontSize: 13, fontFamily: font.bodyMedium, textTransform: "capitalize" },
  chipTextOn: { color: colors.accentInk, fontFamily: font.bodyBold },
  filters: { gap: 8, paddingVertical: 4 },
  label: { color: colors.muted, fontSize: 12, width: 56, fontFamily: font.body },
  small: { minWidth: 0, backgroundColor: colors.panel, color: colors.text, borderColor: colors.line, borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6, fontSize: 14 },
  link: { color: colors.link, fontFamily: font.bodyBold, textDecorationLine: "underline" },
  resultsLabel: { fontFamily: font.bodyBold, fontSize: 11, letterSpacing: 1.6, textTransform: "uppercase", color: brand.gold, marginBottom: 4 },
  resultRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.line },
  rarity: { width: 7, height: 7, borderRadius: 4 },
  name: { color: colors.text, fontFamily: font.bodySemi, fontSize: 14.5 },
  meta: { flexDirection: "row", gap: 6, alignItems: "center" },
  icon: { width: 14, height: 14 },
  muted: { color: colors.muted, fontSize: 12, fontFamily: font.body },
  price: { color: brand.gold, fontFamily: font.bodyBold, fontSize: 14 },
  hint: { color: colors.muted, padding: 16, textAlign: "center", fontFamily: font.body },
  error: { color: colors.danger },
});
