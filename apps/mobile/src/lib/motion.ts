import { useEffect, useState } from "react";
import { AccessibilityInfo } from "react-native";

/** True when the person asked for reduced motion (prefers-reduced-motion on the web). */
export function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduced).catch(() => {});
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduced);
    return () => sub.remove();
  }, []);
  return reduced;
}
