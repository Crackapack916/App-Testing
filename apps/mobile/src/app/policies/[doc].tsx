import { ScrollView, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { ErrorText, Footer, Screen, Title } from "../../components/bits";
import { Markdown } from "../../components/Markdown";
import { useApi } from "../../lib/useApi";
import { updated } from "../../lib/format";

/** Terms of Service and Privacy Policy, current version, dated. */
export default function PolicyPage() {
  const { doc } = useLocalSearchParams<{ doc: string }>();
  const p = useApi<{ title: string; version: string; published_at: string; body_md: string }>(`/policies/${doc}`);
  return (
    <Screen>
      <ScrollView>
        <View style={{ maxWidth: 720, width: "100%", alignSelf: "center" }}>
          <Title sub={p.data ? `Last updated ${updated(p.data.published_at)}, version ${p.data.version}` : " "}>{p.data?.title ?? " "}</Title>
          <View style={{ paddingHorizontal: 16 }} testID={`policy-${doc}`}>{p.data ? <Markdown md={p.data.body_md} /> : null}</View>
          <ErrorText>{p.error}</ErrorText>
        </View>
        <Footer />
      </ScrollView>
    </Screen>
  );
}
