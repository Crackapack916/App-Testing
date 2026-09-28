import { View } from "react-native";
import { Text } from "./Text";
import { type } from "../lib/theme";

/** The small subset our policy pages use: ## headings, numbered lists, paragraphs. */
export function Markdown({ md }: { md: string }) {
  const blocks = md.trim().split(/\n{2,}/);
  return (
    <View style={{ gap: 12 }}>
      {blocks.map((b, i) => {
        if (b.startsWith("## ")) {
          const [head, ...rest] = b.split("\n");
          return (
            <View key={i} style={{ gap: 8, marginTop: 8 }}>
              <Text style={type.h2} accessibilityRole="header">{head.slice(3)}</Text>
              {rest.length ? <Markdown md={rest.join("\n")} /> : null}
            </View>
          );
        }
        if (/^\d+\. /.test(b)) {
          return (
            <View key={i} style={{ gap: 6 }} accessibilityRole="list">
              {b.split("\n").map((line, j) => {
                const m = /^(\d+)\. (.*)$/.exec(line);
                return (
                  <View key={j} style={{ flexDirection: "row", gap: 8 }} role="listitem">
                    <Text style={[type.body, { fontFamily: type.mono.fontFamily, minWidth: 18 }]}>{m?.[1]}.</Text>
                    <Text style={[type.body, { flex: 1 }]}>{m?.[2] ?? line}</Text>
                  </View>
                );
              })}
            </View>
          );
        }
        return <Text key={i} style={type.body}>{b.replace(/\n/g, " ")}</Text>;
      })}
    </View>
  );
}
