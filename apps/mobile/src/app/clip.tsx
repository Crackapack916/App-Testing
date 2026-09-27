import { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useVideoPlayer, VideoView } from "expo-video";
import { Button, Screen } from "../components/bits";

/**
 * Plays an order's segment of the session recording. Pilot clips are "<recording>#t=start,end",
 * so the player seeks to start and stops at end itself.
 */
export default function Clip() {
  const { src } = useLocalSearchParams<{ src: string }>();
  const [url, frag] = (src ?? "").split("#t=");
  const [start, end] = (frag ?? "").split(",").map(Number);
  const player = useVideoPlayer(url || null, (p) => {
    p.timeUpdateEventInterval = 0.25;
    if (start) p.currentTime = start;
    p.play();
  });
  useEffect(() => {
    if (!end) return;
    const sub = player.addListener("timeUpdate", ({ currentTime }) => { if (currentTime >= end) player.pause(); });
    return () => sub.remove();
  }, [player, end]);
  return (
    <Screen style={{ backgroundColor: "#000" }}>
      <View style={{ flex: 1, justifyContent: "center" }}>
        <VideoView player={player} style={s.video} nativeControls contentFit="contain" />
      </View>
      <View style={{ padding: 16 }}><Button kind="ghost" label="Close" onPress={() => router.back()} /></View>
    </Screen>
  );
}

const s = StyleSheet.create({ video: { width: "100%", aspectRatio: 16 / 9 } });
