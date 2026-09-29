import { StyleSheet, View } from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { Text } from "./Text";
import { brand, colors, font, palette } from "../lib/theme";

type Props = { setCode: string; setName: string; boosterType?: string; photo?: string | null; icon?: string | null; width: number };

/**
 * The pack, per set: the real product photo. A set can't go on sale or get a published drop
 * without one (0030), so the drawn wrapper below is only a stopgap while a photo loads or if
 * one ever fails to. No made up card counts or prices.
 */
export function PackArt({ setCode, setName, boosterType = "play", photo, icon, width }: Props) {
  const height = Math.round(width * 1.62);
  const label = `${setName} ${boosterType === "collector" ? "Collector" : "Play"} Booster`;
  if (photo) {
    return (
      <View style={[s.photo, { width, height }]} accessibilityLabel={label}>
        <Image source={photo} style={StyleSheet.absoluteFill} contentFit="contain" accessibilityIgnoresInvertColors />
      </View>
    );
  }
  const pad = Math.round(width * 0.07);
  return (
    <LinearGradient colors={[brand.violet, palette.panelHi, brand.ink]} start={{ x: 0.1, y: 0 }} end={{ x: 0.9, y: 1 }}
      style={[s.frame, { width, height, padding: pad }]} accessibilityLabel={label}>
      <View style={[s.crimp, { height: Math.round(height * 0.05) }]} />
      <View style={s.inner}>
        {icon ? <Image source={icon} style={{ width: width * 0.34, height: width * 0.34, tintColor: brand.gold }} contentFit="contain" /> : null}
        <Text style={[s.code, { fontSize: Math.round(width * 0.17) }]}>{setCode}</Text>
        <Text style={[s.name, { fontSize: Math.max(10, Math.round(width * 0.075)) }]} numberOfLines={2}>{setName}</Text>
        <Text style={[s.type, { fontSize: Math.max(8, Math.round(width * 0.052)) }]}>{boosterType === "collector" ? "COLLECTOR" : "PLAY"} BOOSTER</Text>
      </View>
      <View style={[s.crimp, { height: Math.round(height * 0.05) }]} />
    </LinearGradient>
  );
}

const s = StyleSheet.create({
  photo: { overflow: "visible" },
  frame: { borderRadius: 10, overflow: "hidden", borderWidth: 2, borderColor: brand.magenta },
  crimp: { alignSelf: "stretch", borderRadius: 2, backgroundColor: "rgba(251, 251, 251, 0.10)",
    borderTopWidth: 1, borderBottomWidth: 1, borderColor: "rgba(251, 251, 251, 0.16)" },
  inner: { flex: 1, marginVertical: 8, alignItems: "center", justifyContent: "center", gap: 6, borderWidth: 1, borderColor: "rgba(245, 184, 46, 0.4)",
    borderRadius: 6, paddingHorizontal: 6 },
  code: { color: colors.text, fontFamily: font.displayHeavy, letterSpacing: 2 },
  name: { color: colors.text, fontFamily: font.bodySemi, textAlign: "center" },
  type: { color: brand.gold, fontFamily: font.bodyBold, letterSpacing: 1.6 },
});
