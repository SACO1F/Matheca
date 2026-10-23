---
name: Matheca · 透片对位
description: Standalone introduction website with cold white optical planes, cobalt mathematics and editorial red corrections.
colors:
  ink: "#0c2576"
  blue: "#0759ed"
  muted: "#4d6494"
  red: "#bc302b"
  line: "#a8c8fa"
  ground: "#f7faff"
  white: "#ffffff"
  organisation: "#eef5ff"
  paper-surround: "#edf3fc"
  download: "#e6efff"
  primary-hover: "#0845bd"
  outline-hover: "#e8f0ff"
typography:
  display:
    fontFamily: "'Noto Serif SC', 'Songti SC', serif"
    fontSize: "72px"
    fontWeight: 700
    lineHeight: 1.4
    letterSpacing: ".012em"
  headline:
    fontFamily: "'Noto Serif SC', 'Songti SC', serif"
    fontSize: "clamp(34px, 3.7vw, 58px)"
    fontWeight: 600
    lineHeight: 1.5
    letterSpacing: "-.025em"
  body:
    fontFamily: "'Noto Serif SC', 'Songti SC', serif"
    fontSize: "16px"
    lineHeight: 1.8
  control:
    fontFamily: "'Segoe UI', 'Microsoft YaHei', sans-serif"
    fontSize: "17px"
    lineHeight: 1.2
rounded:
  control: "4px"
  button: "5px"
  editor: "8px"
  plane: "9px"
spacing:
  control-gap: "10px"
  button-inline: "20px"
  chapter-block: "110px"
  paper-surround: "36px"
components:
  button-primary:
    backgroundColor: "{colors.blue}"
    textColor: "{colors.white}"
    rounded: "{rounded.button}"
    padding: "8px 20px"
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
  button-outline:
    backgroundColor: "transparent"
    textColor: "{colors.blue}"
    rounded: "{rounded.button}"
    padding: "8px 20px"
  button-outline-hover:
    backgroundColor: "{colors.outline-hover}"
  title-input:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "0"
    padding: "12px 0"
---

# Design System: Matheca · 透片对位

## Overview

**Creative North Star: "透片对位"**

This document applies only to `introduction-transparency/`. It records the implemented independent website approved by the user: luminous optical work surfaces, bookish Chinese typography and recognisable mathematics passing from source through correction to a finished exercise. It does not define the desktop application's design system.

The user accepted the implemented first viewport as the baseline and explicitly waived the unavailable automated first-viewport review. Authority and that tool limitation are recorded in `../.impeccable/build/MANUAL-OVERRIDE.md`; the surface contract is `../.impeccable/surfaces/transparency-introduction.md`. Documentation was extracted from this directory's HTML, final CSS cascade, JavaScript and local font declarations, with visual inspection of `../.impeccable/review/transparency-final-hero.png`. Independent finishing review reported **SHIP**, with no material findings. This is a record of the baseline and review disposition, not an accessibility certification or a claim that every viewport has been inspected.

Key characteristics: cold white ground; cobalt reading and controls; sparse editorial red; translucent content planes; conventional, readable local demonstrations.

## Colors

Primary cobalt `blue` identifies downloads and active controls; the darker `ink` carries most reading. The final editorial `red` is reserved for corrections and registration marks. Its final override replaces the earlier brighter CSS declaration. `muted` carries supporting text; `line` separates and frames without heavy edges.

Neutral ground alternates white with cold blue tints for organisation, paper surround and download sections. Optical planes use the implemented translucent gradient (`linear-gradient(110deg,#ffffff8f,#eef7ff74 65%,#f5faff9c)`) and a pale blue border. Preserve the final cascade rather than copying an earlier declaration. The canvas plot has its own cobalt curve and red mathematical point annotations in `main.js`.

## Typography

