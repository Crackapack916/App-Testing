---
name: brand
description: CrackAPack visual identity for the customer app (apps/mobile) and the staff ops site (apps/staff). Use for any UI change, new screen, component, email look, or marketing asset, so every page matches the brand kit.
---

# CrackAPack brand

Source: the App Screens Overview brand kit. The app uses one palette; the flyer's other palettes (Ember and Slate, Forest and Card Stock, Bubblegum and Mint) are for print and social only.

## Tokens
| Name | Hex | Use |
|---|---|---|
| Ink | `#16141C` | Page top, wells, text on magenta or gold |
| Arcane Violet | `#7A5CFF` | Active center tab, icons in fields, accents |
| Mythic Gold | `#F5B82E` | Credits, section labels, countdowns, key numbers |
| Hot Magenta | `#FF3D81` | Primary buttons, selected chips, active tab icon, live borders, rules beside numbers |
| Foil White | `#FBFBFB` | Text, search fields (with ink text) |

Surfaces are mixes from the kit: page gradient Ink into `#271652`, panels `#241C45` with `#3A2F6B` borders, tab bar `#1B1533`, muted text `#BCB6D0`, faint `#8F84B8`.

Customer app tokens live only in `apps/mobile/src/lib/theme.ts`; the staff site mirrors them in `:root` of `apps/staff/src/styles.css`. Never name a color anywhere else.

## Logo
* Source sheet: `docs/brand/logo-sheet.webp`. Crops: `apps/mobile/assets/brand/mark.png` (the torn pack mark, keyed for dark backgrounds), app icons in `apps/mobile/assets/images` and `apps/mobile/public`, staff copies in `apps/staff/public`.
* Customer app: always `Logo` (mark beside or above the wordmark) or `Wordmark` from `components/Logo.tsx`. Never type "CrackAPack" as a styled heading by hand.
* Staff site: the `.brand` block in `App.tsx` (mark, Crack, magenta A, Pack, gold Ops).
* The A is always Hot Magenta; the rest of the wordmark is Foil White. Never recolor, stretch or put the mark on a light background.

## Components
* Font: Poppins (400 to 800) in both apps.
* Page title left, the balance right: gold number, a 2px magenta rule on its left, "credits" underneath (`Title` and `CreditsBadge`).
* Buttons are pills. Primary: magenta with ink text, bold spaced capitals. Secondary: outlined. Never a gradient button.
* Chips are pills: magenta fill with ink text when on, panel with a violet line when off.
* Section labels: small bold spaced capitals in gold.
* Panels: 16px radius, 1px border. Live or selected items get a 2px magenta border.
* Bottom tab bar: Drops, Search, Packs (raised circle, violet with a magenta ring when on), Vault, Account. Active icon magenta, label foil.
* Every page opened on top of the tabs (policies, card detail, sign in, reset) has a Back button top left (`Title back=` or `BackButton`); full screen views (reel, Watch) have a Close button.
* Nothing floats over buttons: rows size to their content instead of fixed heights.
* Pack tiles are the real product photo with a magenta and violet ring behind it. Never a text only tile.
* Card art is always the real card image from our database; prices come from our database.
* Every card has a full frame colored by rarity (common slate, uncommon silver, rare gold, mythic orange). Non foil: flat matte (`rarityMatte`). Foil: polished metal (`rarityFrame`) with the shimmer and a soft glow.

## Accessibility (WCAG 2.2 AA)
* Contrast, the WebAIM checker's math: text 4.5:1, large text (24px, or 18.66px bold) 3:1, icons and field edges 3:1. Every gradient stop behind text must pass.
* Never fade text with opacity to make it secondary; use `muted` or `faint`. Disabled controls and decorative art (mark it `aria-hidden` plus `dataSet={{ decorative: "true" }}`) are exempt.
* `e2e/contrast.ts` audits every rendered screen in both apps' browser suites and fails the run on any miss. Audit new screens by calling `shot` (or `auditContrast`) on them.

## Guardrails (brief rule 5)
* No value headlines: no best pull, no vault total, no "hit" callouts. Prices appear per card, small; gold is for credits.
* The reveal deals the logged cards face down in pulled order. Tap flips one, Reveal all flips the rest one beat apart, press and hold zooms. Same beat for every card, no sound, and it says these are the filmed pack's cards.
* No fake scarcity or countdown pressure beyond the real 7:00 PM cutoff and the real packs left tonight.
* Text never uses dashes as punctuation.
