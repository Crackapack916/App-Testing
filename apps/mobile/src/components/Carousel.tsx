import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Animated, PanResponder, Platform, Pressable, StyleSheet, View } from "react-native";
import { useReducedMotion } from "../lib/motion";
import { ChevronLeft, ChevronRight } from "./icons";
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

const SPRING = { damping: 18, stiffness: 170, mass: 0.9, useNativeDriver: Platform.OS !== "web" };

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
  const pos = useRef(new Animated.Value(index)).current;   // position in items, fractional while dragging
  const at = useRef(index);
  const last = items.length - 1;

  const settle = useCallback((i: number) => {
    const next = Math.max(0, Math.min(last, i));
    at.current = next;
    if (reduced) pos.setValue(next); else Animated.spring(pos, { toValue: next, ...SPRING }).start();
    setIndex(next);
    onIndexChange?.(next);
  }, [last, reduced, onIndexChange, pos]);

  useEffect(() => { if (controlled != null && controlled !== index) settle(controlled); }, [controlled]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (index > last && last >= 0) settle(last); }, [last]); // eslint-disable-line react-hooks/exhaustive-deps

  // Drag with an elastic edge; a quick flick travels further, then snaps to the center.
  const settleRef = useRef(settle);
  settleRef.current = settle;
  const pan = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 8 && Math.abs(g.dx) > Math.abs(g.dy),
    onPanResponderGrant: () => pos.stopAnimation(),
    onPanResponderMove: (_, g) => {
      const raw = at.current - g.dx / stepRef.current;
      const end = lastRef.current;
      pos.setValue(raw < 0 ? raw * 0.3 : raw > end ? end + (raw - end) * 0.3 : raw);
    },
    onPanResponderRelease: (_, g) => settleRef.current(Math.round(at.current - g.dx / stepRef.current - g.vx * 0.9)),
    onPanResponderTerminate: () => settleRef.current(at.current),
  })).current;
  const stepRef = useRef(step);
  stepRef.current = step;
  const lastRef = useRef(last);
  lastRef.current = last;

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
      <View style={[StyleSheet.absoluteFill, s.track]} {...pan.panHandlers}>
          {items.map((item, i) => (
            <Slide key={keyOf(item)} i={i} pos={pos} step={step} width={itemWidth} height={height} reduced={reduced}
              label={`${i + 1} of ${items.length}: ${labelOf(item)}`} onPress={() => settle(i)} active={i === index}>
              {render(item, i === index)}
            </Slide>
          ))}
      </View>
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
  { i: number; pos: Animated.Value; step: number; width: number; height: number; reduced: boolean; label: string;
    onPress: () => void; active: boolean; children: ReactNode }) {
  const d = Animated.subtract(i, pos);   // this slide's distance from the center
  const style = {
    opacity: d.interpolate({ inputRange: [-2.2, -1, 0, 1, 2.2], outputRange: [0, 0.55, 1, 0.55, 0], extrapolate: "clamp" as const }),
    transform: [
      { translateX: Animated.multiply(d, step) },
      { perspective: 900 },
      { rotateY: reduced ? "0deg" : d.interpolate({ inputRange: [-1, 0, 1], outputRange: ["15deg", "0deg", "-15deg"], extrapolate: "clamp" }) },
      { scale: d.interpolate({ inputRange: [-1, 0, 1], outputRange: [0.74, 1, 0.74], extrapolate: "clamp" }) },
    ],
    zIndex: active ? 100 : 50,
  };
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
    backgroundColor: palette.panel, borderWidth: 1, borderColor: colors.line, zIndex: 200 },
  arrowStage: { backgroundColor: stage.panel, borderColor: stage.line },
  off: { opacity: 0.3 },
});
