import { View } from "react-native";
import { AuthView } from "@clerk/expo/native";

/** Clerk's native sign in: email code, Google and Sign in with Apple, configured in the Clerk dashboard. */
export function ClerkSignIn() {
  return <View style={{ flex: 1 }}><AuthView mode="signInOrUp" isDismissible={false} /></View>;
}
