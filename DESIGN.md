---
version: alpha
name: seo.vorkei
description: Quiet forest-ink command center for SK, EN and DE SEO work. Tokens are taken from src/styles.css and the mark in public/favicon.svg.
colors:
  background: "#F7FAF8"
  foreground: "#171F1B"
  card: "#FFFFFF"
  primary: "#0B4F38"
  on-primary: "#F8FAFC"
  secondary: "#E8F3EE"
  on-secondary: "#0F172B"
  muted: "#ECF0EE"
  muted-foreground: "#59635E"
  accent: "#DBEFE5"
  border: "#D5DDD9"
  input: "#CDD7D2"
  ring: "#247A5B"
  success: "#298954"
  warning: "#CF9B00"
  danger: "#E7000B"
  info: "#007CB8"
  mark: "#10B981"
  ink: "#0F1214"
  dark-background: "#020618"
  dark-foreground: "#F8FAFC"
  dark-card: "#0F172B"
  dark-primary: "#E2E8F0"
typography:
  display-xl:
    fontFamily: Outfit
    fontSize: 60px
    fontWeight: 500
    lineHeight: 1.1
    letterSpacing: 0em
  display-lg:
    fontFamily: Outfit
    fontSize: 36px
    fontWeight: 500
    lineHeight: 1.15
    letterSpacing: 0em
  title:
    fontFamily: Outfit
    fontSize: 24px
    fontWeight: 500
    lineHeight: 1.25
    letterSpacing: 0em
  body:
    fontFamily: Figtree
    fontSize: 16px
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: 0em
  body-strong:
    fontFamily: Figtree
    fontSize: 14px
    fontWeight: 500
    lineHeight: 1.5
    letterSpacing: 0em
  label:
    fontFamily: Figtree
    fontSize: 10px
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: 0em
rounded:
  sm: 4px
  md: 6px
  lg: 8px
  pill: 999px
spacing:
  xs: 4px
  sm: 8px
  md: 12px
  lg: 16px
  xl: 24px
  section: 80px
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.body-strong}"
    rounded: "{rounded.lg}"
    padding: 12px
    height: 44px
  button-secondary:
    backgroundColor: "{colors.card}"
    textColor: "{colors.foreground}"
    typography: "{typography.body-strong}"
    rounded: "{rounded.lg}"
    padding: 12px
    height: 44px
  button-mark:
    backgroundColor: "{colors.mark}"
    textColor: "#042F24"
    typography: "{typography.body-strong}"
    rounded: "{rounded.pill}"
    padding: 12px
  card:
    backgroundColor: "{colors.card}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.lg}"
    padding: 20px
  input:
    backgroundColor: "{colors.card}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.md}"
    padding: 12px
  badge:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: 8px
---

## Overview

seo.vorkei should feel like a quiet command desk, not a neon marketing site. The light theme is a misted paper with a green undertone (`#F7FAF8`), deep forest ink for actions (`#0B4F38`), and almost no letter-spacing. Density is editorial: a narrow reading measure for the promise, then a calm four-up of tools. The mark itself is a near-black tile (`#0F1214`) with a pale V and one emerald spark (`#10B981`). That spark is the logo accent, not the everyday button color.

Dark mode is a separate night desk: blue-black ink (`#020618`) and pale slate type. Do not invent a third palette.

## Colors

The working set lives as oklch custom properties in `src/styles.css`. Hex values below are the sRGB equivalents agents should quote.

