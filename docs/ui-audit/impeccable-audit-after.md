# Impeccable audit: P6 final (`/impeccable audit apps/web`)

Run 2026-11-22 after the Signal redesign and the P6 fixes, against the same matrix as the baseline (`impeccable-audit-before.md`). The detector ran in two ways: `impeccable detect apps/web/src` on the source, and a live scan of each of the 110 captured route states (`ui-capture.mjs --detect`, English and Bangla, five widths). Rendered checks: axe, console, failed requests and overflow from the same capture. Lighthouse 12.8.2 on the production build (`lighthouse.json`).

## Audit Health Score

| # | Dimension | Score | Key Finding |
|---|-----------|-------|-------------|
| 1 | Accessibility | 4 | 0 axe violations on 110 route states; Lighthouse Accessibility 100 on all 5 audited pages; every colour pair passes AA in both themes |
| 2 | Performance | 3 | Field, review and admin pages are lazy chunks of 31–32 KB, and Lighthouse Performance is 96–100. The entry chunk still carries Dexie and the crypto code for dashboard users (221 KB gzip). |
| 3 | Theming | 4 | Every colour is an OKLCH token, with no hex or rgb outside `tokens.css`. Dark theme with a system default and a toggle; `color-scheme` and `theme-color` follow it. |
| 4 | Responsive Design | 4 | 0 px horizontal overflow at 360, 390, 768, 1024 and 1440 on every route. Tables stack below 48 rem. Field targets are 48 px; the smallest dashboard target is 32 px (above WCAG 2.5.8's 24 px). |
| 5 | Implementation Integrity | 4 | 0 live detector hits on 110 states. One source hit, `overused-font` on Roboto Flex, is waived because the brief pins the font (DECISIONS U10). |
| **Total** | | **19/20** | **Excellent** |

## Implementation Integrity Verdict
**Pass.** The system has one idea and carries it through: a shape means a state, borrowed from the cyclone-warning signals. Nine states have their own mark and word (`StatusMark`), in chips, the sync chip, the outbox, coverage rows and the login legend. The marigold hoist appears once per screen. The detector's 19 baseline hits (repeating stripes, side tab, nested cards, skipped headings, cramped padding, stragglers) are all gone on the live pages. Two of them needed a second fix in P6: the list inset (F08) and the two-line button padding (F53).

## Executive Summary
- Audit Health Score: **19/20** (Excellent), up from 11/20.
- Issues: P0 0 · P1 0 · P2 1 · P3 2.
- Fixed in P6 before scoring: F51 (duplicate landmark names), F52 (sign-in screens blank wherever the entrance animation didn't run), F08 (list inset), F53 (cramped two-line buttons), and the lock-time format.
- Next steps: none block release. The remaining items are below.

## Detailed Findings by Severity

**[P2] Entry chunk carries the offline store for every role**
- Location: `apps/web/src/router.tsx` and the layout imports, entry `index-*.js` (720 KB, 221 KB gzip).
- Category: Performance
- Impact: dashboard users on slow links download Dexie and the vault code they never use. Measured impact is small (desktop Performance 100), but a 3G tablet would feel it.
- Recommendation: load the store behind the field layout only, which means splitting `apps/web/src/local/store.ts` so the shells don't import it.
- Suggested command: /impeccable optimize

**[P3] No unsaved-changes guard on the household form**
- Location: `apps/web/src/pages/field.tsx`, `NewHouseholdPage`.
- Category: Implementation Integrity (WDG Forms)
- Impact: leaving mid-entry drops four fields of input. Deferred because a guard is new behaviour (DECISIONS U15).
- Suggested command: /impeccable harden

**[P3] Lighthouse Best Practices 96**
- Location: all audited pages; the `inspector-issues` and `bf-cache` audits.
- Category: Performance
- Impact: none visible. Not investigated further.
- Suggested command: /impeccable optimize

## Patterns & Systemic Issues
- None systemic remain. The one repeat pattern found in P6 was the same kind in two places: a later rule resetting an earlier one (`.list` padding over `.panel`, `.btn` block padding at zero). Both were fixed at the rule.

## Positive Findings
- Status is never colour alone: a mark, a word and a tint, readable in sun and in greyscale.
- Bangla is a first-class layout: Baloo Da 2 with its own line height. The status bar stays one row at 360 px in Bangla (e2e F14).
- Every destructive action asks in the app's own dialog; errors are assertive, outcomes polite.
- Offline is truthful: the PWA reload test renders the login page with the network off; the sync chip shows the pending count and last sync time.
- Regression tests guard the findings (unit `ui-regressions`, e2e `ui.desktop` and `field.mobile`).

## Recommended Actions
1. **[P2] `/impeccable optimize`**: move the offline store out of the entry chunk so dashboard-only roles skip it.
2. **[P3] `/impeccable harden`**: add a leave-form guard to the household form if the product owner wants one.
3. **[P3] `/impeccable polish`**: after either change, re-run the capture and Lighthouse.
