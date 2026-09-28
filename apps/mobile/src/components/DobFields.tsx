import { useRef } from "react";
import { StyleSheet, View } from "react-native";
import { Text, TextInput } from "./Text";
import type { TextInput as RNTextInput } from "react-native";
import type { Dob } from "../lib/session";
import { colors, radius } from "../lib/theme";

const FIELDS = [
  { key: "month", label: "Month", placeholder: "MM", max: 2, autoComplete: "bday-month" },
  { key: "day", label: "Day", placeholder: "DD", max: 2, autoComplete: "bday-day" },
  { key: "year", label: "Year", placeholder: "YYYY", max: 4, autoComplete: "bday-year" },
] as const;

/**
 * Date of birth as three stacked numeric fields (no native date picker, which pushed the
 * page off screen on phones). Focus moves on when a field is full.
 */
export function DobFields({ value, onChange, onDone }: { value: Dob; onChange: (v: Dob) => void; onDone?: () => void }) {
  const refs = [useRef<RNTextInput>(null), useRef<RNTextInput>(null), useRef<RNTextInput>(null)];
  return (
    <View style={s.group} accessibilityRole="none">
      <Text style={s.legend} nativeID="dob-legend">Date of birth</Text>
      {FIELDS.map((f, i) => (
        <View key={f.key} style={s.row}>
          <Text style={s.label} nativeID={`dob-${f.key}-label`}>{f.label}</Text>
          <TextInput
            ref={refs[i]}
            testID={`dob-${f.key === "month" ? "mm" : f.key === "day" ? "dd" : "yyyy"}`}
            value={value[f.key]}
            onChangeText={(v) => {
              const digits = v.replace(/[^0-9]/g, "").slice(0, f.max);
              onChange({ ...value, [f.key]: digits });
              if (digits.length === f.max) (i < 2 ? refs[i + 1].current?.focus() : onDone?.());
            }}
            placeholder={f.placeholder}
            placeholderTextColor={colors.muted}
            maxLength={f.max}
            inputMode="numeric"
            keyboardType="number-pad"
            // Web: the browser's own birthday autofill.
            autoComplete={f.autoComplete as never}
            aria-labelledby={`dob-legend dob-${f.key}-label`}
            style={s.input}
          />
        </View>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  group: { gap: 6 },
  legend: { color: colors.muted, fontSize: 12, textTransform: "uppercase", letterSpacing: 1 },
  row: { flexDirection: "row", alignItems: "center", gap: 10 },
  label: { color: colors.text, fontSize: 14, width: 56 },
  input: { flex: 1, minWidth: 0, backgroundColor: colors.panel, color: colors.text, borderColor: colors.line, borderWidth: 1,
    borderRadius: radius, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16 },
});
