import type { ComponentType, ReactNode } from "react";
import { Platform, StyleSheet, View } from "react-native";
import { Image } from "expo-image";
import { LinearGradient, type LinearGradientProps } from "expo-linear-gradient";
import { Text } from "./Text";
import { FoilShimmer } from "./FoilShimmer";
import { colors, font, palette, rarityColor, rarityFrame } from "../lib/theme";

// pnpm hoists the staff site's React 18 types for this package; the component is the same.
const Gradient = LinearGradient as unknown as ComponentType<LinearGradientProps & { children?: ReactNode }>;

export type CardLike = { name: string; set_code: string; collector_number: string; rarity: string; image_url?: string | null; finish?: string };

/** Real card proportion: 2.5 by 3.5 inches. */
export const CARD_RATIO = 3.5 / 2.5;

/**
 * A card in a polished metal frame colored by rarity (common slate, uncommon silver, rare
 * gold, mythic orange), the same shape and glow for every card. Foil shimmer lives only in the
 * frame: the image itself is never covered, cropped, stretched or color shifted, so the
 * copyright and artist line stays as Scryfall serves it.
 */
export function CardImage({ card, width: outerWidth }: { card: CardLike; width: number }) {
  // The width given is the whole tile, frame included.
  const frame = Math.max(3, Math.round(outerWidth * 0.03));
  const width = outerWidth - frame * 2;
  const height = Math.round(width * CARD_RATIO);
  const foil = !!card.finish && card.finish !== "nonfoil";
  const metal = rarityFrame[card.rarity] ?? rarityFrame.common;
  const glow = rarityColor[card.rarity] ?? palette.line;
  return (
    <Gradient colors={metal} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
      style={[s.outer, { width: width + frame * 2, height: height + frame * 2, padding: frame, borderRadius: frame + 3 },
        Platform.OS === "web" && outerWidth >= 60 ? ({ boxShadow: `0 0 ${Math.round(outerWidth * 0.06)}px ${glow}66` } as object) : null]}
      accessibilityLabel={`${card.name}${foil ? `, ${card.finish}` : ""}`}>
      {foil ? <FoilShimmer width={width + frame * 2} /> : null}
      <View style={[s.inner, { borderRadius: 3 }]}>
        {card.image_url
          ? <Image source={card.image_url} style={{ width: width - 2, height: height - 2 }} contentFit="contain" transition={120} accessibilityIgnoresInvertColors />
          : <View style={[s.placeholder, { width: width - 2, height: height - 2, padding: Math.max(4, width * 0.06) }]}>
              <Text style={[s.phName, { fontSize: Math.max(9, Math.min(16, width * 0.11)) }]} numberOfLines={4}>{card.name}</Text>
              <Text style={[s.phSet, { fontSize: Math.max(8, Math.min(12, width * 0.085)) }]} numberOfLines={1}>{card.set_code} {card.collector_number}</Text>
            </View>}
      </View>
    </Gradient>
  );
}

const s = StyleSheet.create({
  outer: { overflow: "hidden" },
  inner: { flex: 1, borderWidth: 1, borderColor: palette.line, overflow: "hidden", backgroundColor: palette.ink },
  placeholder: { justifyContent: "space-between", backgroundColor: palette.panel },
  phName: { fontFamily: font.displaySemi, color: colors.text },
  phSet: { fontFamily: font.mono, color: colors.muted },
});
