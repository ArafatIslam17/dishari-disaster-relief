# Design system

## Where this came from

1. **ui-ux-pro-max** (`--design-system`, query "humanitarian field operations offline data dashboard", density 7) returned *Data-Dense Dashboard* with navy and blue, an amber accent, and Fira Code with Fira Sans. Its rules are kept: 4.5:1 contrast minimum, 44 px touch targets, visible focus, reduced motion, tables before cards, filters on every list, SVG icons and no emoji.
2. **frontend-design review.** Its palette and fonts are the generic analytics default and would fit any SaaS console, so both were replaced with choices drawn from the subject:
   - Volunteers work outdoors in flood water, in strong sun, often one-handed.
   - They copy a short code by hand onto a card.
   - Coordinators read a coverage ledger that must never make an empty area look served.
3. **Hallmark (app-screen scope).** The theme supplies only palette, type and surfaces. The shell is a plain top bar and a bottom action bar on the phone, and a sidebar on the dashboard because it has more than 7 destinations; the sidebar collapses under 60 rem. Every data region has loading, empty, error and full states. State lives in the URL. Motion is state only.

**Signature object: the household card.** The 9-character short code is set large in Atkinson Hyperlegible Mono, in three groups (`K7M 4QX 9TC`), on a stamped card. A volunteer reads it aloud and copies it onto the family's paper card. This is the one memorable element; everything around it stays quiet.

## Colour tokens (`apps/web/src/styles/tokens.css`)

Light only, chosen for outdoor legibility. Every pair below was checked against WCAG 2.2 AA.

| Token | Hex | Use | Contrast |
|---|---|---|---|
| `--ink` | `#10202A` | body text, icons | 15.9:1 on paper |
| `--paper` | `#F3F6F5` | app background (cool, never cream) | n/a |
| `--surface` | `#FFFFFF` | panels, inputs | n/a |
| `--muted` | `#4A5A63` | secondary text | 6.8:1 on paper |
| `--line` | `#C5D0D4` | borders, rules | decorative |
| `--river` | `#0E5A66` | primary actions, links, selection | 7.4:1 with white |
| `--river-strong` | `#08434C` | pressed and hover | 10.3:1 with white |
| `--marigold` | `#F2B705` | the one high-visibility action per field screen (Save, Sync now), always with ink text | 10.1:1 with ink |
| `--served` / `--served-bg` | `#1B6B3A` / `#DDEFE3` | Fully served | 5.9:1 |
| `--partly` / `--partly-bg` | `#7A4600` / `#FBE8C7` | Partly served | 6.5:1 |
| `--unserved` / `--unserved-bg` | `#A3241A` / `#FBE3E0` | Not served, errors | 6.3:1 |
| `--norecords` / `--norecords-bg` | `#47555D` / hatched `#E6EBED` | No records, which is never green or amber | 7.0:1 |
| `--offline` | `#7A4600` | offline banner | 6.5:1 on partly-bg |

Colour never carries meaning alone. Every coverage chip also has its text label and a distinct shape: a filled dot for served, a half dot for partly, a ring for not served and a dash for no records.

## Type

- **Atkinson Hyperlegible** for all Latin UI text. It was designed for low-vision readers and keeps 0/O and 1/l/I distinct.
- **Noto Sans Bengali** for Bangla, through the same font stack (`"Atkinson Hyperlegible", "Noto Sans Bengali", system-ui, sans-serif`), so mixed strings render without switching classes.
- **Atkinson Hyperlegible Mono** only for short codes and phone numbers, where mono is the material.
- All fonts are bundled through `@fontsource` and precached by the service worker, so they work offline.
- Scale, ratio 1.2 with a 16 px base, which is 17 px on the field app: 13.3 / 16 / 19.2 / 23 / 27.6 / 33.2 px. Line height is 1.5 for body and 1.2 for headings. Headings use one weight (700) and one colour.
- Labels are sentence case and untracked. There are no all-caps eyebrows.

## Space, size, shape

- Spacing steps: 4, 8, 12, 16, 24, 32, 48.
- Field controls are 48 px tall, dashboard controls 40 px, and every hit target is at least 44 × 44 px.
- Radius: 6 px for controls, 10 px for panels, 14 px for the household card. Panels sit on the paper background; there are no cards inside cards.
- Containers: the field app is capped at 36 rem and centred; the dashboard content is capped at 88 rem.

## Components

`Button` comes in primary (river), signal (marigold, at most one per field screen), quiet and danger variants, each with a visible `:focus-visible` ring (3 px `--river` with a 2 px offset). The other components are `Field` (visible label, help text, inline error with `aria-describedby`), `Select`, `Toggle` (consent and GPS), `Stepper` (quantities and family size, 48 px buttons), `DataTable` (sticky header, row headers), `CoverageChip`, `ShortCode`, `StatusBar`, `EmptyState`, `ErrorState`, `Skeleton`, `ConfirmDialog` (native `<dialog>`) and `Toast` (`aria-live="polite"`).

## Field app rules (NFR19)

- One-handed use: primary actions sit in the bottom bar (Home, Search, New household, Sync) within thumb reach. The bar has 4 items, below the limit of 5.
- The status bar is always visible. It shows online or offline, the pending count and the last sync time (FR13).
- Registration fits on one screen: consent, name, mobile, family size and ward. A similar-household warning appears inline before saving (FR09).
- Long tasks never block input. Saving responds in under 100 ms and is confirmed with a toast and the short-code card.

## Accessibility checklist (WCAG 2.2 AA)

Contrast as tabled above. Keyboard reachable in DOM order with a skip link. Focus is never obscured by the bottom bar (scroll padding). Target size of 44 px or more. No drag-only interactions. Error identification sits next to each field. Language is set on `<html lang>` and switches with the UI. `prefers-reduced-motion` disables all transitions. Status changes are announced through a live region. Authentication does not require a cognitive test, and paste is allowed in password fields.
