import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { Text, TextInput } from "../components/Text";
import { router, useLocalSearchParams } from "expo-router";
import { BackButton, Button, ErrorText, Screen } from "../components/bits";
import { api } from "../lib/api";
import { useSession } from "../lib/session";
import { colors, radius, font } from "../lib/theme";
import { Logo } from "../components/Logo";

/** Opened from the password reset email. */
export default function ResetPassword() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const { useToken } = useSession();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    setBusy(true); setError(null);
    try {
      const r = await api<{ token: string }>("POST", "/auth/reset", { token, password });
      await useToken(r.token);
      router.replace("/packs");
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Screen>
      <View style={s.wrap}>
        <BackButton />
        <Logo size={20} />
        <Text style={s.h1}>Choose a new password</Text>
        <TextInput testID="new-password" value={password} onChangeText={setPassword} secureTextEntry autoComplete={"new-password" as never}
          accessibilityLabel="New password" style={s.input} />
        <Text style={s.hint}>At least 8 characters.</Text>
        <Button testID="save-password" label="Save password" onPress={submit} busy={busy} disabled={password.length < 8 || !token} />
        <ErrorText>{error}</ErrorText>
      </View>
    </Screen>
  );
}

const s = StyleSheet.create({
  wrap: { padding: 16, gap: 10, maxWidth: 380, width: "100%", alignSelf: "center" },
  h1: { color: colors.text, fontSize: 20, fontFamily: font.display },
  hint: { color: colors.muted, fontSize: 12 },
  input: { minWidth: 0, backgroundColor: colors.panel, color: colors.text, borderColor: colors.line, borderWidth: 1, borderRadius: radius,
    paddingHorizontal: 12, paddingVertical: 10, fontSize: 16 },
});
