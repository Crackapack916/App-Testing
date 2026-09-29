import type { ComponentType, ReactNode } from "react";
import { ActivityIndicator, Linking, Platform, Pressable, StyleSheet, View, type ViewStyle } from "react-native";
import { LinearGradient, type LinearGradientProps } from "expo-linear-gradient";
import { router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { ChevronLeft, CircleAlert } from "./icons";
import { Text } from "./Text";
import { brand, colors, font, radii, rarityColor, stage, type } from "../lib/theme";
import { legalityTags } from "../lib/format";
import { credits } from "../lib/format";
import { useSession } from "../lib/session";

// pnpm hoists the staff site's React 18 types for these two packages; the components are the same.
const Gradient = LinearGradient as unknown as ComponentType<LinearGradientProps & { children?: ReactNode }>;
const Safe = SafeAreaView as unknown as ComponentType<{ edges?: ("top" | "bottom")[]; style?: unknown; children?: ReactNode }>;

export const SUPPORT_EMAIL = "crackapack.business@gmail.com";

/** The brand stage on every page: Ink fading into deep violet, with a soft magenta glow. */
export function Screen({ children, style, safe = true }: { children: ReactNode; style?: ViewStyle; safe?: boolean }) {
  const body = safe ? <Safe edges={["top"]} style={[{ flex: 1 }, style]}>{children}</Safe> : <View style={[{ flex: 1 }, style]}>{children}</View>;
  return (
    <Gradient colors={[colors.bg, colors.bgEnd]} start={{ x: 0, y: 0.1 }} end={{ x: 0.3, y: 1 }} style={{ flex: 1 }}>
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, s.glowWrap]}><View style={s.glow} /></View>
      {body}
    </Gradient>
  );
}
/** Same stage; kept so older screens read naturally. */
export const Stage = Screen;

/** The balance, top right on every tab: gold number, a magenta rule, "credits" underneath. */
export function CreditsBadge() {
  const { me } = useSession();
  if (!me) return null;
  const n = me.credits.total;
  return (
    <Pressable onPress={() => router.push("/account")} accessibilityRole="link" accessibilityLabel={`${credits(n)} credits`} style={s.badge}>
      <Text style={s.badgeNum} testID="balance">{credits(n)}</Text>
      <Text style={s.badgeLabel}>credits</Text>
    </Pressable>
  );
}

/** Back to where the customer came from, or to Packs when they arrived by a link. */
export function BackButton({ fallback = "/packs" }: { fallback?: string }) {
  return (
    <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace(fallback as never))} accessibilityRole="button"
      accessibilityLabel="Back" style={s.back} testID="back">
      <ChevronLeft size={20} color={colors.text} />
      <Text style={s.backText}>Back</Text>
    </Pressable>
  );
}

/** Page title on the left, the balance on the right, an optional line underneath. Pages opened on top of the tabs pass back. */
export function Title({ children, sub, balance = true, back }: { children: ReactNode; sub?: ReactNode; onStage?: boolean; balance?: boolean; back?: string }) {
  return (
    <View style={s.titleWrap}>
      {back ? <BackButton fallback={back} /> : null}
      <View style={s.titleRow}>
        <Text style={[type.h1, { flex: 1 }]} accessibilityRole="header">{children}</Text>
        {balance ? <CreditsBadge /> : null}
      </View>
      {sub ? <Text style={[type.body, { color: colors.muted, marginTop: 2 }]}>{sub}</Text> : null}
    </View>
  );
}

type Kind = "primary" | "ghost" | "danger" | "gold";
/** One button system: pill shaped, bold spaced capitals. Primary is Hot Magenta with ink text. */
export function Button({ label, onPress, kind = "primary", disabled, busy, testID, style, icon }:
  { label: string; onPress: () => void; kind?: Kind; disabled?: boolean; busy?: boolean; testID?: string; onStage?: boolean; style?: ViewStyle; icon?: ReactNode }) {
  const off = disabled || busy;
  const textColor = kind === "primary" || kind === "gold" ? colors.accentInk : colors.text;
  const inner = busy ? <ActivityIndicator color={textColor} />
    : <View style={s.btnInner}>{icon}<Text style={[type.button, { color: textColor }]}>{label}</Text></View>;
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityState={{ disabled: !!off, busy: !!busy }} onPress={onPress} disabled={off}
      style={({ pressed }) => [s.btn, kind === "primary" && s.primary, kind === "gold" && s.gold, kind === "ghost" && s.ghost, kind === "danger" && s.danger,
        off && { opacity: 0.45 }, pressed && { transform: [{ translateY: 1 }] }, style]}>
      {inner}
    </Pressable>
  );
}

