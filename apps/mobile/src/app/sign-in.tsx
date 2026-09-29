import { useState } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Text, TextInput } from "../components/Text";
import { Link } from "expo-router";
import { Check } from "../components/icons";
import { BackButton, Button, ErrorText, Footer } from "../components/bits";
import { DobFields } from "../components/DobFields";
import { api } from "../lib/api";
import { useSession, type Dob } from "../lib/session";
import { colors, radius, font } from "../lib/theme";

type Mode = "login" | "signup" | "forgot";

/** Log in with email and password. Date of birth is asked only when creating an account. */
export default function SignIn() {
  const { logIn, signUp } = useSession();
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [dob, setDob] = useState<Dob>({ month: "", day: "", year: "" });
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const submit = async () => {
    setBusy(true); setError(null);
    try {
      if (mode === "login") await logIn(email.trim(), password);
      else if (mode === "signup") await signUp(email.trim(), password, dob);
      else { await api("POST", "/auth/forgot", { email: email.trim() }); setSent(true); }
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const go = (m: Mode) => { setMode(m); setError(null); setSent(false); };
  const dobDone = dob.month.length > 0 && dob.day.length > 0 && dob.year.length === 4;
  const canSubmit = email.includes("@") && (mode === "forgot" || password.length >= (mode === "signup" ? 8 : 1))
    && (mode !== "signup" || (dobDone && agree));

  return (
    <ScrollView contentContainerStyle={s.page} keyboardShouldPersistTaps="handled">
      <BackButton />
      <View style={s.card} testID="auth-card">
        <Text style={s.logo} accessibilityRole="header">CrackAPack</Text>
        <Text style={s.h1}>{mode === "login" ? "Log in" : mode === "signup" ? "Create your account" : "Reset your password"}</Text>

        <View style={s.field}>
          <Text style={s.label} nativeID="email-label">Email</Text>
          <TextInput testID="email" value={email} onChangeText={setEmail} inputMode="email" keyboardType="email-address"
            autoCapitalize="none" autoComplete={"email" as never} aria-labelledby="email-label" style={s.input} />
        </View>

        {mode !== "forgot" && (
          <View style={s.field}>
            <Text style={s.label} nativeID="password-label">Password</Text>
            <TextInput testID="password" value={password} onChangeText={setPassword} secureTextEntry
              autoComplete={(mode === "signup" ? "new-password" : "current-password") as never} aria-labelledby="password-label"
              style={s.input} onSubmitEditing={() => canSubmit && mode === "login" && submit()} />
            {mode === "signup" && <Text style={s.hint}>At least 8 characters.</Text>}
          </View>
        )}

        {mode === "signup" && (
          <>
            <DobFields value={dob} onChange={setDob} />
            <Pressable testID="agree" onPress={() => setAgree(!agree)} style={s.check} accessibilityRole="checkbox" aria-checked={agree}>
              <View style={[s.box, agree && s.boxOn]}>{agree && <Check size={16} color={colors.accentInk} strokeWidth={3} />}</View>
              <Text style={s.checkText}>
                I'm 18 or older and I agree to the <Link href="/policies/terms" style={s.link}>Terms</Link> and <Link href="/policies/privacy" style={s.link}>Privacy Policy</Link>.
              </Text>
            </Pressable>
          </>
        )}

        {sent
          ? <Text style={s.body} testID="reset-sent">If that email has an account, a reset link is on its way. It works for one hour.</Text>
          : <Button testID="submit" label={mode === "login" ? "Log in" : mode === "signup" ? "Create account" : "Email me a link"}
              onPress={submit} busy={busy} disabled={!canSubmit} />}
        <ErrorText>{error}</ErrorText>

        <View style={s.switches}>
          {mode === "login" && <>
            <Pressable testID="to-signup" onPress={() => go("signup")}><Text style={s.link}>Create an account</Text></Pressable>
            <Pressable testID="to-forgot" onPress={() => go("forgot")}><Text style={s.link}>Forgot password</Text></Pressable>
          </>}
          {mode !== "login" && <Pressable testID="to-login" onPress={() => go("login")}><Text style={s.link}>I have an account</Text></Pressable>}
        </View>
      </View>
      <Footer />
    </ScrollView>
  );
}

const s = StyleSheet.create({
  // Web: dvh keeps the layout steady when the phone keyboard opens.
  page: { flexGrow: 1, padding: 16, alignItems: "center", justifyContent: "flex-start", backgroundColor: colors.bg,
    ...(Platform.OS === "web" ? { minHeight: "100dvh" as never } : null) },
  card: { width: "100%", maxWidth: 380, gap: 10, paddingTop: 8 },
  logo: { color: colors.text, fontSize: 22, fontFamily: font.display },
  h1: { color: colors.text, fontSize: 20, fontFamily: font.display, marginBottom: 2 },
  field: { gap: 4 },
  label: { color: colors.muted, fontSize: 12, textTransform: "uppercase", letterSpacing: 1 },
  hint: { color: colors.muted, fontSize: 12 },
  input: { minWidth: 0, backgroundColor: colors.panel, color: colors.text, borderColor: colors.line, borderWidth: 1, borderRadius: radius,
    paddingHorizontal: 12, paddingVertical: 10, fontSize: 16 },
  check: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  box: { width: 22, height: 22, borderRadius: 4, borderWidth: 1, borderColor: colors.muted, alignItems: "center", justifyContent: "center" },
  boxOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  tick: { color: colors.accentInk, fontFamily: font.display },
  checkText: { flex: 1, color: colors.text, fontSize: 13, lineHeight: 18 },
  body: { color: colors.text, fontSize: 14 },
  link: { color: colors.link, fontFamily: font.bodyBold, textDecorationLine: "underline" },
  switches: { flexDirection: "row", justifyContent: "space-between", marginTop: 4 },
});
