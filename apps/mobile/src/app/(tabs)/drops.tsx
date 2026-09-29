import { useState } from "react";
import { Linking, Platform, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from "react-native";
import { router } from "expo-router";
import { CalendarPlus } from "../../components/icons";
import { Text } from "../../components/Text";
import { Button, ErrorText, Footer, Screen, Title } from "../../components/bits";
import { Carousel } from "../../components/Carousel";
import { PackArt } from "../../components/PackArt";
import { API_URL, api } from "../../lib/api";
import { useApi } from "../../lib/useApi";
import { useSession } from "../../lib/session";
import { countdownText, parts, useServerNow } from "../../lib/clock";
import { pacific } from "../../lib/format";
import { brand, colors, font, radii, type } from "../../lib/theme";
import type { Product } from "./packs";

type Drop = { id: string; set_code: string; set_name: string; icon_svg_uri: string | null; pack_image_url: string | null; starts_at: string;
  ends_at: string | null; state: "upcoming" | "live" | "sold_out" | "ended"; reminded: boolean; google_calendar_url: string | null };

const STATE: Record<Drop["state"], string> = { upcoming: "Upcoming", live: "Live now", sold_out: "Sold out", ended: "Ended" };

/** Drops (item 14): when each set goes live here, with a countdown on server time and calendar reminders. */
export default function Drops() {
  const data = useApi<{ now: string; drops: Drop[] }>("/drops");
  // Packs left tonight and the cutoff come from the storefront, the same numbers Packs shows.
  const store = useApi<{ products: Product[]; next_cutoff: string }>("/storefront");
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
            {drops.filter((d) => stateOf(d) === "live").map((d) => (
              <DropCard key={d.id} d={d} state="live" now={now} reload={data.reload}
                product={store.data?.products.find((p) => p.set_code === d.set_code)} cutoff={store.data?.next_cutoff} />
            ))}
            {drops.some((d) => stateOf(d) !== "live") && <Text style={[type.label, { marginTop: 8 }]}>Upcoming</Text>}
            {drops.filter((d) => stateOf(d) !== "live").map((d) => <DropCard key={d.id} d={d} state={stateOf(d)} now={now} reload={data.reload} />)}
            {data.data && !drops.length && <Text style={type.small}>No drops are scheduled yet. Check back soon.</Text>}
            <ErrorText>{data.error}</ErrorText>
          </View>
        </View>
        <Footer />
      </ScrollView>
    </Screen>
  );
}

