# UI redesign report

The "Offline-First Disaster Relief Distribution & Coordination System" got a full visual and UX overhaul plus a bug sweep, from 2026-11-21 to 2026-11-22. Behaviour, data model, API contracts and the sync protocol are unchanged. The defect fixes that touched code are listed in FINDINGS.md, and the decisions are in DECISIONS.md §7.

## What it became

**Signal**, a design system for a calm operations tool. It is named after Bangladesh's port cyclone-warning signals, a public system where a shape carries the meaning.

- **Reference:** the IBM (Carbon) DESIGN.md from VoltAgent/awesome-design-md, chosen over Linear, Mercury, Stripe, Wise and Sentry because it is the only one built for dense operational data (DECISIONS U2). It is adapted, not copied: no IBM name, mark or Plex type. See `DESIGN.md`.
- **Type:** Roboto Flex as a variable font (92 % width in tables; optical size 28–72 on headings; tabular figures) and Baloo Da 2 for Bangla through `:lang(bn)`. Both are self-hosted from Fontsource, woff2 only, Latin and Bengali subsets, preloaded and precached.
- **Colour:** OKLCH tokens with an ink-teal shell, tinted neutrals and one marigold "hoist" for the main action on each screen. Light and dark themes follow the system setting, with a manual toggle. `scripts/contrast.mjs` checks every pair in both themes against WCAG 2.2 AA (unit-tested).
- **Status:** nine states (served, partly served, not served, no records, pending, synced, failed, conflict, duplicate), each with its own geometric mark and a word.
- **Taste dials** (`DESIGN_VARIANCE` / `MOTION_INTENSITY` / `VISUAL_DENSITY`, 1–10): field app 5 / 2 / 3; dashboard 5 / 2 / 8; login, onboarding and empty states 7 / 4 / 5. The installed Taste Skill 2.5.1 has no dials, so the names come from its upstream changelog (DECISIONS U4).

## Before and after

### Rendered checks: 110 route states × 5 widths (360, 390, 768, 1024, 1440), English and Bangla, five roles plus public pages

| Check (pages affected, of 110) | Before | After |
|---|---|---|
| axe violations (WCAG 2.0/2.1/2.2 A and AA plus best practice) | 10 (page-has-heading-one 4, heading-order 6) | **0** |
| Console errors or warnings | 18 | 2 (expected, see below) |
| Failed requests | 18 (401 on every public page, F01) | 2 (expected, see below) |
| Horizontal overflow at any width | 0 | 0 |
| Impeccable detector hits on the live page | 19 (repeating stripes 7, cramped padding 4, nested cards 3, side tab 3, skipped heading 3, stragglers 3) | **0** |

The 2 remaining console and network entries are the deliberate 400 on `/invite/not-a-real-token` (English and Bangla): an invalid invite must be rejected, and the browser itself logs every 4xx. The page shows a designed error state (F02, accepted).

Raw data: `before/capture.json`, `after/capture.json`. Screenshots: `before/` and `after/`, organised as `<role>/<lang>/<width>/<route>.jpg` (550 per set).

### Lighthouse 12.8.2 (final production build, repeat visit; method in DECISIONS U13)

| Page | Form factor | Performance | Accessibility | Best practices | SEO | LCP | CLS | TBT |
|---|---|---|---|---|---|---|---|---|
| Login | mobile | 99 | 100 | 96 | 92 | 0.3 s | 0 | 130 ms |
| Field cold start (opens on PIN unlock) | mobile | 96 | 100 | 96 | 92 | 0.7 s | 0 | 220 ms |
| Dashboard: coverage | desktop | 100 | 100 | 96 | 92 | 0.2 s | 0 | 0 ms |
| Dashboard: duplicates | desktop | 100 | 100 | 96 | 92 | 0.3 s | 0 | 0 ms |
| Dashboard: operation setup | desktop | 100 | 100 | 96 | 92 | 0.2 s | 0 | 0 ms |

Every page clears the 90+ target for Performance, Accessibility and Best Practices. The audits below 90 are `inspector-issues` and `bf-cache` (Best Practices) and `robots-txt` (SEO). The app has no robots.txt because it is not meant for search engines. The two Best Practices items were not investigated further. No Lighthouse run exists from before the redesign, so there is no before column.

**PWA check** (Lighthouse 12 no longer has a PWA category, so the script checks the same things directly): manifest `display: standalone`, 192, 512 and maskable 512 icons, the service worker controls the page, and an offline reload renders the login page. **Pass.** Raw data: `lighthouse.json`.

### Bundle

| | Before | After |
|---|---|---|
| JavaScript | one 786 KB bundle for every role (F33) | entry 720 KB (221 KB gzip) with the shared libraries; field, review and admin pages in lazy chunks of 32, 31 and 32 KB (9, 7, 7 KB gzip) |
| Fonts | Atkinson Hyperlegible and Noto Sans Bengali, `.woff` and `.woff2` | Roboto Flex and Baloo Da 2 variable woff2, two preloaded |

### Audits

| Audit | Before | After |
|---|---|---|
| Impeccable `audit` | 11/20 Acceptable (`impeccable-audit-before.md`) | **19/20 Excellent** (`impeccable-audit-after.md`) |
| Web Design Guidelines (pinned rule set) | 46 `file:line` findings (`wdg-before.md`) | 0 open mechanical violations; 1 fixed in P6; 1 accepted (`wdg-after.md`) |

## Findings

53 defects were logged in `FINDINGS.md` (1 P0, 13 P1, 28 P2, 11 P3). 50 are fixed. One (F50) was fixed locally in the git-ignored `.env`. One (F02, the 400 on a bad invite) is accepted as correct behaviour. One (F10) turned out not to be a live defect, though the rail was still changed so captures show the page truthfully. Phase 6 found and fixed four that the earlier phases missed or got wrong:

- **F52 (P1):** the sign-in, PIN and unlock screens faded their content in from transparent. Wherever the animation didn't run, the phone layout painted nothing; Lighthouse reported "no first paint". The entrance now only moves.
- **F51:** two landmarks with the same name on operation detail and system admin (the last axe violations).
- **F08:** the list-panel inset that P2 thought it had fixed was overridden by a later rule.
- **F53:** two-line button labels touched the button edges.

## Highlights

- **Field app:** the five-line Bangla status bar became one row with the pending count and last sync (F14). The seven identical home tiles became one marigold action, a figures strip and grouped lists (F15). The consent text is set in Baloo Da 2 with tuned line height (F30). Confirmations use the app's own dialog, not the browser's (F25).
- **Dashboard:** the five-row phone header became one row (F11). Every table stacks into labelled rows below 48 rem instead of scrolling sideways (F12). The rail shows open counts for each review queue (F41). Duplicate review shows a meter per matching signal and marks the fields that differ (F21). Destructive actions ask first (F43).
- **Everywhere:** dark theme (F17); status marks for every state (F23); route code-splitting (F33); no 401 on first visit (F01).

## Tests

- `pnpm lint`, `pnpm typecheck`: clean.
- Unit tests: 114 pass (shared 38, API 58, web 18, including the UI-regression suite).
- Playwright e2e: 18 pass (the 12 existing scenarios plus 6 UI-regression tests for F01, F03/F04, F12, F14/F25, F17 and F43).

## Left open

- No unsaved-changes guard on the household form (P3; DECISIONS U15).
- Best Practices sits at 96 on every page because of the `inspector-issues` and `bf-cache` audits; not investigated further.
- The entry chunk still carries the shared libraries (React, the router, i18n, Dexie): 221 KB gzip. Moving Dexie and the crypto code out of the dashboard's path would need the store split in two, which went beyond the redesign.
