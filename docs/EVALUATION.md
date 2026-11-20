# Evaluation

Measured by `pnpm evaluate` (`apps/api/sim/evaluate.ts`) on 2026-11-20. The real API runs in-process and is driven over HTTP by simulated phones that use the same sync engine as the PWA (`apps/api/sim/lib.ts`). Raw numbers: `docs/evaluation-results.json`.

- **Database engine:** PGlite (PostgreSQL in WebAssembly, single connection) - see docs/BLOCKERS.md B1
- **Machine:** AMD Ryzen 5 3400G with Radeon Vega Graphics     x8, 13.9 GiB RAM, Node v24.16.0
- **Scale:** full

The engine matters. No PostgreSQL credentials were available on the build machine (docs/BLOCKERS.md B1), so the evaluation ran on PGlite: real PostgreSQL compiled to WebAssembly, single-threaded, with one connection. Every write is serialised, so the latency and throughput figures below are a pessimistic bound for the native PostgreSQL 19 server. Re-run `pnpm evaluate` after setting `DATABASE_URL`. The script detects the server and creates and drops a throwaway `relief_eval_*` database.

## Summary

| Requirement | Target | Measured | Result |
|---|---|---|---|
| NFR17 duplicate precision | ≥ 90% | 98.6% | **met** |
| NFR17 duplicate recall | ≥ 80% | 94.0% | **met** |
| UC18 QR2 duplicates listed after sync | ≤ 2 min | 9.1 s for 950 households | **met** |
| NFR09 exactly-once under failure injection | 0 lost, 0 duplicated | 0 lost, 0 duplicated of 480 | **met** |
| NFR10 eventual consistency | all devices equal the server | all 8 devices identical to the server | **met** |
| NFR11 / UC17 QR1 conflict detection | 100% of injected | 50/50 (100.0%), 0 false | **met** |
| NFR15 500 records at ~400 kbps | ≤ 60 s | 23.6 s | **met** |
| NFR16 50 devices syncing at once | all succeed | 50/50 succeeded in 30.1 s | **met** |
| NFR16 dashboard views at 20,000 households | ≤ 3 s | slowest 0.3 s with 20000 households | **met** |
| NFR14 save and search with 5,000 households (phone store) | ≤ 1 s | see §6 | **met** |

## 1. Duplicate detection (FR18, NFR17)

The labelled set has 950 households in two unions:

- an organisation's base registrations
- 150 of those families registered again by a second organisation, with realistic field variation: honorific spellings, dropped letters, re-ordered names, a mistyped or missing phone (35% of variants), family size ±1 (30%) and a different ward (25%)
- unrelated households drawn from the same name pools

Pairs flagged by the live server after sync: 143, of which 141 are true duplicates.

| Label | Flagged | True duplicates |
|---|---|---|
| likely (≥ 0.80) | 101 | 101 |
| possible (0.65 to 0.80) | 42 | 40 |

**Tuning.** `apps/api/sim/tune.ts` grid-searched 96 weight and missing-phone combinations over three labelled sets of 950 households, scoring every same-union pair offline at the fixed 0.80 and 0.65 thresholds.

