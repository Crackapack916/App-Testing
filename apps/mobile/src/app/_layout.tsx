import { useEffect } from "react";
import { Stack, router } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { SessionProvider, useSession } from "../lib/session";
import { registerForPush } from "../lib/push";
import { haptic } from "../lib/feedback";
import { colors } from "../lib/theme";

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.bg }}>
      <SafeAreaProvider>
        <SessionProvider>
          <StatusBar style="light" />
          <Root />
        </SessionProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function Root() {
  const { ready, me } = useSession();

  // Signed in: register for "You just cracked a pack", and open the reveal when it's tapped.
  useEffect(() => {
    if (!me || Platform.OS === "web") return;
    registerForPush().catch(() => {});
    const sub = Notifications.addNotificationResponseReceivedListener((r) => {
      haptic.bigHit();
      const id = r.notification.request.content.data?.notification_id as string | undefined;
      router.push({ pathname: "/reveal", params: id ? { notification: id } : {} });
    });
    return () => sub.remove();
  }, [me]);

  if (!ready) return null;
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
      <Stack.Protected guard={!!me?.age_verified}>
        <Stack.Screen name="index" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="reveal" options={{ presentation: "fullScreenModal", animation: "fade" }} />
        <Stack.Screen name="card/[id]" options={{ presentation: "modal" }} />
        <Stack.Screen name="clip" options={{ presentation: "fullScreenModal" }} />
      </Stack.Protected>
      <Stack.Protected guard={!!me && !me.age_verified}>
        <Stack.Screen name="verify-age" />
      </Stack.Protected>
      <Stack.Protected guard={!me}>
        <Stack.Screen name="sign-in" />
      </Stack.Protected>
    </Stack>
  );
}
