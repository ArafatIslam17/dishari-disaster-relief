# Design system: "Signal"

Replaced on 2026-11-22 by the UI redesign. `DESIGN.md` at the repository root is the visual system in DESIGN.md form; this file holds the working detail. The tokens live in `apps/web/src/styles/tokens.css`, the base and component styles in `apps/web/src/styles/app.css`, and the shared components in `apps/web/src/ui/kit.tsx`.

## Where it came from

1. **Reference DESIGN.md: IBM (Carbon), from VoltAgent/awesome-design-md.** It was chosen over Linear, Mercury, Stripe, Wise and Sentry because it is built for dense operational data (DECISIONS U2). Only its structure is borrowed: flat tiles, 1 px hairline elevation, a 4 px grid, one assertive accent, filled inputs with a bottom rule and a 2 px focus underline, sentence-case labels, and density by design. IBM's name, Plex type and blue are not used.
2. **Impeccable direction (`concept-seed`, seed `seed:1a012f43aa84e522`).** The roll assigned candidate 3, Bangladesh's port cyclone-warning signals: a public system where shape carries meaning. That became the signature: every data state has a geometric **signal mark** (below). The direction contract is in `apps/web/.impeccable/surfaces/src.md`.
3. **The brief's pins:** Roboto Flex and Baloo Da 2, self-hosted; an ink-teal base with one warm accent (marigold); tinted OKLCH neutrals; light and dark themes; status never by colour alone.
4. **Secondary checks:** ui-ux-pro-max's accessibility rules (4.5:1 text contrast, 44/48 px targets, visible focus, reduced motion) and frontend-design's warning against templated defaults.

## Taste dials

The installed Taste Skill (`design-taste-frontend` 2.5.1) has no dials. Its upstream changelog names them from v1/v2: `DESIGN_VARIANCE`, `MOTION_INTENSITY` and `VISUAL_DENSITY`, on a 1–10 scale (DECISIONS U4). They are set per surface:

| Surface | DESIGN_VARIANCE | MOTION_INTENSITY | VISUAL_DENSITY | What it means here |
|---|---|---|---|---|
| Field app (phone, outdoors, one hand) | 5 | 2 | 3 | One column; 48 px targets; one marigold action per screen; 56 px list rows; state transitions only (press, toast, sync spin). |
| Coordination dashboard (desktop, many rows) | 5 | 2 | 8 | Condensed table type (`font-stretch` 92%), 10 px cell padding, sticky headers, a summary strip instead of cards, queue counts in the rail; no entrance motion. |
| Login, onboarding and empty states | 7 | 4 | 5 | Split frame: an ink panel with the product promise and the signal legend, and the form on paper. The form's children rise 6 px on load (240 ms, staggered by 40 ms). They move but never fade in from transparent, so the screen still shows its content if the animation never runs (FINDINGS F52). Empty states get a drawn mark, a line, a sentence and an action. |

`MOTION_INTENSITY` stays at 4 or below everywhere, so no surface claims motion it doesn't ship, and every animation has a reduced-motion path. The 2.5.1 controls map to `data-radius="sharp"` (its rule for fintech and developer tools: 2 px here) and `data-motion` default (never `live`).

## Colour (OKLCH, light and dark)

Strategy: restrained. Cool neutrals tinted toward the teal hue, an ink-teal shell (the dashboard rail and the field status bar), and one marigold "hoist". Status colours appear only on status. Dark theme: the ground drops to L 0.185, surfaces step up by about 0.04, text rises to L 0.95, and status hues keep their angle with lightness raised to about 0.8 on dark tints. The theme follows `prefers-color-scheme` unless the user picks light or dark; the toggle sits in the field status bar, the dashboard top bar and the public pages, and the choice is stored per device (`relief.theme`).

