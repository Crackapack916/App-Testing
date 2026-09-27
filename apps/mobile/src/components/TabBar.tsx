import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import type { ComponentProps } from "react";
import type { Tabs } from "expo-router";
import { colors } from "../lib/theme";
import { haptic } from "../lib/feedback";

type BottomTabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>["tabBar"]>>[0];

const ICONS: Record<string, keyof typeof MaterialCommunityIcons.glyphMap> = {
  vault: "treasure-chest", search: "cards-outline", packs: "cards-playing", account: "account-circle-outline",
};
const LABELS: Record<string, string> = { vault: "Vault", search: "Search", packs: "Packs", account: "Account" };
// Packs sits raised in the middle: two tabs to its left, one to its right, balanced by width.
const ORDER = ["vault", "search", "packs", "account"];

export function TabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const current = state.routes[state.index]?.name;
  const go = (name: string) => {
    haptic.tap();
    const route = state.routes.find((r) => r.name === name);
    if (route && current !== name) navigation.navigate(name);
  };
  const tab = (name: string) => (
    <Pressable key={name} testID={`tab-${name}`} accessibilityRole="tab" accessibilityState={{ selected: current === name }}
      onPress={() => go(name)} style={s.tab}>
      <MaterialCommunityIcons name={ICONS[name]} size={24} color={current === name ? colors.text : colors.muted} />
      <Text style={[s.label, current === name && { color: colors.text }]}>{LABELS[name]}</Text>
    </Pressable>
  );
  return (
    <View style={[s.bar, { paddingBottom: Math.max(insets.bottom, 8) }]}>
      <View style={s.side}>{ORDER.slice(0, 2).map(tab)}</View>
      <Pressable testID="tab-packs" accessibilityRole="tab" accessibilityState={{ selected: current === "packs" }}
        onPress={() => go("packs")} style={s.centerWrap}>
        <View style={[s.center, current === "packs" && s.centerOn]}>
          <MaterialCommunityIcons name={ICONS.packs} size={30} color={colors.accentInk} />
        </View>
        <Text style={[s.label, current === "packs" && { color: colors.accent }]}>Packs</Text>
      </Pressable>
      <View style={s.side}>{ORDER.slice(3).map(tab)}</View>
    </View>
  );
}

const s = StyleSheet.create({
  bar: { flexDirection: "row", backgroundColor: colors.panel, borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 8 },
  side: { flex: 1, flexDirection: "row", justifyContent: "space-around" },
  tab: { alignItems: "center", paddingHorizontal: 8, minWidth: 64 },
  label: { color: colors.muted, fontSize: 11, marginTop: 2, fontWeight: "600" },
  centerWrap: { alignItems: "center", marginTop: -26, paddingHorizontal: 10 },
  center: { width: 62, height: 62, borderRadius: 31, backgroundColor: colors.accent, alignItems: "center", justifyContent: "center",
    borderWidth: 4, borderColor: colors.bg, shadowColor: colors.accent, shadowOpacity: 0.4, shadowRadius: 10, elevation: 8 },
  centerOn: { shadowOpacity: 0.8 },
});
