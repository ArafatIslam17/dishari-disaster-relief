# Traceability

Every requirement maps to the code that implements it and the automated tests that verify it.

**Test file abbreviations**

- **AT** `apps/api/test/accounts.test.ts`
- **ST** `apps/api/test/sync.test.ts`
- **RT** `apps/api/test/review.test.ts`
- **SH** `packages/shared/test/*.test.ts`
- **WT** `apps/web/test/store.test.ts`
- **E2E-M** `apps/web/e2e/field.mobile.spec.ts`
- **E2E-D** `apps/web/e2e/dashboard.desktop.spec.ts`
- **EV** `apps/api/sim/evaluate.ts` (results in `docs/EVALUATION.md`)

**Code abbreviations**

- `api/` means `apps/api/src/`
- `web/` means `apps/web/src/`
- `shared/` means `packages/shared/src/`

## Functional requirements

| ID | Requirement | Code | Tests |
|---|---|---|---|
| FR01 | Registration and log-in after approval | `api/routes/auth.ts` (register, login), `api/routes/members.ts` (approve), `web/pages/public.tsx` | AT "UC01 / FR01 …", AT "keeps the account pending…", E2E-D "Coordinator approves a new volunteer…" |
| FR02 | Organisation registration and approval | `api/routes/auth.ts` (register-organisation), `api/routes/admin.ts`, `web/pages/dash-admin.tsx` AdminOrganisationsPage | AT "UC03/UC04 …", E2E-D "System Administrator approves an organisation" |
| FR03 | Members, roles, deactivation, device revocation | `api/routes/members.ts`, `web/pages/dash-admin.tsx` MembersPage | AT "UC05 / FR03 …" (other organisation denied, deactivation, revocation, last coordinator) |
| FR04 | Operation lifecycle, no records after close | `api/routes/operations.ts`, `api/services/sync.ts` checkOperation | AT "UC06 4.a …", RT "removes names… after close" (closed operation rejects records) |
| FR05 | Areas (manual, CSV) and relief items | `api/routes/operations.ts` areas/import/items, OperationDetailPage | AT "imports valid CSV rows…", AT "rejects a repeated area and item", E2E-D OA setup |
| FR06 | Join operation and approval | `api/routes/operations.ts` join/memberships, JoinPage | AT "blocks a second join request…", `test/helpers.ts` buildWorld (join and approve path) |
| FR07 | Area data download | `api/routes/sync.ts` bootstrap and pull, `web/local/store.ts` selectAreas/applyPull, AreasPage | E2E-M onboarding (download), ST "advances per-area cursors", ST "paginates large areas…" |
| FR08 | Offline registration with consent and short code | `web/local/store.ts` saveHousehold, NewHouseholdPage, `shared/shortcode.ts` | WT "saves a household and its outbox event…", SH "short codes (C6)", E2E-M Scenario 1 |
| FR09 | Local duplicate warning | `web/local/store.ts` findSimilar, `shared/duplicate.ts` | WT "warns about a similar household…", E2E-M Scenario 1 (similar-warning) |
| FR10 | Offline search by code, name, mobile | `web/local/store.ts` search, SearchPage | WT "finds by short code…", WT "matches … by phone HMAC", E2E-M "records survive an app restart…" |
| FR11 | Distribution recording, anonymous distribution | `web/local/store.ts` saveDistribution, DistributePage, `api/services/sync.ts` | WT "rejects zero…", WT "records an anonymous distribution…", E2E-M Scenario 2 |
| FR12 | Corrections and 24-hour cancellation | `web/local/store.ts` updateHousehold/voidDistribution, `api/services/sync.ts` applyDistributionVoid | WT "queues a new version…", WT "lets the recorder cancel…", ST "corrects a skewed device clock…", ST "rejects a cancellation after 24 hours" |
| FR13 | Automatic and manual sync, pending count, last sync | `web/local/sync.ts` SyncManager, `web/layouts.tsx` status bar, SyncPage | E2E-M Scenario 3, WT "resumes from the first unconfirmed event…" |
| FR14 | Batched, resumable, idempotent upload | `shared/sync-engine.ts`, `api/services/sync.ts` processPush | ST "stores a household… stored once", ST property "random batches, repeats and reordering…", EV E2 |
| FR15 | Download of shared updates | `api/routes/sync.ts` pull, `web/local/store.ts` applyPull | ST "returns the raw number only to the registering organisation", ST cursors and pagination |
| FR16 | Field-level merge and conflict detection | `shared/merge.ts`, `api/services/sync.ts` applyHouseholdUpdate | SH merge.test (incl. property), ST "merges different fields and records a conflict…", EV E3 |
| FR17 | Conflict resolution as a new version | `api/routes/reviews.ts` resolve, ConflictDetailPage | ST conflict resolution part, E2E-D Scenario 5 |
| FR18 | Duplicate scoring within a union | `api/services/analysis.ts` scoreDuplicates, `shared/duplicate.ts` | SH "duplicate scoring (FR18, C12)", RT "flags a cross-organisation duplicate…", EV E1 |
| FR19 | Duplicate review, link and undo | `api/routes/reviews.ts` link/not-duplicate/undo, recomputeLinkGroups | RT "links (keeping both)… and undoes the link", E2E-D Scenario 4 |
| FR20 | Same item from two organisations within 24 hours | `api/services/analysis.ts` checkDistributionFlags, FlagsPage | RT link test (flag raised, reviewed, never deleted) |
| FR21 | Coverage summary with labels | `api/routes/coverage.ts` coverageSummary, `shared/coverage.ts`, CoveragePage | SH "coverage labels (C11)", RT "labels areas… no records…", E2E-D Scenario 6 |
| FR22 | Unserved list sent to the field app | `api/routes/coverage.ts` unserved/release, FieldUnservedPage | RT "lists unserved households and releases…", E2E-D Scenario 6 (received on phone) |
| FR23 | In-app notifications | `api/lib/audit.ts` notify, `api/routes/notifications.ts`, `web/local/sync.ts` (sync.failed/sync.stale) | ST conflict notification, RT duplicate notification, E2E-D Scenario 4 (notifications) |
| FR24 | Audit trail of all actions | `api/lib/audit.ts`, `drizzle/0002_integrity.sql` | RT "records actions with user, organisation, device and time; never raw personal data" |
| FR25 | Household history, audit search and CSV export | `api/routes/households.ts` history, `api/routes/audit.ts`, AuditPage | RT "searches and exports the trail…", RT "shows the full household history…", E2E-D OA audit export |
| FR26 | Reports in PDF and CSV | `api/routes/reports.ts`, `api/services/pdf.ts`, ReportsPage | RT "FR26 reports (UC25)" (3 tests), E2E-D observer CSV, OA PDF |

