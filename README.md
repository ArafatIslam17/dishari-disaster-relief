# Dishari (দিশারী)

**Offline-first disaster relief management and transparent donation platform.**




After a flood or cyclone, volunteers in the field rarely have a reliable signal. Dishari lets them register consenting households and record relief on their phones **with no network at all**, then syncs everything when a connection returns. Coordinators from different organisations then work from one shared, household-level picture: what reached whom, which areas have no records yet, which families may be registered twice, and where two people entered different values.

The same data feeds a public portal. Donors and citizens can open the site without an account and see how relief is progressing area by area, follow it on a live map, and give to the relief fund.

The system supports human decisions. It never decides who receives aid.

Dishari was built as an SE331 capstone project from the proposal in `Proposal.pdf`. Corrections to the proposal are in [`docs/SRS-addendum.md`](docs/SRS-addendum.md), and the reasoning behind design choices is in [`docs/DECISIONS.md`](docs/DECISIONS.md).


Notion Link: https://app.notion.com/p/Dishari-Project-Journal-421e07232be08057af3be4c395b8f589?source=copy_link

The demo accounts are listed below.

## Key features

### Public Observer Portal (no log-in)
- The home page (`/`) is a public dashboard. It shows live coverage KPIs, a coverage-by-upazila chart, the coverage breakdown, ward-level figures, the relief fund and an operation report you can download as PDF or CSV.
- Public figures come only from `/api/public/*` endpoints. They return area-level aggregates with small counts (1 to 4) shown as "<5". Names, phone numbers, NID numbers, GPS points and household IDs are never sent, and a test checks for each of them.
- The **Live Operation Map** uses Leaflet with OpenStreetMap tiles (no API key). Each upazila gets a pin:
  - a pulsing navy pin with an emerald ring once relief has reached the area;
  - a gold pin where nobody has been served yet or nothing is recorded.

  Clicking a pin shows registered and served households and the coverage status. The tiles darken in dark mode.
- A **Staff login** button takes coordinators, volunteers and administrators to `/login`. Anyone who is already signed in goes straight to their own workspace.

### Offline-first field operations (PWA)
- The installable field app keeps working with no connection. It handles household registration (with recorded consent), relief distribution, anonymous distributions, search by short code, name or mobile, and the unserved lists coordinators send out.
- Records and their outbox events are stored encrypted in IndexedDB. A PIN unlocks the device's data key, and an on-screen number pad helps on small phones.
- Sync uploads in batches and resumes from the first unconfirmed record after a dropped connection. The server stores each event exactly once, merges changes field by field, and holds events that arrive out of order until the record they belong to is there.

### Transparent relief fund and donations
- The `/donate` page offers preset or custom amounts, anonymous giving and a choice of campaign.
- Checkout is a multi-step sandbox gateway in the style of bKash, Nagad, Rocket and Visa/Mastercard. It walks through choosing a method, entering an account or card, an OTP and a PIN, and a processing step.
  - Sandbox values: wallet `01770618575`, OTP `123456`, PIN `12345`.
- Each donation can settle only once. A completed donation gets a printable digital receipt with a `DSH-YYYY-XXXXXX` transaction ID. Failed and cancelled payments get a retry link.
- The Relief fund card on the dashboards shows the total raised and recent donations. A receipt never includes the donor's phone number or email, and anonymous donors are never named.

### Roles and approval hierarchy
- Five roles: Field Volunteer, Group Coordinator, Operation Administrator, System Administrator and Observer.
- A volunteer who registers with an organisation is approved by that organisation's **Group Coordinator**. An **Operation Administrator** can also approve them, as oversight, if the organisation has joined one of their operations.
- Operation Administrators, and coordinators who register a new organisation, are approved only by the **System Administrator**.
- Each approver's pending queue lists only the registrations they may approve. A pending account is told who will approve it.

### Bilingual, themable, mobile-first
- Every screen is in English and Bangla, including numbers, dates and taka amounts. The brand name shows as দিশারী in Bangla.
- Light and dark themes are switched with one toggle and follow the system setting by default.
- Layouts were checked at 360, 375, 390 and 430 px in both languages, with no sideways scrolling and no clipped buttons.

