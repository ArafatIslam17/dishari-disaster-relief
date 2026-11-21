# Web Design Guidelines review: P1 baseline

Rules: vercel-labs/web-interface-guidelines `command.md` at commit 434b7f9 (bundled with the installed `web-design-guidelines` skill). Scope: `apps/web/src/**/*.tsx`, `apps/web/src/styles/app.css`, `apps/web/index.html`.

## apps/web/index.html

apps/web/index.html:6 - `theme-color` fixed teal; doesn't match the page background; no dark variant
apps/web/index.html:8 - favicon SVG only; no dark-scheme variant; no font preload for critical faces
apps/web/index.html:2 - no `color-scheme` declared

## apps/web/src/styles/app.css

apps/web/src/styles/app.css:6-10 - four static font weights plus .woff fallbacks; no `font-display` control; no preload
apps/web/src/styles/app.css:83-85 - `overflow-x: clip` on html/body hides overflow instead of fixing it
apps/web/src/styles/app.css:107-110 - `:focus-visible` ok, but sticky status bar and bottom bar can cover focused fields (no `scroll-padding-top`, only bottom)
apps/web/src/styles/app.css:157-160 - `.btn` transition lists properties ✓; no `touch-action: manipulation`; no `-webkit-tap-highlight-color`
apps/web/src/styles/app.css:519-528 - skeleton shimmer runs forever; reduced-motion variant still animates one cycle
apps/web/src/styles/app.css:546-553 - toast region fixed at 96px bottom: overlaps content; no `env(safe-area-inset-bottom)`
apps/web/src/styles/app.css:568-575 - `dialog` lacks `overscroll-behavior: contain`
apps/web/src/styles/app.css:96-102 - headings lack `text-wrap: balance`
apps/web/src/styles/app.css (all) - no dark theme; native `<select>` without explicit `background-color`/`color` for Windows dark mode
apps/web/src/styles/app.css:684-687 - status bar sticky top, no `env(safe-area-inset-top)`

## apps/web/src/ui/kit.tsx

apps/web/src/ui/kit.tsx:247-261 - ToastProvider: single `role=status` for errors too; error toasts should be assertive
apps/web/src/ui/kit.tsx:299-327 - `<dialog>`: no focus return to trigger; `autoFocus` on reason field
apps/web/src/ui/kit.tsx:188-197 - Loading text "Loading…" ✓; skeleton only shape, no layout match
apps/web/src/ui/kit.tsx:203-215 - ErrorState: message lacks next step beyond Retry
apps/web/src/ui/kit.tsx:144-148 - Stepper input: no `autocomplete="off"`, no `name`

## apps/web/src/layouts.tsx

apps/web/src/layouts.tsx:44-46 - sync status `aria-live` region also re-announces on every pending count change (chatty); last-sync time not announced on completion
apps/web/src/layouts.tsx:227-229 - user name/role printed as loose text in toolbar; wraps
apps/web/src/layouts.tsx:233 - `<main lang>` duplicates `<html lang>`
apps/web/src/layouts.tsx:179 - mobile nav drawer: no `overscroll-behavior: contain`, no scrim, no Escape to close, focus not moved into drawer

## apps/web/src/pages/public.tsx

apps/web/src/pages/public.tsx:83 - submit disabled until password typed (submit should stay enabled until request starts)
apps/web/src/pages/public.tsx:67-81 - mobile input: `name` missing; `spellCheck={false}` missing on phone/usernames
apps/web/src/pages/public.tsx:181 - org search input: no `autocomplete="off"`
apps/web/src/pages/public.tsx:468 - `window.confirm` for a destructive switch: use the app's confirm dialog
apps/web/src/pages/public.tsx:490 - `autoFocus` on PIN (mobile)
apps/web/src/pages/public.tsx:345-353 - errors not focused on submit

## apps/web/src/pages/field.tsx

apps/web/src/pages/field.tsx:365 - inline `style` font-size for consent text
apps/web/src/pages/field.tsx:428, 583, 601, 617, 625, 680, 775, 840, 1026 - inline style spacing off the token scale
apps/web/src/pages/field.tsx:499 - `autoFocus` on search (mobile)
apps/web/src/pages/field.tsx:286-291 - validation errors shown inline ✓ but first error not focused on submit
apps/web/src/pages/field.tsx:441-448 - head-name input: `spellCheck={false}` missing (names)
apps/web/src/pages/field.tsx:249-252 - "Downloading…" ✓; no progress indicator during long download

## apps/web/src/pages/dash-review.tsx

apps/web/src/pages/dash-review.tsx:140-191 - wide table, no narrow-screen pattern
apps/web/src/pages/dash-review.tsx:413 - inline style font sizing for conflict values
apps/web/src/pages/dash-review.tsx:476-482 - `role="tablist"` buttons without `aria-controls`/`tabpanel`; arrow-key handling missing (use links or proper tabs)
apps/web/src/pages/dash-review.tsx:573 - h1 mixes figure + two tags; long in Bangla
apps/web/src/pages/dash-review.tsx:850, 950 - `<span hidden lang>` stray element
apps/web/src/pages/dash-review.tsx:923 - distribution quantity total shown without unit

## apps/web/src/pages/dash-admin.tsx

apps/web/src/pages/dash-admin.tsx:95-102, 821-827 - `role="tablist"` misuse as filters (should be links/toggle buttons with `aria-pressed`)
apps/web/src/pages/dash-admin.tsx:506 - "Remove" area is immediate, no confirmation (destructive)
apps/web/src/pages/dash-admin.tsx:547 - "Retire" item immediate (reversible: acceptable)
apps/web/src/pages/dash-admin.tsx:602 - invite link field readOnly ✓; no copy button
apps/web/src/pages/dash-admin.tsx:734 - placeholder `household.` → should end with `…` and show the pattern
apps/web/src/pages/dash-admin.tsx:1006-1013 - "Run retention now" is destructive (redaction) without confirmation

## apps/web/src/i18n/en.ts

apps/web/src/i18n/en.ts:55, 79, 135, 149, 193 - straight quotes → curly quotes