| Token | Light | Use | Measured contrast (light / dark) |
|---|---|---|---|
| `--ink` | `oklch(0.235 0.035 222)` | text | 15.3 / 16.1 on paper |
| `--ink-2` | `oklch(0.42 0.03 220)` | secondary text | 7.7 / 10.7 on paper |
| `--ink-3` | `oklch(0.50 0.026 220)` | placeholders, tertiary | 5.5 / 7.6 on paper |
| `--paper`, `--surface`, `--surface-2`, `--surface-3` | L 0.972 / 0.995 / 0.948 / 0.915, hue 205 | ground, tiles, filled inputs and hover, pressed | — |
| `--line` / `--line-strong` | L 0.885 / 0.60 | hairlines / control boundaries | line-strong 3.9 / 3.7 on surface (≥ 3:1) |
| `--shell` | `oklch(0.255 0.045 218)` | rail, status bar | on-shell text 14.4 / 17.1 |
| `--teal` | `oklch(0.42 0.08 205)` | primary button, links | 7.5 / 9.7 on paper; on-teal text 7.9 / 9.7 |
| `--marigold` | `oklch(0.81 0.155 76)` | the hoist: field primary action, pending counts, current marker | on-marigold text 9.0 / 10.1 |
| `--focus` | `oklch(0.50 0.13 220)` | focus rings | 5.1 / 10.4 on paper |
| `--served` | `oklch(0.46 0.11 155)` | fully served, synced | 5.9 / 8.1 on its tint |
| `--partly` | `oklch(0.50 0.105 62)` | partly served | 5.4 / 8.0 on its tint |
| `--unserved` | `oklch(0.51 0.175 27)` | not served, failed, errors | 5.4 / 6.6 on its tint |
| `--norecords` | `oklch(0.47 0.02 245)` | no records, neutral | 5.8 / 7.3 on its tint |
| `--pending` | `oklch(0.50 0.11 70)` | pending, waiting to sync, warnings | 5.4 / 8.3 on its tint |
| `--conflict` | `oklch(0.48 0.15 340)` | conflict | 6.2 / 7.1 on its tint |
| `--duplicate` | `oklch(0.47 0.12 255)` | possible duplicate, linked | 5.9 / 7.6 on its tint |

`node apps/web/scripts/contrast.mjs` recomputes all 44 pairs per theme from the token file and exits non-zero on any failure. Current result: all pairs pass WCAG 2.2 AA in both themes.

## Signal marks (status never by colour alone)

Drawn as 12 px SVG in `currentColor` (`StatusMark` in `ui/kit.tsx`), always next to a word:

| State | Mark | Where |
|---|---|---|
| Fully served | filled square | coverage chips, coverage bar legend |
| Partly served | square outline with the lower-left half filled | coverage |
| Not served | hollow ring | coverage |
| No records | dashed bar, dashed chip border | coverage (never looks served) |
| Pending / waiting | hollow diamond | sync chip, outbox rows, pending approvals |
| Synced / approved / resolved | filled square with a knocked-out check | sync chip, status tags |
| Failed / rejected / voided | filled square with a knocked-out cross | sync chip, outbox rows, status tags |
| Conflict | two triangles meeting | conflict queue, status tags |
| Possible duplicate / linked | two overlapping rings | duplicate queue, similar households |

## Typography

