---
name: Matheca
description: A quiet neutral desktop workspace for mathematics lesson preparation.
colors:
  primary: "#252525"
  primary-hover: "#404040"
  blue-primary: "#315a86"
  blue-hover: "#24496e"
  blue-soft: "#e7eff7"
  blue-focus: "#315a86"
  clay-primary: "#8a4c38"
  clay-hover: "#703b2b"
  clay-soft: "#f5eae5"
  clay-focus: "#8a4c38"
  plum-primary: "#74516d"
  plum-hover: "#5e3f58"
  plum-soft: "#f1eaf0"
  plum-focus: "#74516d"
  shell: "#f5f5f5"
  panel: "#ffffff"
  subtle: "#f3f3f3"
  text: "#262626"
  muted: "#696969"
  line: "#e6e6e6"
  hover: "#eeeeee"
  selected: "#e8e8e8"
  paper-muted: "#f7f7f7"
  focus: "#555555"
  card: "#fafafa"
  card-line: "#ededed"
  card-hover-line: "#d7d7d7"
  card-active-line: "#a3a3a3"
  tag-text: "#565656"
  warning-ink: "#886018"
  warning-surface: "#f5efdf"
  error-ink: "#a23245"
  error-surface: "#fbecef"
  danger: "#c94054"
  success-ink: "#30664b"
typography:
  headline:
    fontFamily: "Segoe UI, Microsoft YaHei, sans-serif"
    fontSize: "23px"
    fontWeight: 600
    lineHeight: 1.35
    letterSpacing: "0"
  title:
    fontFamily: "Segoe UI, Microsoft YaHei, sans-serif"
    fontSize: "15px"
    fontWeight: 600
  body:
    fontFamily: "Segoe UI, Microsoft YaHei, sans-serif"
    fontSize: "15px"
    fontWeight: 500
    lineHeight: 1.85
  label:
    fontFamily: "Segoe UI, Microsoft YaHei, sans-serif"
    fontSize: "12px"
  statistic:
    fontFamily: "Segoe UI, Microsoft YaHei, sans-serif"
    fontSize: "16px"
    fontWeight: 550
rounded:
  tag: "5px"
  control: "8px"
  navigation: "10px"
  panel: "12px"
  card: "14px"
  workspace: "16px"
spacing:
  tight: "4px"
  related: "8px"
  compact: "12px"
  group: "16px"
  content: "20px"
  workspace: "30px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.panel}"
    rounded: "{rounded.control}"
    padding: "9px 14px"
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
  button-secondary:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.text}"
    rounded: "{rounded.control}"
    padding: "9px 14px"
  input:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.text}"
    rounded: "{rounded.control}"
    padding: "10px 12px"
  navigation-item:
    textColor: "{colors.muted}"
    rounded: "{rounded.navigation}"
    width: "36px"
    height: "36px"
  navigation-item-selected:
    backgroundColor: "{colors.selected}"
    textColor: "{colors.text}"
  tag-neutral:
    backgroundColor: "{colors.card-line}"
    textColor: "{colors.tag-text}"
    rounded: "{rounded.tag}"
    padding: "3px 7px"
  question-card:
    backgroundColor: "{colors.card}"
    textColor: "{colors.text}"
    rounded: "{rounded.card}"
    typography: "{typography.body}"
---

# Design System: Matheca

## Overview

**Creative North Star: "The Quiet Mathematics Workspace"**

A neutral gray shell holds a clear white work area. Soft question surfaces, graphite or restrained colored primary controls, quiet secondary tools and coherent spacing let mathematics lead. This supports sustained teacher work organizing questions, assembling collections and exporting exercises.

The user chose simplicity and harmonious composition, citing Codex as a quality reference. Matheca retains its own name and mathematics workflow. The previous paper-white and green identity and three generic direction prototypes were explicitly rejected. Local interface fonts and existing local KaTeX assets keep the workspace self-contained.

**Key Characteristics:**
- Neutral reading surfaces with optional restrained accents and independent semantic warning and error colors.
- Content-first question cards and quiet repeated actions.
- Compact icon navigation and consistent curved controls.
- Flat resting surfaces, soft elevation for floating layers.

