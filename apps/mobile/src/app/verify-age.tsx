import { useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { Button, ErrorText, Screen } from "../components/bits";
import { api } from "../lib/api";
import { useSession } from "../lib/session";
import { colors, radius } from "../lib/theme";

/** One time age gate before ordering. Self attested in the pilot. */
export default function VerifyAge() {
  const { refresh, signOut } = useSession();
  const [mm, setMm] = useState("");
  const [dd, setDd] = useState("");
  const [yyyy, setYyyy] = useState("");
  const [state, setState] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const complete = /^\d{1,2}$/.test(mm) && /^\d{1,2}$/.test(dd) && /^\d{4}$/.test(yyyy) && /^[A-Za-z]{2}$/.test(state);

  const submit = async () => {
    setBusy(true); setError(null);
    try {
      const birthdate = `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
      await api("POST", "/me/profile", { birthdate, state: state.toUpperCase() });
      await refresh();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const box = (value: string, set: (v: string) => void, placeholder: string, max: number, id: string, flex = 1) => (
    <TextInput testID={id} value={value} onChangeText={(v) => set(v.replace(/[^0-9]/g, "").slice(0, max))} placeholder={placeholder}
      placeholderTextColor={colors.muted} keyboardType="number-pad" style={[s.input, { flex }]} />
  );

  return (
    <Screen>
      <View style={s.wrap}>
        <Text style={s.h1}>One quick check</Text>
        <Text style={s.body}>You must be 18 or older to order packs. Your birthdate can't be changed once confirmed.</Text>
        <Text style={s.label}>Date of birth</Text>
        <View style={s.row}>{box(mm, setMm, "MM", 2, "dob-mm")}{box(dd, setDd, "DD", 2, "dob-dd")}{box(yyyy, setYyyy, "YYYY", 4, "dob-yyyy", 2)}</View>
        <Text style={s.label}>State</Text>
        <TextInput testID="state" value={state} onChangeText={(v) => setState(v.replace(/[^A-Za-z]/g, "").slice(0, 2).toUpperCase())}
          placeholder="CA" placeholderTextColor={colors.muted} autoCapitalize="characters" style={s.input} />
        <Button testID="verify" label="Confirm" onPress={submit} busy={busy} disabled={!complete} />
        <ErrorText>{error}</ErrorText>
        <Button kind="ghost" label="Sign out" onPress={signOut} />
      </View>
    </Screen>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, justifyContent: "center", padding: 24, gap: 10, maxWidth: 480, width: "100%", alignSelf: "center" },
  h1: { color: colors.text, fontSize: 28, fontWeight: "900" },
  body: { color: colors.muted, lineHeight: 20, marginBottom: 8 },
  label: { color: colors.muted, fontSize: 12, textTransform: "uppercase", letterSpacing: 1, marginTop: 6 },
  row: { flexDirection: "row", gap: 8 },
  input: { backgroundColor: colors.panel, color: colors.text, borderColor: colors.line, borderWidth: 1, borderRadius: radius, padding: 14, fontSize: 18, textAlign: "center" },
});
