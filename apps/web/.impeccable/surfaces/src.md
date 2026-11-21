---
version: 1
slug: "src"
primary_target: "src"
related_targets: []
---

# Surface brief: Relief Coordination web app (field app + coordination dashboard + public shell)

Scope: every route in apps/web/src (field /field/*, dashboard /app/*, public /login etc.). Mode: Operate.
Audience and job: see PRODUCT.md. Field = one-handed phone outdoors, Bangla first. Dashboard = laptop at base, scanning wards and clearing review queues.
Constraints: no API/schema/sync changes; offline-first; WCAG 2.2 AA; 48 px targets in the field.
Pinned by brief (2026-11-22, user unavailable by instruction): Roboto Flex + Baloo Da 2 self-hosted; deep ink/teal base, one warm accent, tinted OKLCH neutrals; light + dark; DESIGN.md adapted from awesome-design-md (IBM/Carbon chosen); Taste dials per surface.

## Direction contract
THESIS: State is a signal you can read at a glance from across a tent. Every data state carries its own hoisted geometric mark, the way Bangladesh's port cyclone signals carry meaning by shape. Refuses the category default of grey SaaS cards with coloured pill badges.
OWN-WORLD: Ink-teal shell (rail, status bar) over a cool tinted paper ground; marigold is the one hoist colour (primary field action, active selection, pending count). Flat Carbon-style tiles, hairline rules, near-square 2 px corners, filled inputs with a 2 px underline focus. Roboto Flex: condensed width for tables, high optical size for headings, tabular numerals. Signal marks: square = served, half-triangle = partly, hollow ring = not served, hatched bar = no records, hollow diamond = pending, check-square = synced, cross = failed, split-square = conflict, linked rings = duplicate.
STORY: The volunteer sees, before anything else, whether the phone is online and how many records wait; then one big thumb action. The coordinator sees which wards are unserved or have no records and which queues need a decision, then opens a pair or conflict and decides side by side.
FIRST VIEWPORT: Field: sticky ink status bar (network signal, pending count chip, last sync) then title, operation line, the marigold "New household" as a full-width primary, secondary actions as a two-column list; bottom nav with the centre hoist. Dashboard: ink left rail with grouped navigation and queue counts; top bar with operation selector; coverage summary strip (registered / served / unserved / no-records with signal marks) above a sticky-header condensed table.
FORM: candidate 3 of 7 (Bangladesh cyclone port-warning signal system), seed:1a012f43aa84e522. Raises: tabular figures right-aligned everywhere (from ikeda-datamatics); hairline module borders without whitespace inflation on the dashboard (from japanese-high-density-web); cancelled things stay visible and stamped, never removed (from jet-age ticket wallet); nav carries queue extent as counts (from acetate tab board); strict 4 px grid alignment (from Crouwel specimen).
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
