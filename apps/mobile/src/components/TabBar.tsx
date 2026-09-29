import { useEffect } from "react";
import { Pressable, StyleSheet, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Box, CalendarClock, CircleUser, Search, Sparkle, SquareX, type LucideIcon } from "./icons";
import type { ComponentProps } from "react";
import type { Tabs } from "expo-router";
import { Text } from "./Text";
import { brand, colors, font, palette } from "../lib/theme";
import { useSession } from "../lib/session";

type BottomTabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>["tabBar"]>>[0];

/** Five destinations, in this order everywhere (brief section 3). */
export const TABS: { name: string; label: string; icon: LucideIcon }[] = [
  { name: "drops", label: "Drops", icon: CalendarClock },
  { name: "search", label: "Search", icon: Search },
  { name: "packs", label: "Packs", icon: Box },
  { name: "vault", label: "Vault", icon: SquareX },
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
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Sparkle size={22} color={brand.gold} fill={brand.gold} />
          <Text style={s.brand}>CrackAPack</Text>
        </View>
        <View style={s.topLinks}>
          {TABS.map((t) => {
            const on = current === t.name;
            return (
              <Pressable key={t.name} testID={`tab-${t.name}`} accessibilityRole="tab" accessibilityState={{ selected: on }}
                accessibilityLabel={t.name === "vault" && dot ? "Vault, new packs" : t.label} onPress={() => go(t.name)} style={[s.topLink, on && s.topLinkOn]}>
                <t.icon size={18} color={on ? brand.magenta : colors.muted} strokeWidth={on ? 2.25 : 1.75} />
                <Text style={[s.topLabel, on && { color: colors.text, fontFamily: font.bodyBold }]}>{t.label}</Text>
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
                <t.icon size={26} color={colors.text} strokeWidth={2} />
              </View>
            ) : (
              <View>
                <t.icon size={22} color={on ? brand.magenta : colors.faint} strokeWidth={on ? 2.1 : 1.6} />
                {t.name === "vault" && dot ? <View style={s.dot} testID="vault-dot" /> : null}
              </View>
            )}
            <Text style={[s.label, on && { color: colors.text, fontFamily: font.bodySemi }]}>{t.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  bar: { flexDirection: "row", alignItems: "flex-end", backgroundColor: palette.night, borderTopWidth: 1, borderTopColor: palette.line, paddingTop: 6,
    borderTopLeftRadius: 18, borderTopRightRadius: 18 },
  tab: { flex: 1, alignItems: "center", paddingVertical: 4, minHeight: 48, justifyContent: "flex-end" },
  label: { color: colors.faint, fontSize: 11, marginTop: 3, fontFamily: font.body },
  centerWrap: { flex: 1.2, alignItems: "center", marginTop: -26 },
  center: { width: 58, height: 58, borderRadius: 29, backgroundColor: palette.panelHi, alignItems: "center", justifyContent: "center",
    borderWidth: 2, borderColor: palette.line },
  centerOn: { backgroundColor: brand.violet, borderColor: brand.magenta, borderWidth: 3 },
  dot: { position: "absolute", top: -2, right: -4, width: 9, height: 9, borderRadius: 5, backgroundColor: brand.magenta, borderWidth: 1.5, borderColor: palette.night },
  top: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 24, height: 64,
    backgroundColor: palette.night, borderBottomWidth: 1, borderBottomColor: palette.line },
  brand: { fontFamily: font.displayHeavy, fontSize: 22, color: colors.text, letterSpacing: 0.3 },
  topLinks: { flexDirection: "row", gap: 4 },
  topLink: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 14, height: 40, borderRadius: 99 },
  topLinkOn: { backgroundColor: palette.panelHi },
  topLabel: { fontFamily: font.bodyMedium, fontSize: 14, color: colors.muted },
  dotInline: { width: 8, height: 8, borderRadius: 4, backgroundColor: brand.magenta },
});
