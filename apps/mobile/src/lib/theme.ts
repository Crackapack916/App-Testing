/**
 * Design tokens: the CrackAPack brand kit (App Screens Overview). Every color in the app comes
 * from here. Five brand colors; surfaces are Ink and Arcane Violet mixes sampled from the kit.
 * Contrast (WCAG AA, checked): foil on panel 14.6, muted on panel 7.9, faint on panel 4.6,
 * ink on magenta 5.6, ink on gold 10.4, gold on page 9.8, violet 300 links on panel 5.3.
 * The flyer palettes (Ember and Slate, Forest and Card Stock, Bubblegum and Mint) are for print
 * and social only, never the app.
 */
export const brand = {
  ink: "#16141C",
  violet: "#7A5CFF",
  gold: "#F5B82E",
  magenta: "#FF3D81",
  foil: "#FBFBFB",
} as const;

/** Mixes of the brand colors, sampled from the kit. */
export const palette = {
  ink: brand.ink,
  night: "#1B1533",       // tab bar
  deep: "#271652",        // bottom of the page gradient
  panel: "#241C45",       // cards and panels
  panelHi: "#2E2360",     // raised: inactive center tab, hover
  line: "#3A2F6B",        // panel borders
  violet300: "#A996FF",   // links and focus on dark
  muted: "#BCB6D0",
  faint: "#8F84B8",
} as const;

export const status = { success: "#3DD68C", warning: brand.gold, error: brand.magenta } as const;

/** One dark stage everywhere, like the kit: ink at the top fading into deep violet. */
export const colors = {
  bg: palette.ink,
  bgEnd: palette.deep,
  panel: palette.panel,
  panelHi: palette.panelHi,
  well: brand.ink,        // inset boxes (the countdown row)
  line: palette.line,
  lineStrong: "#54478F",
  text: brand.foil,
  muted: palette.muted,
  faint: palette.faint,
  accent: brand.magenta,  // primary actions, with ink text
  accentInk: brand.ink,
  violet: brand.violet,
  gold: brand.gold,       // credits and numbers that matter
  link: palette.violet300,
  field: brand.foil,      // search fields are Foil White with ink text, as in the kit
  fieldInk: brand.ink,
  fieldHint: "#6B6675",   // placeholder text on Foil White fields
  danger: brand.magenta,
  ok: status.success,
  warn: brand.gold,
} as const;

/** Kept for screens written against the old stage tokens; now the same dark scheme. */
export const stage = {
  bg: colors.bg,
  bgEnd: colors.bgEnd,
  glow: "rgba(255, 61, 129, 0.16)",
  panel: colors.panel,
  line: colors.line,
  text: colors.text,
  muted: colors.muted,
  accent: colors.gold,
  accentInk: colors.accentInk,
} as const;

/** Real Magic rarity colors. */
export const rarityColor: Record<string, string> = {
  common: "#6B6675",
  uncommon: "#ACACB6",
  rare: "#C9A227",
  mythic: "#E2622B",
  special: "#C9A227",
  bonus: "#C9A227",
};

/** Sort order for the Vault's rarity sort. */
export const rarityRank: Record<string, number> = { common: 0, uncommon: 1, rare: 2, special: 2, bonus: 2, mythic: 3 };

/** Poppins, as in the kit, bundled with the site, with real fallback stacks. */
const SANS = "'Helvetica Neue', Helvetica, 'Liberation Sans', 'Nimbus Sans', sans-serif";
export const font = {
  body: `Poppins_400Regular, ${SANS}`,
  bodyMedium: `Poppins_500Medium, ${SANS}`,
  bodySemi: `Poppins_600SemiBold, ${SANS}`,
  bodyBold: `Poppins_700Bold, ${SANS}`,
  display: `Poppins_700Bold, ${SANS}`,
  displaySemi: `Poppins_600SemiBold, ${SANS}`,
  displayHeavy: `Poppins_800ExtraBold, ${SANS}`,
  mono: `Poppins_500Medium, ${SANS}`,
  monoMedium: `Poppins_700Bold, ${SANS}`,
} as const;

/** Type scale from the kit: bold titles, small spaced labels in gold, numbers in Poppins bold. */
export const type = {
  h1: { fontFamily: font.display, fontSize: 28, lineHeight: 36, color: colors.text },
  h2: { fontFamily: font.display, fontSize: 20, lineHeight: 27, color: colors.text },
  h3: { fontFamily: font.displaySemi, fontSize: 16, lineHeight: 22, color: colors.text },
  body: { fontFamily: font.body, fontSize: 14, lineHeight: 21, color: colors.text },
  small: { fontFamily: font.body, fontSize: 12.5, lineHeight: 18, color: colors.muted },
  label: { fontFamily: font.bodyBold, fontSize: 11, letterSpacing: 1.6, textTransform: "uppercase" as const, color: colors.gold },
  price: { fontFamily: font.bodyBold, fontSize: 14, color: colors.gold },
  mono: { fontFamily: font.mono, fontSize: 12.5, color: colors.muted },
  button: { fontFamily: font.bodyBold, fontSize: 14, letterSpacing: 1.6, textTransform: "uppercase" as const },
} as const;

export const space = (n: number) => n * 4;
/** Rounded, like the kit: pill buttons and chips, soft panels. */
export const radii = { card: 6, tile: 12, panel: 16, control: 14, pill: 99 } as const;
export const radius = radii.control;
