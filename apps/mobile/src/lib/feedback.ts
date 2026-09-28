import { Platform } from "react-native";
import * as Haptics from "expo-haptics";

/** A light tap on devices that support it; nothing on web. No celebratory feedback anywhere. */
export const haptic = {
  tap: () => Platform.OS !== "web" && Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}),
};
