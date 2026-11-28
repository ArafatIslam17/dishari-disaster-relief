---
version: 1
name: Relief Coordination — Signal
reference: "Adapted from the IBM (Carbon) DESIGN.md in VoltAgent/awesome-design-md (design-md/ibm/DESIGN.md). Structure and principles borrowed; no IBM name, logo, typeface or colour is used."
description: "A flat, engineered operations system for offline relief work. Cool tinted paper, a deep ink-teal shell, one marigold hoist colour, hairline tiles with near-square corners, filled inputs that underline on focus, and a set of geometric signal marks that carry every data state by shape as well as colour. Roboto Flex for everything Latin, Baloo Da 2 for Bangla."

colors:
  # Light theme. All values OKLCH; the CSS custom properties in apps/web/src/styles/tokens.css are the source of truth.
  paper: "oklch(0.972 0.007 205)"        # page ground
  surface: "oklch(0.995 0.003 205)"      # tiles, tables, dialogs
  surface-2: "oklch(0.948 0.011 205)"    # filled inputs, row hover, quiet bands
  line: "oklch(0.885 0.013 210)"         # hairline borders
  line-strong: "oklch(0.58 0.022 215)"   # control boundaries (>= 3:1 on surface)
  ink: "oklch(0.235 0.035 222)"          # text
  ink-2: "oklch(0.42 0.03 220)"          # secondary text
  ink-3: "oklch(0.50 0.026 220)"         # tertiary text, placeholders (>= 4.5:1 on paper)
  shell: "oklch(0.255 0.045 218)"        # dashboard rail, field status bar
  teal: "oklch(0.42 0.08 205)"           # primary actions, links, selection
  teal-strong: "oklch(0.34 0.072 208)"   # pressed / hover primary
  teal-tint: "oklch(0.935 0.028 200)"    # selected row, active nav on light
  marigold: "oklch(0.81 0.155 76)"       # the hoist: field primary action, pending counts, current tab
  marigold-strong: "oklch(0.75 0.16 68)"
  ok-on-shell: "oklch(0.82 0.13 155)"     # synced mark on the ink shell
  bad-on-shell: "oklch(0.78 0.14 30)"     # failed mark on the ink shell
  status:
    served: "oklch(0.46 0.11 155)"
    partly: "oklch(0.50 0.105 62)"
    not-served: "oklch(0.51 0.175 27)"
    no-records: "oklch(0.47 0.02 245)"
    pending: "oklch(0.50 0.11 70)"
    synced: "oklch(0.46 0.11 155)"
    failed: "oklch(0.51 0.175 27)"
    conflict: "oklch(0.48 0.15 340)"
    duplicate: "oklch(0.47 0.12 255)"
  dark-theme: "Redefined under [data-theme=dark] and prefers-color-scheme: dark. Ground oklch(0.185 0.02 220), surface 0.222, ink 0.95; status hues kept, lightness raised to ~0.80 with 0.29 tints."

typography:
  latin: "Roboto Flex Variable (wght 100–1000, wdth 25–151, opsz 8–144), self-hosted via @fontsource-variable/roboto-flex, Latin subset only"
  bangla: "Baloo Da 2 Variable (wght 400–800), self-hosted via @fontsource-variable/baloo-da-2, Bengali + Latin subsets"
  stack: "'Roboto Flex Variable', 'Baloo Da 2 Variable', system-ui, sans-serif — Bengali code points fall through to Baloo Da 2 by unicode-range"
  scale: "Fluid clamp() steps on a 1.2 ratio: xs 0.78rem, sm 0.875rem, base 1rem, md 1.125rem, lg clamp(1.3–1.45rem), xl clamp(1.55–1.9rem), 2xl clamp(1.9–2.5rem)"
  headings: "wght 640, opsz = size (auto), letter-spacing -0.018em, text-wrap: balance"
  body: "wght 400, line-height 1.55 Latin / 1.7 Bangla, letter-spacing 0.005em (Carbon's small positive body tracking)"
  data: "Tables: wdth 88 (slightly condensed), tabular-nums, right-aligned figures"
  figures: "Summary figures: wght 300, opsz 72, tabular-nums — the light display weight Carbon uses, applied only to numbers"
  code: "Short codes: Roboto Flex at wdth 112, wght 560, letter-spacing 0.08em, tabular; no monospace costume"

spacing: "4px base. Tokens --s1 4 · --s2 8 · --s3 12 · --s4 16 · --s5 24 · --s6 32 · --s7 48 · --s8 64"
rounded: "--r-1 2px controls and tiles, --r-2 4px dialogs and toasts, 999px only for count badges"
elevation:
  "0": "flat on paper"
  "1": "1px hairline border (tiles, inputs, tables)"
  "2": "surface-2 fill (hover, quiet band)"
  "3": "0 8px 24px -6px shadow tinted from ink — dialogs, toasts, the mobile nav drawer only"
motion: "Tokens in tokens.css, rules in styles/motion.css, hooks in ui/motion.tsx. 160ms hover/press, 220ms menus, 280ms toasts/dialogs/indicator, 360ms drawer, 560ms page entrance, 820ms charts; 90ms stagger; 24px rise. Curves: --ease cubic-bezier(0.22, 1, 0.36, 1) to enter/settle, --ease-state (0.4, 0, 0.2, 1) for toggles, --ease-sheet (0.32, 0.72, 0, 1) for drawers, --ease-pop (0.34, 1.56, 0.64, 1) only for confirmations. Transform and opacity only. Reduced motion keeps colour/opacity changes, removes movement."
z: "base 0 · sticky 20 · rail 30 · bar 40 · drawer 50 · toast 60 · dialog 70 · skip 80"
---

