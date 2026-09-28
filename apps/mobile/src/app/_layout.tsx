import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { SessionProvider, useSession } from "../lib/session";
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
      <Stack.Screen name="reset-password" />
    </Stack>
  );
}
