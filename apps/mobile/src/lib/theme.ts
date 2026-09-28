/**
 * Design tokens (revision brief section 2). Every color in the app comes from here.
 * Palette ramps are the attached palette; nothing outside it except rarity and status.
 * Contrast (WCAG AA, checked): ink on card 15.2, ink on page 11.6, muted (ink 600) on page 7.2,
 * white on blue 400 4.7, blue 500 links on card 7.8, blue 700 on sky 200 11.1, stage text 18.6.
 * Status colors fail AA as small text, so they are used for borders, icons and fills only.
 */
export const palette = {
  blue: { 100: "#D9DFE9", 200: "#ABB9D0", 300: "#7E94B7", 400: "#59739D", 500: "#3E5170", 600: "#222F43", 700: "#0A101A" },
  sky: { 100: "#D9EFF9", 200: "#87CFEF", 300: "#53AACE", 400: "#4086A4", 500: "#2D6278", 600: "#193C4B", 700: "#081B23" },
  neutral: { 100: "#FBFBFB", 200: "#D3D3D8", 300: "#ACACB6", 400: "#8A8A98", 500: "#676679", 600: "#434350", 700: "#23232B" },
  ink: { 100: "#FCFCFC", 200: "#D5D4D8", 300: "#AFACB5", 400: "#8E8A96", 500: "#6B6675", 600: "#47434D", 700: "#252329" },
  grey: { 100: "#EDEFF0", 200: "#C2C9CC", 300: "#9BA3A8", 400: "#7B8285", 500: "#595F61", 600: "#383B3D", 700: "#191B1C" },
} as const;

export const status = { success: "#2F8F6B", warning: "#C98A1B", error: "#C4453C" } as const;

/** Light surfaces: most pages. */
export const colors = {
  bg: palette.blue[100],          // page, fading to blue 200
  bgEnd: palette.blue[200],
  panel: palette.ink[100],        // cards
  panelHi: palette.blue[100],
  line: palette.neutral[200],
  lineStrong: palette.neutral[300],
  text: palette.ink[700],
  muted: palette.ink[600],
  accent: palette.blue[400],      // primary actions (white text on it)
  accentDeep: palette.blue[500],
  accentInk: palette.ink[100],
  link: palette.blue[500],
  sky: palette.sky[200],          // never white text on sky: use skyInk
  skyInk: palette.blue[700],
  danger: status.error,
  ok: status.success,
  warn: status.warning,
} as const;

/** Dark stage: Packs, the rip clip page, and Drops hero areas. */
export const stage = {
  bg: palette.blue[700],
  bgEnd: palette.blue[600],
  glow: "rgba(89, 115, 157, 0.28)",   // blue 400 at low opacity
  panel: palette.blue[600],
  line: palette.blue[500],
  text: palette.ink[100],
  muted: palette.blue[200],
  accent: palette.sky[200],
  accentInk: palette.blue[700],
} as const;

/** Real Magic rarity colors (brief section 2.1). */
export const rarityColor: Record<string, string> = {
  common: "#23232B",
  uncommon: "#ACACB6",
  rare: "#C9A227",
  mythic: "#E2622B",
  special: "#C9A227",
  bonus: "#C9A227",
};

/** Reveal order: lower first, so the rare or mythic slot comes last. */
export const rarityRank: Record<string, number> = { common: 0, uncommon: 1, rare: 2, special: 2, bonus: 2, mythic: 3 };

/**
 * Self hosted fonts (bundled with the site) with real fallback stacks. No Inter, Roboto,
 * Arial or system UI stacks.
 */
const SERIF = "Georgia, 'Iowan Old Style', 'Palatino Linotype', 'Times New Roman', serif";
const SANS = "'Helvetica Neue', Helvetica, 'Liberation Sans', 'Nimbus Sans', sans-serif";
const MONO = "'SFMono-Regular', Menlo, Consolas, 'Liberation Mono', monospace";
export const font = {
  display: `Fraunces_700Bold, ${SERIF}`,
  displaySemi: `Fraunces_600SemiBold, ${SERIF}`,
  displayHeavy: `Fraunces_800ExtraBold, ${SERIF}`,
  body: `InstrumentSans_400Regular, ${SANS}`,
  bodyMedium: `InstrumentSans_500Medium, ${SANS}`,
  bodySemi: `InstrumentSans_600SemiBold, ${SANS}`,
  bodyBold: `InstrumentSans_700Bold, ${SANS}`,
  mono: `IBMPlexMono_400Regular, ${MONO}`,
  monoMedium: `IBMPlexMono_500Medium, ${MONO}`,
} as const;

/** Type scale. Headings, card names and prices are Fraunces; numbers are Plex Mono. */
export const type = {
  h1: { fontFamily: font.display, fontSize: 28, lineHeight: 34, color: colors.text },
  h2: { fontFamily: font.displaySemi, fontSize: 21, lineHeight: 27, color: colors.text },
  h3: { fontFamily: font.displaySemi, fontSize: 17, lineHeight: 22, color: colors.text },
  body: { fontFamily: font.body, fontSize: 15, lineHeight: 22, color: colors.text },
  small: { fontFamily: font.body, fontSize: 13, lineHeight: 18, color: colors.muted },
  label: { fontFamily: font.bodySemi, fontSize: 12, letterSpacing: 1.2, textTransform: "uppercase" as const, color: colors.muted },
  price: { fontFamily: font.displaySemi, fontSize: 15, color: colors.text },
  mono: { fontFamily: font.mono, fontSize: 13, color: colors.muted },
  button: { fontFamily: font.bodyBold, fontSize: 14, letterSpacing: 1.1, textTransform: "uppercase" as const },
} as const;

export const space = (n: number) => n * 4;
/** Radii vary by component instead of one big rounded rectangle everywhere. */
export const radii = { card: 5, tile: 10, panel: 14, control: 8, pill: 99 } as const;
export const radius = radii.control;
