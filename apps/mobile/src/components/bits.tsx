import type { ReactNode } from "react";
import { ActivityIndicator, ImageBackground, Linking, Platform, Pressable, StyleSheet, View, type ViewStyle } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { CircleAlert } from "./icons";
import { Text } from "./Text";
import { colors, font, palette, radii, rarityColor, stage, type } from "../lib/theme";
import { legalityTags } from "../lib/format";

const GRAIN = require("../../assets/images/grain.png");
// On web, a repeating CSS background: ImageBackground's repeat mode draws a single tile there.
const grainWeb = { backgroundImage: `url(${typeof GRAIN === "string" ? GRAIN : GRAIN?.uri ?? GRAIN?.default?.uri ?? ""})`,
  backgroundRepeat: "repeat", opacity: 0.09 } as object;
export const SUPPORT_EMAIL = "crackapack.business@gmail.com";

/** Light surface page: blue 100 fading to blue 200. */
export function Screen({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return (
    <LinearGradient colors={[colors.bg, colors.bgEnd]} start={{ x: 0, y: 0 }} end={{ x: 0.4, y: 1 }} style={{ flex: 1 }}>
      <SafeAreaView edges={["top"]} style={[{ flex: 1 }, style]}>{children}</SafeAreaView>
    </LinearGradient>
  );
}

/** Dark stage (Packs, the rip clip page, Drops hero): blue 700 to 600, a soft blue glow, fine grain. */
export function Stage({ children, style, safe = true }: { children: ReactNode; style?: ViewStyle; safe?: boolean }) {
  const body = safe ? <SafeAreaView edges={["top"]} style={[{ flex: 1 }, style]}>{children}</SafeAreaView> : <View style={[{ flex: 1 }, style]}>{children}</View>;
  return (
    <LinearGradient colors={[stage.bg, stage.bgEnd]} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }} style={{ flex: 1 }}>
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, s.glowWrap]}>
        <View style={s.glow} />
      </View>
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, Platform.OS === "web" && grainWeb]}>
        {Platform.OS !== "web" && <ImageBackground source={GRAIN} resizeMode="repeat" style={StyleSheet.absoluteFill} imageStyle={{ opacity: 0.09 }} />}
      </View>
      {body}
    </LinearGradient>
  );
}

export function Title({ children, sub, onStage }: { children: ReactNode; sub?: ReactNode; onStage?: boolean }) {
  return (
    <View style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12 }}>
      <Text style={[type.h1, onStage && { color: stage.text }]} accessibilityRole="header">{children}</Text>
      {sub ? <Text style={[type.small, { marginTop: 2 }, onStage && { color: stage.muted }]}>{sub}</Text> : null}
    </View>
  );
}

type Kind = "primary" | "ghost" | "danger" | "sky";
/** One button system: uppercase, letter spaced labels; primary is the blue gradient. */
export function Button({ label, onPress, kind = "primary", disabled, busy, testID, onStage, style }:
  { label: string; onPress: () => void; kind?: Kind; disabled?: boolean; busy?: boolean; testID?: string; onStage?: boolean; style?: ViewStyle }) {
  const off = disabled || busy;
  const textColor = kind === "primary" || kind === "danger" ? colors.accentInk : kind === "sky" ? colors.skyInk : onStage ? stage.text : colors.link;
  const inner = busy ? <ActivityIndicator color={textColor} /> : <Text style={[type.button, { color: textColor }]}>{label}</Text>;
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityState={{ disabled: !!off, busy: !!busy }} onPress={onPress} disabled={off}
      style={({ pressed }) => [s.btn, kind === "ghost" && [s.ghost, onStage && { borderColor: stage.muted }], kind === "danger" && s.danger,
        kind === "sky" && s.sky, off && { opacity: 0.45 }, pressed && { transform: [{ translateY: 1 }] }, style]}>
      {kind === "primary"
        ? <LinearGradient colors={[palette.blue[400], palette.blue[500]]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.fill}>{inner}</LinearGradient>
        : inner}
    </Pressable>
  );
}

export function Panel({ children, style, testID }: { children: ReactNode; style?: ViewStyle; testID?: string }) {
  return <View testID={testID} style={[s.panel, style]}>{children}</View>;
}

/** Errors: ink text with an error mark and border (the error red fails AA as small text). */
export function ErrorText({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <View style={s.error} accessibilityRole="alert">
      <CircleAlert size={16} color={colors.danger} />
      <Text style={[type.small, { color: colors.text, flex: 1 }]}>{children}</Text>
    </View>
  );
}

/** Neutral facts only (brief 2.4): a left accent border, never outcomes or values won. */
export function StatCard({ label, value, testID }: { label: string; value: ReactNode; testID?: string }) {
  return (
    <View style={s.stat} testID={testID}>
      <Text style={type.label}>{label}</Text>
      <Text style={[type.h2, { fontFamily: font.monoMedium }]}>{value}</Text>
    </View>
  );
}

export function RarityPill({ rarity }: { rarity: string }) {
  const c = rarityColor[rarity] ?? palette.neutral[300];
  const dark = rarity === "common";
  return (
    <View style={[s.pill, { backgroundColor: c }]}>
      <Text style={[s.pillText, { color: dark ? palette.ink[100] : palette.ink[700] }]}>{rarity}</Text>
    </View>
  );
}

