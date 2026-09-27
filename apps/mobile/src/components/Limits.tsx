import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Button, ErrorText, Panel } from "./bits";
import { api } from "../lib/api";
import { useApi } from "../lib/useApi";
import { dollars } from "../lib/format";
import { colors } from "../lib/theme";

type Limits = { daily: number; monthly: number; break_until: string | null; spent_today: number; spent_month: number;
  pending_daily: number | null; pending_monthly: number | null; pending_at: string | null; max_daily: number; max_monthly: number };

const DAILY_CHOICES = [2500, 5000, 10000, 25000];

/** Spending limits and breaks. Lowering is instant; raising takes 24 hours. */
export function LimitsPanel() {
  const limits = useApi<Limits>("/me/limits");
  const [error, setError] = useState<string | null>(null);
  const [confirmBreak, setConfirmBreak] = useState<number | null>(null);
  const l = limits.data;
  if (!l) return null;
  const onBreak = l.break_until && new Date(l.break_until).getTime() > Date.now();

  const setDaily = async (daily: number) => {
    setError(null);
    try { await api("PUT", "/me/limits", { daily: daily >= l.max_daily ? null : daily, monthly: null }); await limits.reload(); }
    catch (e) { setError((e as Error).message); }
  };
  const takeBreak = async (days: number) => {
    try { await api("POST", "/me/break", { days }); setConfirmBreak(null); await limits.reload(); }
    catch (e) { setError((e as Error).message); }
  };

  return (
    <Panel style={{ gap: 10 }}>
      <Text style={s.label}>Spending limits</Text>
      <Bar label="Last 24 hours" used={l.spent_today} limit={l.daily} />
      <Bar label="Last 30 days" used={l.spent_month} limit={l.monthly} />
      <Text style={s.muted}>24 hour limit</Text>
      <View style={s.row}>
        {DAILY_CHOICES.map((d) => (
          <Pressable key={d} testID={`limit-${d}`} onPress={() => setDaily(d)} style={[s.chip, l.daily === d && s.chipOn]}>
            <Text style={[s.chipText, l.daily === d && { color: colors.accentInk }]}>{dollars(d)}</Text>
          </Pressable>
        ))}
      </View>
      {l.pending_at && <Text style={s.muted}>Raise to {dollars(l.pending_daily ?? l.max_daily)} takes effect {new Date(l.pending_at).toLocaleString()}.</Text>}
      {onBreak
        ? <Text style={s.body} testID="on-break">On a break until {new Date(l.break_until!).toLocaleDateString()}.</Text>
        : confirmBreak
          ? <View style={{ gap: 8 }}>
              <Text style={s.body}>Pause ordering for {confirmBreak} days? You can't end a break early.</Text>
              <View style={s.row}><Button kind="ghost" label="Cancel" onPress={() => setConfirmBreak(null)} /><Button kind="danger" label="Start break" onPress={() => takeBreak(confirmBreak)} /></View>
            </View>
          : <View style={s.row}>
              <Text style={[s.muted, { alignSelf: "center" }]}>Take a break:</Text>
              {[1, 7, 30].map((d) => <Pressable key={d} onPress={() => setConfirmBreak(d)} style={s.chip}><Text style={s.chipText}>{d}d</Text></Pressable>)}
            </View>}
      <ErrorText>{error}</ErrorText>
    </Panel>
  );
}

function Bar({ label, used, limit }: { label: string; used: number; limit: number }) {
  const pct = Math.min(100, (100 * used) / Math.max(1, limit));
  return (
    <View style={{ gap: 4 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
        <Text style={s.muted}>{label}</Text>
        <Text style={s.muted}>{dollars(used)} of {dollars(limit)}</Text>
      </View>
      <View style={s.track}><View style={[s.fill, { width: `${pct}%` }, pct >= 100 && { backgroundColor: colors.danger }]} /></View>
    </View>
  );
}

const s = StyleSheet.create({
  label: { color: colors.muted, fontSize: 12, textTransform: "uppercase", letterSpacing: 1 },
  muted: { color: colors.muted, fontSize: 12 },
  body: { color: colors.text, fontSize: 14 },
  row: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  chip: { borderWidth: 1, borderColor: colors.line, borderRadius: 99, paddingHorizontal: 12, paddingVertical: 6 },
  chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { color: colors.text, fontWeight: "700" },
  track: { height: 6, backgroundColor: colors.line, borderRadius: 3, overflow: "hidden" },
  fill: { height: "100%", backgroundColor: colors.accent },
});
