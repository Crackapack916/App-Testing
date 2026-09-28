import { View } from "react-native";
import { Stack } from "expo-router";
import { useFonts } from "expo-font";
import { Fraunces_600SemiBold, Fraunces_700Bold, Fraunces_800ExtraBold } from "@expo-google-fonts/fraunces";
import { InstrumentSans_400Regular, InstrumentSans_500Medium, InstrumentSans_600SemiBold, InstrumentSans_700Bold } from "@expo-google-fonts/instrument-sans";
import { IBMPlexMono_400Regular, IBMPlexMono_500Medium } from "@expo-google-fonts/ibm-plex-mono";
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
          <StatusBar style="dark" />
          <Root />
        </SessionProvider>
      </SafeAreaProvider>
    </View>
  );
}

function Root() {
  const { ready, me } = useSession();
  // Bundled with the site (self hosted); the fallback stacks cover the moment before they load.
  const [fontsLoaded, fontError] = useFonts({ Fraunces_600SemiBold, Fraunces_700Bold, Fraunces_800ExtraBold,
    InstrumentSans_400Regular, InstrumentSans_500Medium, InstrumentSans_600SemiBold, InstrumentSans_700Bold,
    IBMPlexMono_400Regular, IBMPlexMono_500Medium });

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