export function Panel({ children, style, testID }: { children: ReactNode; style?: ViewStyle; testID?: string }) {
  return <View testID={testID} style={[s.panel, style]}>{children}</View>;
}

/** A filter or choice chip: a pill, Hot Magenta when on. */
export function Chip({ label, on, onPress, testID }: { label: string; on?: boolean; onPress: () => void; testID?: string }) {
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityState={{ selected: !!on }} onPress={onPress} style={[s.chip, on && s.chipOn]}>
      <Text style={[s.chipText, on && { color: colors.accentInk, fontFamily: font.bodyBold }]}>{label}</Text>
    </Pressable>
  );
}

/** A number that matters, with the kit's magenta rule on its left. */
export function Figure({ label, value, note, testID }: { label: string; value: ReactNode; note?: string; testID?: string }) {
  return (
    <View style={s.figure} testID={testID}>
      <Text style={type.label}>{label}</Text>
      <Text style={s.figureNum}>{value}</Text>
      {note ? <Text style={type.small}>{note}</Text> : null}
    </View>
  );
}

/** Errors: foil text with a magenta mark and border. */
export function ErrorText({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <View style={s.error} accessibilityRole="alert">
      <CircleAlert size={16} color={colors.danger} />
      <Text style={[type.small, { color: colors.text, flex: 1 }]}>{children}</Text>
    </View>
  );
}

/** Neutral facts only: never outcomes or values won. */
export function StatCard({ label, value, testID }: { label: string; value: ReactNode; testID?: string }) {
  return (
    <View style={s.stat} testID={testID}>
      <Text style={type.label}>{label}</Text>
      <Text style={[type.h2, { fontFamily: font.bodyBold }]}>{value}</Text>
    </View>
  );
}

export function RarityPill({ rarity }: { rarity: string }) {
  const c = rarityColor[rarity] ?? colors.faint;
  return (
    <View style={[s.pill, { borderColor: c }]}>
      <View style={[s.pillDot, { backgroundColor: c }]} />
      <Text style={s.pillText}>{rarity}</Text>
    </View>
  );
}

export function RarityDot({ rarity }: { rarity: string }) {
  return <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: rarityColor[rarity] ?? colors.line, borderWidth: 1, borderColor: colors.faint }} />;
}

/** One empty state style everywhere. */
export function EmptyState({ title, body, action }: { title: string; body?: string; action?: ReactNode; onStage?: boolean }) {
  return (
    <View style={s.empty}>
      <Text style={type.h3}>{title}</Text>
      {body ? <Text style={[type.small, { textAlign: "center" }]}>{body}</Text> : null}
      {action}
    </View>
  );
}

