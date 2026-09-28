import { StyleSheet, View } from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { Text } from "./Text";
import { font, palette } from "../lib/theme";

type Props = { setCode: string; setName: string; boosterType?: string; photo?: string | null; icon?: string | null; width: number };

/**
 * The pack, per set. The official pack photo when staff have set one (Stock screen); until
 * then a plain wrapper in the palette with a thin double frame and the set symbol. No made up
 * card counts or prices: what's in a pack links to Wizards' own page.
 */
export function PackArt({ setCode, setName, boosterType = "play", photo, icon, width }: Props) {
  const height = Math.round(width * 1.62);
  const label = `${setName} ${boosterType === "collector" ? "Collector" : "Play"} Booster`;
  if (photo) {
    return (
      <View style={[s.frame, { width, height }]} accessibilityLabel={label}>
        <Image source={photo} style={StyleSheet.absoluteFill} contentFit="cover" accessibilityIgnoresInvertColors />
      </View>
    );
  }
  const pad = Math.round(width * 0.07);
  return (
    <LinearGradient colors={[palette.blue[500], palette.blue[600], palette.blue[700]]} start={{ x: 0.1, y: 0 }} end={{ x: 0.9, y: 1 }}
      style={[s.frame, { width, height, padding: pad }]} accessibilityLabel={label}>
      <View style={[s.crimp, { height: Math.round(height * 0.05) }]} />
      <View style={s.inner}>
        {icon ? <Image source={icon} style={{ width: width * 0.34, height: width * 0.34, tintColor: palette.sky[200] }} contentFit="contain" /> : null}
        <Text style={[s.code, { fontSize: Math.round(width * 0.17) }]}>{setCode}</Text>
        <Text style={[s.name, { fontSize: Math.max(10, Math.round(width * 0.075)) }]} numberOfLines={2}>{setName}</Text>
        <Text style={[s.type, { fontSize: Math.max(8, Math.round(width * 0.052)) }]}>{boosterType === "collector" ? "COLLECTOR" : "PLAY"} BOOSTER</Text>
      </View>
      <View style={[s.crimp, { height: Math.round(height * 0.05) }]} />
    </LinearGradient>
  );
}

const s = StyleSheet.create({
  frame: { borderRadius: 6, overflow: "hidden", borderWidth: 1, borderColor: palette.blue[300] },
  crimp: { alignSelf: "stretch", borderRadius: 2, backgroundColor: "rgba(217, 223, 233, 0.12)",
    borderTopWidth: 1, borderBottomWidth: 1, borderColor: "rgba(217, 223, 233, 0.18)" },
  inner: { flex: 1, marginVertical: 8, alignItems: "center", justifyContent: "center", gap: 6, borderWidth: 1, borderColor: "rgba(135, 207, 239, 0.35)",
    borderRadius: 3, paddingHorizontal: 6 },
  code: { color: palette.ink[100], fontFamily: font.displayHeavy, letterSpacing: 2 },
  name: { color: palette.blue[100], fontFamily: font.bodySemi, textAlign: "center" },
  type: { color: palette.sky[200], fontFamily: font.bodyBold, letterSpacing: 1.6 },
});
