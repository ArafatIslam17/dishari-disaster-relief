# Product
<!-- impeccable:product-schema 1 -->

## Platform
web

## Users
- **Field Volunteer.** Registers consenting households and records relief on an Android phone (Chrome, 2 GB RAM, Android 8+), outdoors, often in sun or rain, usually one-handed, frequently with no signal. Works in Bangla first.
- **Group Coordinator.** Leads one volunteer group. Uses a laptop or tablet at a base, scanning coverage across wards, reviewing possible duplicates, conflicting edits and repeat-distribution flags, approving members and devices. Can also use the field app.
- **Operation Administrator.** Sets up an operation (areas, relief items), approves organisations that ask to join, closes the operation, reads reports and the audit trail.
- **System Administrator.** Approves organisations, manages user accounts and disaster types, runs backups and the retention job.
- **Observer.** A partner who sees area-level figures and summary reports only (counts from 1 to 4 shown as "<5").

## Product Purpose
Several volunteer groups work the same flood or cyclone area without a shared record. This system gives them one household-level record that works offline: phones register households and record what each received, then sync when a signal returns. Coordinators see what reached whom, which areas have no records, which families may be registered twice, and where two people entered different values. Success: fewer missed households and fewer accidental repeats, with every decision traceable.

## Positioning
Offline-first field capture plus a cross-organisation household record, where conflicts and possible duplicates surface for a human to resolve. The system supports human decisions; it never decides who receives aid.

## Operating Context
- Field work happens in the open, in poor connectivity, under time pressure, with families waiting. A short code (e.g. `K7M-2Q4`) is written on the family's card and read aloud.
- Consent is read aloud in Bangla before registration; refusal leads to an anonymous distribution instead.
- Dashboards are used at a base on a laptop, sometimes a tablet, to scan many wards quickly and to clear review queues.
- Sync can be interrupted; records wait in an outbox on the phone, with attempt counts.

## Capabilities and Constraints
- One codebase, installable PWA: field routes (`/field/*`) and dashboard routes (`/app/*`), role-based.
- Works fully offline after first log-in and area download (service worker precache, Dexie/IndexedDB, encrypted local vault behind a 4–6 digit PIN that locks after 5 wrong tries).
- Bangla is the default language; the whole interface, consent statement and coverage labels exist in Bangla and English. Head-of-household names are entered in English letters only.
- Coverage labels: fully served, partly served, not served, no records ("no records" must never look served).
- Mobile numbers outside the registering organisation are masked. Personal data is removed 90 days after an operation closes.
- API contracts, schema, sync protocol and business rules are fixed; UI work must not change them.
- No runtime CDN or font-service requests: everything is self-hosted for offline use.

## Brand Commitments
- Name: "Relief Coordination" (Bangla UI uses the translated name). No logo beyond the existing simple mark (`apps/web/public/icon.svg`).
- Voice: short, human, plain; Bangla must read naturally, not as a literal translation. The meaning of the consent statement must never change.
- Pinned by the redesign brief (2026-11-22): Roboto Flex (variable) for Latin/UI and Baloo Da 2 for Bangla, self-hosted; a deep ink/teal base with one confident warm accent and tinted neutrals in OKLCH; light and dark themes; status never by colour alone; one icon set at one stroke weight.

## Evidence on Hand
- Synthetic demo seed only (`pnpm seed`): one operation "Feni Flash Flood 2024 (demo)", 60 households across Feni Sadar and Sonagazi wards, eight demo accounts across the five roles. No real beneficiary data, partner logos, testimonials or photography exist and none may be invented.

## Product Principles
1. The phone must never lose a record or block a volunteer because the network is gone.
2. Show the state of the data honestly: pending, synced, failed, conflict and duplicate are always visible and named.
3. Humans decide. The interface surfaces evidence side by side and asks; it never auto-merges or excludes a family.
4. Bangla first, readable outdoors, operable with one hand.
5. Collect the minimum, mask by default, and keep an audit trail of every change.

## Accessibility & Inclusion
WCAG 2.2 AA across both surfaces; touch targets at least 48 px in the field app; no information by colour alone; works at 200% zoom and from 360 px wide; respects reduced motion; volunteers may have low literacy in English.
