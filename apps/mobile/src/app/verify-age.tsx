import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { Text } from "../components/Text";
import { Button, ErrorText, Screen } from "../components/bits";
import { DobFields } from "../components/DobFields";
import { api } from "../lib/api";
import { useSession, type Dob } from "../lib/session";
import { colors, font } from "../lib/theme";

/** For an account made before sign up asked for a date of birth. Asked once, then locked. */
export default function VerifyAge() {
  const { refresh, signOut } = useSession();
  const [dob, setDob] = useState<Dob>({ month: "", day: "", year: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    setBusy(true); setError(null);
    try { await api("POST", "/auth/confirm-age", { dob }); await refresh(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Screen>
      <View style={s.wrap}>
        <Text style={s.h1}>Confirm your date of birth</Text>
        <Text style={s.body}>You must be 18 or older to use CrackAPack. This can't be changed once confirmed.</Text>
        <DobFields value={dob} onChange={setDob} />
        <Button testID="verify" label="Confirm" onPress={submit} busy={busy} disabled={!dob.month || !dob.day || dob.year.length !== 4} />
        <ErrorText>{error}</ErrorText>
        <Button kind="ghost" label="Log out" onPress={signOut} />
      </View>
    </Screen>
  );
}

const s = StyleSheet.create({
  wrap: { padding: 16, gap: 10, maxWidth: 380, width: "100%", alignSelf: "center" },
  h1: { color: colors.text, fontSize: 20, fontFamily: font.display },
  body: { color: colors.muted, lineHeight: 20 },
});
