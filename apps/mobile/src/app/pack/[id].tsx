import { createElement, useEffect, useState } from "react";
import { Linking, Platform, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { X } from "../../components/icons";
import { Text } from "../../components/Text";
import { ErrorText, Footer, Stage, SUPPORT_EMAIL } from "../../components/bits";
import { CardImage } from "../../components/CardImage";
import { api } from "../../lib/api";
import { dollars } from "../../lib/format";
import { brand, colors, font, radii, type } from "../../lib/theme";

type Card = { slot: number; card_id: string; finish: string; name: string; set_code: string; collector_number: string; rarity: string;
  market_cents: number | null; image_url: string | null };
type Pack = { id: string; pack_index: number; order_packs: number; set_code: string; set_name: string; batch_date: string; video_status: string | null };
type Video = { url: string; poster: string | null; content_type: string };

/**
 * Watch: one cracked pack's filmed video, then its cards in the order they came out of the
 * pack, with market prices. No "best pull" or value headline.
 */
export default function PackScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { width } = useWindowDimensions();
  const [pack, setPack] = useState<{ pack: Pack; cards: Card[] } | null>(null);
  const [video, setVideo] = useState<Video | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<{ pack: Pack; cards: Card[] }>("GET", `/me/packs/${id}`).then(setPack).catch((e) => setError(e.message));
    api<Video>("GET", `/me/packs/${id}/video`).then(setVideo).catch((e) => setError(e.message));
  }, [id]);
  const inner = Math.min(width, 900) - 32;
  const cols = inner >= 700 ? 5 : inner >= 480 ? 4 : 3;
  const tile = Math.floor((inner - (cols - 1) * 10) / cols);

  return (
    <Stage>
      <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
        <View style={s.wrap}>
          <View style={s.head}>
            <View style={{ flex: 1 }}>
              <Text style={type.h1} accessibilityRole="header">Watch</Text>
              {pack && <Text style={s.muted}>{pack.pack.set_name} · Pack {pack.pack.pack_index} of {pack.pack.order_packs} · opened {pack.pack.batch_date}</Text>}
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={() => (router.canGoBack() ? router.back() : router.replace("/vault"))} style={s.close}>
              <X size={22} color={colors.text} />
            </Pressable>
          </View>
          <View style={s.video} testID="pack-video">
            {video && Platform.OS === "web"
              ? createElement("video", { src: video.url, poster: video.poster ?? undefined, controls: true, playsInline: true, preload: "metadata",
                  style: { width: "100%", height: "100%", backgroundColor: "#000", borderRadius: 8 }, "aria-label": "Video of this pack being opened" })
              : <Text style={s.muted}>{error ?? "Loading video"}</Text>}
          </View>
          <Text style={type.label}>Your {pack?.cards.length ?? ""} cards, in the order they came out</Text>
          <View style={s.grid}>
            {pack?.cards.map((c) => (
              <Pressable key={c.slot} style={{ width: tile }} onPress={() => router.push(`/card/${c.card_id}`)} accessibilityRole="button" testID={`pack-card-${c.slot}`}>
                <CardImage card={c} width={tile} />
                <Text style={s.price}>{dollars(c.market_cents)}</Text>
              </Pressable>
            ))}
          </View>
          <ErrorText>{pack ? null : error}</ErrorText>
          <Text style={s.report} accessibilityRole="link" testID="report-problem"
            onPress={() => Linking.openURL(`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(`Problem with pack ${id}`)}`)}>
            Report a problem with this pack
          </Text>
        </View>
        <Footer />
      </ScrollView>
    </Stage>
  );
}

const s = StyleSheet.create({
  wrap: { maxWidth: 900, width: "100%", alignSelf: "center", paddingHorizontal: 16, gap: 12 },
  head: { flexDirection: "row", alignItems: "center", gap: 12, paddingTop: 14 },
  muted: { fontFamily: font.body, fontSize: 13, color: colors.muted },
  close: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.line },
  video: { aspectRatio: 16 / 9, width: "100%", backgroundColor: brand.ink, borderRadius: radii.panel, alignItems: "center", justifyContent: "center",
    overflow: "hidden", borderWidth: 1, borderColor: colors.line },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  report: { fontFamily: font.bodySemi, fontSize: 13.5, color: colors.link, textDecorationLine: "underline", paddingVertical: 12 },
  price: { fontFamily: font.bodyMedium, fontSize: 12.5, color: colors.muted, marginTop: 4 },
});
