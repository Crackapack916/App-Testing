import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Platform, Pressable, StyleSheet, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { Extrapolation, interpolate, runOnJS, useAnimatedStyle, useReducedMotion, useSharedValue, withSpring, withTiming,
  type SharedValue } from "react-native-reanimated";
import { ChevronLeft, ChevronRight } from "lucide-react-native";
import { colors, palette, stage } from "../lib/theme";

type Props<T> = {
  items: T[];
  keyOf: (item: T) => string;
  labelOf: (item: T) => string;
  render: (item: T, active: boolean) => ReactNode;
  /** Width of one item at full size; neighbors sit closer and smaller. */
  itemWidth: number;
  height: number;
  index?: number;
  onIndexChange?: (i: number) => void;
  label: string;
  onStage?: boolean;
  testID?: string;
};

const SPRING = { damping: 18, stiffness: 170, mass: 0.9 };

/**
 * The pack picker (item 7): drag or swipe with momentum and an elastic snap to the center.
 * The center item is large and faces forward; neighbors are smaller, dimmed and turned about
 * 15 degrees. Arrow buttons and the left and right keys move one step. Used on Packs, for
 * Cracked today in the Vault, and for upcoming sets in Drops.
 */
export function Carousel<T>({ items, keyOf, labelOf, render, itemWidth, height, index: controlled, onIndexChange, label, onStage, testID }: Props<T>) {
  const reduced = useReducedMotion();
  const [index, setIndex] = useState(controlled ?? 0);
  const step = itemWidth * 0.72;
  const pos = useSharedValue(index);   // position in items, fractional while dragging
  const start = useSharedValue(0);
  const last = items.length - 1;

  const settle = useCallback((i: number) => {
    const next = Math.max(0, Math.min(last, i));
    pos.value = reduced ? withTiming(next, { duration: 0 }) : withSpring(next, SPRING);
    setIndex(next);
    onIndexChange?.(next);
  }, [last, reduced, onIndexChange, pos]);

  useEffect(() => { if (controlled != null && controlled !== index) settle(controlled); }, [controlled]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (index > last && last >= 0) settle(last); }, [last]); // eslint-disable-line react-hooks/exhaustive-deps

  const pan = Gesture.Pan().activeOffsetX([-8, 8]).failOffsetY([-14, 14])
    .onBegin(() => { start.value = pos.value; })
    .onUpdate((e) => {
      const raw = start.value - e.translationX / step;
      // Elastic past either end.
      pos.value = raw < 0 ? raw * 0.3 : raw > last ? last + (raw - last) * 0.3 : raw;
    })
    .onEnd((e) => {
      // Momentum: a quick flick travels further, then snaps.
      const projected = pos.value - (e.velocityX / step) * 0.18;
      runOnJS(settle)(Math.round(projected));
    });

  // Left and right keys when the carousel has focus (web).
  const ref = useRef<View>(null);
  useEffect(() => {
    if (Platform.OS !== "web") return;
    const el = ref.current as unknown as HTMLElement | null;
    if (!el?.addEventListener) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") { e.preventDefault(); settle(index - 1); }
      if (e.key === "ArrowRight") { e.preventDefault(); settle(index + 1); }
    };
    el.addEventListener("keydown", onKey);
    return () => el.removeEventListener("keydown", onKey);
  }, [index, settle]);

  const arrow = onStage ? stage.text : colors.text;
  return (
    <View ref={ref} testID={testID} style={{ height, justifyContent: "center" }} focusable
      role="region" aria-roledescription="carousel" aria-label={label}>
      <GestureDetector gesture={pan}>
        <View style={[StyleSheet.absoluteFill, s.track]}>
          {items.map((item, i) => (
            <Slide key={keyOf(item)} i={i} pos={pos} step={step} width={itemWidth} height={height} reduced={reduced}
              label={`${i + 1} of ${items.length}: ${labelOf(item)}`} onPress={() => settle(i)} active={i === index}>
              {render(item, i === index)}
            </Slide>
          ))}
        </View>
      </GestureDetector>
      {items.length > 1 && (
        <>
          <Pressable accessibilityRole="button" accessibilityLabel="Previous" onPress={() => settle(index - 1)} disabled={index === 0}
            style={[s.arrow, { left: 4 }, index === 0 && s.off, onStage && s.arrowStage]} testID={testID ? `${testID}-prev` : undefined}>
            <ChevronLeft size={22} color={arrow} />
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Next" onPress={() => settle(index + 1)} disabled={index === last}
            style={[s.arrow, { right: 4 }, index === last && s.off, onStage && s.arrowStage]} testID={testID ? `${testID}-next` : undefined}>
            <ChevronRight size={22} color={arrow} />
          </Pressable>
        </>
      )}
    </View>
  );
}

function Slide({ i, pos, step, width, height, reduced, label, onPress, active, children }:
  { i: number; pos: SharedValue<number>; step: number; width: number; height: number; reduced: boolean; label: string;
    onPress: () => void; active: boolean; children: ReactNode }) {
  const style = useAnimatedStyle(() => {
    const d = i - pos.value;
    const ad = Math.abs(d);
    return {
      zIndex: Math.round(100 - ad * 10),
      opacity: interpolate(ad, [0, 1, 2.2], [1, 0.55, 0], Extrapolation.CLAMP),
      transform: [
        { translateX: d * step },
        { perspective: 900 },
        { rotateY: `${reduced ? 0 : interpolate(d, [-1, 0, 1], [15, 0, -15], Extrapolation.CLAMP)}deg` },
        { scale: interpolate(ad, [0, 1], [1, 0.74], Extrapolation.CLAMP) },
      ],
    };
  });
  return (
    <Animated.View style={[s.slide, { width, height, marginLeft: -width / 2 }, style]}
      role="group" aria-roledescription="slide" aria-label={label} aria-hidden={!active}>
      {/* The center slide's own controls stay usable; a side slide is one button that brings it to the center. */}
      {active ? <View style={{ flex: 1 }}>{children}</View> : (
        <Pressable onPress={onPress} accessibilityLabel={`Show ${label}`} style={{ flex: 1 }} tabIndex={-1 as never}>
          <View pointerEvents="none" style={{ flex: 1 }}>{children}</View>
        </Pressable>
      )}
    </Animated.View>
  );
}

const s = StyleSheet.create({
  track: { overflow: "hidden" },
  slide: { position: "absolute", left: "50%", top: 0 },
  arrow: { position: "absolute", top: "50%", marginTop: -22, width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center",
    backgroundColor: palette.ink[100], borderWidth: 1, borderColor: colors.line, zIndex: 200 },
  arrowStage: { backgroundColor: stage.panel, borderColor: stage.line },
  off: { opacity: 0.3 },
});
