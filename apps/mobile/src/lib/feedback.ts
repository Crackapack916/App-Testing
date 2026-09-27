import { Platform } from "react-native";
import * as Haptics from "expo-haptics";

/** Haptics are device only; every call is safe on web. */
export const haptic = {
  tap: () => Platform.OS !== "web" && Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}),
  tear: () => Platform.OS !== "web" && Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {}),
  reveal: () => Platform.OS !== "web" && Haptics.selectionAsync().catch(() => {}),
  bigHit: () => Platform.OS !== "web" && Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}),
};