## Non-functional requirements

| ID | Requirement | Code | Evidence |
|---|---|---|---|
| NFR01 | Server-side role and organisation checks | `api/auth/guard.ts`, every route | AT "NFR01 role-based access on every protected route" |
| NFR02 | Salted hashes, lock after 5, PIN for 7 days | `api/auth/tokens.ts` (argon2id), login lockout, `web/local/store.ts` vault | AT "stores passwords as argon2id", AT "locks after 5 failures, auto-unlocks…", WT vault tests |
| NFR03 | Temporary password recovery | `api/routes/members.ts` temporary-password | AT "a temporary password unlocks immediately…" |
| NFR04 | HTTPS, encrypted phone store | `api/config.ts` (COOKIE_SECURE in production), helmet HSTS, `web/local/crypto.ts` | WT "never stores the PIN…", WT "…personal data encrypted at rest" |
| NFR05 | Minimisation and consent | consent step in NewHouseholdPage, `household_consent_ck`, `shared/schemas.ts` consentGiven literal | E2E-M Scenario 1 (Bangla consent), schema rejects non-consent |
| NFR06 | Masking, observers area-level only | `api/services/views.ts` toHouseholdDTO, `suppressSmallCells` | ST "returns the raw number only…", RT "observers see area-level figures…", E2E-D observer |
| NFR07 | Removal 90 days after close | `api/services/retention.ts`, server daily duty | RT "removes names, phones and GPS 90 days after close and crypto-shreds…" |
| NFR08 | 3 days offline, no loss after crash | `web/local/store.ts` (atomic transactions), service worker precache | WT "keeps records after a restart", E2E-M "records survive an app restart while offline" |
| NFR09 | Exactly-once storage | `api/services/sync.ts` (dedupe by event id, deferred replay) | ST property test, ST out-of-order test, EV E2 |
| NFR10 | Eventual consistency | pull with per-area cursors and advisory-locked change feed (`lockOperationFeed`) | ST property convergence, EV E2 converged |
| NFR11 | No silent overwrite | `shared/merge.ts` | SH merge property "never lost", ST 100% injected conflicts, EV E3 |
| NFR12 | Append-only, traceable, validated | `drizzle/0002_integrity.sql` triggers, Zod on both sides | RT "cannot be edited or deleted, even directly in the database", AT validation tests |
| NFR13 | Daily backup, tested restore | `api/services/backup.ts`, `pnpm backup`, `pnpm backup:verify`, SystemPage | Needs PostgreSQL credentials: see docs/BLOCKERS.md B1 and EVALUATION §7 |
| NFR14 | 5,000 households, save/search < 1 s | `web/local/store.ts` in-memory decrypted index | WT "NFR14 … saves and searches within 1 second" (measured) |
| NFR15 | 500 records < 60 s at 400 kbps | `shared/sync-engine.ts` batching | EV E4, E2E-M Scenario 3 (CDP 400 kbps) |
| NFR16 | Dashboard < 3 s at 20k; 50 concurrent devices | set-based coverage SQL (D3), indexes | EV E5, EV E6 |
| NFR17 | Precision ≥ 90%, recall ≥ 80% | `shared/duplicate.ts` (tuned), `api/services/analysis.ts` | EV E1 |
| NFR18 | Bangla and English; Bangla coverage labels | `web/i18n/bn.ts` typed against `en.ts` (compile-time key parity), Noto Sans Bengali bundled | `pnpm typecheck` (parity), E2E-D "Bangla interface…", PDF report labels |
| NFR19 | Register and distribute within 2 minutes, one hand | bottom-bar actions, single-screen registration, steppers | E2E-M Scenarios 1–2: the full flow is 9 taps and 4 fields (EVALUATION §6) |
| NFR20 | Android 8+ (PWA), Chrome/Firefox/Edge | ES2020 build target, installable manifest | Production build, e2e in Chromium (mobile emulation) |
| NFR21 | Configurable types, areas, items; automated tests | disaster types, areas and items as data | `pnpm test` (110 tests), `pnpm test:e2e` (12) |

