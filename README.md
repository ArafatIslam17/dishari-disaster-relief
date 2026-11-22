# Offline-First Disaster Relief Distribution & Coordination System

Volunteer groups register consenting households and record relief **without a network**. Their phones sync when a signal returns. Coordinators then see one shared, household-level record across organisations: what reached whom, which areas have no records, which families may be registered twice, and where two people entered different values.

The system supports human decisions. It never decides who receives aid.

Built from the SE331 capstone proposal (`Proposal.pdf`). Corrections to the proposal are in [`docs/SRS-addendum.md`](docs/SRS-addendum.md), and the reasoning is in [`docs/DECISIONS.md`](docs/DECISIONS.md).

## Quick start (Windows)

Requirements: Node.js 22.12+ (24 recommended), pnpm 10+, and the native PostgreSQL (16+; developed against 19) on `localhost:5432` with its `bin` folder on `PATH` (for `pg_dump`/`pg_restore`). No Docker.

```powershell
pnpm install
Copy-Item .env.example .env
# Edit .env:
#   1. DATABASE_URL: put your local postgres password in place of CHANGE_ME
#   2. JWT_SECRET, PHONE_PEPPER, DATA_MASTER_KEY: generate each with
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
pnpm db:migrate     # creates relief_dev if missing, enables pg_trgm, applies migrations
pnpm seed           # demo operation + accounts for all five roles
pnpm dev            # API http://localhost:4000 and app http://localhost:5173
```

Open **http://localhost:5173**. On a phone on the same network, serve over HTTPS (see *Production*), because service workers and WebCrypto need a secure context outside `localhost`.

### Demo accounts (`pnpm seed`)

Every demo password is `Relief2026demo`, unless you set `SEED_DEMO_PASSWORD` (and `SEED_ADMIN_PASSWORD` for the System Administrator). The demo data is refused when `NODE_ENV=production`.

| Role | Mobile | Name | Starts at |
|---|---|---|---|
| System Administrator | 01700000000 | System Administrator | Organisations (one pending: Meghna Flood Response) |
| Operation Administrator | 01711000001 | Nusrat Jahan | Operations: "Feni Flash Flood 2024 (demo)" |
| Group Coordinator (Shapla Relief Team) | 01722000001 | Tanvir Ahmed | Coverage dashboard (one pending volunteer, one conflict, duplicates, one flag) |
| Field Volunteer (Shapla) | 01733000001 / 01733000002 | Sumaiya Akter / Rakib Hasan | Field app (asks for a new PIN on first log-in) |
| Group Coordinator (Padma Youth Volunteers) | 01844000001 | Farhana Rahman | Coverage dashboard |
| Field Volunteer (Padma) | 01855000001 | Imran Hossain | Field app |
| Observer | 01766000001 | Partner Observer | Coverage (area-level only) |

## Demo walkthrough (the six scenarios of PDF §2.1)

1. **Register a household offline.** Log in as `01733000002`, set a PIN, choose the operation, open *Download areas*, and download Dharmapur wards 1–2. In DevTools → Network choose *Offline*. Then *New household*, read the Bangla consent, accept, and enter the name, mobile, family size and ward, then *Save household*. The card shows the short code. The status bar shows "1 waiting to sync".
2. **Record a distribution.** Search by code, name or mobile and open the household, then *Record distribution* (quantities, "received elsewhere today"). For a family that refuses registration, use *Anonymous distribution*.
3. **Sync after an interrupted upload.** Go online and tap *Sync now*. Records upload in batches. If the connection drops, the next sync resumes from the first unconfirmed record, and repeated records are stored once.
4. **Review a possible duplicate.** Log in as `01722000001` and open *Duplicates*. Compare the pair side by side with per-signal scores, link it, then undo the link.
5. **Resolve a conflict.** *Conflicts*: both values with user, organisation, device and time. Choose one or type the correct value. It is saved as a new version in the household history.
6. **Check coverage.** *Coverage* shows Fully, Partly, Not served and **No records** (dashed mark; never shown as served). Filter by upazila, union or ward, open *Unserved households*, and *Send this list to field devices*. The volunteer receives it at the next sync.

