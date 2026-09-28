import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, View, useWindowDimensions } from "react-native";
import { Text } from "../components/Text";
import { router, useLocalSearchParams } from "expo-router";
import { useAudioPlayer } from "expo-audio";
import Animated, { Easing, FadeIn, FadeOut, ZoomIn, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { Button } from "../components/bits";
import { CardImage } from "../components/CardImage";
import { PackArt } from "../components/PackArt";
import { api } from "../lib/api";
import { dollars } from "../lib/format";
import { haptic } from "../lib/feedback";
import { colors, rarityColor, rarityRank, font } from "../lib/theme";

type Pull = { pack_opening_id: string; order_id: string; slot: number; name: string; set_code: string; collector_number: string;
  rarity: string; finish: string; market_cents: number | null; image_url: string | null; batch_date: string };

const BEAT_MS = 950;          // each regular card
const SUSPENSE_MS = 900;      // pause before the last card
const LAST_BEAT_MS = 2600;    // the rare or mythic slot lingers
const BIG_HIT_CENTS = 2000;

const isBigHit = (p: Pull) => p.rarity === "mythic" || (p.market_cents ?? 0) >= BIG_HIT_CENTS;
/** Worst first, best last: rarity, then foil, then value. */
const revealOrder = (cards: Pull[]) => [...cards].sort((a, b) =>
  (rarityRank[a.rarity] ?? 0) - (rarityRank[b.rarity] ?? 0) ||
  Number(a.finish !== "nonfoil") - Number(b.finish !== "nonfoil") ||
  (a.market_cents ?? 0) - (b.market_cents ?? 0));

type Stage = { kind: "loading" } | { kind: "empty" } | { kind: "pack"; pack: number } | { kind: "tearing"; pack: number }
  | { kind: "card"; pack: number; index: number } | { kind: "suspense"; pack: number } | { kind: "done" };

export default function Reveal() {
  const { notification } = useLocalSearchParams<{ notification?: string }>();
  const { width } = useWindowDimensions();
  const tear = useAudioPlayer(require("../../assets/sounds/pack-tear.wav"));
  const hit = useAudioPlayer(require("../../assets/sounds/big-hit.wav"));
  const [packs, setPacks] = useState<Pull[][]>([]);
  const [stage, setStage] = useState<Stage>({ kind: "loading" });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    api<{ pulls: Pull[] }>("GET", "/me/pulls").then(({ pulls }) => {
      const byPack = new Map<string, Pull[]>();
      for (const p of pulls) byPack.set(p.pack_opening_id, [...(byPack.get(p.pack_opening_id) ?? []), p]);
      const list = [...byPack.values()].map(revealOrder);
      setPacks(list);
      setStage(list.length ? { kind: "pack", pack: 0 } : { kind: "empty" });
    }).catch(() => setStage({ kind: "empty" }));
    if (notification) api("POST", `/me/notifications/${notification}/opened`).catch(() => {});
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [notification]);

  const play = (p: ReturnType<typeof useAudioPlayer>) => { try { p.seekTo(0); p.play(); } catch { /* audio unavailable */ } };
  const schedule = (fn: () => void, ms: number) => { if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(fn, ms); };

  const showCard = useCallback((pack: number, index: number) => {
    const cards = packs[pack];
    const last = index === cards.length - 1;
    const card = cards[index];
    setStage({ kind: "card", pack, index });
    if (last && isBigHit(card)) { play(hit); haptic.bigHit(); } else haptic.reveal();
    schedule(() => advance(pack, index), last ? LAST_BEAT_MS : BEAT_MS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [packs]);

  const advance = useCallback((pack: number, index: number) => {
    const cards = packs[pack];
    if (index + 1 < cards.length - 1) return showCard(pack, index + 1);
    if (index + 1 === cards.length - 1) {
      setStage({ kind: "suspense", pack });
      return schedule(() => showCard(pack, index + 1), SUSPENSE_MS);
    }
    if (pack + 1 < packs.length) return setStage({ kind: "pack", pack: pack + 1 });
    setStage({ kind: "done" });
  }, [packs, showCard]);

  const crack = (pack: number) => {
    play(tear);
    haptic.tear();
    setStage({ kind: "tearing", pack });
    schedule(() => (packs[pack].length > 1 ? showCard(pack, 0) : (setStage({ kind: "suspense", pack }), schedule(() => showCard(pack, 0), SUSPENSE_MS))), 650);
  };

  const onTap = () => {
    if (stage.kind === "pack") return crack(stage.pack);
    if (stage.kind === "card") return advance(stage.pack, stage.index);
  };

  const cardWidth = Math.min(width * 0.72, 340);
  const all = packs.flat();
  const total = all.reduce((n, p) => n + (p.market_cents ?? 0), 0);

  return (
    <Pressable style={s.root} onPress={onTap} testID="reveal">
      {stage.kind === "loading" && <Text style={s.hint}>Loading tonight's pulls…</Text>}
      {stage.kind === "empty" && (
        <View style={s.center}>
          <Text style={s.title}>Nothing to reveal yet</Text>
          <Text style={s.hint}>Your packs are opened live between 7 and 8pm Pacific.</Text>
          <Button label="Back" kind="ghost" onPress={() => router.back()} />
        </View>
      )}

      {(stage.kind === "pack" || stage.kind === "tearing") && (
        <View style={s.center}>
          <Text style={s.kicker}>Pack {stage.pack + 1} of {packs.length}</Text>
          <TearingPack tearing={stage.kind === "tearing"} setCode={packs[stage.pack][0].set_code} width={cardWidth * 0.7} />
          {stage.kind === "pack" && <Text style={s.hint} testID="tap-to-crack">Tap to crack</Text>}
        </View>
      )}

      {stage.kind === "suspense" && (
        <Animated.View entering={FadeIn.duration(250)} exiting={FadeOut.duration(150)} style={s.center}>
          <Text style={s.suspense}>…</Text>
        </Animated.View>
      )}

      {stage.kind === "card" && (() => {
        const cards = packs[stage.pack];
        const card = cards[stage.index];
        const last = stage.index === cards.length - 1;
        const big = last && isBigHit(card);
        return (
          <View style={s.center} key={`${stage.pack}-${stage.index}`}>
            <Text style={s.kicker}>{stage.index + 1} / {cards.length}</Text>
            <Animated.View entering={(last ? ZoomIn.duration(520) : ZoomIn.duration(260)).easing(Easing.out(Easing.back(1.4)))}>
              <CardImage card={card} width={last ? cardWidth : cardWidth * 0.86} />
            </Animated.View>
            <Animated.View entering={FadeIn.delay(last ? 400 : 120)} style={{ alignItems: "center" }}>
              <Text style={[s.cardName, { color: rarityColor[card.rarity] === "#1B1B1B" ? colors.text : rarityColor[card.rarity] }]} testID="revealed-name">{card.name}</Text>
              <Text style={s.hint}>{card.rarity}{card.finish !== "nonfoil" ? ` · ${card.finish}` : ""} · {dollars(card.market_cents)}</Text>
              {big && <Text style={s.bigHit} testID="big-hit">Big pull</Text>}
            </Animated.View>
          </View>
        );
      })()}

      {stage.kind === "done" && (
        <Animated.View entering={FadeIn} style={[s.center, { paddingHorizontal: 20 }]} testID="reveal-done">
          <Text style={s.title}>You cracked {packs.length} pack{packs.length > 1 ? "s" : ""}</Text>
          <Text style={s.total}>{dollars(total)}</Text>
          <Text style={s.hint}>market value, now in your vault</Text>
          <View style={s.grid}>
            {revealOrder(all).reverse().slice(0, 6).map((p, i) => <CardImage key={i} card={p} width={Math.min(96, (width - 80) / 3)} />)}
          </View>
          <Button testID="to-vault" label="Go to vault" onPress={() => router.dismissTo("/vault")} />
        </Animated.View>
      )}

      {stage.kind !== "done" && stage.kind !== "empty" && stage.kind !== "loading" && (
        <Pressable style={s.skip} onPress={() => { if (timer.current) clearTimeout(timer.current); setStage({ kind: "done" }); }} testID="skip">
          <Text style={s.hint}>Skip</Text>
        </Pressable>
      )}
    </Pressable>
  );
}

/** The sealed wrapper; on tear, the top crimp rips away and the body drops. */
function TearingPack({ tearing, setCode, width }: { tearing: boolean; setCode: string; width: number }) {
  const t = useSharedValue(0);
  useEffect(() => { t.value = withTiming(tearing ? 1 : 0, { duration: 600, easing: Easing.out(Easing.cubic) }); }, [tearing, t]);
  const top = useAnimatedStyle(() => ({ transform: [{ translateY: -t.value * 140 }, { translateX: t.value * 60 }, { rotate: `${t.value * 28}deg` }], opacity: 1 - t.value * 0.9 }));
  const body = useAnimatedStyle(() => ({ transform: [{ translateY: t.value * 220 }], opacity: 1 - t.value }));
  const h = width * 1.62;
  return (
    <View style={{ width, height: h }}>
      <Animated.View style={[StyleSheet.absoluteFill, body]}>
        <PackArt setCode={setCode} setName="" boosterType="play" width={width} />
      </Animated.View>
      <Animated.View style={[{ position: "absolute", top: 0, left: 0, right: 0, height: h * 0.14, overflow: "hidden" }, top]}>
        <PackArt setCode={setCode} setName="" boosterType="play" width={width} />
      </Animated.View>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#07080B", justifyContent: "center" },
  center: { alignItems: "center", justifyContent: "center", gap: 14 },
  kicker: { color: colors.muted, letterSpacing: 2, textTransform: "uppercase", fontSize: 12 },
  hint: { color: colors.muted, textAlign: "center", textTransform: "capitalize" },
  title: { color: colors.text, fontSize: 26, fontFamily: font.display, textAlign: "center" },
  total: { color: colors.accent, fontSize: 44, fontFamily: font.display },
  suspense: { color: colors.accent, fontSize: 64, fontFamily: font.display, letterSpacing: 8 },
  cardName: { fontSize: 22, fontFamily: font.display, textAlign: "center", marginTop: 6 },
  bigHit: { color: colors.accent, fontSize: 16, fontFamily: font.display, letterSpacing: 3, textTransform: "uppercase", marginTop: 6 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8, justifyContent: "center", marginVertical: 12 },
  skip: { position: "absolute", top: 56, right: 20, padding: 8 },
});