export function RarityDot({ rarity }: { rarity: string }) {
  return <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: rarityColor[rarity] ?? colors.line, borderWidth: 1, borderColor: palette.neutral[400] }} />;
}

/** One empty state style everywhere. */
export function EmptyState({ title, body, action, onStage }: { title: string; body?: string; action?: ReactNode; onStage?: boolean }) {
  return (
    <View style={s.empty}>
      <Text style={[type.h3, onStage && { color: stage.text }]}>{title}</Text>
      {body ? <Text style={[type.small, { textAlign: "center" }, onStage && { color: stage.muted }]}>{body}</Text> : null}
      {action}
    </View>
  );
}

/** Format legality chips: legal, banned, restricted, not legal. Text stays ink for contrast. */
export function LegalityTags({ legalities }: { legalities: Record<string, string> | null | undefined }) {
  return (
    <View style={s.tags}>
      {legalityTags(legalities).map(({ format, status }) => {
        const border = status === "Legal" ? colors.ok : status === "Banned" ? colors.danger : status === "Restricted" ? colors.warn : colors.line;
        return (
          <View key={format} style={[s.tag, { borderColor: border }, status === "Legal" && { backgroundColor: palette.ink[100] }]}>
            <Text style={[s.tagText, { color: status === "Not legal" ? colors.muted : colors.text }]}>
              {format}{status === "Legal" || status === "Not legal" ? "" : ` (${status.toLowerCase()})`}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

/** Every page (brief item 13 and 16). */
export function Footer({ onStage }: { onStage?: boolean }) {
  const c = onStage ? stage.muted : colors.muted;
  return (
    <View style={s.footer} accessibilityRole={Platform.OS === "web" ? ("contentinfo" as never) : undefined} testID="footer">
      <Text style={[s.footText, { color: c }]}>
        CrackAPack is an unofficial retailer. It is not produced by or endorsed by Wizards of the Coast. Magic: The Gathering, card names,
        card images, and set symbols are property of Wizards of the Coast LLC.
      </Text>
      <Text style={[s.footText, { color: c }]}>Card data and images via Scryfall.</Text>
      <Text style={[s.footText, { color: c }]}>
        Support and problem reports:{" "}
        <Text style={[s.footText, s.footLink, { color: onStage ? stage.accent : colors.link }]} accessibilityRole="link"
          onPress={() => Linking.openURL(`mailto:${SUPPORT_EMAIL}`)}>{SUPPORT_EMAIL}</Text>
        {"  "}
        <Text style={[s.footText, s.footLink, { color: onStage ? stage.accent : colors.link }]} accessibilityRole="link"
          onPress={() => router.push("/policies")}>Fairness and policies</Text>
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  glowWrap: { alignItems: "center", overflow: "hidden" },
  glow: { position: "absolute", top: "18%", width: 520, height: 520, borderRadius: 260, backgroundColor: stage.glow, opacity: 0.9,
    ...(Platform.OS === "web" ? { filter: "blur(60px)" } as object : null) },
  btn: { borderRadius: radii.control, minHeight: 48, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  fill: { alignSelf: "stretch", flex: 1, minHeight: 48, alignItems: "center", justifyContent: "center", paddingHorizontal: 20 },
  ghost: { borderWidth: 1.5, borderColor: colors.link, paddingHorizontal: 18, backgroundColor: "transparent" },
  danger: { backgroundColor: palette.ink[700], paddingHorizontal: 18, borderLeftWidth: 4, borderLeftColor: colors.danger },
  sky: { backgroundColor: colors.sky, paddingHorizontal: 18 },
  panel: { backgroundColor: colors.panel, borderColor: colors.line, borderWidth: 1, borderRadius: radii.panel, padding: 16 },
  error: { flexDirection: "row", gap: 8, alignItems: "flex-start", marginTop: 8, paddingVertical: 8, paddingHorizontal: 10,
    backgroundColor: colors.panel, borderLeftWidth: 3, borderLeftColor: colors.danger, borderRadius: 4 },
  stat: { backgroundColor: colors.panel, borderRadius: radii.tile, paddingVertical: 12, paddingHorizontal: 14, borderLeftWidth: 4, borderLeftColor: colors.sky, gap: 4 },
  pill: { borderRadius: radii.pill, paddingHorizontal: 10, paddingVertical: 3, alignSelf: "flex-start" },
  pillText: { fontFamily: font.bodySemi, fontSize: 11, textTransform: "capitalize" },
  empty: { alignItems: "center", gap: 8, paddingVertical: 32, paddingHorizontal: 24 },
  tags: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  tag: { borderWidth: 1.5, borderRadius: 4, paddingHorizontal: 7, paddingVertical: 2 },
  tagText: { fontFamily: font.bodyMedium, fontSize: 11, textTransform: "capitalize" },
  footer: { gap: 6, paddingHorizontal: 16, paddingTop: 24, paddingBottom: 32, maxWidth: 900, width: "100%", alignSelf: "center" },
  footText: { fontFamily: font.body, fontSize: 11, lineHeight: 16 },
  footLink: { fontFamily: font.bodySemi, textDecorationLine: "underline" },
});
