# UI audit findings

Phase 1 baseline, 2026-11-22, against `pnpm dev` on the local PostgreSQL with the demo seed.

How the evidence was gathered:
- `node apps/web/scripts/ui-capture.mjs --out docs/ui-audit/before --detect` captured 110 route states for the public pages and all five roles, in English and Bangla, at 360, 390, 768, 1024 and 1440 px (550 screenshots in `docs/ui-audit/before/<role>/<lang>/<width>/`). For each capture it ran axe (wcag2a/aa, 2.1, 2.2 AA plus best practice), recorded console errors, failed requests and horizontal overflow, and ran the Impeccable detector on the live page through the debugging port. The raw results are in `docs/ui-audit/before/capture.json`.
- Impeccable `audit` scored the source and the rendered pages (`docs/ui-audit/impeccable-audit-before.md`).
- The Web Design Guidelines review checked every `.tsx` file, `app.css` and `index.html` against the pinned rule set (`docs/ui-audit/wdg-before.md`).
- Screenshots were read visually at all five widths.

Severity uses Impeccable's scale: P0 blocks the task, P1 is major or breaks WCAG AA, P2 is minor, P3 is polish. The **Fix** column says what changed and in which phase. "Open" means it isn't fixed yet.

| # | Route | Viewport | Sev | Finding | Fix |
|---|---|---|---|---|---|
| F01 | all public routes (/login, /register, /register-organisation, /invite/*), /set-pin | all | P1 | Every visit without a session logs `401 (Unauthorized)` from `POST /api/auth/refresh` to the console (18 of 110 captures). | Open |
| F02 | /invite/:bad-token | all | P3 | The expected 400 for an invalid token shows in the console. The error state renders correctly. The browser logs any 4xx itself, so this is accepted. | Open |
| F03 | /field/households/:id, /app/households/:id | all | P1 | The page has no `<h1>`; its only heading lives inside the household card (axe page-has-heading-one). | Open |
| F04 | /field/unserved, /field/notifications, /app/notifications (empty) | all | P2 | The empty state uses an `<h3>` straight after the `<h1>` (axe heading-order, detector skipped-heading). | Open |
| F05 | /field/households/:id, /app/households/:id, /app/duplicates/:id | all | P2 | The household card's decorative striped bar is a one-sided stripe on a rounded box (detector side-tab, repeating-stripes-gradient). | Open |
| F06 | /app/coverage | all | P2 | The "No records" chip uses a repeating-stripe gradient background, which the detector reads as decoration. The meaning should come from a mark, not texture. | Open |
| F07 | /app/operations/:id, /app/admin/system | ≥768 | P2 | Tables in bordered wrappers sit inside bordered panels: nested cards (detector). | Open |
| F08 | /field/search, /app/join, /app/notifications, /app/admin/disaster-types | all | P2 | List rows sit flush against the panel edge with no inset (detector cramped-padding). | Open |
| F09 | /register, /field/areas, /field/settings | 390 | P3 | A single word strands on the last line of intro paragraphs (detector straggler). | Open |
| F10 | every /app route | ≥1024, page taller than 900px | P1 | The sidebar background stops at viewport height (`height: 100dvh`), leaving a white column under the nav on long pages (seen on /app/coverage at 1440). | Open |
| F11 | every /app route | 360, 390 | P1 | The top bar wraps into five stacked rows (menu, operation select, bell + language, name, log out), taking 230 px before any content. | Open |
| F12 | /app/coverage and every dashboard table | 360–768 | P1 | Tables scroll sideways, so the coverage label, counts and actions sit off-screen. Nothing shows that more columns exist. | Open |
| F13 | /app/coverage | 1440 | P2 | The "Unserved households" link wraps to two lines in every row, doubling row height; 15 rows fill 1.5 screens. | Open |
| F14 | all field routes (Bangla) | 360 | P1 | The status bar wraps to five lines (online, all synced, a three-line last-sync time, the language switch) and covers 136 px of a 800 px screen. | Open |
| F15 | /field (home) | all | P2 | The home screen is seven identical icon-plus-label tiles: no hierarchy, and the main action (register a household) looks the same as Settings. | Open |
| F16 | /field/* | all | P2 | Toasts sit 96 px above the bottom and cover form content and action buttons (seen on /field after an area download). | Open |
| F17 | all | all | P1 | No dark theme, no `color-scheme`, and no theme toggle. The `theme-color` meta is fixed teal and doesn't match the page ground. | Open |
| F18 | all | all | P2 | The fonts are Atkinson Hyperlegible plus Noto Sans Bengali, not the required Roboto Flex and Baloo Da 2. Legacy `.woff` copies are precached alongside `.woff2`. No font preload. | Open |
| F19 | all | all | P2 | Atkinson's slashed zero (`0` with a stroke) reads as "Ø" in counts and times ("00:40"), which hurts outdoor reading of numbers. | Open |
| F20 | all | all | P1 | Status colours are hard-coded hex, with no OKLCH tokens or contrast check. `--ink`, `--muted` and friends are not themable. Many inline `style={{…}}` overrides (field.tsx, dash-*.tsx). | Open |
| F21 | /app/duplicates/:id | 1440 | P2 | Signals are a plain definition list. The two households sit side by side without marking which values differ, so the reviewer compares by eye. | Open |
| F22 | /app/conflicts/:id | all | P2 | The two values are big bold text in identical panels. Nothing distinguishes the server copy from the field copy beyond the h2. | Open |
| F23 | all | all | P2 | Status tags (pending, failed, likely, rejected…) rely on tint plus text. There's no shape cue for pending, synced, failed, conflict or duplicate, which the brief requires. | Open |
| F24 | /field/sync | all | P2 | The queue rows show "Pending" or "Failed" tags only. There's no sync progress while running and no screen-reader announcement when a sync ends, apart from the toast. | Open |
| F25 | /unlock | all | P2 | "Use another account" uses `window.confirm`, a browser dialog that is unstyled, not translated by the app and blocks the thread. | Open |
| F26 | /unlock | 360–390 | P2 | `autoFocus` on the PIN field opens the keyboard over the screen on phones (WDG: autofocus on mobile). | Open |
| F27 | /field/search | 360–390 | P3 | `autoFocus` on the search field. It's acceptable as the page's single primary input, but it scrolls the bottom bar off on some phones. | Open |
| F28 | /login, /register, /register-organisation, /invite | ≥1024 | P2 | A bare form floats in a 480 px column at the top of an empty 1440 page. There's no product identity, onboarding context or language-aware layout. | Open |
| F29 | /login | all | P2 | The "Log in" button stays disabled until a password is typed, so an empty submit gives no feedback (WDG: submit stays enabled until the request starts). | Open |
| F30 | /field/households/new (consent) | 360 | P2 | The consent text is set at an inline 1.1rem with no Bangla line-height tuning. The two decision buttons fall under the fixed bottom bar on 360 × 640 screens. | Open |
| F31 | all | 200% zoom | P2 | `html, body { overflow-x: clip }` hides real overflow instead of preventing it. A wide table or long code could be cut with no scroll. | Open |
| F32 | all | all | P2 | The skeleton loader shimmer loops forever (1.4 s infinite). The reduced-motion rule only collapses duration, so it still flickers once a cycle. | Open |
| F33 | all | — | P1 | One 786 KB JS bundle for all routes: field users download the whole dashboard and the dashboard downloads Dexie and crypto code. No route code-splitting. | Open |
| F34 | /app/members, /app/operations/:id | ≥768 | P3 | Action buttons in table cells wrap into a column of three outlined buttons per row. Row height jumps. | Open |
| F35 | /app/audit | 1440 | P3 | The filter toolbar is six inputs in one wrapped row with no grouping. The placeholder `household.` has no ellipsis or example form (WDG). | Open |
| F36 | /app/reports | all | P3 | Format radios are bare; date fields carry no hint of the range format. Success and failure notices sit above the form, out of view after submitting on a phone. | Open |
| F37 | all | all | P3 | No favicon variants for dark tabs; `apple-touch-icon` points at a 192 px PNG; no splash or maskable-safe artwork. | Open |
| F38 | i18n | — | P3 | Straight quotes in copy (`"No records"`, `"{{operation}}"`) instead of curly quotes (WDG Typography). | Open |
| F39 | /field/households/:id, /field/sync | all | P3 | Inline `style={{ marginTop: 12 }}` spacing and `<br/>` stacking produce uneven rhythm; the spacing is off the 4 px grid in places. | Open |
| F40 | all | — | P3 | Lucide icons render at the default 2 px stroke beside 1.5 px hairlines; sizes mixed (16/18/20/24/28). | Open |
| F41 | /app/* | all | P2 | Nav groups show no counts for review queues, so a coordinator can't see where decisions wait without opening each queue. | Open |
| F42 | DashboardLayout | all | P3 | The coordinator's name and role are printed as loose small text in the top bar between buttons; at 1024 it wraps. | Open |
| F43 | /app/operations/:id, /app/admin/system | all | P1 | Destructive actions run without confirmation: "Remove" on an area, and "Run retention now", which redacts personal data (WDG: destructive actions need confirmation). | Open |
| F44 | /app/members, /app/duplicates, /app/admin/organisations | all | P2 | Status filters are marked up as `role="tablist"`/`tab` without tab panels or arrow-key support. They are filters, so the semantics are wrong. | Open |

What passed: zero horizontal page overflow at all widths, no keyboard traps, and the skip link is present on both shells. Every form control has a label. Images carry alt text.

## Web Design Guidelines (P1 baseline)
The full `file:line` list is in `docs/ui-audit/wdg-before.md`.

## Impeccable audit (P1 baseline)
Score 11/20 (Acceptable). Accessibility 3, Performance 2, Theming 1, Responsive 2, Implementation integrity 3. The full report is in `docs/ui-audit/impeccable-audit-before.md`.
