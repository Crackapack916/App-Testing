import { useState } from "react";
import { KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, View } from "react-native";
import { Button, ErrorText, Screen } from "../components/bits";
import { useSession } from "../lib/session";
import { ClerkSignIn } from "../components/ClerkSignIn";
import { colors, radius } from "../lib/theme";

export default function SignIn() {
  const { mode } = useSession();
  if (mode === "clerk") return <Screen><ClerkSignIn /></Screen>;
  return <PilotSignIn />;
}

function PilotSignIn() {
  const { signIn } = useSession();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    setBusy(true); setError(null);
    try { await signIn(email.trim()); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Screen>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={s.wrap}>
        <Text style={s.logo}>Crack<Text style={{ color: colors.accent }}>A</Text>Pack</Text>
        <Text style={s.tag}>Your pack. Opened live on camera tonight.</Text>
        <View style={{ gap: 12, marginTop: 32 }}>
          <TextInput testID="email" value={email} onChangeText={setEmail} placeholder="Email" placeholderTextColor={colors.muted}
            autoCapitalize="none" keyboardType="email-address" style={s.input} onSubmitEditing={submit} />
          <Button testID="sign-in" label="Continue" onPress={submit} busy={busy} disabled={!email.includes("@")} />
          <Text style={s.note}>Pilot sign in. Test mode only.</Text>
          <ErrorText>{error}</ErrorText>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, justifyContent: "center", padding: 24, maxWidth: 480, width: "100%", alignSelf: "center" },
  logo: { color: colors.text, fontSize: 44, fontWeight: "900", textAlign: "center" },
  tag: { color: colors.muted, textAlign: "center", marginTop: 6 },
  input: { backgroundColor: colors.panel, color: colors.text, borderColor: colors.line, borderWidth: 1, borderRadius: radius, padding: 14, fontSize: 16 },
  note: { color: colors.muted, fontSize: 12, textAlign: "center" },
});
