# Dishari — Capstone Project Journal

Weekly progress log for the SE331 capstone, recorded every Tuesday from 22 September to 24 November 2026.

**Team:** Arafat Islam ([@ArafatIslam17](https://github.com/ArafatIslam17)) and Meherin Khondoker Priya

A table version of this log, ready to paste into Notion, is in [`NOTION_JOURNAL.md`](NOTION_JOURNAL.md).

---

## Week 1 — Tuesday, 22 September 2026

**Class:** Held
**Contributors:** Arafat Islam & Meherin Khondoker Priya

The course supervisor walked us through the capstone guidelines, how the project will be evaluated, and the expected workflow for the semester. That workflow covers weekly check-ins, a proposal, an SRS, a working system and a final report.

- Noted the evaluation criteria and what each milestone has to show.
- Agreed to keep a weekly journal and to track the work in Git from the start.
- Began listing problem areas we cared about. Disaster response came up first, because both of us had seen how relief work goes during floods at home.

## Week 2 — Tuesday, 29 September 2026

**Class:** Held
**Contributors:** Arafat Islam & Meherin Khondoker Priya

We proposed **Dishari**, an offline-first platform for disaster relief management.

The proposal centred on two problems we kept hearing about:
- **No signal in the field.** Volunteers working in flooded unions often lose mobile signal, so paper lists and phone calls become the record. Data gets lost, or is typed in twice later.
- **Little visibility for anyone outside.** Several organisations work the same wards without a shared view. Families get missed or served twice, and donors cannot see where their money goes.

Proposed scope:
- A phone app volunteers can use with no connection.
- A coordination dashboard across organisations.
- Coverage reporting that never treats "no records" as "served".
- A transparent way to show progress to the public.

The written proposal is `Proposal.pdf`.

## Week 3 — Tuesday, 6 October 2026

**Class:** Held
**Contributors:** Arafat Islam & Meherin Khondoker Priya

We finalised the architecture and the tech stack.

- **Stack:** TypeScript throughout. Fastify for the REST API, Drizzle ORM over PostgreSQL, and React with Vite for the web app, built as an installable PWA.
- **Structure:** a pnpm monorepo with `apps/api`, `apps/web` and `packages/shared`. The shared package holds the Zod schemas, so the client and server validate against the same contract.
- **First schema draft:** organisations, users and devices, operations and their areas (upazila, union, ward), relief items, households, distributions, and an event table for sync.
- **Key decision:** every change made on a phone becomes an event with a client-generated UUIDv7, so the server can accept the same upload twice and store it once.

## Week 4 — Tuesday, 13 October 2026

**Class:** Cancelled
**Contributors:** Both

There was no formal class this week. We used the time for independent research and setup:
- Read up on IndexedDB storage limits and service-worker caching for offline web apps.
- Installed PostgreSQL locally, set up the pnpm workspace, and agreed on lint and TypeScript settings.

## Week 5 — Tuesday, 20 October 2026

**Class:** Held
**Contributors:** Arafat Islam (backend API & database schema); Meherin Khondoker Priya (RBAC & API validation)

We built the core backend.

- **Arafat:**
  - Set up the Fastify server: security headers, cookies, rate limiting, and consistent error codes the client can translate.
  - Built the database with Drizzle migrations and seed data for a demo operation ("Feni Flash Flood").
  - Added the first REST endpoints for accounts, organisations, operations, areas and relief items.
- **Meherin:**
  - Built the role structure. Five roles (Field Volunteer, Group Coordinator, Operation Administrator, System Administrator, Observer) are enforced by a `requireAuth` guard on each route, with checks for organisation and operation membership.
  - Wrote Zod validation for request bodies and query strings.

## Week 6 — Tuesday, 27 October 2026

**Class:** Cancelled
**Contributors:** Both

There was no formal class this week. Work continued in the background:
- Prototyped the offline sync loop.
- Tightened data validation, for example phone number normalisation and family-size limits.
- Wrote early tests that run against a throwaway database.

## Week 7 — Tuesday, 3 November 2026

**Class:** Held
**Contributors:** Meherin Khondoker Priya (offline sync & coverage aggregation); Arafat Islam (frontend integration)

The field app started working offline from end to end.

- **Meherin:**
  - Built the sync queue. Records and their outbox events are saved together in IndexedDB, uploaded in batches of up to 100 events, and confirmed one by one, so an interrupted upload resumes where it stopped.
  - Built ward-level coverage aggregation on the server. A family linked as a duplicate counts once, and a ward with no records is reported as **No records**, never as served.
- **Arafat:**
  - Connected the field screens to the local store: household registration with consent, relief distribution, anonymous distribution, search, and the sync status bar.
  - Built the first coordinator dashboard pages: coverage, conflicts and duplicates.

## Week 8 — Tuesday, 10 November 2026

**Class:** Held
**Contributors:** Arafat Islam

The whole interface was redesigned around the **Dishari design system**.

- **Palette:** Command Navy `#1B3B6F` for structure, Beacon Gold `#F59E0B` for the main action on each screen, and Sky Signal `#8FB2E8` for charts.
- **Type:** Roboto Flex for Latin text and Baloo Da 2 for Bangla, both self-hosted so they work offline.
- **Bilingual:** complete English and Bangla, including Bangla digits, dates and taka amounts. The brand reads "দিশারী" in Bangla.
- **Theme:** a single light/dark toggle that starts from the system setting.
- **Dashboard:** KPI cards, a paired bar chart, a coverage donut and an urgent-queue card. Every coverage state is shown with a shape as well as a colour.

## Week 9 — Tuesday, 17 November 2026

**Class:** Held
**Contributors:** Arafat Islam (full-stack donation & gateway); Meherin Khondoker Priya (validation & testing)

We added the Donation & Relief Fund module.

- **Arafat:**
  - Added the `donation` table and migration. Amounts are limited to ৳10–৳1,000,000, each transaction ID is unique, and the status moves from pending to completed, failed or cancelled exactly once.
  - Built public endpoints to start a donation, read it back, settle it in the sandbox, and summarise the fund.
  - Built the `/donate` page and a multi-step sandbox checkout in the style of bKash and SSLCommerz: choose a method (bKash, Nagad, Rocket, Visa, Mastercard), enter an account or card, then an OTP, a PIN and a processing step.
  - Added printable digital receipts and a Relief fund KPI card on the dashboard.
- **Meherin:**
  - Wrote validation rules: a name is required unless the donation is anonymous, and phone and email formats are checked.
  - Wrote API tests that settle a donation once and check a second attempt is rejected, check that failed and cancelled payments never count toward the total, and check the seed can run twice safely.
  - Confirmed that receipts never include a donor's phone number or email.

## Week 10 — Tuesday, 24 November 2026

**Class:** Held
**Contributors:** Arafat Islam & Meherin Khondoker Priya

This week the system opened to the public and the approval rules were tightened.

- **Public Observer Portal:** the root route (`/`) is now a public dashboard that needs no log-in. It shows coverage, reports and the relief fund.
  - It reads from new `/api/public/*` endpoints that return only area-level figures, with counts from 1 to 4 shown as "<5".
  - Staff reach their workspace through a **Staff login** button.
- **Live Operation Map:** a Leaflet map with OpenStreetMap tiles pins each upazila, using the Feni Sadar, Fulgazi, Parshuram and Chhagalnaiya centres for the demo operation.
  - Navy pulsing pins mark areas where relief has reached people; gold pins mark areas that need attention.
  - Popups show registered and served households.
- **Approval hierarchy:**
  - Field volunteers are approved by their own Group Coordinator, or by an Operation Administrator for oversight.
  - Operation Administrators are approved only by the System Administrator.
  - Each pending queue shows only what that person may approve, and a pending account is told who will approve it.
  - The registration page now has one searchable organisation picker.
- **Mobile audit:** every page was checked at 360–430 px in English and Bangla. We fixed the cut-off "Staff login" button, the header wrapping and the KPI card text, with no sideways scrolling left.
- **Documentation:** refreshed the README, started this journal, and prepared a Notion copy of it.
- **Checks:** typecheck, lint, the production build, 18 web tests and 71 API tests all pass.
