import { useEffect } from "react";
import { Pressable, StyleSheet, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CalendarClock, CircleUser, Package, Search, Vault, type LucideIcon } from "./icons";
import type { ComponentProps } from "react";
import type { Tabs } from "expo-router";
import { Text } from "./Text";
import { colors, font, palette, status } from "../lib/theme";
import { useSession } from "../lib/session";

type BottomTabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>["tabBar"]>>[0];

/** Five destinations, in this order everywhere (brief section 3). */
export const TABS: { name: string; label: string; icon: LucideIcon }[] = [
  { name: "drops", label: "Drops", icon: CalendarClock },
  { name: "search", label: "Search", icon: Search },
  { name: "packs", label: "Packs", icon: Package },
  { name: "vault", label: "Vault", icon: Vault },
  { name: "account", label: "Account", icon: CircleUser },
];
/** Widths at or above this get the top navigation. */
export const DESKTOP = 900;

export function TabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { me, refresh } = useSession();
  const current = state.routes[state.index]?.name;
  // The Vault dot follows the server: refetch on every tab change.
  useEffect(() => { if (me) refresh(); }, [current]); // eslint-disable-line react-hooks/exhaustive-deps
  const dot = (me?.unseen_cracked ?? 0) > 0;
  const go = (name: string) => {
    if (current !== name) navigation.navigate(name);
  };

  if (width >= DESKTOP) {
    return (
      <View style={s.top} accessibilityRole="tablist">
        <Text style={s.brand}>CrackAPack</Text>
        <View style={s.topLinks}>
          {TABS.map((t) => {
            const on = current === t.name;
            return (
              <Pressable key={t.name} testID={`tab-${t.name}`} accessibilityRole="tab" accessibilityState={{ selected: on }}
                accessibilityLabel={t.name === "vault" && dot ? "Vault, new packs" : t.label} onPress={() => go(t.name)} style={[s.topLink, on && s.topLinkOn]}>
                <t.icon size={18} color={on ? colors.text : colors.muted} strokeWidth={on ? 2.25 : 1.75} />
                <Text style={[s.topLabel, on && { color: colors.text }]}>{t.label}</Text>
                {t.name === "vault" && dot ? <View style={s.dotInline} testID="vault-dot" /> : null}
              </Pressable>
            );
          })}
        </View>
      </View>
    );
  }

  return (
    <View style={[s.bar, { paddingBottom: Math.max(insets.bottom, 8) }]} accessibilityRole="tablist">
      {TABS.map((t) => {
        const on = current === t.name;
        const center = t.name === "packs";
        return (
          <Pressable key={t.name} testID={`tab-${t.name}`} accessibilityRole="tab" accessibilityState={{ selected: on }}
            accessibilityLabel={t.name === "vault" && dot ? "Vault, new packs" : t.label} onPress={() => go(t.name)} style={center ? s.centerWrap : s.tab}>
            {center ? (
              <View style={[s.center, on && s.centerOn]}>
                <t.icon size={28} color={colors.accentInk} strokeWidth={2} />
              </View>
            ) : (
              <View>
                <t.icon size={23} color={on ? colors.text : colors.muted} strokeWidth={on ? 2.25 : 1.75} />
                {t.name === "vault" && dot ? <View style={s.dot} testID="vault-dot" /> : null}
              </View>
            )}
            <Text style={[s.label, on && { color: colors.text, fontFamily: font.bodyBold }]}>{t.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  bar: { flexDirection: "row", alignItems: "flex-end", backgroundColor: colors.panel, borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 6 },
  tab: { flex: 1, alignItems: "center", paddingVertical: 4, minHeight: 48, justifyContent: "flex-end" },
  label: { color: colors.muted, fontSize: 11, marginTop: 3, fontFamily: font.bodySemi },
  centerWrap: { flex: 1.2, alignItems: "center", marginTop: -24 },
  center: { width: 60, height: 60, borderRadius: 30, backgroundColor: palette.blue[500], alignItems: "center", justifyContent: "center",
    borderWidth: 3, borderColor: palette.blue[100] },
  centerOn: { backgroundColor: palette.blue[600], borderColor: palette.sky[200] },
  dot: { position: "absolute", top: -2, right: -4, width: 9, height: 9, borderRadius: 5, backgroundColor: status.error, borderWidth: 1.5, borderColor: colors.panel },
  top: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 24, height: 60,
    backgroundColor: colors.panel, borderBottomWidth: 1, borderBottomColor: colors.line },
  brand: { fontFamily: font.displayHeavy, fontSize: 22, color: colors.text, letterSpacing: 0.3 },
  topLinks: { flexDirection: "row", gap: 4 },
  topLink: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 14, height: 40, borderRadius: 6 },
  topLinkOn: { backgroundColor: palette.blue[100], borderBottomWidth: 2, borderBottomColor: palette.blue[500], borderBottomLeftRadius: 0, borderBottomRightRadius: 0 },
  topLabel: { fontFamily: font.bodySemi, fontSize: 14, color: colors.muted },
  dotInline: { width: 8, height: 8, borderRadius: 4, backgroundColor: status.error },
});
