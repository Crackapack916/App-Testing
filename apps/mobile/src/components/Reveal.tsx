import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Animated, Easing, Platform, Pressable, StyleSheet, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Image } from "expo-image";
import { CardImage, CARD_RATIO, type CardLike } from "./CardImage";
import { Sparkle } from "./icons";
import { Text } from "./Text";
import { useReducedMotion } from "../lib/motion";
import { brand, colors, font, radii } from "../lib/theme";

export type RevealCard = CardLike & { slot: number };

const USE_NATIVE = Platform.OS !== "web";
// Quick on purpose: about four seconds for a pack. Every card gets the same beat, whatever its
// rarity or price, and there is no sound. Tap to show everything at once.
const RIP_MS = 520;
const DEAL_GAP = 40;
const DEAL_MS = 240;
const FLIP_GAP = 150;
const FLIP_MS = 240;

/**
 * An animated look at a pack that was already opened and filmed: the same cards, in the order
 * they came out of the real pack. Nothing here is random and nothing is decided on the device;
 * the cards and their order come from the pack's logged contents.
 */
export function Reveal({ cards, packPhoto, width, height, playing, testID }:
  { cards: RevealCard[]; packPhoto: string | null; width: number; height: number; playing: boolean; testID?: string }) {
  const reduced = useReducedMotion();
  const cols = cards.length > 12 ? 4 : 3;
  const gap = 8;
  const rows = Math.ceil(cards.length / cols);
  // Fit the grid in the space: as wide as possible, but never taller than the reel item.
  const byWidth = Math.floor((width - (cols - 1) * gap) / cols);
  const byHeight = Math.floor(((height - (rows - 1) * gap) / rows) / CARD_RATIO);
  const cardW = Math.max(40, Math.min(byWidth, byHeight));
  const cardH = Math.round(cardW * CARD_RATIO);
  const gridW = cols * cardW + (cols - 1) * gap;
  const gridH = rows * cardH + (rows - 1) * gap;

  const rip = useRef(new Animated.Value(0)).current;
  const deal = useMemo(() => cards.map(() => new Animated.Value(0)), [cards]);
  const flip = useMemo(() => cards.map(() => new Animated.Value(0)), [cards]);
  const anim = useRef<Animated.CompositeAnimation | null>(null);
  const [done, setDone] = useState(false);

  const showAll = useCallback(() => {
    anim.current?.stop();
    rip.setValue(1); deal.forEach((v) => v.setValue(1)); flip.forEach((v) => v.setValue(1));
    setDone(true);
  }, [rip, deal, flip]);

  const play = useCallback(() => {
    anim.current?.stop();
    rip.setValue(0); deal.forEach((v) => v.setValue(0)); flip.forEach((v) => v.setValue(0));
    setDone(false);
    if (reduced) { showAll(); return; }
    anim.current = Animated.sequence([
      Animated.timing(rip, { toValue: 1, duration: RIP_MS, easing: Easing.in(Easing.cubic), useNativeDriver: USE_NATIVE }),
      Animated.stagger(DEAL_GAP, deal.map((v) => Animated.timing(v, { toValue: 1, duration: DEAL_MS, easing: Easing.out(Easing.back(1.2)), useNativeDriver: USE_NATIVE }))),
      Animated.stagger(FLIP_GAP, flip.map((v) => Animated.timing(v, { toValue: 1, duration: FLIP_MS, easing: Easing.inOut(Easing.quad), useNativeDriver: USE_NATIVE }))),
    ]);
    anim.current.start(({ finished }) => { if (finished) setDone(true); });
  }, [rip, deal, flip, reduced, showAll]);

  useEffect(() => {
    if (playing && cards.length) play();
    else anim.current?.stop();
  }, [playing, cards.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const packW = Math.min(width * 0.5, 190);
  return (
    <Pressable onPress={done ? undefined : showAll} style={[s.stage, { width, height }]} testID={testID}
      accessibilityRole="button" accessibilityLabel={done ? `${cards.length} cards, in the order they came out of the pack` : "Show all cards now"}>
      {/* The sealed pack tears away first. */}
      <Animated.View pointerEvents="none" style={[s.center, {
        opacity: rip.interpolate({ inputRange: [0, 0.7, 1], outputRange: [1, 1, 0] }),
        transform: [
          { translateY: rip.interpolate({ inputRange: [0, 0.35, 1], outputRange: [0, 8, -height * 0.55] }) },
          { scale: rip.interpolate({ inputRange: [0, 0.35, 1], outputRange: [1, 1.06, 0.9] }) },
          { rotate: rip.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "-6deg"] }) },
        ],
      }]}>
        {packPhoto
          ? <Image source={packPhoto} style={{ width: packW, height: packW * 1.9 }} contentFit="contain" accessibilityIgnoresInvertColors />
          : <CardBack width={packW} height={packW * 1.6} />}
      </Animated.View>

      <View style={{ width: gridW, height: gridH }}>
        {cards.map((c, i) => {
          const col = i % cols, row = Math.floor(i / cols);
          const x = col * (cardW + gap), y = row * (cardH + gap);
          // Dealt from the middle of the grid to its place.
          const fromX = gridW / 2 - cardW / 2 - x, fromY = gridH / 2 - cardH / 2 - y;
          const dealt = deal[i], turned = flip[i];
          const place = {
            position: "absolute" as const, left: x, top: y, width: cardW, height: cardH,
            opacity: dealt.interpolate({ inputRange: [0, 0.2, 1], outputRange: [0, 1, 1] }),
            transform: [
              { translateX: dealt.interpolate({ inputRange: [0, 1], outputRange: [fromX, 0] }) },
              { translateY: dealt.interpolate({ inputRange: [0, 1], outputRange: [fromY, 0] }) },
              { scale: dealt.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }) },
            ],
          };
          return (
            <Animated.View key={c.slot} style={place} testID={`reveal-card-${c.slot}`}>
              <Animated.View style={[StyleSheet.absoluteFill, {
                opacity: turned.interpolate({ inputRange: [0, 0.5, 0.51, 1], outputRange: [1, 1, 0, 0] }),
                transform: [{ perspective: 800 }, { rotateY: turned.interpolate({ inputRange: [0, 0.5], outputRange: ["0deg", "90deg"], extrapolate: "clamp" }) }],
              }]}>
                <CardBack width={cardW} height={cardH} />
              </Animated.View>
              <Animated.View style={[StyleSheet.absoluteFill, {
                opacity: turned.interpolate({ inputRange: [0, 0.5, 0.51, 1], outputRange: [0, 0, 1, 1] }),
                transform: [{ perspective: 800 }, { rotateY: turned.interpolate({ inputRange: [0.5, 1], outputRange: ["-90deg", "0deg"], extrapolate: "clamp" }) }],
              }]}>
                <CardImage card={c} width={cardW} />
              </Animated.View>
            </Animated.View>
          );
        })}
      </View>

      {done ? (
        <Pressable onPress={play} style={s.replay} accessibilityRole="button" testID="reveal-replay">
          <Text style={s.replayText}>Replay</Text>
        </Pressable>
      ) : <Text style={s.hint}>Tap to show all</Text>}
    </Pressable>
  );
}