## Use cases

| UC | Name | Code (web page / API route) | Tests |
|---|---|---|---|
| 01 | Register Account | RegisterPage, POST /api/auth/register | AT UC01 |
| 02 | Log In | LoginPage, UnlockPage, POST /api/auth/login | AT lockout, WT vault, E2E-M unlock |
| 03 | Register Organisation | RegisterOrganisationPage, POST /api/auth/register-organisation | AT UC03 |
| 04 | Approve Organisation | AdminOrganisationsPage, POST /api/admin/organisations/:id/approve | AT, E2E-D |
| 05 | Manage Members and Devices | MembersPage, /api/members/*, /api/devices/:id/revoke | AT UC05 |
| 06 | Manage Operation Lifecycle | OperationsPage, OperationDetailPage, /api/operations | AT UC06 |
| 07 | Set Up Areas and Relief Items | OperationDetailPage, /api/operations/:id/areas, /items | AT UC07, E2E-D |
| 08 | Request to Join Operation | JoinPage, POST /api/operations/:id/join | AT UC08 |
| 09 | Approve Join Request | OperationDetailPage, /memberships/:orgId/approve | buildWorld path, E2E-D |
| 10 | Download Area Data | AreasPage, /api/sync/bootstrap, /api/sync/pull | E2E-M onboarding |
| 11 | Register Household | NewHouseholdPage | WT, E2E-M S1 |
| 12 | Check Similar Households | findSimilar | WT, E2E-M S1 |
| 13 | Record Relief Distribution | DistributePage | WT, E2E-M S2 |
| 14 | Search Household | SearchPage, HouseholdsPage | WT, E2E-M |
| 15 | Correct Records | EditHouseholdPage, cancel in HouseholdPage | WT, ST |
| 16 | Synchronise Data | SyncPage, SyncManager, /api/sync/push | ST, WT, E2E-M S3, EV E2 |
| 17 | Resolve Conflicts | ConflictsPage, ConflictDetailPage | ST, E2E-D S5 |
| 18 | Review Possible Duplicates | DuplicatesPage, DuplicateDetailPage | RT, E2E-D S4 |
| 19 | Review Duplicate Distribution Flags | FlagsPage, FlagDetailPage | RT |
| 20 | View Notifications | NotificationsPage, FieldNotificationsPage | E2E-D S4 |
| 21 | View Unserved Households | UnservedPage, FieldUnservedPage | RT, E2E-D S6 |
| 22 | View Area Coverage | CoveragePage | RT, E2E-D S6 |
| 23 | View Household History | HouseholdDetailPage, /api/households/:id/history | RT |
| 24 | Search and Export Audit Trail | AuditPage, /api/audit, /api/audit/export.csv | RT, E2E-D |
| 25 | Generate Reports | ReportsPage, /api/reports/* | RT, E2E-D |

## State machines

| Diagram | Implementation | Test |
|---|---|---|
| Fig 5.9 Pending record sync | `shared/sync-engine.ts` (pending → uploading → failed/acknowledged), `web/local/store.ts` markFailed/applyAcks | WT "resumes from the first unconfirmed event…" |
| Fig 5.10 User account | `app_user.status` with checks, login lockout, temporary password, deactivate | AT lockout, deactivation |
| Fig 5.11 Organisation approval | `organisation.status`, admin approve/reject | AT UC03/UC04 |
| Fig 5.12 Operation lifecycle | `operation.status`, close, retention | AT close, RT retention |
| Fig 5.13 Conflict review | `conflict.status` open → resolved; "leave open" keeps it open | ST, E2E-D S5 |
| Fig 5.14 Duplicate pair review | `duplicate_pair.status` pending_review ↔ linked, → not_duplicate | RT, E2E-D S4 |
