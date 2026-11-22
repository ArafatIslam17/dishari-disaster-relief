# Web Design Guidelines review: P6 final

Rules: vercel-labs/web-interface-guidelines `command.md` at commit 434b7f9 (bundled with the installed `web-design-guidelines` skill), the same pinned set as `wdg-before.md`. Scope: `apps/web/src/**/*.tsx`, `apps/web/src/styles/*.css`, `apps/web/index.html`. Run 2026-11-22 after the P6 fixes.

Method: each mechanical rule was searched across the scope, and every hit was read in context. The judgement rules were checked against the AFTER capture (`docs/ui-audit/after/`): focus not covered, empty states, long content, and dark mode.

## Mechanical rules (counts across the scope)

| Rule | Result |
|---|---|
| `transition: all` | 0 |
| `outline: none` without replacement | 0. Two uses, both replaced: `:focus:not(:focus-visible)` keeps the ring for keyboard users, and inputs swap the outline for a 2 px focus underline plus a halo (`app.css`, input `:focus-visible`). |
| `user-scalable=no` / `maximum-scale` | 0 |
| `onPaste` + `preventDefault` | 0 |
| `<div>`/`<span>` with `onClick` | 0 |
| `autoFocus` | 0 (F26, F27) |
| `window.confirm` | 0 (F25 and F43 use the app's `<dialog>`) |
| `...` instead of `…` / straight quotes in copy | 0 / 0 (F38) |
| `<img>` without `width`/`height` | 0 (4 images, all sized, decorative `alt=""`) |
| Icon-only buttons without `aria-label` | 0 |
| `touch-action: manipulation`, tap highlight | set on buttons and links |
| `overscroll-behavior: contain` on dialogs and the drawer | yes |
| `env(safe-area-inset-*)` | status bar, field page padding, bottom bar, toast region |
| `font-variant-numeric: tabular-nums` | 12 rules: counts, coverage figures, times |
| `text-wrap: balance` on headings, `pretty` on body | yes (P6 adds `li`, `dd`, `figcaption`) |
| `color-scheme` and `theme-color` follow the theme | yes, light and dark |
| Native `<select>` with explicit background and colour | yes |
| Critical fonts preloaded with `font-display: swap` | Roboto Flex Latin and Baloo Da 2 Bengali, woff2 only |
| Async updates announced | 10 live regions: toasts (errors assertive), sync result, form errors, report result |
| Sticky bars covering focus | `scroll-padding-block: 96px` keeps focused fields clear of the status and bottom bars |
| Large lists | every list endpoint is capped (households 100, members 500, audit 500, notifications 100), so no virtualisation is needed |

## Findings

apps/web/src/ui/kit.tsx:31 - the account-lock time uses `toLocaleTimeString` while the rest of the app goes through `formatTime` (`Intl.DateTimeFormat`). Fixed in P6 for consistency.
apps/web/src/pages/field.tsx (household form) - no unsaved-changes guard when leaving mid-entry. Accepted; see below.

## Deliberate departures from the rule set

- **Title Case for headings and buttons:** not applied. DESIGN.md sets sentence case everywhere. Bangla has no case, and sentence case reads calmer in an operations tool.
- **Unsaved-changes guard:** the household form is short (four fields after consent), and a router guard would add behaviour the brief rules out ("no new product features"). It stays open as a P3 suggestion.
- **Inline `style` values that remain:** three data-driven widths (coverage bar segments, signal meter, skeleton lines), the report form's max width, the boot screen and the top toast placement. None carries a colour or a spacing token.

## Result

0 open violations of the mechanical rules. 1 inconsistency fixed in P6. 1 rule (unsaved-changes guard) accepted as out of scope. Every item in `wdg-before.md` is closed; FINDINGS.md maps each one to its fix.