This record was manually derived from `desktop/src/renderer/workbench-theme.css`, preceding `style.css` and `management-pages.css`, and component structure in `main.tsx`. The theme imports last, but specificity still matters. Final captures are in `desktop/test-output/design-direction-1792242781856/`. The engine download was unavailable; no detector or automated extraction ran. The sidecar provides manually translated component previews; synthesized tonal ramps are preview extensions, not application tokens. Source cascade inspection is not a runtime computed-style measurement. The 2026-10-18 accent extension is evidenced by desktop/test-output/color-themes-1792306215566/EVIDENCE.md and twelve final captures. Independent manual review disposition: ship. Both engine context and detector downloads for 0.1.14 failed; no automatic detector ran for this extension.

## Colors

Default Graphite is achromatic. Mist Blue (雾蓝), Clay (陶土) and Plum (梅紫) are optional accents; all retain the light shell, white reading surfaces and graphite text.

### Primary

- **Charcoal:** Primary actions and the floating add control. The historical accent variable resolves to Graphite by default and to the chosen accent for other themes.
- **Soft Charcoal:** Default primary hover feedback.
- **Mist Blue / Clay / Plum:** Optional primary, hover, soft-selection and keyboard-focus tokens, grouped by their frontmatter prefixes. Primary labels stay white; selected controls pair soft surfaces with accent ink.

### Neutral

- **Shell Gray:** Window background and compact navigation rail.
- **Workspace White:** Main work area, fields and floating menus.
- **Quiet Gray / Preview Gray:** Recessed tools, previews and knowledge surfaces.
- **Graphite / Secondary Gray:** Main text and supporting information.
- **Hairline Gray:** Pane boundaries and field outlines.
- **Selection Gray:** Current navigation, selected filters and collection rows.
- **Question White:** Question cards, with distinct hover and active outlines.

Warning ochre, error rose, destructive red and success green convey state. These remain independent of the chosen accent.

**The Restrained Accent Rule.** Indicate selection with the chosen soft fill, accent ink and border changes; keep ordinary reading surfaces neutral and preserve semantic state colors.

## Typography

**Body Font:** Segoe UI, Microsoft YaHei, sans-serif. The same local stack serves headings and interface labels. Mathematics uses the existing KaTeX font assets. There is no separate display-font role.

### Hierarchy

- **Headline:** Main page titles use the headline token; compact workspace titles reduce to (22px) inside the (800px) workspace container query.
- **Title:** Small section headings use the title token.
- **Body:** Generic and collection question content uses the body role. The more specific inherited masonry selector still produces (13px) library question text; both contexts use text weight (500) and line-height (1.85). KaTeX weight remains regular (400). The (13/15px) split is inherited specificity drift, not a preferred universal scale. The earlier intended (15px) treatment did not apply globally.
- **Label:** Supporting headings and metadata use the label role. Existing controls and management pages also retain (11–13px) UI text and some (10px) tags. These are observations, not a certified accessibility minimum or permission to shrink new reading content.
- **Statistic:** Counts use the statistic token and tabular numerals; question numbers also use tabular numerals.

**The Content Leads Rule.** Preserve hierarchy between question text and repeated metadata; avoid decorative English kickers and ornamental lettermarks.

## Layout

The application fills the desktop viewport beneath a (36px) draggable title bar. The fixed icon rail is (52px) wide with (36px) square controls and (8px) gaps. The white content shell has a fine boundary and the workspace radius. Preserve pane resizing, knowledge-tree behavior, proofreading and collection settings as functional structures.

The question grid is centered and bounded at (1120px). This reading limit does not constrain the editor or collection settings. Cards and grid columns use the group spacing step. Card text uses content padding, reducing horizontal padding to the group step in compact workspaces. Count/filter rows use workspace horizontal margins, reducing to content margins when the workspace container is at most (800px).

The library question list uses a natural single-column flex layout with (16px) gaps and a fixed (760px) reading width. Window resizing does not stretch question cards; narrow workspaces allow scrolling. Opening, switching, and closing question editors is immediate, with no reveal or content transition and no delayed close. Do not restore per-frame measurement, one-pixel grid tracks, width animations, or editor fades.

Main title padding is (27px) above and (23px) below, reducing to (20px) and (18px) at window heights of at most (760px). Existing editor layout changes at viewport widths of (1250px).

The shipped Electron window enforces a minimum (1024 × 700px). Authoritative compact evidence is (1024 × 720px); a requested (1000px) width is clamped. Wide evidence uses (1440 × 940px). Do not represent narrower CSS-only states as supported desktop window geometry.

