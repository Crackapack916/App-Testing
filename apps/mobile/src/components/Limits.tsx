import { useState } from "react";
import { Linking, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Button, ErrorText, Panel } from "./bits";
import { api } from "../lib/api";
import { useApi } from "../lib/useApi";
import { credits, pacific } from "../lib/format";
import { colors, radius } from "../lib/theme";

type Period = "daily" | "weekly" | "monthly";
type Limit = { period: Period; limit: number | null; spent: number; resets_at: string; pending: { limit: number | null; at: string } | null };
type Limits = { limits: Limit[]; break_until: string | null; break_end_requested: boolean; loosen_delay_hours: number; support_email: string };

const WINDOW: Record<Period, { name: string; word: string; resets: string }> = {
  daily: { name: "Daily", word: "today", resets: "Resets at 12:00 AM Pacific." },
  weekly: { name: "Weekly", word: "this week", resets: "Resets Monday 12:00 AM Pacific." },
  monthly: { name: "Monthly", word: "this month", resets: "Resets on the 1st at 12:00 AM Pacific." },
};
const BREAKS = [{ hours: 24, label: "24 hours" }, { hours: 168, label: "7 days" }, { hours: 720, label: "30 days" }];

/** Account, Spending: optional daily, weekly and monthly limits, and breaks. */
export function LimitsPanel() {
  const data = useApi<Limits>("/me/limits");
  const [error, setError] = useState<string | null>(null);
  const [confirmBreak, setConfirmBreak] = useState<number | null>(null);
  const l = data.data;
  if (!l) return null;

  const takeBreak = async (hours: number) => {
    setError(null);
    try { await api("POST", "/me/break", { hours }); setConfirmBreak(null); await data.reload(); }
    catch (e) { setError((e as Error).message); }
  };
  const requestEnd = async () => {
    setError(null);
    try {
      const r = await api<{ mailto: string }>("POST", "/me/break/end-request");
      await data.reload();
      Linking.openURL(r.mailto).catch(() => {});
    } catch (e) { setError((e as Error).message); }
  };

  return (
    <Panel style={{ gap: 14 }}>
      <Text style={s.label} accessibilityRole="header">Spending</Text>
      {l.limits.map((lim) => <LimitRow key={lim.period} lim={lim} onBreak={!!l.break_until} reload={data.reload} />)}
      <Text style={s.muted}>
        {l.loosen_delay_hours > 0
          ? `Lowering a limit works right away. Raising or removing one takes ${l.loosen_delay_hours} hours.`
          : "Changes take effect right away."}
      </Text>

      <View style={s.divider} />
      <Text style={s.label} accessibilityRole="header">Take a break</Text>
      {l.break_until ? (
        <View style={{ gap: 8 }} testID="on-break">
          <Text style={s.body}>You're on a break until {pacific(l.break_until)} Pacific.</Text>
          <Text style={s.muted}>You can't buy packs or add credit until then. You can still see your Vault, watch videos and ship cards.</Text>
          {l.break_end_requested
            ? <Text style={s.muted} testID="end-requested">Early end requested. We'll reply from {l.support_email}.</Text>
            : <Button testID="request-end" kind="ghost" label="Request early end" onPress={requestEnd} />}
        </View>
      ) : confirmBreak ? (
        <View style={{ gap: 8 }}>
          <Text style={s.body}>Take a {BREAKS.find((b) => b.hours === confirmBreak)!.label} break? You can't buy packs or add credit, and you can't end it early yourself.</Text>
          <View style={s.row}>
            <Button kind="ghost" label="Cancel" onPress={() => setConfirmBreak(null)} />
            <Button testID="start-break" kind="danger" label="Start break" onPress={() => takeBreak(confirmBreak)} />
          </View>
        </View>
      ) : (
        <View style={s.row}>
          {BREAKS.map((b) => (
            <Pressable key={b.hours} testID={`break-${b.hours}`} onPress={() => setConfirmBreak(b.hours)} style={s.chip} accessibilityRole="button">
              <Text style={s.chipText}>{b.label}</Text>
            </Pressable>
          ))}
        </View>
      )}
      <ErrorText>{error}</ErrorText>
    </Panel>
  );
}

