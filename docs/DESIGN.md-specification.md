# DESIGN.md Specification

DESIGN.md is an open Apache-2.0 format from [Google Labs](https://github.com/google-labs-code/design.md) for describing a design system to coding agents in one version-controlled file. It pairs **machine-readable design tokens in YAML front matter** with **human-readable design rationale in markdown prose**.

It plays the same role for design context that `AGENTS.md` plays for engineering context. Status: **alpha**. The reference consumer is [Google Stitch](https://stitch.withgoogle.com/docs/design-md/specification).

This project also keeps the Stitch analysis skill at [`.agents/skills/design-md/SKILL.md`](../.agents/skills/design-md/SKILL.md). Use that skill to refresh [`DESIGN.md`](../DESIGN.md) from the live UI. The file in the repo root must stay valid against this spec.

## File anatomy

```md
---
version: alpha
name: Product
colors:
  primary: "#1a3a52"
  background: "#f7f3ec"
typography:
  headline:
    fontFamily: Inter
    fontSize: 48px
    fontWeight: 700
rounded:
  md: 8px
spacing:
  md: 16px
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.md}"
---

## Overview
## Colors
## Typography
## Layout
## Elevation & Depth
## Shapes
## Components
## Do's and Don'ts
```

The `##` headings that are present must appear in that order. Unknown headings are kept, duplicate headings are an error.

## Token schema

```yaml
version: <string>          # optional, current: "alpha"
name: <string>
description: <string>      # optional
colors:
  <token-name>: <Color>    # hex, rgb(), oklch(), or a named CSS color
typography:
  <token-name>:
    fontFamily: <string>
    fontSize: <Dimension>
    fontWeight: <number>
    lineHeight: <Dimension | number>
    letterSpacing: <Dimension>
rounded:
  <scale-level>: <Dimension>
spacing:
  <scale-level>: <Dimension | number>
components:
  <component-name>:
    backgroundColor: <Color | "{colors.token}">
    textColor: <Color | token reference>
    typography: <token reference>
    rounded: <Dimension | token reference>
    padding: <Dimension>
    height: <Dimension>
    width: <Dimension>
```

Token references use `{path.to.token}`. Valid component properties: `backgroundColor`, `textColor`, `typography`, `rounded`, `padding`, `size`, `height`, `width`. Hover and pressed states are separate component entries.

## How to write the prose

From the design-md skill. Tokens say *what*. Prose says *why*.

- Name each color by character, then give the hex, then the job. Example: Deep Forest (`#0B4F38`) — primary actions.
- Translate geometry into physical language, and keep the exact value in parentheses. `8px` is a subtly rounded corner, not "rounded-lg".
- Describe elevation as a quality of shadow, not only a CSS variable.
- Do not use a technical class name as the only description.

## Check

```bash
npx @google/design.md lint DESIGN.md
```

## Sources

- https://github.com/google-labs-code/design.md
- https://stitch.withgoogle.com/docs/design-md/specification
- https://github.com/google-labs-code/stitch-skills/blob/main/plugins/stitch-utilities/skills/design-md/SKILL.md