Locally bundled **Noto Serif SC**, in regular, semibold and bold, carries headings, source mathematics context and reading copy; the fallback is Songti SC then serif. **Segoe UI / Microsoft YaHei** carries controls, metadata and supporting interface copy. KaTeX and its fonts are local resources; use mathematical markup rather than approximating formula layout with plain text.

The frontmatter display role is the base desktop rule. The hero becomes 62px at widths up to 1450px and scales at widths from 1600px. At phone widths it uses `clamp(28px,7.6vw,42px)`; the smallest override is 27px. Section headings follow the headline role, with narrower responsive overrides. Body copy generally uses generous line heights (1.8–1.9); small interface labels remain sans. Final paper metadata and footer corrections use 12px.

## Layout

The sticky header places identity and utility navigation on the left and Windows/Android downloads on the right. The desktop hero is capped at 1920px and uses three positioned planes with perspective: source, editable mathematics with a data-driven graph, and exercise metadata. Chapter gutters are 6.1% at the base size. The organisation workspace uses two columns (1.18fr / 1fr); composition and usage pair 38% / 54% columns with an 8% gap.

At 1250px, the audience label disappears and spacing tightens. At 1000px, the optical stages become readable stacked content, the main navigation disappears, composition and usage become single column, and the organisation workspace retains two columns. At 600px, the question workspace and downloads also become single column; the header shortens to 66px, and visible download labels shorten to platform names. The 360px rules reduce type and padding again. Keep all source, correction and exercise stages in the reading order when stacking.

## Elevation & Depth

Depth comes from overlapping translucent planes and their perspective, not opaque dashboard cards. The final optical shadow is subtle neutral ink (`0 18px 46px #0000000a`); it supersedes the initial blue shadow. A paper preview uses `0 18px 38px #0c257610`; the temporary editor uses `0 14px 50px #0c257626`. Shadow and motion details live in the sidecar.

## Shapes

Use gently rounded planes, compact rounded controls and straight ruled dividers. The exercise preview reads as a rectangular sheet within a tinted surround. Correction boxes are thin red outlines with an offset; registration crosshairs remain small and functional. Avoid treating the translucent planes as a general-purpose card pattern for every section.

## Components

**Download buttons:** solid cobalt primary and transparent outlined secondary, with platform SVGs and a shared compact shape. Hover changes the fill; keyboard focus uses a cobalt 2px outline with a 5px offset.

**Navigation and filters:** text links underline on hover. Subject filters expose selected state through `aria-pressed`, a pale fill and blue edge. Question rows use dividers, addition/removal state and explicit reorder actions; disabled reorder buttons reduce opacity.

**Title input and temporary editor:** the permanent title field is a simple bottom rule. The metadata editor is a bounded floating form, restoring focus on close and supporting Escape. All demos run in browser memory and reset on refresh; they do not read or modify application data.

**Exercise preview:** title, selected problem order and answer-space setting update together. Removing all questions shows the implemented empty state. The page demonstrates layout; actual PDF / Word export belongs to the app, and Word formulas are described as images.

**Optical alignment:** one signature gesture straightens the planes as the hero leaves the reading field: 900ms with `cubic-bezier(.16,1,.3,1)`, and 7px inward translation on the outer stages. Reduced motion removes transforms and transitions; narrow viewports show the static stacked composition. Do not add looping, parallax or reveal dependencies to reading content.

## Do's and Don'ts

- **Do** preserve the same mathematically consistent example across the three optical stages.
- **Do** use local fonts, local KaTeX and labelled demonstrations.
- **Do** keep downloads explicit about their published version and platform.
- **Do** preserve keyboard focus, state labels, empty states and reduced-motion behavior when editing components.
- **Don't** reuse this scoped document as authority for the desktop app or other Matheca sites.
- **Don't** turn correction red into a broad decorative background.
- **Don't** imply automatic condition completion, guaranteed recognition, persistent browser editing or browser document export.
- **Don't** describe the waived automatic capture as passed; browser evidence and independent review have their own scope.
