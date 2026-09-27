import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type ViewStyle } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors, radius, rarityColor } from "../lib/theme";
import { legalityTags } from "../lib/format";

export function Screen({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <SafeAreaView edges={["top"]} style={[{ flex: 1, backgroundColor: colors.bg }, style]}>{children}</SafeAreaView>;
}

export function Title({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return (
    <View style={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12 }}>
      <Text style={s.title}>{children}</Text>
      {sub ? <Text style={s.sub}>{sub}</Text> : null}
    </View>
  );
}

export function Button({ label, onPress, kind = "primary", disabled, busy, testID }:
  { label: string; onPress: () => void; kind?: "primary" | "ghost" | "danger"; disabled?: boolean; busy?: boolean; testID?: string }) {
  return (
    <Pressable testID={testID} accessibilityRole="button" onPress={onPress} disabled={disabled || busy}
      style={({ pressed }) => [s.btn, s[kind], (disabled || busy) && { opacity: 0.45 }, pressed && { opacity: 0.8 }]}>
      {busy ? <ActivityIndicator color={kind === "primary" ? colors.accentInk : colors.text} />
        : <Text style={[s.btnText, kind === "primary" && { color: colors.accentInk }]}>{label}</Text>}
    </Pressable>
  );
}

export function Panel({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[s.panel, style]}>{children}</View>;
}

export function ErrorText({ children }: { children: ReactNode }) {
  return children ? <Text style={s.error}>{children}</Text> : null;
}

export function RarityDot({ rarity }: { rarity: string }) {
  return <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: rarityColor[rarity] ?? colors.line, borderWidth: 1, borderColor: "#555" }} />;
}

/** Format legality chips: green legal, red banned, amber restricted, dim not legal. */
export function LegalityTags({ legalities }: { legalities: Record<string, string> | null | undefined }) {
  return (
    <View style={s.tags}>
      {legalityTags(legalities).map(({ format, status }) => {
        const color = status === "Legal" ? colors.ok : status === "Banned" ? colors.danger : status === "Restricted" ? colors.accent : colors.line;
        return (
          <View key={format} style={[s.tag, { borderColor: color }]}>
            <Text style={[s.tagText, { color: status === "Not legal" ? colors.muted : color }]}>{format}{status === "Legal" || status === "Not legal" ? "" : ` · ${status.toLowerCase()}`}</Text>
          </View>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  title: { color: colors.text, fontSize: 28, fontWeight: "800" },
  sub: { color: colors.muted, marginTop: 2 },
  btn: { borderRadius: radius, paddingVertical: 14, paddingHorizontal: 18, alignItems: "center", justifyContent: "center", borderWidth: 1 },
  primary: { backgroundColor: colors.accent, borderColor: colors.accent },
  ghost: { backgroundColor: "transparent", borderColor: colors.line },
  danger: { backgroundColor: colors.danger, borderColor: colors.danger },
  btnText: { color: colors.text, fontWeight: "700", fontSize: 16 },
  panel: { backgroundColor: colors.panel, borderColor: colors.line, borderWidth: 1, borderRadius: radius, padding: 14 },
  error: { color: "#FFB4B6", marginTop: 8 },
  tags: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  tag: { borderWidth: 1, borderRadius: 99, paddingHorizontal: 8, paddingVertical: 2 },
  tagText: { fontSize: 11, fontWeight: "600", textTransform: "capitalize" },
});