## Tech stack

| Layer | Tools |
|---|---|
| Language | TypeScript throughout (one shared domain package) |
| API | Fastify 5, Zod 4, Drizzle ORM 0.45, PostgreSQL 16+ (`pg_trgm`), PGlite for tests, PDFKit reports |
| Web | React 19, Vite 7, React Router 7, react-i18next, Dexie (IndexedDB), Workbox PWA, lucide-react |
| Map | Leaflet 1.9 + react-leaflet 5, OpenStreetMap tiles |
| Testing | Vitest (unit, property and integration), Playwright (end-to-end, offline, accessibility with axe) |
| Tooling | pnpm workspaces, ESLint, tsup |

## Architecture

```
packages/shared   TypeScript domain core used by both sides: Zod schemas (one contract), UUIDv7, short codes
                  with check characters, phone normalisation and masking, Jaro-Winkler duplicate scoring,
                  field-level merge, coverage labels and small-cell rules, and the transport-agnostic sync engine
apps/api          Fastify 5 + PostgreSQL (Drizzle migrations). Exactly-once sync with deferred out-of-order
                  events, conflicts, duplicate scoring (pg_trgm candidates), distribution flags, coverage,
                  public aggregate endpoints, donations, reports (PDF with embedded Bangla font, CSV),
                  retention, backups, append-only audit and event log (database triggers), job queue in Postgres
apps/web          React 19 PWA (Vite 7, Workbox): mobile-first field app with an encrypted IndexedDB store
                  (Dexie + WebCrypto AES-GCM, PIN-wrapped key), the staff dashboard, the public observer
                  portal with the Leaflet map, and the donation flow; complete Bangla and English
```

- **Offline store.** Personal fields and outbox events are encrypted with a random data key. That key is wrapped twice: by a PBKDF2 key derived from the PIN, and by a per-device recovery key the server holds. So neither the PIN nor the plain key is stored anywhere. A record and its outbox event are saved in one IndexedDB transaction.
- **Sync protocol.**
  - Client-generated UUIDv7 event IDs.
  - Batches of at most 100 events or 64 KB.
  - One acknowledgement per event, and a resumed upload starts from the first unacknowledged event.
  - The server ignores event IDs it has already seen, merges on `base_version`, and holds out-of-order events until their record arrives.
  - Downloads use per-area cursors over a change sequence numbered within each operation, so no change can be skipped.
- **Privacy.** Raw phone numbers and GPS points go only to the registering organisation. Other organisations get a masked number and a per-operation HMAC for matching. Observers and the public see area-level counts with small cells suppressed. 90 days after an operation closes, personal fields are removed and the operation's event key is destroyed.
- **Main tables.** `organisation`, `app_user`, `device`, `operation`, `operation_admin`, `operation_membership`, `operation_observer`, `area`, `relief_item`, `household`, `distribution`, `distribution_item`, `distribution_flag`, `duplicate_pair`, `conflict`, `sync_event`, `audit_log`, `notification`, `unserved_release`, `job` and `donation`. All are defined in `apps/api/src/db/schema.ts`, with migrations in `apps/api/drizzle/`.

More detail: [`docs/DECISIONS.md`](docs/DECISIONS.md), [`docs/TRACEABILITY.md`](docs/TRACEABILITY.md), [`docs/EVALUATION.md`](docs/EVALUATION.md), [`docs/FINAL-REPORT.md`](docs/FINAL-REPORT.md).

## Local setup

Requirements:
- Node.js 22.12 or later (24 recommended) and pnpm 10 or later.
- PostgreSQL 16 or later on `localhost:5432`, with its `bin` folder on `PATH` (for `pg_dump` and `pg_restore`).

Docker is not needed.

