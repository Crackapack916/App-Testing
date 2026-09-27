import { StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { FoilShimmer } from "./FoilShimmer";
import { colors, rarityColor } from "../lib/theme";

export type CardLike = { name: string; set_code: string; collector_number: string; rarity: string; image_url?: string | null; finish?: string };

/** A card at Magic's 63x88 ratio, framed in its rarity color, with foil shimmer when foil. */
export function CardImage({ card, width, glow = false }: { card: CardLike; width: number; glow?: boolean }) {
  const height = Math.round((width * 88) / 63);
  const frame = rarityColor[card.rarity] ?? colors.line;
  const foil = card.finish && card.finish !== "nonfoil";
  return (
    <View style={[styles.frame, { width, height, borderColor: frame, borderRadius: width * 0.05 },
      glow && { shadowColor: frame, shadowOpacity: 0.9, shadowRadius: 18, elevation: 12 }]}>
      {card.image_url
        ? <Image source={card.image_url} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} accessibilityLabel={card.name} />
        : <View style={[StyleSheet.absoluteFill, styles.placeholder, { padding: Math.max(4, width * 0.06) }]}>
            {/* Text scales with the card so thumbnails stay legible. */}
            <Text style={[styles.phName, { fontSize: Math.max(8, Math.min(16, width * 0.12)) }]} numberOfLines={4}>{card.name}</Text>
            <Text style={[styles.phSet, { fontSize: Math.max(7, Math.min(12, width * 0.09)) }]} numberOfLines={1}>{card.set_code} #{card.collector_number}</Text>
          </View>}
      {foil ? <FoilShimmer width={width} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { borderWidth: 2, overflow: "hidden", backgroundColor: colors.panelHi },
  placeholder: { padding: 10, justifyContent: "space-between" },
  phName: { color: colors.text, fontWeight: "700", fontSize: 14 },
  phSet: { color: colors.muted, fontSize: 11 },
});
