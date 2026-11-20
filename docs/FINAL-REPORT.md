# Final report

## What was built

A complete implementation of the SE331 proposal *Offline-First Disaster Relief Distribution & Coordination System*: FR01–FR26, NFR01–NFR21, use cases 1–25, all five roles and all six state machines, on a pnpm monorepo:

- **`packages/shared`** is the domain core used by every part. It holds the Zod contracts, UUIDv7, Crockford short codes with a check character, Bangladeshi phone normalisation and masking, the Jaro-Winkler duplicate scorer (tuned), field-level merge on `base_version`, coverage labels, and a transport-agnostic sync engine.
- **`apps/api`** is Fastify 5 on PostgreSQL with Drizzle migrations. It provides:
  - argon2id log-ins with lockout, short access tokens and rotating refresh tokens with reuse detection, devices and revocation
  - organisations, operations, CSV area import, items, join requests and observer invites
  - exactly-once sync with deferred out-of-order events, conflicts, duplicate scoring (pg_trgm candidates), 24-hour cross-organisation flags and notifications
  - coverage and unserved lists, household history, audit search and streamed CSV, PDF and CSV reports with an embedded Bangla font
  - retention with crypto-shredding of the event log, pg_dump backup with a verified restore, and an append-only audit and event log enforced by database triggers
- **`apps/web`** is one installable React PWA. The mobile-first field app works fully offline: an encrypted IndexedDB store keyed by the PIN, atomic saves, local search and similarity warning, distributions, corrections, cancellation, sync status and unserved lists. The desktop-first dashboard has a screen for every coordinator, administrator and observer use case. Both are complete in Bangla and English.
- **Evidence tooling** includes the device simulator, the synthetic labelled data generator, the scorer tuner, the evaluation harness and a Playwright suite for the six scenarios of PDF §2.1.

## What was measured

Full details are in `docs/EVALUATION.md`. Measurements ran on PGlite (see Blockers), which is pessimistic for the native server.

| Requirement | Result |
|---|---|
| NFR17 duplicate precision / recall | 98.6% / 94.0% on 950 labelled households; listed 9.1 s after sync (target 2 min) |
| NFR09 exactly-once under failure injection | 480/480 events stored once; 0 lost; 35 repeated uploads absorbed; 14 failed attempts recovered |
| NFR10 convergence | all 8 phones identical to the server |
| NFR11 conflict detection | 50/50 injected same-field conflicts (100%), 0 false; 50/50 different-field edits merged |
| NFR15 500 records at 400 kbps | 23.6 s (target 60 s) |
| NFR16 50 concurrent devices | 50/50 succeeded in 30.1 s |
| NFR16 dashboard at 20,000 households | slowest view 0.26 s (target 3 s) |
| NFR14 5,000 households on the phone | save ≈ 2 ms, search ≈ 40 ms, similarity ≈ 50 ms (target 1 s) |

Tests: `pnpm test` runs 110 tests (shared 38, api 58, web 14), including fast-check properties for merge and for sync under random batching, repetition and reordering. `pnpm test:e2e` runs 12 Playwright tests at 375 and 1440 px with offline mode, injected connection resets, 400 kbps CDP throttling and axe WCAG 2.2 AA checks. 28 screenshots are in `docs/screenshots`. Lint, typecheck and the production build are clean, and the dependency audit shows no critical or high findings.

## What changed in the specification, and why

The full list with reasons is in `docs/DECISIONS.md` (C1–C30, D1–D8), and the corrected requirements are in `docs/SRS-addendum.md`. The most significant changes:

1. **Platform.** The native Android app became an installable PWA, so one codebase serves phone and laptop.
2. **Lockout.** A lock lasts 15 minutes and also clears at once with a temporary password. This reconciles NFR02 with the state diagram.
3. **Registration gaps.** The System Administrator approves Operation Administrators. Observers join through one-time invite links. The organisation registrant is an unregistered visitor.
4. **Masking vs matching.** Other organisations receive a masked number plus a per-operation HMAC, so search and duplicate scoring still work. The residual risk is documented.
5. **Short-code collisions.** Codes carry a device prefix and a check character, and the server reissues on a clash.
6. **Clock skew.** The 24-hour rules use server-corrected time.
7. **Retention vs immutability.** Personal data is nulled and the event log is crypto-shredded, and the audit log never holds raw personal data.
8. **GPS.** Optional, with separate consent.
9. **Language.** Names stay in Latin letters; Bangla search covers places, organisations and items.
10. **Coverage labels.** Four labels are defined, and "No records" can never look served.
11. **Duplicate thresholds.** 0.80/0.65 are kept, but the weights were re-tuned: the original weighting reached only 65% precision on labelled data.
12. **Chapter 1 statistics.** 4.94 million is verified. 1,807 towers is verified but dated 23 August, not 24. "Fully disrupted" in Feni is softened to about 90% of towers out.
13. **Consistency fixes.** The table of contents, the ERD and class diagram gaps, undefined notifications for two roles, and editing rights.

## Audit against the proposal (M10)

Each use case's main and alternative flows were checked against the running system, mostly through the end-to-end suite:

- UC01 offline and duplicate-mobile paths; UC02 PIN, 7-day and lockout paths; UC07 CSV rejected rows; UC10 low storage and incomplete download
- UC11 consent refusal leading to an anonymous distribution; UC12 local-only matches; UC15 the 24-hour and not-owner rules; UC16 resume, duplicate and revoked paths
- UC17 "leave open"; UC18 undo; UC19 the household still in duplicate review; UC21 every household served; UC22 observer and not-yet-synced notes; UC25 an empty range

The gaps the end-to-end suite exposed were fixed and are covered by tests:

- the registration form did not reset
- the server session did not resume after an offline unlock
- coordinators were forced to set a field PIN to use the dashboard
- a duplicated heading
- quadratic coverage queries
- inaccurate duplicate weighting

Deliberately not built, per the scope: payments, eligibility decisions, rescue dispatch, government integrations, national ID numbers, photos, area claiming, priority lists, the map view, and any AI or RAG feature.

## Blockers

See `docs/BLOCKERS.md`.

- **B1: no PostgreSQL credentials on the build machine.** `pnpm dev`, `pnpm db:migrate`, `pnpm seed`, `pnpm backup` and `pnpm backup:verify` need the local `postgres` password in `.env`. The one-line fix is in BLOCKERS.md. Until then, tests, the evaluation and the e2e server run on PGlite, which is real PostgreSQL in WebAssembly running the same migrations. The NFR13 tested restore is the single requirement still waiting for that step.