- The first design (phone 0.40, name 0.35, location 0.10, family 0.15, with a missing phone's weight renormalised away) reached 0.98 recall but only 0.65 precision. With no phone, two strangers with similar names in one ward scored as "likely".
- The adopted design has phone 0.40, name 0.40 (honorifics removed), location 0.15 and family size 0.05, and a missing phone counts as 0.2. It reached 0.998 precision and 0.933 recall offline.

The live figures above come from that design. The best combinations on this run's own pairs were:

| phone | name | location | family | threshold | precision | recall |
|---|---|---|---|---|---|---|
| 0.4 | 0.4 | 0.15 | 0.05 | 0.65 | 98.6% | 94.0% |
| 0.35 | 0.4 | 0.1 | 0.15 | 0.7 | 99.2% | 87.3% |
| 0.3 | 0.4 | 0.15 | 0.15 | 0.75 | 100.0% | 86.0% |
| 0.45 | 0.35 | 0.1 | 0.1 | 0.6 | 94.5% | 91.3% |
| 0.5 | 0.3 | 0.05 | 0.15 | 0.6 | 100.0% | 85.3% |

## 2. Exactly-once storage and convergence (NFR09, NFR10)

8 simulated phones (three volunteers, several phones each) generated 480 events: registrations, distributions and corrections. They synced concurrently, with random batch sizes and injected failures:

- 15.0% of uploads lost before reaching the server
- 15.0% of responses lost after the server committed
- 10.0% of earlier batches sent again

Each phone retried until its queue was empty.

| Measure | Value |
|---|---|
| Events stored (rows / distinct ids) | 480 / 480 |
| Lost events | 0 |
| Events left waiting for a missing entity | 0 |
| Repeated uploads absorbed (acknowledged as duplicates) | 35 |
| Failed sync attempts recovered by retry | 14 |
| Every phone's view identical to a fresh download | yes |

The same property is also checked by a fast-check test (`apps/api/test/sync.test.ts`: random batch splits, one to three deliveries per event, shuffled order, three devices) on every `pnpm test`.

## 3. Conflicts (FR16, NFR11)

50 households were edited offline by two phones from the same base version: both changed the family size to different values. Every one became an open conflict: 50/50, a detection rate of 100.0%. In each case the first value was kept and nothing was overwritten. On another 50 households the two phones changed different fields. All 50 merged automatically, with 0 false conflicts.

## 4. Slow link (NFR15, UC16 QR1)

One phone with 500 waiting records (250 registrations and 250 distributions) synced over a simulated 400 kbps link with 300 ms latency each way. Request and response bytes are charged uncompressed, which is conservative because the server gzips responses.

| Measure | Value |
|---|---|
| Total time | 23.6 s |
| Batches / HTTP requests | 5 / 6 |
| Bytes up / down | 248 KiB / 315 KiB |

The Playwright suite also syncs real records from the PWA under Chrome DevTools 400 kbps throttling after an injected connection reset (`apps/web/e2e/field.mobile.spec.ts`, Scenario 3).

## 5. Server load (NFR16)

**Concurrent devices.** 50 phones each pushed 40 events at the same moment. 50/50 completed. The wall time was 30.1 s, and the per-request latency was p50 23.1 s and p95 23.1 s.

Writes for one operation are serialised on purpose (an advisory lock per operation keeps the download cursor gap-free), and PGlite additionally serialises every statement. The latency therefore reflects a queue, not failures. On native PostgreSQL, pushes for different operations run in parallel and each batch is several times faster.

**Dashboard with 20000 households.** Loading them took 597.1 s of simulated field sync, about half with a distribution. Each view below was measured three times over HTTP as a coordinator or administrator.

| View | Median | Max | Response size |
|---|---|---|---|
| Coverage summary (all areas) | 158 ms | 183 ms | 10.2 KiB |
| Unserved list, largest area | 50 ms | 54 ms | 0.1 KiB |
| Household search by name | 114 ms | 115 ms | 55.2 KiB |
| Duplicate review list | 7 ms | 9 ms | 0.0 KiB |
| Conflict list | 11 ms | 13 ms | 0.0 KiB |
| Operation summary report (CSV) | 258 ms | | |
| Audit trail, first page | 70 ms | | |

## 6. Field app on the phone (NFR08, NFR14, NFR19)

- **NFR14.** `apps/web/test/store.test.ts` stores 5,000 encrypted households in IndexedDB and then measures, on the Node runtime of the build laptop: save ≈ 2 ms, search ≈ 40 ms and the similarity check ≈ 50 ms, against a 1 s target. That leaves a margin of about 20× for a low-end 2 GB Android phone. The search runs over an in-memory index that is decrypted once at unlock.
- **NFR08.** Each record and its outbox entry commit in one IndexedDB transaction. Tests: "keeps records after a restart" (unit) and "records survive an app restart while offline" (Playwright, with the service worker serving the app shell while offline).
- **NFR19.** Registering a household is one consent tap, four fields (name, mobile, family size by stepper, ward) and one save. Recording a distribution is one search, one tap on the household, a quantity per item and one save: 9 taps in all. The primary actions sit in the bottom bar within thumb reach, and every target is at least 44 px. The 2-minute target is a human measure and should be confirmed with volunteers after the 10-minute briefing. Playwright completes the flow in about 8 s.

## 7. Backup and restore (NFR13)

`pnpm backup` (pg_dump, custom format) and `pnpm backup:verify` (pg_restore into a scratch database, then row counts of eight core tables) are implemented and wired into the API's daily duty and the System Administrator's screen. They need the native PostgreSQL server, so the tested restore that NFR13 requires is the one step that waits for database credentials (docs/BLOCKERS.md B1). Run `pnpm backup && pnpm backup:verify` once `.env` is filled in.
