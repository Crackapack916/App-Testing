import { ScrollView, StyleSheet, View } from "react-native";
import { router } from "expo-router";
import { Text } from "../../components/Text";
import { Button, ErrorText, Footer, Screen, Title } from "../../components/bits";
import { Markdown } from "../../components/Markdown";
import { useApi } from "../../lib/useApi";
import { updated } from "../../lib/format";
import { colors, font, radii, type } from "../../lib/theme";

type Policy = { doc: string; title: string; version: string; published_at: string; body_md: string };

/** Fairness and policies (item 18): how a pack is handled, the promises, and links to the Terms and Privacy Policy. */
export default function Policies() {
  const fair = useApi<Policy>("/policies/fairness");
  const list = useApi<{ policies: Omit<Policy, "body_md">[] }>("/policies");
  return (
    <Screen>
      <ScrollView>
        <View style={s.wrap}>
          <Title back="/packs" balance={false} sub={fair.data ? `Last updated ${updated(fair.data.published_at)}` : " "}>Fairness and policies</Title>
          <View style={s.body} testID="policy-fairness">{fair.data ? <Markdown md={fair.data.body_md} /> : null}</View>
          <View style={s.links}>
            {list.data?.policies.filter((p) => p.doc !== "fairness").map((p) => (
              <View key={p.doc} style={s.link}>
                <View style={{ flex: 1 }}>
                  <Text style={s.linkTitle}>{p.title}</Text>
                  <Text style={type.small}>Last updated {updated(p.published_at)}</Text>
                </View>
                <Button kind="ghost" label="Read" testID={`read-${p.doc}`} onPress={() => router.push(`/policies/${p.doc}`)} />
              </View>
            ))}
          </View>
          <ErrorText>{fair.error}</ErrorText>
        </View>
        <Footer />
      </ScrollView>
    </Screen>
  );
}

const s = StyleSheet.create({
  wrap: { maxWidth: 720, width: "100%", alignSelf: "center" },
  body: { paddingHorizontal: 16 },
  links: { paddingHorizontal: 16, paddingTop: 24, gap: 10 },
  link: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, backgroundColor: colors.panel, borderRadius: radii.tile, borderWidth: 1, borderColor: colors.line },
  linkTitle: { fontFamily: font.displaySemi, fontSize: 17, color: colors.text },
});
