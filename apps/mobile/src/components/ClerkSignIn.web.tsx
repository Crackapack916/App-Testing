import { View } from "react-native";
import { SignIn } from "@clerk/expo/web";

/** Clerk's web sign in, for the web build. */
export function ClerkSignIn() {
  return <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 16 }}><SignIn /></View>;
}
