import { StyleSheet, View } from "react-native";
import { Text } from "./Text";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { colors, font } from "../lib/theme";

/**
 * The pack. Shows your own photograph of the physical pack (products' pack_art_ref) when
 * it's set; until then, a branded foil wrapper with the set code.
 */
export function PackArt({ setCode, setName, boosterType, photo, width = 110 }:
  { setCode: string; setName: string; boosterType: string; photo?: string | null; width?: number }) {
  const height = width * 1.62;
  if (photo) return <Image source={photo} style={{ width, height, borderRadius: 8 }} contentFit="cover" />;
  return (
    <LinearGradient colors={boosterType === "collector" ? ["#2b1a3d", "#8a5a1d", "#2b1a3d"] : ["#1b2433", "#3a4f6e", "#1b2433"]}
      start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[s.pack, { width, height }]}>
      <View style={s.crimp} />
      <Text style={s.code}>{setCode}</Text>
      <Text style={s.name} numberOfLines={2}>{setName}</Text>
      <Text style={s.type}>{boosterType === "collector" ? "COLLECTOR" : "PLAY"} BOOSTER</Text>
      <View style={[s.crimp, { marginTop: "auto" }]} />
    </LinearGradient>
  );
}

const s = StyleSheet.create({
  pack: { borderRadius: 8, padding: 8, alignItems: "center", borderWidth: 1, borderColor: "#ffffff22" },
  crimp: { height: 8, alignSelf: "stretch", borderRadius: 2, backgroundColor: "#ffffff18", marginBottom: 10 },
  code: { color: colors.accent, fontSize: 26, fontFamily: font.display, letterSpacing: 2, marginTop: 10 },
  name: { color: colors.text, fontSize: 12, fontFamily: font.bodyBold, textAlign: "center", marginTop: 6 },
  type: { color: colors.muted, fontSize: 9, letterSpacing: 1.5, marginTop: 6 },
});
