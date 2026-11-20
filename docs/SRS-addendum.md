# SRS addendum: corrections to the SE331 proposal

This addendum amends `Proposal.pdf` (Fall 2026). Where they differ, this document wins. Each item names the original text, the correction and the reason. The design rationale for each item is in `docs/DECISIONS.md` (C1–C30). Page numbers are the printed numbers.

## 1. Chapter 1 statistics (verified November 2026)

| Original (p.1) | Status | Corrected wording |
|---|---|---|
| "affected about 4.94 million people" | **Verified.** UN OCHA *Bangladesh: Eastern Flash Flood Situation Report No. 01* (25 Aug 2024), citing the National Disaster Response Coordination Center. Later reports (MoDMR, 27 Aug) rose above 5.8 million. | "...affected about 4.94 million people (OCHA, 25 August 2024; later estimates exceeded 5.8 million)." |
| "On 24 August, 1,807 cell towers were out of service" | **Date corrected.** The BTRC figure of 1,807 towers out (10,443 of 12,250 sites working in 12 districts) is as of 09:00 on **23** August 2024. OCHA repeated it on 25 August. | "On 23 August, 1,807 mobile towers in 12 districts were out of service..." |
| "communication in Feni was reported as fully disrupted" | **Softened.** Reports give 590 of 656 towers in Feni (about 90–92%) out of service, not all of them. | "...and about nine in ten mobile towers in Feni were out of service." |

## 2. Corrected requirements

**R1 Platform (replaces "Android app", pp.2, 13–17).** The field application is an installable Progressive Web App. It runs in Chrome on Android 8.0 or later with 2 GB RAM, and in current Chrome, Firefox and Edge on desktops (NFR20). One codebase serves the field app and the coordination dashboard through role-based routes.

**R2 Account lock (NFR02, UC02 QR1, Fig 5.10).** After 5 consecutive failed online log-ins the account becomes **Locked** for 15 minutes. The next log-in after that time unlocks it automatically. A temporary password issued by a coordinator (own organisation) or the System Administrator unlocks it at once and forces a password change. The field app's PIN locks after 5 wrong attempts until the next online log-in. Unsynced records on the phone are kept.

**R3 Who approves whom (FR01, UC01, Key Features).** Field volunteers are approved by a Group Coordinator of their organisation, who assigns the role. Operation Administrators register from the same form and are approved by the System Administrator. Observers do not register: an Operation Administrator creates a one-time invitation link, valid for 7 days, for one operation, and the observer's organisation is optional. The first System Administrator is created by `pnpm seed` (demo) or `pnpm admin:create` (production).

**R4 UC03 actor.** The actor is an *unregistered visitor*. One form creates the organisation (Pending) and its coordinator account (Pending). The System Administrator's approval activates both, and a rejection records the reason (Fig 5.11).

**R5 Masking and matching (NFR06, UC14, UC23 3.a).** Users outside the registering organisation see the mobile number masked (`017******89`) and receive only an HMAC-SHA256 of the normalised number under a per-operation key derived on the server from a secret pepper. That HMAC supports exact-match search and duplicate scoring. Raw numbers and GPS points are shown only to the registering organisation and System Administrators.

**R6 Short codes (FR08).** The code is a 3-character device prefix issued by the server, 5 random Crockford base32 characters and a Luhn mod-32 check character, for 9 characters shown as `K7M 4QX 9TC`. The server enforces uniqueness. On a clash it keeps the first household, reissues the second code, and notifies the volunteer to update the family's card.

**R7 Time (FR12, FR20).** Every event stores the client time and the server receipt time, and each upload records the device clock offset. The 24-hour cancellation window and the 24-hour duplicate-distribution flag use server-corrected times. The offline app shows a warning when its clock is more than 5 minutes off.

**R8 Retention (NFR07, UC06 QR2, Fig 5.12).** 90 days after an operation closes, household names, phone numbers and GPS points are removed from the working tables. The operation's data key is destroyed, which makes the personal data inside the immutable event log unreadable, and a `retention.redacted` audit entry is appended. Audit entries never contain personal values, only field names and keyed hashes. Distribution history and counts remain for reporting.