```powershell
pnpm install
Copy-Item .env.example .env        # macOS/Linux: cp .env.example .env
# Edit .env:
#   1. DATABASE_URL: put your local postgres password in place of CHANGE_ME
#   2. JWT_SECRET, PHONE_PEPPER, DATA_MASTER_KEY: generate each one with
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
pnpm db:migrate     # creates relief_dev if missing, enables pg_trgm, applies migrations
pnpm seed           # demo operation, accounts for all five roles, sample donations
pnpm dev            # API on http://localhost:4000 and the web app on http://localhost:5173
```

Open **http://localhost:5173** to see the public portal. Use **Staff login** to sign in with a demo account.

To use the app from a phone on the same network, serve it over HTTPS (see [Production](#production)). Service workers and WebCrypto need a secure context anywhere except `localhost`.

### Demo accounts (`pnpm seed`)

Every demo password is `Relief2026demo`, unless you set `SEED_DEMO_PASSWORD` (and `SEED_ADMIN_PASSWORD` for the System Administrator). The seed refuses to run when `NODE_ENV=production`.

| Role | Mobile | Name | Starts at |
|---|---|---|---|
| System Administrator | 01700000000 | System Administrator | Organisations (one pending: Meghna Flood Response) |
| Operation Administrator | 01711000001 | Nusrat Jahan | Operations: "Feni Flash Flood 2024 (demo)" |
| Group Coordinator (Shapla Relief Team) | 01722000001 | Tanvir Ahmed | Coverage dashboard (one pending volunteer, one conflict, duplicates, one flag) |
| Field Volunteer (Shapla) | 01733000001 / 01733000002 | Sumaiya Akter / Rakib Hasan | Field app (asks for a new PIN on first log-in) |
| Group Coordinator (Padma Youth Volunteers) | 01844000001 | Farhana Rahman | Coverage dashboard |
| Field Volunteer (Padma) | 01855000001 | Imran Hossain | Field app |
| Observer | 01766000001 | Partner Observer | Coverage (area-level only; the public portal shows the same figures without a log-in) |

## Demo walkthrough

1. **Look around without an account.** Open `/`. Check the KPIs, the map pins and their popups, the ward table and the relief fund. Switch to বাংলা and to dark mode, then download the operation report from *Reports*.
2. **Donate.** Choose *Donate*, pick an amount, then *bKash*. Enter the sandbox wallet, OTP and PIN listed above. Print the receipt, and see the new total on the Relief fund card.
3. **Register a household offline.**
   - Log in as `01733000002`, set a PIN, choose the operation, open *Download areas* and download Dharmapur wards 1–2.
   - In DevTools → Network, choose *Offline*.
   - Open *New household*, read the Bangla consent and accept, enter the household's details and save. The card shows the short code, and the status bar shows "1 waiting to sync".
4. **Record a distribution.** Search for the household and open it, then choose *Record distribution*. For a family that refuses registration, use *Anonymous distribution* instead.
5. **Sync after an interrupted upload.** Go back online and tap *Sync now*. If the connection drops part-way, the next sync resumes from the first unconfirmed record, and records sent twice are stored once.
6. **Review a possible duplicate and a conflict.** Log in as `01722000001`.
   - In *Duplicates*, compare a pair side by side with a score for each signal, link them, then undo the link.
   - In *Conflicts*, choose one of the two values or type the correct one. It is saved as a new version in the household's history.
7. **Approve accounts.**
   - Register a new volunteer at `/register`. Its organisation's coordinator approves it in *Members*, or the operation administrator (`01711000001`) in *Approvals*.
   - Register an operation administrator. Only the System Administrator (`01700000000`) can approve it, in *Users*.
8. **Check coverage.** *Coverage* separates Fully served, Partly served, Not served and **No records**; "no records" is never counted as served. Filter by upazila, union or ward, open *Unserved households*, and send the list to field devices.

## Roles

| Role | Can |
|---|---|
| Field Volunteer | Work offline in the field app: register households (with consent), record and cancel their own distributions (within 24 h), correct details, search, sync, receive unserved lists |
| Group Coordinator | Approve volunteers and manage members and devices in their own organisation; resolve conflicts; review duplicates and flags; coverage; release unserved lists; organisation reports; join operations |
| Operation Administrator | Create and close operations, areas (CSV import) and relief items; approve join requests; approve volunteers of member organisations (oversight); invite observers; review flags; audit trail and summaries for their own operations |
| System Administrator | Approve organisations and operation administrators; manage all accounts and devices, disaster types, backups and retention; full audit trail |
| Observer | Area-level coverage and operation summaries without personal data (the public portal offers the same view without an account) |

## Design

The interface follows the **Dishari design system**:
- **Colour.** Command Navy `#1B3B6F` for structure, Beacon Gold `#F59E0B` for the main action, and Sky Signal `#8FB2E8` for charts and highlights.
- **Type.** Roboto Flex for Latin text and Baloo Da 2 for Bangla. Both fonts are self-hosted and precached, so they work offline.

Colours are OKLCH tokens in `apps/web/src/styles/tokens.css`; components are in `apps/web/src/styles/dishari.css` and `apps/web/src/ui/kit.tsx`. `node apps/web/scripts/contrast.mjs` checks every text and control colour pair against WCAG 2.2 AA in both themes.

- **Status never by colour alone.** Each state (served, partly served, not served, no records, pending, synced, failed, conflict, duplicate) has both a shape and a word.
- **Two staff shells.**
  - The field app is one column with 48 px touch targets, a bottom bar, a one-line status bar and a profile menu.
  - The dashboard has a sidebar with counts of open review items, KPI cards, charts and tables that turn into labelled cards on narrow screens.
- **Motion** lasts 120–240 ms and has a reduced-motion path. The map's pulsing pins and the live indicator stop under reduced motion.

The Stitch reference designs are in [`docs/stitch-design/`](docs/stitch-design/). The earlier UI audit, with before-and-after screenshots for every role, is in [`docs/ui-audit/`](docs/ui-audit/).

## Scripts

| Command | Does |
|---|---|
| `pnpm dev` | Starts the API (after waiting for PostgreSQL) and the web dev server together, and prints both URLs |
| `pnpm db:migrate` | Creates the database if needed, enables `pg_trgm` and applies migrations |
| `pnpm db:generate` | Generates a new Drizzle migration after a schema change |
| `pnpm seed` | Loads the demo data. `pnpm admin:create` creates only the first System Administrator, from the `SEED_ADMIN_*` settings |
| `pnpm test` | Runs the unit, property and integration tests. They use a throwaway `relief_test_*` database on your PostgreSQL, or PGlite when no credentials work |
| `pnpm test:e2e` | Builds the PWA and runs the Playwright scenarios (offline, slow network, axe), saving screenshots to `docs/screenshots` |
| `pnpm evaluate` | Takes the measurements behind `docs/EVALUATION.md` (`EVAL_SCALE=quick` for a short run) |
| `pnpm simulate -- --devices 10 --events 50 --drop 0.3` | Simulates phones with injected failures |
| `pnpm backup` / `pnpm backup:verify` | Runs `pg_dump`, then restores into a scratch database and checks row counts |
| `pnpm lint`, `pnpm typecheck`, `pnpm build` | Quality checks and the production build |

## Production

1. Run `pnpm build`.
2. Start the API with these settings:
   - `NODE_ENV=production`
   - `COOKIE_SECURE=true` (required)
   - `WEB_DIST=apps/web/dist`, so the API serves the PWA from the same origin
   - `TRUST_PROXY=true` when running behind a proxy that handles TLS
   - `CORS_ORIGINS` listing only your HTTPS origin
3. Create the first administrator with `pnpm admin:create`. Never run `pnpm seed` in production. The sandbox payment endpoint also refuses to run in production.

### Vercel

`vercel.json` deploys the repository as one Vercel project:
- **Web app:** the Vite build of `apps/web` is served as static files. Any path that is not a file and not under `/api/` falls back to `index.html`, so client-side routes load.
- **API:** every `/api/*` request is rewritten to one Vercel Function, `api/index.ts`. It hands the request to the Fastify app through `apps/api/src/vercel.ts`, which builds the same app as `server.ts` once per warm instance. It runs without `listen()`, timers, backups or signal handling.
- **Same domain:** the browser calls the API with relative `/api/...` paths on that domain, so the session cookie works without cross-site CORS.

**Environment variables (Project → Settings → Environment Variables):**
- **Required:** `DATABASE_URL` for a hosted PostgreSQL with `pg_trgm` available, such as Neon.
- **Required:** `JWT_SECRET` (`AUTH_JWT_SECRET` is accepted too), `PHONE_PEPPER` and `DATA_MASTER_KEY`. Each must be at least 32 random bytes, base64-encoded: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`. `PHONE_PEPPER` and `DATA_MASTER_KEY` must match the values the database was seeded with, because phone lookups and encrypted fields depend on them.
- **Set automatically:** `NODE_ENV=production`, `COOKIE_SECURE=true`, `TRUST_PROXY=true` and `BACKUP_DAILY=false` are applied by `vercel.ts` unless you set them yourself.
- **CORS:** the deployment's own URLs (production, branch and per-deployment) are added to `CORS_ORIGINS` automatically. Add any custom domain to `CORS_ORIGINS`.
- **Optional:** `CRON_SECRET` enables the cron routes below.

If a required variable is missing or invalid, every `/api/*` request answers `503 {"code":"service_unavailable"}`. The function log names the variables to fix; it never prints their values.

**Migrations.** Run them against that database before the first deploy and after every schema change: `DATABASE_URL=... pnpm db:migrate`. Then run `pnpm admin:create`.

**Background jobs.** Queued jobs run while an instance is warm. To make sure they run, schedule `GET /api/cron/jobs` (for example every few minutes) and `GET /api/cron/daily` (once a day) with Vercel Cron. Both routes require `Authorization: Bearer $CRON_SECRET`, and they return 404 when `CRON_SECRET` is not set.

The Content Security Policy allows map images from `tile.openstreetmap.org` only. A high-traffic public deployment should move to a tile provider that allows that volume, or host its own tiles, and update `imgSrc` in `apps/api/src/app.ts` to match.

## Troubleshooting

- `fe_sendauth: no password supplied` / `password authentication failed`: set the real password in `DATABASE_URL` (see [`docs/BLOCKERS.md`](docs/BLOCKERS.md)).
- `Invalid environment configuration … still a placeholder`: generate the three secrets as shown above.
- The field app asks for a PIN after reloading: this is by design, because the phone's records are encrypted. If you forgot the PIN, log in online again and set a new one. Unsynced records are kept.
- The map shows grey squares: the browser cannot reach `tile.openstreetmap.org`. The pins, popups and the screen-reader list still work.

## Team & Contributions

**Arafat Islam** ([@ArafatIslam17](https://github.com/ArafatIslam17))
- UI/UX design system (Dishari branding, Command Navy/Beacon Gold palette, light/dark theme toggle)
- Frontend architecture (`apps/web`: React, TypeScript, Vite)
- Backend REST API architecture (`apps/api`: Fastify and TypeScript)
- Database schema design, migrations and seed data (Drizzle ORM and PostgreSQL)
- Full bilingual support (EN/BN) and mobile-first responsiveness
- Donation flow and the multi-step sandbox payment gateway UI (bKash, Nagad, Rocket, cards and printable receipts)
- Public Observer Portal (no-login dashboard) and the interactive Leaflet Live Operation Map
- Role-based registration and approval UI flows

**Meherin Khondoker Priya** (`@<github-username>`) *(update the username after accepting the GitHub collaborator invite)*
- Offline-first PWA data sync, local queue and ward coverage aggregation logic
- Role-based access control (RBAC) and the account approval hierarchy endpoints
- API validation, unit and integration testing, and system documentation (SRS and journal alignment)

The weekly progress log is in [`JOURNAL.md`](JOURNAL.md), and a Notion-ready copy is in [`NOTION_JOURNAL.md`](NOTION_JOURNAL.md).
