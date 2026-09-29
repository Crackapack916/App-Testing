import { useEffect, useRef } from "react";
import { Animated, Easing, Platform, StyleSheet } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useReducedMotion } from "../lib/motion";
import { brand } from "../lib/theme";

const AnimatedGradient = Animated.createAnimatedComponent(LinearGradient);

/**
 * Holographic foil, drawn in the card frame only (never over the card image, so the
 * copyright and artist line stay as Scryfall serves them). Colors come from the palette's
 * sky and blue steps. A slow sheen sweeps across; still when reduced motion is on.
 */
export function FoilShimmer({ width, intensity = 1 }: { width: number; intensity?: number }) {
  const reduce = useReducedMotion();
  const sweep = useRef(new Animated.Value(0.5)).current;
  useEffect(() => {
    if (reduce) return;
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(sweep, { toValue: 1, duration: 2600, easing: Easing.inOut(Easing.quad), useNativeDriver: Platform.OS !== "web" }),
      Animated.timing(sweep, { toValue: 0, duration: 2600, easing: Easing.inOut(Easing.quad), useNativeDriver: Platform.OS !== "web" }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [sweep, reduce]);

  const rainbow = { opacity: 0.85 * intensity, transform: [{ translateX: sweep.interpolate({ inputRange: [0, 1], outputRange: [-width * 0.3, width * 0.3] }) }] };
  const sheen = { transform: [{ translateX: sweep.interpolate({ inputRange: [0, 1], outputRange: [-width * 1.2, width * 1.2] }) }, { rotate: "20deg" }] };
  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { overflow: "hidden" }]}>
      <AnimatedGradient
        colors={[brand.violet, brand.magenta, brand.foil, brand.gold, brand.violet, brand.magenta]}
        start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
        style={[{ position: "absolute", top: 0, bottom: 0, left: -width * 0.5, width: width * 2 }, rainbow]}
      />
      <AnimatedGradient
        colors={["rgba(252,252,252,0)", "rgba(252,252,252,0.8)", "rgba(252,252,252,0)"]}
        start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }}
        style={[{ position: "absolute", top: -width, bottom: -width, width: width * 0.35 }, sheen]}
      />
    </Animated.View>
  );
}
