import { View } from "react-native";
import { Stack } from "expo-router";
import { useFonts } from "expo-font";
import { Poppins_400Regular, Poppins_500Medium, Poppins_600SemiBold, Poppins_700Bold, Poppins_800ExtraBold } from "@expo-google-fonts/poppins";
import "../global.css";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { SessionProvider, useSession } from "../lib/session";
import { colors } from "../lib/theme";

export default function RootLayout() {
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <SafeAreaProvider>
        <SessionProvider>
          <StatusBar style="light" />
          <Root />
        </SessionProvider>
      </SafeAreaProvider>
    </View>
  );
}

function Root() {
  const { ready, me } = useSession();
  // Bundled with the site (self hosted); the fallback stacks cover the moment before they load.
  const [fontsLoaded, fontError] = useFonts({ Poppins_400Regular, Poppins_500Medium, Poppins_600SemiBold, Poppins_700Bold, Poppins_800ExtraBold });

  // Render at once: every font has a fallback stack, and the web fonts swap in when loaded.
  // Blocking on them left the page blank for seconds on a slow phone.
  void fontsLoaded; void fontError;
  if (!ready) return null;
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
      {/* Guests can browse (Search and Drops must work without an account); a signed in
          customer who hasn't confirmed their age sees only that step. */}
      <Stack.Protected guard={!me || me.age_verified}>
        <Stack.Screen name="index" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="card/[id]" options={{ presentation: "modal" }} />
        <Stack.Screen name="add-credits" options={{ presentation: "modal" }} />
      </Stack.Protected>
      <Stack.Protected guard={!!me?.age_verified}>
        <Stack.Screen name="pack/[id]" options={{ presentation: "fullScreenModal" }} />
        <Stack.Screen name="reel" options={{ presentation: "fullScreenModal", animation: "fade" }} />
        <Stack.Screen name="ship" />
      </Stack.Protected>
      <Stack.Protected guard={!!me && !me.age_verified}>
        <Stack.Screen name="verify-age" />
      </Stack.Protected>
      <Stack.Protected guard={!me}>
        <Stack.Screen name="sign-in" />
      </Stack.Protected>
      <Stack.Screen name="reset-password" />
      {/* Policies are public, even before sign in or age confirmation. */}
      <Stack.Screen name="policies/index" />
      <Stack.Screen name="policies/[doc]" />
    </Stack>
  );
}
