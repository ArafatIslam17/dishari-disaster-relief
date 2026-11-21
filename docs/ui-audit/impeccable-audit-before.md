# Impeccable audit: P1 baseline (`/impeccable audit apps/web`)

Run 2026-11-22 on every route of the field app, the dashboard and the public pages. Detector: `impeccable detect` on the source (`apps/web/src`) plus a live scan of each of the 110 captured route states through the debugging port (`--cdp`), in English. Rendered checks came from `apps/web/scripts/ui-capture.mjs`.

## Audit Health Score

| # | Dimension | Score | Key Finding |
|---|-----------|-------|-------------|
| 1 | Accessibility | 3 | Household detail pages have no h1; empty states skip heading levels; filters use `tablist` without tabs; destructive actions without confirmation |
| 2 | Performance | 2 | One 786 KB JS bundle for every role and route; legacy .woff precached; no font preload |
| 3 | Theming | 1 | Hex tokens only; no dark theme, no `color-scheme`; inline styles in pages |
| 4 | Responsive Design | 2 | Tables scroll sideways at 360–768 hiding status; dashboard header stacks 5 rows; field status bar wraps 5 lines in Bangla |
| 5 | Implementation Integrity | 3 | Side stripe and repeating-stripe decoration on the household card; identical icon tile grid on the field home; nested cards |
| **Total** | | **11/20** | **Acceptable (significant work needed)** |

## Implementation Integrity Verdict
**Fail, partially.** The system has a point of view: the household card as a signature object, shape plus text on coverage chips, and outdoor legibility. But it expresses that through a striped "hazard tape" bar the detector flags as decoration (side-tab, repeating-stripes-gradient on 7 captures). The field home falls back to the category default of identical icon tiles, and the shape language stops at the four coverage labels instead of covering every state the product has (pending, synced, failed, conflict, duplicate).

## Executive Summary
- Audit Health Score: **11/20** (Acceptable)
- Issues: P0 0 · P1 11 · P2 22 · P3 11 (44 in docs/ui-audit/FINDINGS.md)
- Top issues: no dark theme and untokenised colour (F17, F20); dashboard unusable at 360–768 because of the header stack and sideways tables (F11, F12); field status bar eats the screen in Bangla (F14); a single 786 KB bundle (F33); a 401 console error on every public page (F01).
- Next steps: build the token system with dark mode and the signal marks (`/impeccable colorize`, `/impeccable typeset`), then shell and table adaptation (`/impeccable adapt`, `/impeccable layout`), then hardening of states and errors (`/impeccable harden`, `/impeccable onboard`), then `/impeccable optimize` for code-splitting, finishing with `/impeccable polish`.

## Detailed Findings by Severity
P1: F01, F03, F10, F11, F12, F14, F17, F20, F33, F43; plus F44 counted with the a11y P2s. P2: F04–F09, F13, F15, F16, F18, F19, F21–F26, F28–F32, F41, F44. P3: F02, F27, F34–F40, F42. Each entry in FINDINGS.md gives location, impact and the fix.

## Patterns & Systemic Issues
- Colour lives in hard-coded hex with no themable layer, so dark mode is impossible without a token rewrite.
- Layout spacing is patched with inline styles in about 15 places across the page modules.
- Tables have no narrow-screen pattern anywhere (9 tables).
- State vocabulary is incomplete: the four coverage chips have shapes, but the other five states are tint plus text only.

## Positive Findings
- Every form control has a visible label; error text is tied with `aria-describedby`.
- A skip link on both shells; `aria-live` toasts; native `<dialog>` for confirmation.
- Coverage chips already pair a shape with text; "no records" never looks served.
- Bangla is the default; numbers and dates go through `Intl`.
- No horizontal page overflow at any audited width.

## Recommended Actions
1. **[P1] `/impeccable colorize`**: OKLCH token system, light and dark, contrast-checked status palette.
2. **[P1] `/impeccable adapt`**: dashboard header and stacked tables at 360–768; compact field status bar.
3. **[P1] `/impeccable harden`**: h1 on detail pages, confirmation on destructive actions, 401-free session boot, error and empty states.
4. **[P1] `/impeccable optimize`**: route code-splitting, font subsetting and preload.
5. **[P2] `/impeccable typeset`**: Roboto Flex and Baloo Da 2 with axes, fluid scale, tabular figures.
6. **[P2] `/impeccable layout`**: field home hierarchy, review-pair comparison, table density.
7. **[P2] `/impeccable onboard`**: login and onboarding frame, designed empty states.
8. **[P3] `/impeccable polish`**: final pass.