## Architecture

```
packages/shared   TypeScript domain core used by both sides: Zod schemas (one contract), UUIDv7, short codes
                  with check characters, phone normalisation and masking, Jaro-Winkler duplicate scoring,
                  field-level merge, coverage labels, and the transport-agnostic sync engine
apps/api          Fastify 5 + PostgreSQL (Drizzle migrations). Exactly-once sync with deferred out-of-order
                  events, conflicts, duplicate scoring (pg_trgm candidates), distribution flags, coverage,
                  reports (PDF with embedded Bangla font, CSV streamed), retention, backups, append-only
                  audit and event log (database triggers), durable job queue in Postgres
apps/web          React 19 PWA (Vite 7, Workbox): mobile-first field app with an encrypted IndexedDB
                  store (Dexie + WebCrypto AES-GCM, PIN-wrapped key) and a desktop-first dashboard;
                  complete Bangla and English
```

- **Offline store.** Personal fields and outbox events are encrypted with a random data key. The key is wrapped by a PBKDF2 key from the PIN and by a per-device recovery key held by the server, so no PIN or plaintext key is stored. A record and its outbox event commit in one IndexedDB transaction.
- **Sync protocol.** Client UUIDv7 event ids, batches of ≤ 100 events or 64 KB, one acknowledgement per event, and resume from the first unacknowledged event. The server dedupes by event id, applies field-level merge on `base_version`, and parks out-of-order events until their entity arrives. Downloads use per-area cursors over a change sequence serialised per operation, so no change can be skipped.
- **Privacy.** Raw phone numbers and GPS points go only to the registering organisation. Others get a masked number and a per-operation HMAC for matching. Observers see area-level counts with small cells suppressed. 90 days after closure, personal fields are removed and the operation's event key is destroyed.

More: [`docs/DECISIONS.md`](docs/DECISIONS.md), [`docs/design-system.md`](docs/design-system.md), [`docs/TRACEABILITY.md`](docs/TRACEABILITY.md), [`docs/EVALUATION.md`](docs/EVALUATION.md), [`docs/FINAL-REPORT.md`](docs/FINAL-REPORT.md)

## Design

The interface uses **Signal**, a design system named after Bangladesh's port cyclone-warning signals, where a shape carries the meaning. [`DESIGN.md`](DESIGN.md) holds the visual system. It is adapted from the IBM (Carbon) entry in VoltAgent's awesome-design-md and borrows Carbon's structure, not its identity. [`docs/design-system.md`](docs/design-system.md) has the working detail: tokens, dial settings and components.

- **Type.** Roboto Flex (variable: condensed width in tables, higher optical size in headings, tabular figures for counts) and Baloo Da 2 for Bangla through `:lang(bn)`. Both are self-hosted from Fontsource, Latin and Bengali subsets only, preloaded and precached, so they work offline.
- **Colour.** OKLCH tokens in `apps/web/src/styles/tokens.css`: an ink-teal shell, tinted neutrals and one marigold accent for the main action on each screen. A full dark theme follows the system setting, with a manual toggle in every shell. `node apps/web/scripts/contrast.mjs` checks every text and control pair against WCAG 2.2 AA in both themes.
- **Status never by colour alone.** Served, partly served, not served, no records, pending, synced, failed, conflict and duplicate each have a geometric mark and a word.
- **Two shells.** The field app is one column with 48 px targets, a bottom bar and a one-row status bar (network, pending count, last sync). The dashboard has a dark rail with open-queue counts, condensed sticky-header tables that stack into labelled rows below 48 rem, and a summary strip instead of cards.
- **Motion** lasts 120–240 ms, is used only for state changes, and has a reduced-motion path. The only loops are the skeleton pulse while content loads and the sync spinner while a sync runs; both stop under reduced motion.