**R9 GPS (ERD, NFR07).** Recording a GPS point is optional, needs the household's separate permission, and is subject to R5 and R8.

**R10 Language (scope p.16–17, UC14 QR2, NFR18).** Head-of-household names are entered in English letters only. Area, organisation and relief-item names may also carry a Bangla name, and search matches either. The whole interface, the consent statement and the coverage labels are available in Bangla and English. Bangla is the default.

**R11 Coverage labels (FR21).** A household is *served* when it, or a household confirmed as the same family, has at least one non-cancelled distribution.

| Label | Bangla | Rule |
|---|---|---|
| No records | কোনো রেকর্ড নেই | 0 registered households (shown hatched, never as served, even with anonymous distributions) |
| Not served | ত্রাণ পৌঁছায়নি | ≥ 1 household, 0% served |
| Partly served | আংশিক ত্রাণ পৌঁছেছে | more than 0% and less than 100% served |
| Fully served | সব খানায় ত্রাণ পৌঁছেছে | 100% served |

Observers see area-level figures only, and counts from 1 to 4 are shown as "<5".

**R12 Duplicate scoring (FR18, Fig 5.14, Fig 5.16).** A pair is **likely** at a score of 0.80 or more and **possible** from 0.65 up to 0.80. (The class diagram's 0.85 and the state diagram's single 0.65 are superseded.) The score is the weighted mean of four signals. Phone (0.40) is 1 if equal, 0.7 if one digit differs, 0 if different, and 0.2 when either side has no number. Name (0.40) is Jaro-Winkler on normalised names with honorifics removed. Location (0.15) is 1 for the same ward and 0.4 for the same union. Family size (0.05) is 1, 0.6 or 0.25 for differences of 0, 1 or 2. Only households in the same union are compared. Measured precision and recall are in `docs/EVALUATION.md`.

**R13 Notifications (FR23, UC20).**
- Group Coordinators: new duplicates, conflicts and distribution flags involving their organisation, pending members, and join decisions.
- Operation Administrators: join requests and distribution flags in their operations.
- System Administrator: pending organisations and Operation Administrator accounts.
- Field volunteers: sync failing 3 times in a row, records waiting more than 24 hours, rejected records, reissued short codes, and unserved lists sent to them.

**R14 Editing rights (FR12, UC15).** Any member of an approved organisation may correct the name, family size, ward or GPS of a household in the operation. Only the registering organisation may change its mobile number. Only the recorder may cancel a distribution, within 24 hours. Conflicts are resolved by a coordinator of an involved organisation; the first saved decision wins.

**R15 Disaster types (NFR21).** Disaster types are records maintained by the System Administrator, not code.

**R16 Not collected.** §2.5 mentions "vulnerability flags", but no requirement or ERD field defines them. They are not collected (NFR05, data minimisation).

## 3. Diagram and document corrections

- The table of contents is wrong from §2.6 onward: Block Diagrams are pp.20–24, Ch.3 starts p.25, Ch.4 p.33, Ch.5 p.59 and the ERD is p.71.
- The ERD's "encrypted SQLite on phone" becomes an encrypted IndexedDB store (R1). The class diagram's `LocalStore.pinHash` is replaced by a PIN-wrapped data key, so no PIN hash is stored.
- ERD additions required by the use cases: organisation contact details, rejection reasons, `locked_until`, device short-code prefix, the distribution's device, organisation and "received elsewhere today" flag (Scenario 2), Bangla names, both authors of a conflict, per-signal duplicate scores, notification links, unserved-list releases, operation administrator teams, observer membership, and disaster types.
- UC16 2.a ("last confirmed batch") and FR14 ("where it stopped") both mean: resume from the first event the server has not confirmed.
- Fig 5.9's "waiting too long" is defined as more than 24 hours pending (configurable).
