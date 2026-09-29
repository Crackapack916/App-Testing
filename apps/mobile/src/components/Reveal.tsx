import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from "react";
import { Animated, Easing, Platform, Pressable, StyleSheet, View } from "react-native";
import { LinearGradient, type LinearGradientProps } from "expo-linear-gradient";
import { Image } from "expo-image";
import { CardImage, CARD_RATIO, type CardLike } from "./CardImage";
import { Sparkle, Sparkles } from "./icons";
import { Text } from "./Text";
import { useReducedMotion } from "../lib/motion";
import { brand, colors, font, radii } from "../lib/theme";

// pnpm hoists the staff site's React 18 types for this package; the component is the same.
const Gradient = LinearGradient as unknown as ComponentType<LinearGradientProps & { children?: ReactNode }>;

export type RevealCard = CardLike & { slot: number };

const USE_NATIVE = Platform.OS !== "web";
// Every card gets the same beat, whatever its rarity or price, and there is no sound.
const RIP_MS = 520;
const DEAL_GAP = 40;
const DEAL_MS = 240;
const FLIP_GAP = 150;
const FLIP_MS = 240;
const CONTROLS = 52;   // the Reveal all or Replay row
const NOTE = 22;       // the line saying these are the filmed pack's cards

/**
 * An animated look at a pack that was already opened and filmed: the same cards, in the order
 * they came out of the real pack. Nothing here is random and nothing is decided on the device.
 * The pack tears open and the cards are dealt face down. The customer taps a card to flip it,
 * or Reveal all to flip the rest in order. Press and hold a face up card to zoom in; let go to
 * return to the spread.
 */
export function Reveal({ cards, packPhoto, width, height, playing, testID }:
  { cards: RevealCard[]; packPhoto: string | null; width: number; height: number; playing: boolean; testID?: string }) {
  const reduced = useReducedMotion();
  const cols = cards.length > 12 ? 4 : 3;
  const gap = 8;
  const rows = Math.ceil(cards.length / cols);
  const gridSpace = height - CONTROLS - NOTE;
  // Fit the grid in the space: as wide as possible, but never taller than the reel item.
  const byWidth = Math.floor((width - (cols - 1) * gap) / cols);
  const byHeight = Math.floor(((gridSpace - (rows - 1) * gap) / rows) / CARD_RATIO);
  const cardW = Math.max(40, Math.min(byWidth, byHeight));
  const cardH = Math.round(cardW * CARD_RATIO);
  const gridW = cols * cardW + (cols - 1) * gap;
  const gridH = rows * cardH + (rows - 1) * gap;

  const rip = useRef(new Animated.Value(0)).current;
  const deal = useMemo(() => cards.map(() => new Animated.Value(0)), [cards]);
  const flip = useMemo(() => cards.map(() => new Animated.Value(0)), [cards]);
  const anim = useRef<Animated.CompositeAnimation | null>(null);
  const [dealt, setDealt] = useState(false);
  const [up, setUp] = useState<boolean[]>(() => cards.map(() => false));
  const [zoom, setZoom] = useState<RevealCard | null>(null);
  const [flipping, setFlipping] = useState(false);
  const allUp = up.length > 0 && up.every(Boolean);

  const turn = (i: number) => Animated.timing(flip[i], { toValue: 1, duration: reduced ? 0 : FLIP_MS, easing: Easing.inOut(Easing.quad), useNativeDriver: USE_NATIVE });

  // Tear the pack and deal the cards face down.
  const start = useCallback(() => {
    anim.current?.stop();
    rip.setValue(0); deal.forEach((v) => v.setValue(0)); flip.forEach((v) => v.setValue(0));
    setUp(cards.map(() => false)); setDealt(false); setZoom(null); setFlipping(false);
    if (reduced) { rip.setValue(1); deal.forEach((v) => v.setValue(1)); setDealt(true); return; }
    anim.current = Animated.sequence([
      Animated.timing(rip, { toValue: 1, duration: RIP_MS, easing: Easing.in(Easing.cubic), useNativeDriver: USE_NATIVE }),
      Animated.stagger(DEAL_GAP, deal.map((v) => Animated.timing(v, { toValue: 1, duration: DEAL_MS, easing: Easing.out(Easing.back(1.2)), useNativeDriver: USE_NATIVE }))),
    ]);
    anim.current.start(({ finished }) => { if (finished) setDealt(true); });
  }, [cards, rip, deal, flip, reduced]);

  // Finish the deal at once, so a tap or Reveal all during it still works.
  const finishDeal = () => {
    if (dealt) return;
    anim.current?.stop(); rip.setValue(1); deal.forEach((v) => v.setValue(1)); setDealt(true);
  };

  const flipOne = (i: number) => {
    if (up[i]) return;
    finishDeal();
    setUp((u) => u.map((x, j) => x || j === i));
    turn(i).start();
  };

  // The rest, in pulled order, one beat apart.
  const revealAll = () => {
    finishDeal();
    const rest = cards.map((_, i) => i).filter((i) => !up[i]);
    setUp(cards.map(() => true));
    setFlipping(true);
    anim.current = Animated.stagger(reduced ? 0 : FLIP_GAP, rest.map(turn));
    anim.current.start(() => setFlipping(false));
  };

  useEffect(() => {
    if (playing && cards.length) start();
    else { anim.current?.stop(); setZoom(null); }
  }, [playing, cards.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const packW = Math.min(width * 0.5, 190);
  const zoomW = Math.min(width * 0.92, (height - 16) / CARD_RATIO, 480);
  return (
    <View style={[s.stage, { width, height }]} testID={testID}>
      <Text style={s.note}>Same cards, in the order they came out of your filmed pack.</Text>

      <View style={{ width: gridW, height: gridH, marginTop: NOTE }}>
        {cards.map((c, i) => {
          const col = i % cols, row = Math.floor(i / cols);
          const x = col * (cardW + gap), y = row * (cardH + gap);
          // Dealt from the middle of the grid to its place.
          const fromX = gridW / 2 - cardW / 2 - x, fromY = gridH / 2 - cardH / 2 - y;
          const d = deal[i], t = flip[i];
          const place = {
            position: "absolute" as const, left: x, top: y, width: cardW, height: cardH,
            opacity: d.interpolate({ inputRange: [0, 0.2, 1], outputRange: [0, 1, 1] }),
            transform: [
              { translateX: d.interpolate({ inputRange: [0, 1], outputRange: [fromX, 0] }) },
              { translateY: d.interpolate({ inputRange: [0, 1], outputRange: [fromY, 0] }) },
              { scale: d.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }) },
            ],
          };
          return (
            <Animated.View key={c.slot} style={place} testID={`reveal-card-${c.slot}`}>
              <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, {
                opacity: t.interpolate({ inputRange: [0, 0.5, 0.51, 1], outputRange: [1, 1, 0, 0] }),
                transform: [{ perspective: 800 }, { rotateY: t.interpolate({ inputRange: [0, 0.5], outputRange: ["0deg", "90deg"], extrapolate: "clamp" }) }],
              }]}>
                <CardBack width={cardW} height={cardH} />
              </Animated.View>
              <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, {
                opacity: t.interpolate({ inputRange: [0, 0.5, 0.51, 1], outputRange: [0, 0, 1, 1] }),
                transform: [{ perspective: 800 }, { rotateY: t.interpolate({ inputRange: [0.5, 1], outputRange: ["-90deg", "0deg"], extrapolate: "clamp" }) }],
              }]}>
                <CardImage card={c} width={cardW} />
              </Animated.View>
              {/* A transparent layer on top takes the touches, so holding never opens the image menu. */}
              <Pressable style={[StyleSheet.absoluteFill, s.touch]} testID={`reveal-touch-${c.slot}`}
                onPress={() => flipOne(i)} delayLongPress={280}
                onLongPress={() => { if (up[i]) setZoom(c); }} onPressOut={() => setZoom(null)}
                accessibilityRole="button"
                accessibilityLabel={up[i] ? `${c.name}. Press and hold to zoom in.` : `Card ${i + 1}, face down. Tap to flip.`} />
            </Animated.View>
          );
        })}
      </View>

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

      <View style={s.controls}>
        {allUp && flipping ? null : allUp ? (
          <Pressable onPress={start} style={s.ghost} accessibilityRole="button" testID="reveal-replay">
            <Text style={s.ghostText}>Replay</Text>
          </Pressable>
        ) : (
          <Pressable onPress={revealAll} style={s.primary} accessibilityRole="button" testID="reveal-all">
            <Sparkles size={15} color={colors.accentInk} />
            <Text style={s.primaryText}>Reveal all</Text>
          </Pressable>
        )}
      </View>

      {zoom ? (
        <View pointerEvents="none" style={s.zoom} testID="reveal-zoom">
          <CardImage card={zoom} width={zoomW} />
        </View>
      ) : null}
    </View>
  );
}