The UI audit lives in [`docs/ui-audit/`](docs/ui-audit/): [`REPORT.md`](docs/ui-audit/REPORT.md) (before and after, with measured scores), [`FINDINGS.md`](docs/ui-audit/FINDINGS.md) (every defect and its fix) and the before and after screenshots of every route for all five roles at five widths in both languages. To repeat the measurements:

```powershell
pnpm dev                                                       # then, in another terminal:
node apps/web/scripts/ui-capture.mjs --out docs/ui-audit/after --detect   # screenshots, axe, console, overflow
node scripts/workspace.mjs web build; node scripts/workspace.mjs api e2e:server   # production build on :4173, then:
node apps/web/scripts/lighthouse.mjs                           # Lighthouse + PWA check -> docs/ui-audit/lighthouse.json
```

Restart the production server after every build: it registers the built files when it starts.

## Roles

| Role | Can |
|---|---|
| Field Volunteer | Work offline in the field app: register households (with consent), record and cancel own distributions (24 h), correct details, search, sync, receive unserved lists |
| Group Coordinator | Everything a volunteer can, plus approve and manage members and devices (own organisation), resolve conflicts, review duplicates and flags, coverage, release unserved lists, organisation reports, join operations |
| Operation Administrator | Create and close operations, areas (CSV import), relief items, approve join requests, invite observers, review flags, audit trail (own operations), operation summaries |
| System Administrator | Approve organisations and operation administrators, manage all accounts and devices, disaster types, backups, retention, full audit trail |
| Observer | Area-level coverage and operation summaries without personal data |

## Scripts

| Command | Does |
|---|---|
| `pnpm dev` | API (waits for PostgreSQL) and the PWA dev server together, printing both URLs |
| `pnpm db:migrate` | Create the database if needed, enable `pg_trgm`, apply migrations |
| `pnpm seed` | Demo data. `pnpm admin:create` creates only the first System Administrator from `SEED_ADMIN_*` |
| `pnpm test` | Unit, property and integration tests. Uses a throwaway `relief_test_*` database on your PostgreSQL, or PGlite when no credentials work |
| `pnpm test:e2e` | Builds the PWA and runs Playwright (six scenarios, offline, 400 kbps, axe) with screenshots in `docs/screenshots` |
| `pnpm evaluate` | Measurements for `docs/EVALUATION.md` (`EVAL_SCALE=quick` for a short run) |
| `pnpm simulate -- --devices 10 --events 50 --drop 0.3` | Simulated phones with injected failures against an in-process server, or `--url http://localhost:4000` |
| `pnpm backup` / `pnpm backup:verify` | `pg_dump` to `BACKUP_DIR`, and a real restore into a scratch database with row-count checks |
| `pnpm lint`, `pnpm typecheck`, `pnpm build` | Quality gates |

**Daily backup.** The API takes one daily when `BACKUP_DAILY=true`. To use Windows Task Scheduler instead, set `BACKUP_DAILY=false` and schedule `pnpm backup` in the project folder:
`schtasks /Create /SC DAILY /ST 02:00 /TN "Relief backup" /TR "cmd /c cd /d \"E:\C Files\Disaster relief\" && pnpm backup"`

## Production

`pnpm build`, then run the API with `NODE_ENV=production`, `COOKIE_SECURE=true` (enforced), `WEB_DIST=apps/web/dist` (the API then serves the PWA from the same origin) and `TRUST_PROXY=true` behind a TLS-terminating proxy. `CORS_ORIGINS` must list only your HTTPS origin. Create the first administrator with `pnpm admin:create`. Never run `pnpm seed` in production.

## Troubleshooting

- `fe_sendauth: no password supplied` / `password authentication failed`: set the real password in `DATABASE_URL` (see [`docs/BLOCKERS.md`](docs/BLOCKERS.md)).
- `Invalid environment configuration … still a placeholder`: generate the three secrets as shown above.
- The field app asks for a PIN after reloading: this is by design (the phone's records are encrypted). If you forgot the PIN, log in online again and set a new one. Unsynced records are kept.
