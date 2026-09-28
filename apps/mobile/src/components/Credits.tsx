import { StyleSheet, View } from "react-native";
import { router } from "expo-router";
import { Text } from "./Text";
import { Button, Panel } from "./bits";
import { useApi } from "../lib/useApi";
import { credits, dollars } from "../lib/format";
import { colors, font, type } from "../lib/theme";

type Activity = { id: number; at: string; description: string; amount: number; balance: number };
type CreditsData = { available: number; pending: number; activity: Activity[] };

export const RATE_SENTENCE = "Credits can be used on CrackAPack packs. 100 credits = $1. They can't be cashed out or sent to anyone.";

/** Account, Credits (item 6): what you have, how to add more, and whether you can cash it out. */
export function CreditsPanel() {
  const data = useApi<CreditsData>("/me/credits");
  const c = data.data;
  return (
    <Panel style={{ gap: 12 }} testID="credits-panel">
      <Text style={type.label} accessibilityRole="header">Credits</Text>
      <View>
        <Text style={type.small}>Available</Text>
        <Text style={s.big} testID="account-credits">{credits(c?.available)} credits</Text>
        <Text style={type.small}>{dollars(c?.available ?? 0)}</Text>
        {c && c.pending > 0 ? <Text style={[type.small, { marginTop: 4 }]} testID="pending">Pending: {credits(c.pending)} credits</Text> : null}
      </View>
      <Text style={type.body}>{RATE_SENTENCE}</Text>
      <Button testID="add-credits" label="Add credits" onPress={() => router.push("/add-credits")} style={{ alignSelf: "flex-start" }} />

      <Text style={[type.label, { marginTop: 8 }]} accessibilityRole="header">Activity</Text>
      {c && !c.activity.length ? <Text style={type.small}>No activity yet.</Text> : null}
      {c?.activity.map((a) => (
        <View key={a.id} style={s.row} testID="activity-row">
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={s.desc}>{a.description}</Text>
            <Text style={type.small}>{new Date(a.at).toLocaleDateString("en-US", { timeZone: "America/Los_Angeles", month: "short", day: "numeric", year: "numeric" })}</Text>
          </View>
          <View style={{ alignItems: "flex-end", gap: 2 }}>
            <Text style={s.amount}>{a.amount > 0 ? "+" : "−"}{credits(Math.abs(a.amount))}</Text>
            <Text style={type.mono}>{credits(a.balance)}</Text>
          </View>
        </View>
      ))}
    </Panel>
  );
}

const s = StyleSheet.create({
  big: { fontFamily: font.monoMedium, fontSize: 32, lineHeight: 40, color: colors.text },
  row: { flexDirection: "row", gap: 12, paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.line },
  desc: { fontFamily: font.bodySemi, fontSize: 14, color: colors.text },
  amount: { fontFamily: font.monoMedium, fontSize: 14, color: colors.text },
});
