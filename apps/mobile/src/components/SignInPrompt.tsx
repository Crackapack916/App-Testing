import { StyleSheet, View } from "react-native";
import { Text } from "./Text";
import { router } from "expo-router";
import { Button } from "./bits";
import { colors, font } from "../lib/theme";

/** What a guest sees on screens that need an account. */
export function SignInPrompt({ title, body }: { title: string; body: string }) {
  return (
    <View style={s.wrap} testID="sign-in-prompt">
      <Text style={s.h1} accessibilityRole="header">{title}</Text>
      <Text style={s.body}>{body}</Text>
      <Button testID="go-sign-in" label="Log in or create an account" onPress={() => router.push("/sign-in")} />
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, justifyContent: "center", padding: 24, gap: 12, maxWidth: 420, width: "100%", alignSelf: "center" },
  h1: { color: colors.text, fontSize: 22, fontFamily: font.display },
  body: { color: colors.muted, fontSize: 15, lineHeight: 21 },
});
