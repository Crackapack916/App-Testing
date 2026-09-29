import { createElement, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlatList, Platform, Pressable, StyleSheet, View, useWindowDimensions, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ChevronDown, ChevronUp, Film, Sparkles, X } from "../components/icons";
import { Text } from "../components/Text";
import { Screen } from "../components/bits";
import { Reveal, type RevealCard } from "../components/Reveal";
import { api } from "../lib/api";
import { useApi } from "../lib/useApi";
import { brand, colors, font, radii, type } from "../lib/theme";

type Cracked = { pack_id: string; pack_index: number; order_packs: number; set_code: string; set_name: string; batch_date: string;
  pack_image_url: string | null; video_status: string | null };
type Mode = "video" | "reveal";
type Video = { url: string; poster: string | null };

const TOP = 64;      // the bar with close, the Video or Reveal switch, and the count
const BOTTOM = 76;   // pack name and the link to its cards

/**
 * Cracked today as a reel: one pack per swipe, full height, like Reels or Shorts. Each pack
 * shows either its real filmed video or a quick animated reveal of the same cards in pulled
 * order. The switch at the top changes every pack; "See cards" goes to the plain list.
 */
export default function Reel() {
  const params = useLocalSearchParams<{ start?: string; mode?: string }>();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const cracked = useApi<{ packs: Cracked[] }>("/me/cracked");
  const packs = useMemo(() => (cracked.data?.packs ?? []).filter((p) => p.video_status === "approved"), [cracked.data]);
  const [mode, setMode] = useState<Mode>(params.mode === "reveal" ? "reveal" : "video");
  const [index, setIndex] = useState(0);
  const list = useRef<FlatList<Cracked>>(null);
  const itemH = height;
  const startAt = Math.max(0, packs.findIndex((p) => p.pack_id === params.start));

  useEffect(() => { if (packs.length) setIndex(startAt); }, [packs.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const go = useCallback((i: number) => {
    const n = Math.max(0, Math.min(packs.length - 1, i));
    list.current?.scrollToIndex({ index: n, animated: true });
    setIndex(n);
  }, [packs.length]);

  // Up and down keys on a keyboard, like the arrows on screen.
  useEffect(() => {
    if (Platform.OS !== "web") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") { e.preventDefault(); go(index + 1); }
      if (e.key === "ArrowUp") { e.preventDefault(); go(index - 1); }
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, go]);

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const i = Math.round(e.nativeEvent.contentOffset.y / itemH);
    if (i !== index && i >= 0 && i < packs.length) setIndex(i);
  };

  return (
    <Screen safe={false}>
      {packs.length > 0 && (
        <FlatList
          ref={list}
          testID="reel"
          data={packs}
          keyExtractor={(p) => p.pack_id}
          pagingEnabled
          snapToInterval={itemH}
          decelerationRate="fast"
          showsVerticalScrollIndicator={false}
          initialScrollIndex={startAt}
          getItemLayout={(_, i) => ({ length: itemH, offset: itemH * i, index: i })}
          onScroll={onScroll}
          scrollEventThrottle={50}
          windowSize={3}
          renderItem={({ item, index: i }) => (
            <ReelItem p={item} mode={mode} active={i === index} width={width} height={itemH} top={TOP + insets.top} bottom={BOTTOM + insets.bottom} />
          )}
        />
      )}
      {cracked.data && !packs.length && (
        <View style={s.empty}><Text style={type.h3}>No cracked packs to show yet.</Text></View>
      )}

      <View style={[s.bar, { paddingTop: insets.top + 10 }]} pointerEvents="box-none">
        <Pressable onPress={close} accessibilityRole="button" accessibilityLabel="Close" style={s.round} testID="reel-close">
          <X size={20} color={colors.text} />
        </Pressable>
        <View style={s.switch} accessibilityRole="radiogroup" accessibilityLabel="How to see your pack">
          {([["video", "Video", Film], ["reveal", "Reveal", Sparkles]] as const).map(([k, label, Icon]) => {
            const on = mode === k;
            return (
              <Pressable key={k} onPress={() => setMode(k)} style={[s.seg, on && s.segOn]} accessibilityRole="radio" accessibilityState={{ checked: on }}
                aria-checked={on} testID={`mode-${k}`}>
                <Icon size={15} color={on ? colors.accentInk : colors.muted} />
                <Text style={[s.segText, on && { color: colors.accentInk, fontFamily: font.bodyBold }]}>{label}</Text>
              </Pressable>
            );
          })}
        </View>
        <Text style={s.count} testID="reel-count">{packs.length ? `${index + 1} / ${packs.length}` : ""}</Text>
      </View>

      {/* Phones swipe; wider screens also get arrows beside the pack. */}
      {packs.length > 1 && width >= 700 && (
        <View style={[s.arrows, { bottom: BOTTOM + insets.bottom + 12 }]} pointerEvents="box-none">
          <Pressable onPress={() => go(index - 1)} disabled={index === 0} accessibilityRole="button" accessibilityLabel="Previous pack"
            style={[s.round, index === 0 && { opacity: 0.3 }]} testID="reel-prev"><ChevronUp size={20} color={colors.text} /></Pressable>
          <Pressable onPress={() => go(index + 1)} disabled={index === packs.length - 1} accessibilityRole="button" accessibilityLabel="Next pack"
            style={[s.round, index === packs.length - 1 && { opacity: 0.3 }]} testID="reel-next"><ChevronDown size={20} color={colors.text} /></Pressable>
        </View>
      )}
    </Screen>
  );
}

function close() {
  if (router.canGoBack()) router.back(); else router.replace("/vault");
}

function ReelItem({ p, mode, active, width, height, top, bottom }:
  { p: Cracked; mode: Mode; active: boolean; width: number; height: number; top: number; bottom: number }) {
  const [cards, setCards] = useState<RevealCard[] | null>(null);
  const [video, setVideo] = useState<Video | null>(null);
  const [error, setError] = useState<string | null>(null);
  const media = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    api<{ cards: RevealCard[] }>("GET", `/me/packs/${p.pack_id}`).then((r) => setCards(r.cards)).catch((e) => setError(e.message));
  }, [p.pack_id]);
  // Signed links expire, so the video link is fetched when the pack comes on screen.
  useEffect(() => {
    if (active && mode === "video" && !video) api<Video>("GET", `/me/packs/${p.pack_id}/video`).then(setVideo).catch((e) => setError(e.message));
  }, [active, mode, video, p.pack_id]);
  useEffect(() => { if (!active || mode !== "video") media.current?.pause(); }, [active, mode]);

  const boxH = height - top - bottom;
  const boxW = Math.min(width - 24, 560);
  // Vertical video, cropped to fill a phone shaped frame.
  const vidW = Math.min(boxW, Math.round(boxH * 9 / 16));
  return (
    <View style={{ width, height, paddingTop: top, paddingBottom: bottom, alignItems: "center" }} testID={`reel-${p.pack_id}`}>
      <View style={{ width: boxW, height: boxH, alignItems: "center", justifyContent: "center" }}>
        {mode === "video" ? (
          <View style={[s.video, { width: vidW, height: boxH }]} testID="reel-video">
            {video && Platform.OS === "web"
              ? createElement("video", { ref: media, src: video.url, poster: video.poster ?? undefined, controls: true, playsInline: true, autoPlay: active, muted: true,
                  preload: "metadata", style: { width: "100%", height: "100%", objectFit: "cover", backgroundColor: "#000" },
                  "aria-label": "Video of this pack being opened" })
              : <Text style={type.small}>{error ?? (active ? "Loading video" : "")}</Text>}
          </View>
        ) : cards ? (
          <Reveal cards={cards} packPhoto={p.pack_image_url} width={boxW} height={boxH} playing={active} testID="reel-reveal" />
        ) : <Text style={type.small}>{error ?? "Loading"}</Text>}
      </View>
      <View style={[s.foot, { height: bottom }]}>
        <View style={{ flex: 1 }}>
          <Text style={s.set} numberOfLines={1}>{p.set_name}</Text>
          <Text style={type.small}>Pack {p.pack_index} of {p.order_packs} · opened {p.batch_date}</Text>
        </View>
        <Pressable onPress={() => router.push({ pathname: "/pack/[id]", params: { id: p.pack_id } })} accessibilityRole="link" style={s.cardsLink}
          testID={`reel-cards-${p.pack_id}`}>
          <Text style={s.cardsText}>See cards</Text>
        </Pressable>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  bar: { position: "absolute", top: 0, left: 0, right: 0, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 12 },
  round: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(22, 20, 28, 0.7)",
    borderWidth: 1, borderColor: colors.line },
  switch: { flexDirection: "row", backgroundColor: "rgba(22, 20, 28, 0.8)", borderRadius: radii.pill, padding: 4, borderWidth: 1, borderColor: colors.line },
  seg: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, minHeight: 36, borderRadius: radii.pill },
  segOn: { backgroundColor: brand.magenta },
  segText: { fontFamily: font.bodyMedium, fontSize: 13, color: colors.muted },
  count: { width: 44, textAlign: "center", fontFamily: font.bodySemi, fontSize: 13, color: colors.muted },
  video: { borderRadius: radii.panel, overflow: "hidden", backgroundColor: brand.ink, alignItems: "center", justifyContent: "center",
    borderWidth: 1, borderColor: colors.line },
  foot: { position: "absolute", bottom: 0, left: 0, right: 0, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingBottom: 12,
    maxWidth: 600, alignSelf: "center" },
  set: { fontFamily: font.bodyBold, fontSize: 18, color: colors.text },
  cardsLink: { minHeight: 44, justifyContent: "center", paddingHorizontal: 14, borderRadius: radii.pill, borderWidth: 1, borderColor: colors.lineStrong },
  cardsText: { fontFamily: font.bodySemi, fontSize: 13, color: colors.text },
  arrows: { position: "absolute", right: 12, gap: 8 },
  empty: { flex: 1, alignItems: "center", justifyContent: "center" },
});