/** Our own card back: Arcane Violet into Ink, a gold spark. Never Wizards' card back. */
export function CardBack({ width, height }: { width: number; height: number }) {
  return (
    <Gradient colors={[brand.violet, "#3B2A8C", brand.ink]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
      style={[s.back, { width, height, borderRadius: Math.max(4, width * 0.06) }]}>
      <View style={[s.backInner, { borderRadius: Math.max(3, width * 0.045) }]}>
        <Sparkle size={Math.max(12, width * 0.34)} color={brand.gold} fill={brand.gold} />
      </View>
    </Gradient>
  );
}

const s = StyleSheet.create({
  stage: { alignItems: "center" },
  note: { position: "absolute", top: 0, fontFamily: font.body, fontSize: 11.5, lineHeight: 16, color: colors.faint, textAlign: "center" },
  center: { position: "absolute", top: 0, bottom: CONTROLS, left: 0, right: 0, alignItems: "center", justifyContent: "center", zIndex: 10 },
  touch: Platform.OS === "web" ? ({ userSelect: "none", WebkitUserSelect: "none", WebkitTouchCallout: "none", touchAction: "manipulation" } as object) : {},
  back: { padding: 3, borderWidth: 1, borderColor: "rgba(245, 184, 46, 0.55)" },
  backInner: { flex: 1, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "rgba(251, 251, 251, 0.25)" },
  controls: { position: "absolute", bottom: 0, height: CONTROLS, justifyContent: "center" },
  primary: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: brand.magenta, borderRadius: radii.pill, paddingHorizontal: 20, minHeight: 44 },
  primaryText: { fontFamily: font.bodyBold, fontSize: 13, letterSpacing: 1.4, textTransform: "uppercase", color: colors.accentInk },
  ghost: { borderRadius: radii.pill, borderWidth: 1, borderColor: colors.lineStrong, paddingHorizontal: 20, minHeight: 44, justifyContent: "center",
    backgroundColor: colors.panel },
  ghostText: { fontFamily: font.bodySemi, fontSize: 13, color: colors.text },
  zoom: { position: "absolute", top: 0, bottom: 0, left: -12, right: -12, alignItems: "center", justifyContent: "center", zIndex: 20,
    backgroundColor: "rgba(10, 8, 16, 0.78)" },
});