- **Misted Paper (`#F7FAF8`):** page background. Cooler than white so large surfaces do not glare.
- **Forest Ink (`#171F1B`):** default text.
- **White Sheet (`#FFFFFF`):** cards and form wells, lifted off the paper.
- **Deep Forest (`#0B4F38`):** primary actions and the small uppercase badge. White text (`#F8FAFC`) sits on it.
- **Pale Fern (`#E8F3EE`):** secondary fills and quiet chips.
- **Sage Mist (`#ECF0EE`) and Stone Caption (`#59635E`):** muted surfaces and secondary copy.
- **Fern Wash (`#DBEFE5`):** hover and accent wash, never a large background.
- **Hairline Sage (`#D5DDD9`):** borders. Inputs use a slightly deeper stroke (`#CDD7D2`).
- **Focus Fern (`#247A5B`):** the focus ring.
- **Growth (`#298954`), Amber Alert (`#CF9B00`), Signal Red (`#E7000B`), Clear Blue (`#007CB8`):** status only. Do not recolor actions with them.
- **Emerald Spark (`#10B981`) on Night Tile (`#0F1214`):** favicon and PWA chrome, plus the one WordPress "send" action.
- **Night Desk (`#020618` / `#0F172B` / `#F8FAFC`):** dark background, dark cards, dark text.

## Typography

Outfit carries display and headings. Figtree carries everything else, including buttons. Both load with `font-display: swap` and a metric-matched Arial fallback so the first paint does not jump.

- Headlines are medium, not black. A page title is Outfit at 36–60px with tight leading (`1.1`).
- Body is Figtree 16px, line-height about 1.6.
- Labels are Figtree 10px, medium, uppercase, with tracking forced to zero. The stylesheet sets `letter-spacing: 0` on every element. Do not add wide tracking to look "premium".
- Slovak, English and German copy share these sizes. Do not shrink German lines by dropping a weight.

## Layout

Pages sit in a `max-w-screen-xl` column with 24px of side padding. The hero promise stays inside roughly 44 characters so the first screen reads like a sentence, not a billboard. Tool groups are a 1 / 2 / 4 column grid with 12px gaps. Sections are separated by 80px, not by decorative bands.

The header is shared. Tool screens use the same workspace frame. Locale prefixes (`/sk`, `/en`, `/de`) never change the layout, only the words.

## Elevation & Depth

Depth is a whisper, not a stack of cards. Resting cards use a hairline ring (`border` at low opacity) and an optional soft fern shadow: 4px blur spread to 24px at 5% ink. Raised hover and the floating action bar use a slightly deeper shadow, 10px by 32px at 10% ink. Nothing gets a hard drop shadow or a colored glow.

The floating action bar, when an article is done, is a Deep Forest pill lifted over the page. It is the only element allowed to float.

## Shapes

The base radius is 8px: a subtly rounded corner, used by cards, primary buttons and the workspace. Smaller controls use 6px. The logo tile is a generously rounded square (16px on a 64px tile). Status chips and the done-state action bar are pill-shaped. Do not mix sharp corners into this system.

## Components

- **Primary button:** Deep Forest fill, mist-white label, 8px corners, at least 44px tall. Hover stays in the same green family. Disabled is the same button at reduced opacity, not a new gray style.
- **Secondary button:** white sheet, forest text, a hairline ring. Used for the second action in a pair.
- **Mark button:** Emerald Spark pill. Reserved for the logo and the single "send to WordPress" action. Do not use it for generic CTAs.
- **Cards:** white sheet, 8px corners, 20px padding, hairline ring. They hold tools, benefits and the writer.
- **Inputs:** borderless inside a card when they are the main prompt; otherwise a 1px sage stroke on a white well, 6px corners. Focus uses the Focus Fern ring, not a blue browser outline.
- **Badge:** Deep Forest pill, 10px uppercase Figtree. One per hero. It names the product, it is not a tag cloud.

## Do's and Don'ts

- Do read these tokens before changing `src/styles.css`. New colors go in as oklch variables first, then get a named entry here.
- Do keep one type scale and zero letter-spacing.
- Do keep the first screen painted immediately. Do not fade `main` in from transparent.
- Do not reintroduce the old SEO4WEB wordmark, purple gradients, or a second accent beside Deep Forest and Emerald Spark.
- Do not put marketing chrome on dashboard, history or settings. Those screens stay noindex and visually quieter than the public tools.
- Do not use hash routes. Navigation is a real path under `/$locale`.