# Relief Coordination — Signal

## Overview
Borrowed from Carbon: **flat geometry, hairline tiles, a 4 px grid, one assertive accent, filled inputs that draw a 2 px underline on focus, sentence-case labels, and density by design.** Changed for this product: the accent is marigold (a hoist, not a corporate blue), the shell is a deep ink-teal, corners keep a 2 px softness so outdoor phones do not read as hostile, and type is Roboto Flex with its width and optical-size axes doing real work.

The signature is the **signal mark**. Bangladesh's port cyclone signals mean something by shape. Here every data state has its own small geometric mark drawn in SVG, always paired with a text label:

| State | Mark | Colour role |
|---|---|---|
| Fully served | filled square | served |
| Partly served | square, lower-left half filled | partly |
| Not served | hollow ring | not-served |
| No records | dashed bar | no-records (never looks served) |
| Pending / waiting to sync | hollow diamond | pending |
| Synced | square with check | synced |
| Failed | square with cross | failed |
| Conflict | square split by a diagonal | conflict |
| Possible duplicate | two overlapping rings | duplicate |

## Colors
Restrained strategy: tinted cool neutrals plus marigold. The ink-teal shell gives the product its colour field (the dashboard rail and the field status bar), so screens are not grey with one accent. Marigold marks the one thing to do next: the field's primary action, the pending count, the current tab underline. Status colours appear only on status. Every text pair meets WCAG 2.2 AA (checked by `apps/web/scripts/contrast.mjs`).

## Typography
One family carries the Latin UI. Headings use a higher optical size and weight 640 with tight tracking; data tables run at width 88 so wards and counts fit; summary numbers use the light weight at a large optical size. Bangla runs in Baloo Da 2 with a taller line height (1.7) and a slight weight reduction so mixed lines balance.

## Layout
- Field (phones): one column, max 36rem, 16px gutters, sticky ink status bar on top, bottom navigation with the centre action hoisted in marigold, 48px minimum targets, primary action reachable by the thumb.
- Dashboard: ink rail 248px with grouped navigation and queue counts; top bar with the operation selector; content max 90rem. Tables are the primary surface: sticky header, condensed type, figures right-aligned; on narrow screens rows stack into labelled blocks.
- Public pages (login, registration, PIN): a split frame on wide screens (ink panel with the product promise and the signal legend, form on paper); a single column on phones.

## Elevation & depth
Carbon's hairline-first rule: tiles separate with 1px lines and the surface-2 fill, never drop shadows. Shadows exist only for things that float above the page (dialog, toast, drawer).

## Shapes
2px radius on controls and tiles, 4px on dialogs and toasts. Pills only for count badges.

## Components
- **Buttons:** primary (teal), hoist (marigold, one per screen), secondary (outlined), quiet (text), danger (outlined red). Min height 44px dashboard, 48px field. Press state darkens; focus ring 2px teal + 2px offset.
- **Inputs:** surface-2 fill, 1px line-strong bottom rule, 2px teal underline on focus; errors underline red and print the message below with an icon.
- **Status chip:** signal mark + label, tinted background, 1px border in the status colour.
- **Tables:** header row on surface-2, sticky; rows 44px; hover fill; numeric columns right-aligned and tabular.
- **Notices:** full border + tint + leading icon (never a single side bar).
- **Empty states:** a drawn signal mark, a one-line title, one sentence, one next action.
- **Toasts:** bottom on phones (above the bottom bar), bottom-right on desktop; announced politely; errors assertive.

## Motion
Motion explains a change of state or place; it never decorates and never makes anyone wait for data or an action.
- **Arrival:** a page's title focuses in (4px blur, 620ms) while its blocks rise 24px in reading order, 90ms apart, capped at 270ms. Groups (KPI tiles, dashboard columns, field stats) stagger their own children instead of moving as one. Shells (sidebar, top bar, field status bar, bottom bar) arrive once when a workspace opens, never on navigation. Skeletons wait 120ms, so fast answers never flash one.
- **Place:** one indicator travels to the current item (sidebar pill, field bottom-bar pill); the first placement and any resize snap, only navigation slides.
- **Data:** summary figures count up once, on first view (final value given to screen readers); later changes show at once. Bars grow from the baseline, donut slices draw, meters fill: once, as the data arrives. Blocks arriving below the fold rise when scrolled to.
- **Feedback:** toasts, dialogs, popovers and validation messages enter and leave on their own short curves; closing elements are inert at once. Counts and the sync mark pop (the only overshoot) when they appear or change.
- **Touch:** buttons and link cards press to 0.97–0.985; only cards that are links lift on hover (pointer devices), because a lift promises a click.
- **Loops:** only the live-map dot and the active-operation pin, both on the compositor.
- **Cost:** transform and opacity only; no blur behind animating content (the desktop rail is not frosted: it sits over the page gradient, where a blur changes no pixels but cost frames).

## Do
- Pair every colour with a mark and a word.
- Keep one hoist (marigold) action per screen.
- Right-align and tabularise every figure.
- Use sentence case everywhere.

## Don't
- No gradients, glass, glows, emoji icons, side-stripe cards or identical icon-card grids.
- No second accent colour; no purple-blue gradients.
- No monospace as decoration; short codes use Roboto Flex's wide axis.
- No motion that only decorates; nothing loops except the live signals; nothing animates while someone reads a figure.
