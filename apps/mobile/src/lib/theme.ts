/** Design tokens. Rarity colors follow Magic's own language. */
export const colors = {
  bg: "#0E0F13",
  panel: "#171920",
  panelHi: "#1F222B",
  line: "#2A2D38",
  text: "#ECEEF3",
  muted: "#8A90A0",
  accent: "#F2B233",
  accentInk: "#1A1400",
  danger: "#E5484D",
  ok: "#3FB950",
};

export const rarityColor: Record<string, string> = {
  common: "#1B1B1B",
  uncommon: "#B8C4CC",
  rare: "#D4AF37",
  mythic: "#E8641C",
  special: "#9B6BDF",
  bonus: "#9B6BDF",
};

/** Reveal order: lower first, so the rare or mythic slot comes last. */
export const rarityRank: Record<string, number> = { common: 0, uncommon: 1, rare: 2, special: 2, bonus: 2, mythic: 3 };

export const space = (n: number) => n * 4;
export const radius = 14;
