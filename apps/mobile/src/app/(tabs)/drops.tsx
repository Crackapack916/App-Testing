import { useState } from "react";
import { Linking, Platform, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from "react-native";
import { router } from "expo-router";
import { BellRing, CalendarPlus, Check } from "lucide-react-native";
import { Text } from "../../components/Text";
import { Button, ErrorText, Footer, Screen, Title } from "../../components/bits";
import { Carousel } from "../../components/Carousel";
import { PackArt } from "../../components/PackArt";
import { API_URL, api } from "../../lib/api";
import { useApi } from "../../lib/useApi";
import { useSession } from "../../lib/session";
import { parts, useServerNow } from "../../lib/clock";
import { pacific } from "../../lib/format";
import { colors, font, palette, radii, type } from "../../lib/theme";

type Drop = { id: string; set_code: string; set_name: string; icon_svg_uri: string | null; pack_image_url: string | null; starts_at: string;
  ends_at: string | null; state: "upcoming" | "live" | "sold_out" | "ended"; reminded: boolean; google_calendar_url: string | null };

const STATE: Record<Drop["state"], string> = { upcoming: "Upcoming", live: "Live now", sold_out: "Sold out", ended: "Ended" };

/** Drops (item 14): when each set goes live here, with a countdown on server time and calendar reminders. */
export default function Drops() {
  const data = useApi<{ now: string; drops: Drop[] }>("/drops");
  const now = useServerNow(data.data?.now);
  const { width } = useWindowDimensions();
  const drops = data.data?.drops ?? [];
  const upcoming = drops.filter((d) => d.state === "upcoming");
  // A drop whose window opened since the page loaded shows as live without a reload.
  const stateOf = (d: Drop): Drop["state"] => d.state === "upcoming" && new Date(d.starts_at).getTime() <= now ? "live" : d.state;

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
        <View style={s.wrap}>
          <Title sub="This is when each set goes live on CrackAPack. Times are Pacific.">Drops</Title>
          {upcoming.length > 1 && (
            <Carousel label="Upcoming sets" items={upcoming} keyOf={(d) => d.id} labelOf={(d) => d.set_name}
              itemWidth={Math.min(150, width * 0.36)} height={Math.round(Math.min(150, width * 0.36) * 1.62) + 12}
              render={(d) => <PackArt setCode={d.set_code} setName={d.set_name} photo={d.pack_image_url} icon={d.icon_svg_uri} width={Math.min(150, width * 0.36)} />} />
          )}
          <View style={{ gap: 12, paddingHorizontal: 16 }}>
            {drops.map((d) => <DropCard key={d.id} d={d} state={stateOf(d)} now={now} reload={data.reload} />)}
            {data.data && !drops.length && <Text style={type.small}>No drops are scheduled yet. Check back soon.</Text>}
            <ErrorText>{data.error}</ErrorText>
          </View>
        </View>
        <Footer />
      </ScrollView>
    </Screen>
  );
}

function DropCard({ d, state, now, reload }: { d: Drop; state: Drop["state"]; now: number; reload: () => Promise<void> }) {
  const { me } = useSession();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const t = parts(d.starts_at, now);
  const remind = async () => {
    if (!me) return router.push("/sign-in");
    setBusy(true); setError(null);
    try { await api(d.reminded ? "DELETE" : "POST", `/drops/${d.id}/remind`); await reload(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const ics = `${API_URL}/drops/${d.id}/calendar.ics`;
  return (
    <View style={s.card} testID={`drop-${d.set_code}`}>
      <PackArt setCode={d.set_code} setName={d.set_name} photo={d.pack_image_url} icon={d.icon_svg_uri} width={84} />
      <View style={{ flex: 1, gap: 8 }}>
        <View style={s.headRow}>
          <Text style={type.h3}>{d.set_name}</Text>
          <View style={[s.badge, state === "live" && s.badgeLive]}><Text style={s.badgeText} testID="drop-state">{STATE[state]}</Text></View>
        </View>
        <Text style={type.small}>{pacific(d.starts_at)} PT{d.ends_at ? ` to ${pacific(d.ends_at)} PT` : ""}</Text>
        {state === "upcoming" && (
          <View style={s.count} accessibilityRole="timer" accessibilityLabel={`${t.d} days ${t.h} hours ${t.m} minutes until live`} testID="countdown">
            {[["d", t.d], ["h", t.h], ["m", t.m], ["s", t.s]].map(([u, v]) => (
              <View key={u as string} style={s.unit}>
                <Text style={s.num}>{String(v).padStart(2, "0")}</Text><Text style={s.unitLabel}>{({ d: "days", h: "hrs", m: "min", s: "sec" } as Record<string, string>)[u as string]}</Text>
              </View>
            ))}
          </View>
        )}
        {state === "live" && <Button testID="open-packs" label="Open packs" onPress={() => router.push("/packs")} />}
        {state === "upcoming" && (
          <View style={s.actions}>
            <Pressable accessibilityRole="link" style={s.action} testID="add-ics"
              onPress={() => (Platform.OS === "web" ? window.open(ics, "_self") : Linking.openURL(ics))}>
              <CalendarPlus size={16} color={colors.link} /><Text style={s.actionText}>Apple or Outlook calendar</Text>
            </Pressable>
            {d.google_calendar_url && (
              <Pressable accessibilityRole="link" style={s.action} testID="add-google" onPress={() => Linking.openURL(d.google_calendar_url!)}>
                <CalendarPlus size={16} color={colors.link} /><Text style={s.actionText}>Google Calendar</Text>
              </Pressable>
            )}
            <Pressable accessibilityRole="switch" accessibilityState={{ checked: d.reminded, busy }} style={s.action} onPress={remind} testID="remind">
              {d.reminded ? <Check size={16} color={colors.ok} /> : <BellRing size={16} color={colors.link} />}
              <Text style={s.actionText}>{d.reminded ? "Reminder on: we'll email you an hour before" : "Email me a reminder"}</Text>
            </Pressable>
          </View>
        )}
        <ErrorText>{error}</ErrorText>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { maxWidth: 900, width: "100%", alignSelf: "center" },
  card: { flexDirection: "row", gap: 14, padding: 14, backgroundColor: colors.panel, borderRadius: radii.panel, borderWidth: 1, borderColor: colors.line },
  headRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 8, flexWrap: "wrap" },
  badge: { borderRadius: radii.pill, paddingHorizontal: 10, paddingVertical: 3, borderWidth: 1.5, borderColor: colors.lineStrong },
  badgeLive: { borderColor: colors.ok, backgroundColor: palette.ink[100] },
  badgeText: { fontFamily: font.bodySemi, fontSize: 12, color: colors.text },
  count: { flexDirection: "row", gap: 6 },
  unit: { alignItems: "center", minWidth: 48, paddingVertical: 6, borderRadius: 6, backgroundColor: palette.blue[700] },
  num: { fontFamily: font.monoMedium, fontSize: 20, color: palette.ink[100] },
  unitLabel: { fontFamily: font.body, fontSize: 10, color: palette.blue[200], textTransform: "uppercase", letterSpacing: 1 },
  actions: { gap: 2 },
  action: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 40 },
  actionText: { fontFamily: font.bodySemi, fontSize: 14, color: colors.link, textDecorationLine: "underline", flexShrink: 1 },
});
