import { StyleSheet, View } from "react-native";
import { Image } from "expo-image";
import { Text } from "./Text";
import { brand, colors, font } from "../lib/theme";

const MARK = require("../../assets/brand/mark.png");
/** The mark's own proportions (the torn pack with its sparks). */
const MARK_RATIO = 190 / 164;

/**
 * The CrackAPack logo: the torn pack mark and the wordmark, with the A always Hot Magenta.
 * The mark is keyed for dark backgrounds, which is every page on the site.
 * row: mark beside the wordmark (headers). stacked: mark above it (sign in, empty states).
 */
export function Logo({ size = 28, layout = "row", testID }: { size?: number; layout?: "row" | "stacked"; testID?: string }) {
  const markH = layout === "stacked" ? size * 2.6 : size * 1.45;
  return (
    <View style={[layout === "row" ? s.row : s.stacked, { gap: layout === "row" ? size * 0.3 : size * 0.35 }]}
      accessibilityRole="image" accessibilityLabel="CrackAPack" testID={testID}>
      <Image source={MARK} style={{ height: markH, width: markH / MARK_RATIO }} contentFit="contain" accessibilityIgnoresInvertColors />
      <Wordmark size={size} />
    </View>
  );
}

export function Wordmark({ size = 28 }: { size?: number }) {
  return (
    <Text style={[s.word, { fontSize: size, lineHeight: size * 1.15 }]} accessible={false}>
      Crack<Text style={[s.word, s.a, { fontSize: size, lineHeight: size * 1.15 }]}>A</Text>Pack
    </Text>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center" },
  stacked: { alignItems: "center" },
  word: { fontFamily: font.displayHeavy, color: colors.text, letterSpacing: -0.3 },
  a: { color: brand.magenta },
});