function DropCard({ d, state, now, reload, product, cutoff }:
  { d: Drop; state: Drop["state"]; now: number; reload: () => Promise<void>; product?: Product; cutoff?: string }) {
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
  if (state === "live") {
    return (
      <View style={[s.card, s.live]} testID={`drop-${d.set_code}`}>
        <View style={s.livePill}><Text style={s.livePillText} testID="drop-state">{STATE[state]}</Text></View>
        <View style={s.row}>
          <PackArt setCode={d.set_code} setName={d.set_name} photo={d.pack_image_url} icon={d.icon_svg_uri} width={40} />
          <View style={{ flex: 1 }}>
            <Text style={type.h3}>{d.set_name}</Text>
            <Text style={type.small}>Play Booster{product ? ` · ${product.left_tonight} of ${product.night_limit} packs left` : ""}</Text>
          </View>
        </View>
        {cutoff ? (
          <View style={s.well}>
            <Text style={s.wellText}>Order by 7:00 PM PT</Text>
            <Text style={s.wellNum}>{countdownText(cutoff, now)}</Text>
          </View>
        ) : null}
        <Button testID="open-packs" label="Order packs" onPress={() => router.push("/packs")} />
      </View>
    );
  }
  return (
    <View style={s.card} testID={`drop-${d.set_code}`}>
      <View style={s.row}>
        <PackArt setCode={d.set_code} setName={d.set_name} photo={d.pack_image_url} icon={d.icon_svg_uri} width={48} />
        <View style={{ flex: 1 }}>
          <View style={s.headRow}>
            <Text style={[type.h3, { flexShrink: 1 }]}>{d.set_name}</Text>
            <View style={s.badge}><Text style={s.badgeText} testID="drop-state">{STATE[state]}</Text></View>
          </View>
          <Text style={type.small}>{pacific(d.starts_at)} PT{d.ends_at ? ` to ${pacific(d.ends_at)} PT` : ""}</Text>
        </View>
      </View>
      {state === "upcoming" && (
        <View style={s.count} accessibilityRole="timer" accessibilityLabel={`${t.d} days ${t.h} hours ${t.m} minutes until live`} testID="countdown">
          {[["d", t.d], ["h", t.h], ["m", t.m], ["s", t.s]].map(([u, v]) => (
            <View key={u as string} style={s.unit}>
              <Text style={s.num}>{String(v).padStart(2, "0")}</Text><Text style={s.unitLabel}>{({ d: "days", h: "hrs", m: "min", s: "sec" } as Record<string, string>)[u as string]}</Text>
            </View>
          ))}
        </View>
      )}
      {state === "upcoming" && (
        <View style={s.actions}>
          <Pressable accessibilityRole="switch" accessibilityState={{ checked: d.reminded, busy }} aria-checked={d.reminded} style={s.toggleRow} onPress={remind} testID="remind">
            <Text style={s.toggleText}>{d.reminded ? "Reminder on: we'll email you an hour before" : "Notify me by email"}</Text>
            <View style={[s.switch, d.reminded && s.switchOn]}><View style={[s.knob, d.reminded && s.knobOn]} /></View>
          </Pressable>
          <Pressable accessibilityRole="link" style={s.action} testID="add-ics"
            onPress={() => (Platform.OS === "web" ? window.open(ics, "_self") : Linking.openURL(ics))}>
            <CalendarPlus size={16} color={colors.link} /><Text style={s.actionText}>Apple or Outlook calendar</Text>
          </Pressable>
          {d.google_calendar_url && (
            <Pressable accessibilityRole="link" style={s.action} testID="add-google" onPress={() => Linking.openURL(d.google_calendar_url!)}>
              <CalendarPlus size={16} color={colors.link} /><Text style={s.actionText}>Google Calendar</Text>
            </Pressable>
          )}
        </View>
      )}
      <ErrorText>{error}</ErrorText>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { maxWidth: 900, width: "100%", alignSelf: "center" },
  card: { gap: 12, padding: 14, backgroundColor: colors.panel, borderRadius: radii.panel, borderWidth: 1, borderColor: colors.line },
  live: { borderWidth: 2, borderColor: brand.magenta, marginTop: 10 },
  livePill: { position: "absolute", top: -11, right: 14, backgroundColor: brand.magenta, borderRadius: radii.pill, paddingHorizontal: 10, paddingVertical: 3 },
  livePillText: { fontFamily: font.bodyBold, fontSize: 10.5, letterSpacing: 1.4, textTransform: "uppercase", color: colors.accentInk },
  row: { flexDirection: "row", gap: 12, alignItems: "center" },
  headRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 8 },
  badge: { borderRadius: radii.pill, paddingHorizontal: 10, paddingVertical: 3, borderWidth: 1, borderColor: colors.lineStrong },
  badgeText: { fontFamily: font.bodySemi, fontSize: 11.5, color: colors.text },
  well: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", backgroundColor: colors.well, borderRadius: radii.control,
    paddingHorizontal: 12, paddingVertical: 10, borderWidth: 1, borderColor: colors.line },
  wellText: { fontFamily: font.body, fontSize: 12.5, color: colors.muted },
  wellNum: { fontFamily: font.bodyBold, fontSize: 16, color: brand.gold },
  count: { flexDirection: "row", gap: 6 },
  unit: { alignItems: "center", minWidth: 52, paddingVertical: 6, borderRadius: 10, backgroundColor: colors.well, borderWidth: 1, borderColor: colors.line },
  num: { fontFamily: font.bodyBold, fontSize: 19, color: brand.gold },
  unitLabel: { fontFamily: font.body, fontSize: 10, color: colors.muted, textTransform: "uppercase", letterSpacing: 1 },
  actions: { gap: 2 },
  toggleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, minHeight: 44 },
  toggleText: { fontFamily: font.body, fontSize: 13.5, color: colors.text, flexShrink: 1 },
  switch: { width: 44, height: 26, borderRadius: 13, backgroundColor: colors.panelHi, borderWidth: 1, borderColor: colors.lineStrong, justifyContent: "center", paddingHorizontal: 3 },
  switchOn: { backgroundColor: brand.magenta, borderColor: brand.magenta },
  knob: { width: 18, height: 18, borderRadius: 9, backgroundColor: colors.muted },
  knobOn: { backgroundColor: brand.foil, alignSelf: "flex-end" },
  action: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 40 },
  actionText: { fontFamily: font.bodyMedium, fontSize: 13.5, color: colors.link, textDecorationLine: "underline", flexShrink: 1 },
});