function LimitRow({ lim, onBreak, reload }: { lim: Limit; onBreak: boolean; reload: () => Promise<void> }) {
  const w = WINDOW[lim.period];
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(lim.limit ? String(lim.limit) : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async (next: number | null) => {
    setBusy(true); setError(null);
    try { await api("PUT", `/me/limits/${lim.period}`, { credits: next }); setEditing(false); await reload(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const pct = lim.limit ? Math.min(100, (100 * lim.spent) / lim.limit) : 0;

  return (
    <View style={{ gap: 6 }} testID={`limit-${lim.period}`}>
      <View style={s.head}>
        <Text style={s.name}>{w.name} limit</Text>
        <Text style={s.value} testID={`limit-${lim.period}-value`}>{lim.limit ? `${credits(lim.limit)} credits` : "No limit"}</Text>
      </View>
      {lim.limit ? (
        <>
          <View style={s.track}><View style={[s.fill, { width: `${pct}%` }, pct >= 100 && { backgroundColor: colors.danger }]} /></View>
          <Text style={s.muted} testID={`limit-${lim.period}-progress`}>
            {credits(lim.spent)} of {credits(lim.limit)} credits used {w.word}. {w.resets}
          </Text>
        </>
      ) : (
        <Text style={s.muted}>{credits(lim.spent)} credits spent {w.word}.</Text>
      )}
      {lim.pending && (
        <Text style={s.muted} testID={`limit-${lim.period}-pending`}>
          {lim.pending.limit == null ? "Removing this limit" : `Changing to ${credits(lim.pending.limit)} credits`} takes effect {pacific(lim.pending.at)} Pacific.
        </Text>
      )}
      {editing ? (
        <View style={s.row}>
          <TextInput testID={`limit-${lim.period}-input`} value={value} onChangeText={(v) => setValue(v.replace(/[^0-9]/g, ""))}
            inputMode="numeric" keyboardType="number-pad" placeholder="Credits" placeholderTextColor={colors.muted}
            accessibilityLabel={`${w.name} limit in credits`} style={s.input} />
          <Button testID={`limit-${lim.period}-save`} label="Save" onPress={() => save(Number(value))} busy={busy} disabled={!Number(value)} />
          <Button kind="ghost" label="Cancel" onPress={() => setEditing(false)} />
        </View>
      ) : (
        <View style={s.row}>
          <Pressable testID={`limit-${lim.period}-edit`} onPress={() => setEditing(true)} accessibilityRole="button">
            <Text style={s.link}>{lim.limit ? "Change" : "Set a limit"}</Text>
          </Pressable>
          {lim.limit != null && !onBreak && (
            <Pressable testID={`limit-${lim.period}-remove`} onPress={() => save(null)} accessibilityRole="button">
              <Text style={s.link}>Remove</Text>
            </Pressable>
          )}
        </View>
      )}
      {onBreak && editing && <Text style={s.muted}>During a break you can lower a limit but not raise or remove it.</Text>}
      <ErrorText>{error}</ErrorText>
    </View>
  );
}

const s = StyleSheet.create({
  label: { color: colors.muted, fontSize: 12, textTransform: "uppercase", letterSpacing: 1 },
  head: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },
  name: { color: colors.text, fontSize: 15, fontWeight: "700" },
  value: { color: colors.text, fontSize: 15 },
  muted: { color: colors.muted, fontSize: 13, lineHeight: 18 },
  body: { color: colors.text, fontSize: 14, lineHeight: 20 },
  link: { color: colors.accent, fontWeight: "700", fontSize: 14 },
  row: { flexDirection: "row", gap: 12, flexWrap: "wrap", alignItems: "center" },
  chip: { borderWidth: 1, borderColor: colors.line, borderRadius: 99, paddingHorizontal: 14, paddingVertical: 8 },
  chipText: { color: colors.text, fontWeight: "700" },
  track: { height: 6, backgroundColor: colors.line, borderRadius: 3, overflow: "hidden" },
  fill: { height: "100%", backgroundColor: colors.accent },
  input: { flex: 1, minWidth: 0, backgroundColor: colors.bg, color: colors.text, borderColor: colors.line, borderWidth: 1, borderRadius: radius,
    paddingHorizontal: 12, paddingVertical: 8, fontSize: 16 },
  divider: { height: 1, backgroundColor: colors.line },
});