- **Latin and UI: Roboto Flex Variable** (`@fontsource-variable/roboto-flex` 5.3.0, the "standard" axes wght 100–1000, wdth 25–151, opsz 8–144, Latin subset only, 250 KB woff2).
- **Bangla: Baloo Da 2 Variable** (`@fontsource-variable/baloo-da-2` 5.3.0, wght 400–800, Bengali subset only, 90 KB woff2). The stack `'Roboto Flex Variable', 'Baloo Da 2 Variable', system-ui` sends Bengali code points to Baloo Da 2 by `unicode-range`, so no Bangla glyph falls back to a system font.
- Both are declared with our own `@font-face` (`font-display: swap`) in `tokens.css`, emitted by Vite as hashed assets, precached by the service worker and preloaded from `index.html` in production. There are no runtime requests to Google Fonts or a CDN.
- **Scale** (fluid where it helps reading, fixed for UI chrome): xs 0.78 rem · sm 0.875 · base 1 · md 1.125 · lg clamp(1.3–1.45) · xl clamp(1.55–1.9) · 2xl clamp(1.9–2.5) · figure clamp(1.9–2.4).
- **Headings:** weight 640, `opsz` 28–60, tracking −0.018 em, `text-wrap: balance`. **Body:** 400, line height 1.55, tracking +0.005 em (Carbon's small positive body tracking).
- **Bangla:** line height 1.72 (headings 1.35), tracking 0, headings at 600; chip and table-header sizes go up one step so conjuncts stay legible.
- **Data:** tables at `font-stretch: 92%` (condensed), tabular numerals, right-aligned figures. **Summary figures:** weight 300 at `opsz` 72, tabular. **Short codes:** wide axis (112%), weight 560, tracking 0.06 em, no monospace costume.

## Space, shape, depth, motion, layers

- Space: 4 px base: `--s1` 4 · `--s2` 8 · `--s3` 12 · `--s4` 16 · `--s5` 24 · `--s6` 32 · `--s7` 48 · `--s8` 64.
- Radius: `--r-1` 2 px (controls, tiles, chips), `--r-2` 4 px (dialogs, toasts); pills only for count badges.
- Elevation: 0 flat; 1 hairline border; 2 the surface-2 fill; 3 `--shadow-float` (an offset, soft, ink-tinted shadow) for dialogs, toasts and the drawer only.
- Motion: `--dur-1` 120 ms (micro), `--dur-2` 180 ms, `--dur-3` 240 ms; ease `cubic-bezier(0.2, 0.7, 0.2, 1)`. Used for button press, hover fills, toast and dialog entry, the drawer slide, the sync chip's spin while syncing, the skeleton pulse, and the public form's one entrance. Under `prefers-reduced-motion: reduce`, all animation stops and only colour and opacity transitions remain.
- Layers: sticky 20 · rail 30 · bars 40 · drawer 50 · toast 60 · dialog 70 · skip link 80.
- Targets: 44 px minimum on the dashboard, 48 px in the field (steppers, list rows 56 px, bottom bar 56 px, hoist 76 px).

## Components (`ui/kit.tsx`, `layouts.tsx`)

`PageHead` (back link, h1, actions, lead) · `StatusMark` · `CoverageChip` · `StatusTag` · `Notice` (full border, tint and icon; never a side stripe) · `Empty` (mark, h2, sentence, action) · `Loading` (skeleton rows, `role=status`) · `ErrorState` (message and retry) · `TextField`, `SelectField`, `Stepper` (filled, underline focus, inline error with icon) · `Segmented` (filters as pressed buttons, not fake tabs) · `LangSwitch` (full and compact) · `ThemeToggle` · toasts (polite region for outcomes, assertive for errors, dismissible, above the bottom bar on phones and bottom-right on desktop) · `useConfirm` (native `<dialog>`: focus trap, Escape, focus returns to the trigger, danger tone, optional reason) · field shell (ink status bar with network state, sync chip with signal mark, pending count and last-sync time, compact language and theme toggles, and a polite announcement of every sync result; bottom navigation with the marigold centre action) · dashboard shell (ink rail with icons, groups and queue counts, sticky top bar with the operation selector, a drawer below 64 rem with scrim, Escape and focus management).

Tables use `.stack-table` below 48 rem: each row becomes a labelled block (`data-label` per cell), so nothing scrolls sideways on a phone.

## Icons

One set: Lucide, stroke 1.75 (set globally in CSS), sizes 16 (inline), 18 (navigation, buttons), 20–22 (field), 24 (hoist). No emoji or Unicode glyphs as icons. The signal marks are the only custom drawings.