/** Our own card back: Arcane Violet into Ink, a gold spark. Never Wizards' card back. */
export function CardBack({ width, height }: { width: number; height: number }) {
  return (
    <LinearGradient colors={[brand.violet, "#3B2A8C", brand.ink]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
      style={[s.back, { width, height, borderRadius: Math.max(4, width * 0.06) }]}>
      <View style={[s.backInner, { borderRadius: Math.max(3, width * 0.045) }]}>
        <Sparkle size={Math.max(12, width * 0.34)} color={brand.gold} fill={brand.gold} />
      </View>
    </LinearGradient>
  );
}

const s = StyleSheet.create({
  stage: { alignItems: "center", justifyContent: "center" },
  center: { position: "absolute", alignItems: "center", justifyContent: "center", zIndex: 10 },
  back: { padding: 3, borderWidth: 1, borderColor: "rgba(245, 184, 46, 0.55)" },
  backInner: { flex: 1, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "rgba(251, 251, 251, 0.25)" },
  hint: { position: "absolute", bottom: 4, fontFamily: font.body, fontSize: 12, color: colors.muted },
  replay: { position: "absolute", bottom: 0, borderRadius: radii.pill, borderWidth: 1, borderColor: colors.lineStrong, paddingHorizontal: 16, paddingVertical: 6,
    backgroundColor: colors.panel },
  replayText: { fontFamily: font.bodySemi, fontSize: 12.5, color: colors.text },
});