/** Format legality chips: legal, banned, restricted, not legal. */
export function LegalityTags({ legalities }: { legalities: Record<string, string> | null | undefined }) {
  return (
    <View style={s.tags}>
      {legalityTags(legalities).map(({ format, status }) => {
        const border = status === "Legal" ? colors.ok : status === "Banned" ? colors.danger : status === "Restricted" ? colors.warn : colors.line;
        return (
          <View key={format} style={[s.tag, { borderColor: border }]}>
            <Text style={[s.tagText, { color: status === "Not legal" ? colors.faint : colors.text }]}>
              {format}{status === "Legal" || status === "Not legal" ? "" : ` (${status.toLowerCase()})`}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

/** Every page: the kit's legal line, Scryfall credit, support and policies. */
export function Footer(_: { onStage?: boolean }) {
  return (
    <View style={s.footer} accessibilityRole={Platform.OS === "web" ? ("contentinfo" as never) : undefined} testID="footer">
      <Text style={s.footText}>
        CrackAPack is an unofficial retailer. It is not produced by or endorsed by Wizards of the Coast. Magic: The Gathering, card names,
        card images, and set symbols are property of Wizards of the Coast LLC. Card data and images via Scryfall.
      </Text>
      <Text style={s.footText}>
        Support and problem reports:{" "}
        <Text style={[s.footText, s.footLink]} accessibilityRole="link" onPress={() => Linking.openURL(`mailto:${SUPPORT_EMAIL}`)}>{SUPPORT_EMAIL}</Text>
        {"  "}
        <Text style={[s.footText, s.footLink]} accessibilityRole="link" onPress={() => router.push("/policies")}>Fairness and policies</Text>
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  glowWrap: { alignItems: "center", overflow: "hidden" },
  glow: { position: "absolute", top: "12%", width: 480, height: 480, borderRadius: 240, backgroundColor: stage.glow,
    ...(Platform.OS === "web" ? { filter: "blur(80px)" } as object : null) },
  back: { flexDirection: "row", alignItems: "center", gap: 2, alignSelf: "flex-start", minHeight: 44, paddingRight: 12, marginLeft: -6 },
  backText: { fontFamily: font.bodyMedium, fontSize: 14, color: colors.text },
  titleWrap: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 12, maxWidth: 900, width: "100%", alignSelf: "center" },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  badge: { alignItems: "flex-end", borderLeftWidth: 2, borderLeftColor: brand.magenta, paddingLeft: 10, minHeight: 44, justifyContent: "center" },
  badgeNum: { color: brand.gold, fontSize: 19, lineHeight: 22, fontFamily: font.bodyBold },
  badgeLabel: { color: colors.muted, fontSize: 11, lineHeight: 14, fontFamily: font.body },
  btn: { borderRadius: radii.pill, minHeight: 50, alignItems: "center", justifyContent: "center", paddingHorizontal: 22, overflow: "hidden" },
  btnInner: { flexDirection: "row", alignItems: "center", gap: 8 },
  primary: { backgroundColor: brand.magenta,
    ...(Platform.OS === "web" ? { boxShadow: "0 8px 24px rgba(255, 61, 129, 0.35)" } as object : null) },
  gold: { backgroundColor: brand.gold },
  ghost: { borderWidth: 1.5, borderColor: colors.lineStrong, backgroundColor: "transparent" },
  danger: { borderWidth: 1.5, borderColor: brand.magenta, backgroundColor: "transparent" },
  panel: { backgroundColor: colors.panel, borderColor: colors.line, borderWidth: 1, borderRadius: radii.panel, padding: 16 },
  chip: { borderWidth: 1, borderColor: colors.lineStrong, borderRadius: radii.pill, paddingHorizontal: 14, minHeight: 36, justifyContent: "center", backgroundColor: colors.panel },
  chipOn: { backgroundColor: brand.magenta, borderColor: brand.magenta },
  chipText: { fontFamily: font.bodyMedium, fontSize: 13, color: colors.text },
  figure: { borderLeftWidth: 3, borderLeftColor: brand.magenta, paddingLeft: 12, gap: 2 },
  figureNum: { fontFamily: font.bodyBold, fontSize: 28, lineHeight: 36, color: brand.gold },
  error: { flexDirection: "row", gap: 8, alignItems: "flex-start", marginTop: 8, paddingVertical: 8, paddingHorizontal: 10,
    backgroundColor: colors.panel, borderLeftWidth: 3, borderLeftColor: colors.danger, borderRadius: 6 },
  stat: { backgroundColor: colors.panel, borderRadius: radii.tile, paddingVertical: 12, paddingHorizontal: 14, borderLeftWidth: 3, borderLeftColor: brand.magenta, gap: 4 },
  pill: { flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1, borderRadius: radii.pill, paddingHorizontal: 10, paddingVertical: 3, alignSelf: "flex-start" },
  pillDot: { width: 7, height: 7, borderRadius: 4 },
  pillText: { fontFamily: font.bodySemi, fontSize: 11, textTransform: "capitalize", color: colors.text },
  empty: { alignItems: "center", gap: 8, paddingVertical: 32, paddingHorizontal: 24 },
  tags: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  tag: { borderWidth: 1.5, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 },
  tagText: { fontFamily: font.bodyMedium, fontSize: 11, textTransform: "capitalize" },
  footer: { gap: 6, paddingHorizontal: 16, paddingTop: 24, paddingBottom: 32, maxWidth: 900, width: "100%", alignSelf: "center" },
  footText: { fontFamily: font.body, fontSize: 10.5, lineHeight: 15, color: colors.faint },
  footLink: { fontFamily: font.bodySemi, textDecorationLine: "underline", color: colors.muted },
});