## Elevation & Depth

Tonal layering and fine borders separate normal surfaces. Question cards, selected navigation and settings containers remain flat. Floating menus, add controls and reveal layers use soft ambient shadows. The shared shadow is `0 8px 28px #0000000a`; filter menus use `0 8px 24px #00000014`; the floating add control uses `0 6px 20px #00000016`.

**The Flat Rest Rule.** Keep resting content surfaces flat; use ambient elevation to explain floating placement.

## Shapes

Controls use gently curved control corners. Tags are tighter, navigation buttons slightly softer, panels and menus broader, and question cards and the work area broadest. Keep thin outlines subordinate to content. Existing circular add and progress elements retain their functional silhouettes; the system does not prohibit native circular controls.

## Components

### Buttons

Filled primary actions use white text and current accent tokens; unprefixed component tokens describe default Graphite. Secondary actions use white or subtle neutral surfaces. Quiet header tools are transparent at rest and show neutral hover fills. Repeated card review actions use soft neutral fill with dark text; this contextual treatment does not replace the global primary button.

Ordinary buttons translate down (1px) when pressed and reduce opacity to (0.5) when disabled. Background changes use (150ms); press transforms use (120ms). Keyboard focus uses a (2px) outline in the current accent focus color with a (3px) offset; rail controls retain their specific (2px) offset. Reduced motion collapses theme animation and transition durations to (0.01ms).

### Chips

Ordinary grade and knowledge tags share neutral fill and secondary text. Warning and error tags retain semantic colors. Interactive tags strengthen the neutral fill on hover and selection. Retained compact tag text is not a preferred body-reading size.

### Cards / Containers

Question cards use the card radius, fine resting outline and no shadow. Hover changes the surface to preview gray and strengthens the outline; active cards strengthen it further. Header padding is (15px 20px 0); text padding is (18px 20px); footer padding is (0 16px 13px 20px). The theme removes internal header/footer rules. Cards retain keyboard focus and real action controls. The sidecar illustrates the generic body role, not the inherited masonry size exception.

### Inputs / Fields

White fields use a hairline border, control radius and input component padding. Placeholders use secondary gray. Focus shifts the border to the current accent focus color without a glow; keyboard focus retains a visible outline. Textarea line-height remains (1.6).

### Navigation

Hovering the library rail button only highlights the control; it never opens a knowledge sidebar or hover preview. The title-bar sidebar toggle explicitly opens and closes the library knowledge panel. Preserve navigation and focus behavior independently of hover.

The compact rail uses inline vector icons, accessible names and tooltips. Inactive items use secondary gray; hover and current items use the chosen soft accent surface and accent ink. Navigation color transitions use (180ms ease).

### Theme Choices

Settings → Appearance offers four native radio choices with color swatches and (44px) minimum targets. Selection applies immediately and persists independently of API settings. Incomplete API drafts remain intact; saving API settings preserves the accent. Unknown stored IDs fall back to Graphite. LIGHT mode remains fixed regardless of OS appearance.

### Mathematical Question Content

Retain formula layout, wrapping and overflow handling. Keep local KaTeX fonts and regular mathematical weight. Preserve source comparison and proofreading panes alongside the question flow.

The first mobile photo import surface extends the same neutral palette and curved control language. Keep incoming-photo preview and removal distinct from the explicit desktop recognition action. Connection, expiry, upload and retry states must use clear text and existing semantic colors; this extension introduces no new visual identity. Native mobile camera/album behavior and actual LAN compatibility remain outside the completed visual validation.

## Do's and Don'ts

### Do:

- **Do** use the neutral shell, white workspace and soft question surfaces together.
- **Do** preserve content hierarchy, visible keyboard focus and reduced-motion behavior.
- **Do** use semantic color for actual warnings, errors, destructive actions and success states.
- **Do** verify wide and compact desktop windows with real mathematics and populated collections.

### Don't:

- **Don't** restore the rejected paper-white and green identity or generic direction prototypes.
- **Don't** introduce decorative English kickers, ornamental lettermarks or decorative selection bars unrelated to the chosen accent.
- **Don't** apply the question-grid width limit to editing or collection-setting panes.
- **Don't** claim an exact Codex clone, automated detector extraction or full accessibility certification from this visual record.
