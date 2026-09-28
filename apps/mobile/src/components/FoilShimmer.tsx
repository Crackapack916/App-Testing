import { useEffect } from "react";
import { Platform, StyleSheet } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { DeviceMotion } from "expo-sensors";
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming } from "react-native-reanimated";
import { palette } from "../lib/theme";

const AnimatedGradient = Animated.createAnimatedComponent(LinearGradient);

/**
 * Holographic foil, drawn in the card frame only (never over the card image). Colors come
 * from the palette's light sky and blue steps. Respects reduced motion.
 * Holographic foil overlay. A rainbow layer and a white sheen band sweep across the card;
 * on devices, tilting the phone shifts the sheen the way a real foil catches light.
 * All motion runs on the UI thread, so it stays smooth on mid range phones.
 */
export function FoilShimmer({ width, intensity = 1 }: { width: number; intensity?: number }) {
  const reduce = useReducedMotion();
  const sweep = useSharedValue(0.5);
  const tilt = useSharedValue(0);

  useEffect(() => {
    if (reduce) return;
    sweep.value = withRepeat(withTiming(1, { duration: 2600, easing: Easing.inOut(Easing.quad) }), -1, true);
    if (Platform.OS === "web") return;
    DeviceMotion.setUpdateInterval(50);
    const sub = DeviceMotion.addListener((m) => {
      const g = m.rotation?.gamma ?? 0; // left/right tilt, radians
      tilt.value = withTiming(Math.max(-1, Math.min(1, g / 0.6)), { duration: 80 });
    });
    return () => sub.remove();
  }, [sweep, tilt, reduce]);

  const rainbow = useAnimatedStyle(() => ({
    opacity: 0.85 * intensity,
    transform: [{ translateX: (sweep.value - 0.5) * width * 0.6 + tilt.value * width * 0.3 }],
  }));
  const sheen = useAnimatedStyle(() => ({
    transform: [{ translateX: (sweep.value * 2 - 1) * width * 1.2 + tilt.value * width * 0.5 }, { rotate: "20deg" }],
  }));

  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { overflow: "hidden" }]}>
      <AnimatedGradient
        colors={[palette.sky[100], palette.sky[200], palette.ink[100], palette.blue[200], palette.sky[300], palette.sky[100]]}
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
