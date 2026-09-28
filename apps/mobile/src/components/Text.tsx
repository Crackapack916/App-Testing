import { forwardRef } from "react";
import { Text as RNText, TextInput as RNTextInput, type TextInputProps, type TextProps } from "react-native";
import { colors, font } from "../lib/theme";

/**
 * Text with the body font and ink color by default, so no text falls back to a system UI
 * stack. A style passed in overrides these.
 */
export const Text = forwardRef<RNText, TextProps>(function Text({ style, ...props }, ref) {
  return <RNText ref={ref} {...props} style={[{ fontFamily: font.body, color: colors.text }, style]} />;
});

export const TextInput = forwardRef<RNTextInput, TextInputProps>(function TextInput({ style, placeholderTextColor, ...props }, ref) {
  return <RNTextInput ref={ref} placeholderTextColor={placeholderTextColor ?? colors.muted} {...props}
    style={[{ fontFamily: font.body, color: colors.text }, style]} />;
});
