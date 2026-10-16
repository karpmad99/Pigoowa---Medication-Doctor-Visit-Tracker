# Pigoowa — Project Specification

> **Status:** the domain types and pure business logic described in §7 and §10.3 (stage 2), the design system (stage 3) the browser-storage data layer of §10.4 (stage 4) and the medication screens (stage 5) are implemented and tested. The doses, appointments and dashboard screens come in stages 6 to 8. See [ROADMAP.md](ROADMAP.md) for progress.

Pigoowa is a web application for organising medications, dosage schedules, medication intake history and doctor appointments. The user interface is in Polish; code, database identifiers and technical documentation are in English.

## 1. Goals

1. **Portfolio project** – show React, TypeScript, testing, database design and engineering practices to prospective employers (Junior React Developer roles).
2. **Real product foundation** – a reliable base that can be released to real users and extended.

**Priorities, in order:** correctness → clarity/maintainability → security/privacy → UX polish → speed of delivery.

## 2. Health-related safety statement

Pigoowa is an **organisational tool**. It is not a medical device or decision-making system.

- It never diagnoses, never suggests changing a dose, and never decides whether a medication should be taken.
- Every schedule is **configured by the user**. The UI must not present it as verified by a healthcare professional (a short, permanent note such as *"Harmonogram ustawiony przez Ciebie – nie zastępuje zaleceń lekarza"* is shown where schedules are edited).
- No medication instructions, interaction data or dosing suggestions are bundled with the app.
- Stock and "days remaining" values are **estimates** and are labelled as such.
- Future reminders must not imply that a notification guarantees correct or safe medication use.
- Personal health data is sensitive: collect the minimum (see §9).
- Demo data is fictional only.

## 3. Scope

### 3.1 MVP (in scope)

Three sections: **Pulpit** (Dashboard), **Leki** (Medications), **Wizyty** (Appointments). Initially backed by mock data (stage 4), later by Supabase.

### 3.2 Explicitly out of scope for the MVP

AI assistant · OCR / prescription scanning · billing · family/caregiver sharing · external calendar sync · push notifications · complex analytics · social features · interaction checking. A doctors table (DEC-05), weekly/custom recurrence rules and an i18n library (DEC-08) are also deferred.

## 4. Functional requirements

### 4.1 Medications (`Leki`)

| ID | Requirement |
|---|---|
| M-1 | List all the user's medications. Empty state with a call to action. |
| M-2 | Add a medication: name (required), dose unit (required, free text with suggestions, e.g. *tabletka, ml, mg, kropla*), notes (optional), start date (default today), end date (optional). |
| M-3 | Edit a medication. |
| M-4 | **Ending a medication** (setting an end date) is the preferred, primary way to stop using it: the medication leaves today's and future schedules but its intake history is preserved. **Permanent deletion** is a secondary, clearly separated action. Its confirmation dialog must state explicitly: that the medication, its schedule **and its entire intake history will be permanently deleted**, how many history records will be lost (count), and that this cannot be undone; it offers "End medication instead" as the first alternative and requires a deliberate confirm action (not the default-focused button). |
| M-5 | Daily schedule: one or more administration times per day (`HH:mm`), each with its own dose amount (> 0). Two entries with the same time are rejected. |
| M-6 | Optional stock: current quantity (≥ 0, at most 3 decimals) with an explicit unit (the form pre-fills the medication's dose unit), recorded "as of" a moment. Updating stock resets that moment. |
| M-7 | Show an estimated remaining stock and days remaining **only if computable** (§7.3); otherwise show *"Szacunek niedostępny"* with the reason. |

### 4.2 Doses and intake history

| ID | Requirement |
|---|---|
| D-1 | For any selected day, show the scheduled doses generated from the schedule rules (§7.1). Default day: today. |
| D-2 | Mark a dose as **taken** or **skipped**. Both are recorded; the two are visually and semantically distinct. |
| D-3 | A dose with no record is **unrecorded** (*"Nie zapisano"*). The app never infers "taken". |
| D-4 | Undo/correction: a recorded dose can be changed (taken ↔ skipped), which **updates the existing record**, or cleared (back to unrecorded), which **deletes that same record**. Neither action ever creates a second record for the slot. Clearing an already-unrecorded slot is a harmless no-op. |
| D-5 | Marking a dose never modifies the schedule rules or any other day. |
| D-6 | Doses on future days cannot be recorded. Today and past days can. |
| D-7 | Repeating the same action (double click, duplicate request) results in exactly one record per dose. |
| D-8 | History view: chronological list of records, filterable by medication and date range, showing status, scheduled time, when it was recorded, and the dose amount/unit **as they were when recorded**. |
| D-9 | Records that no longer match the current schedule (e.g. schedule edited later) remain in history, labelled *"poza aktualnym harmonogramem"*. |

### 4.3 Appointments (`Wizyty`)

| ID | Requirement |
|---|---|
| A-1 | Add an appointment: doctor name and/or specialty (at least one required), date and time (required), location (optional), notes (optional). |
| A-2 | Edit an appointment. |
| A-3 | Delete after confirmation. |
| A-4 | Status: `scheduled` → `completed` or `cancelled` (reversible back to `scheduled` for corrections). |
| A-5 | "Upcoming" list: status `scheduled` and date/time in the future, grouped by date, soonest first. |
| A-6 | "Past" list: everything else, newest first, with a status badge. |
| A-7 | A `scheduled` appointment whose time has passed is shown as *"Do potwierdzenia"* with quick actions to mark it completed or cancelled. Its status is never changed automatically. |
| A-8 | No calendar library; a list grouped by date is sufficient. |

### 4.4 Dashboard (`Pulpit`)

| ID | Requirement |
|---|---|
| B-1 | Today's dose summary as counts: taken / skipped / unrecorded of total. **No percentages or "adherence scores"** (misleading with little data). |
| B-2 | List of today's doses with taken/skipped actions (same component and logic as D-1/D-2). |
| B-3 | Next upcoming appointments (up to 3). |
| B-4 | Stock summary: medications with a computable estimate, soonest-to-run-out first; medications with an estimate shorter than 7 days are highlighted. Medications without stock info are not listed as "low". |
| B-5 | Clear navigation to Leki and Wizyty. |
| B-6 | Loading, empty, error and partial-data states for every panel; one failing panel must not blank the whole page. |

## 5. Non-functional requirements

| Area | Requirement |
|---|---|
| Language | Polish UI; Polish date/number formats via `Intl` (`pl-PL`); 24-hour time. |
| Responsiveness | Usable from 360 px width to desktop. Mobile: bottom navigation; desktop: sidebar. |
| Accessibility | Target WCAG 2.1 AA: contrast, labels bound to inputs, visible focus, keyboard-operable dialogs and menus, status conveyed by text/icon not colour alone, error messages announced (`aria-live`/`role="alert"`). `eslint-plugin-jsx-a11y` enabled. |
| Type safety | `strict: true`, no `any` without a documented justification; no non-null assertion shortcuts to silence errors. |
| Testing | See §10. Deterministic: no dependency on wall-clock time or live services. |
| Security | RLS on every user-data table; no secrets in the frontend; only public Supabase URL + anon key in the client; ownership enforced in the database (see DATABASE.md). |
| Privacy | Minimal data (§9). Fictional data in public demo. Legal/privacy review before public release. |
| Browsers | Current evergreen Chrome, Firefox, Safari, Edge (last 2 versions). |
| Maintainability | Business logic is pure functions independent of React; data access behind interfaces; small components. |
| Dependencies | Every dependency has a stated purpose (§8). |

## 6. Assumptions and decisions

Ambiguities are resolved with reasonable, **reversible** choices (IDs `DEC-xx`). Requirement IDs use a different scheme (`M-`, `D-`, `A-`, `B-`).

| ID | Decision | Reasoning / how to reverse |
|---|---|---|
| DEC-01 | **Slots are generated, not stored.** A "scheduled dose" is computed from schedule rules for a date. Only *records* of taken/skipped doses are stored. | Avoids creating thousands of future rows and keeps rules separate from facts. Reversible later by materialising slots if reminders require it. |
| DEC-02 | **A dose record is identified by `(medicationId, scheduledDate, scheduledTime)`** with a uniqueness constraint. | Gives idempotency (D-7) at the database level. If the user edits a time, old records become "outside current schedule" rather than being rewritten. |
| DEC-03 | **`scheduleEffectiveFrom`** on each medication: set to *today* whenever schedule times change. Slots are generated only for dates ≥ `max(startDate, scheduleEffectiveFrom)`. | Prevents editing today's schedule from retroactively inventing "unrecorded" doses for past days. Limitation: days before the change show only recorded doses. |
| DEC-04 | **Dates and times are wall-clock values** (`LocalDate` = `YYYY-MM-DD`, `LocalTime` = `HH:mm`) interpreted in the user's IANA time zone. Instants (when a record was made, when an appointment starts) are UTC timestamps. | Medication times mean "08:00 where I am", also across DST changes. No date library needed: `Intl.DateTimeFormat` suffices for the zone conversions. |
| DEC-05 | **No `doctors` table in the MVP.** Appointments store doctor name and specialty as text. | Avoids a CRUD section nobody asked for. Add a table later if reuse (doctor contact data) is needed. |
| DEC-06 | **One dose unit per medication, dose amount per schedule time.** Example: morning 1 tabletka, evening 2 tabletki. Units are never converted into each other. | Prevents unit-conversion guesses (§7.3). |
| DEC-07 | **Dose records snapshot amount and unit** at recording time. | Later edits of a medication must not rewrite history; stock maths uses the snapshot. |
| DEC-08 | **No i18n library.** Polish strings live in components; validation functions return issue codes, and the Polish messages for them are attached in the form layer (stage 5). | YAGNI for a single-language MVP. Reversible by extracting strings later. |
| DEC-09 | **Ending a medication (end date) is the preferred option and preserves history.** Hard deletion exists as a secondary action that cascades to schedule and history, behind an explicit confirmation describing the consequences (M-4). | Intake history is valuable to the user (and to a doctor); deletion is irreversible. A hard-delete path is still needed to honour the right to erase personal data. Reversible: deletion can later be removed or replaced by archive/restore. |
| DEC-10 | **Default time zone** comes from the browser; later stored in the user's profile (default `Europe/Warsaw`). | Poland-first, but not hard-coded. |
| DEC-11 | **Mock data is persisted in `localStorage`** behind the same repository interface the Supabase implementation will use, with a "reset demo data" action (implemented in stage 4, see §10.4). | Lets reviewers and E2E tests exercise real flows with reloads. localStorage is acceptable only because the data is fictional; it is not a persistence layer for real health data. |
| DEC-12 | **TanStack Query is approved but added in stage 11** (Supabase integration), not earlier. Stages 4–10 use small custom data hooks over the repository interfaces, exposing the same `{ data, error, isLoading }` shape. | Server-state caching/invalidation/mutation handling is only really needed once data is genuinely remote. Until then it would be a dependency without a job. The hooks' shape is chosen so the later swap changes hook internals, not components. This is the only dependency outside the original list. |
| DEC-13 | **Native `<dialog>` for modals/confirmations; no UI kit.** | Built-in focus trapping and Escape handling; fewer dependencies. Reversible with Radix/Headless UI. |
| DEC-14 | **ID generation with `crypto.randomUUID()`** in the client for mock data; `gen_random_uuid()` in Postgres. | UUIDs avoid guessable IDs; same format both sides. |
| DEC-15 | **Stock stores its own unit** (`MedicationStock.unit`, DB column `stock_unit`), instead of implicitly using `Medication.doseUnit`. Stock whose unit differs from the dose unit gives an *unavailable* estimate (`incompatible-units`). *(Changed in stage 2.)* | Concrete correctness problem in the original draft: if the user later edited the medication's unit (say from "tabletka" to "ml"), the stored quantity would have been silently reinterpreted in the new unit. With an explicit unit the mismatch is detected and the user must re-enter stock. Cost: one extra column; the form pre-fills it, so users rarely see it. |
| DEC-16 | **No Zod in stage 2.** Validation is done by plain functions that return issue *codes* (`validateScheduleTimes`, `buildMedicationStock`, `validateAppointmentDraft`). Zod arrives with React Hook Form in stage 5 and wraps/reuses the same rules. *(Changed in stage 2.)* | Stage 2 was specified to add no runtime dependencies. Codes (not Polish sentences) keep the logic UI-independent; the UI maps codes to Polish messages. |
| DEC-17 | **Three explicit dose actions instead of one "upsert".** `recordDose` creates a record (or confirms an identical one), `changeDoseStatus` changes an existing record, `undoDose` removes it. `recordDose` refuses to overwrite a record that has a different status. *(Refined in stage 2.)* | "Never silently overwrite" and stale-screen safety: if a record was undone in another tab, a late "change to skipped" click must fail with `record-not-found` instead of resurrecting it. The database-level upsert (DATABASE.md) is still how the repository stores the result. |
| DEC-18 | **Supported calendar range is 1900–2999**; times are 24-hour `HH:mm` (`24:00` is invalid); timestamps must carry an explicit offset. | Rejects nonsense input and avoids the JavaScript `Date.UTC` two-digit-year quirk. |
| DEC-19 | **DST policy for converting a local date and time to an instant** (only needed for appointments): a wall-clock time that does not exist is rejected (`nonexistent-time`); one that occurs twice resolves to the earlier occurrence and is flagged `ambiguousTime`. | "Reject impossible values rather than silently normalise". Medication schedule times are never converted to instants, so DST cannot move them. |
| DEC-20 | **Repositories are plain storage: callers supply ids and timestamps; no `setStatus`.** *(Refined in stage 4.)* | Stage 2's functions already take ids and `now`. Keeping business rules out of repositories means the local and Supabase implementations stay interchangeable and the rules stay tested in one place. A status change is `changeAppointmentStatus` + `update`. |
| DEC-21 | **Storage format: one versioned envelope per collection, no migrations.** | Lets a future release recognise old data. Refusing unknown versions is safer than guessing; migrations would be speculative. |
| DEC-22 | **Corrupt or unknown stored data is an explicit error, never "empty", and is never overwritten.** Leftover records of a deleted medication are tolerated. | Treating damage as empty would let the next write destroy recoverable data. Tolerating orphans is needed because a medication deletion cannot be made atomic across two storage keys. |
| DEC-23 | **Demo data is loaded or reset only by explicit calls; reset backs up first; sample data is recognised by the `demo-` id prefix.** | No silent data changes; recoverable even from damage; no new field on the domain types is needed to tell sample data from the user's own. |
| DEC-24 | **`DoseLogRepository.upsert` stores by id and rejects a different record in the same slot (`duplicate-slot`).** *(Refines DEC-02 / DEC-17.)* | The Stage 2 functions decide create, update or no-op; storage must not silently replace some other record. The Supabase implementation maps its unique-violation to the same error. |
| DEC-25 | **Data hooks return a loading / loaded / failed union plus `reload`; the loader must keep its identity; superseded and late answers are ignored; reloading goes back through loading.** | Makes "failure shown as empty list" unrepresentable and prevents stale answers overwriting newer ones. TanStack Query (stage 11) replaces the internals only. |
| DEC-26 | **Development-only page `/dev/data` is the place where demo data is loaded and reset in stage 4.** | The roadmap asks for a reset action but no settings screen. A dev page exercises the layer in a browser without inventing production UI; it is excluded from production builds. |
| DEC-27 | **Zod is a thin adapter over the Stage 2 plain validation.** `medicationFormSchema` calls `validateMedicationForm` inside `superRefine` and maps issue codes to Polish messages. React Hook Form, Zod and `@hookform/resolvers` were installed in stage 5. *(Fulfils DEC-16.)* | One source of truth for the rules; the schema adds only messages and field paths. |
| DEC-28 | **`DoseLogRepository.countForMedication(medicationId)`** returns the number of intake records of a medication (0 for an unknown id; storage problems are errors, never 0). | The delete dialog must say how many records will be lost (M-4). The method is the smallest addition; the contract suite covers it. |
| DEC-29 | **Editing rules.** The effective date follows the start date only if it equalled the old start date, otherwise it is kept but never earlier than the new start; `applyScheduleChange` moves it to today only when the schedule really changes. Schedule row ids are kept. Stock keeps its `asOf` when the quantity is unchanged, is rebuilt (unit = dose unit, `asOf` = now) when changed and is removed when cleared. Intake records are never touched. | Preserves history and keeps the stock estimate honest (DEC-15). |
| DEC-30 | **Ending vs deleting in the UI.** Ending sets only `endDate` (and `updatedAt`) and keeps all history; deletion is a secondary action after counting the records, with an "end instead" alternative. If the count fails, deletion is not offered. A failed rollback is reported as possibly inconsistent data, never as success. | History is the user's record (DEC-09); consequences must be known before a destructive action. |

## 7. Business rules

### 7.1 Generating scheduled doses for a date

`generateScheduledDoses({ medications, doseLogs, date })` in `features/doses/logic/scheduledDoses.ts`. Pure; no clock access; inputs are never modified; the output is deterministic.

1. A medication is **active on `date`** when `startDate ≤ date`, (`endDate` is null or `date ≤ endDate`) and `date ≥ scheduleEffectiveFrom`. Inactive medications produce no doses.
2. The schedule is first **normalised** (`normalizeScheduleTimes`):
   - an entry whose amount is unusable (not a finite number > 0 with at most 3 decimals) is **skipped**;
   - if several entries share a time of day, **one is kept: the one with the smallest `id`**. Amounts are never added together (that would invent a dose nobody configured);
   - the result is sorted by time.
3. Each remaining schedule time produces exactly one dose `(medicationId, date, time, doseAmount, doseUnit)`, so the same slot can never appear twice.
4. A dose's **status** comes from the intake record with the same medication, date and time: `taken`, `skipped`, or `unrecorded` if there is none. Valid data has at most one record per slot; if corrupt data holds several, the most recently recorded one is shown (ties: highest `id`), so the output stays deterministic. Recording functions refuse to touch such a slot (§7.2).
5. Records for `date` that match no dose are returned separately as `outsideSchedule` (D-9): the schedule changed after they were recorded, the medication ended, or it no longer exists. Days before `scheduleEffectiveFrom` therefore show only recorded history.
6. Doses are ordered by time of day, then medication name (Polish collation, so "Cz…" sorts before "Ćm…"), then medication id. `outsideSchedule` is ordered by time, medication id, record id.

**Changing a schedule** (`applyScheduleChange`): if the effective schedule really changes (a time or an amount differs; ids and order are ignored), `scheduleEffectiveFrom` becomes today, or the start date if that is later (DEC-03). If nothing changed, the same medication object is returned.

**Daylight-saving time:** schedule times are wall-clock labels. A dose at `02:30` is generated exactly once on the night clocks go forward and on the night they go back (tested for 2026-03-29 and 2026-10-25 in `Europe/Warsaw`). Recording a dose never converts its time to an instant.

### 7.2 Recording a dose

`features/doses/logic/recording.ts`. All three functions are pure: they take the current records and return the *complete new list* plus what happened (`change`: `created | updated | unchanged | removed | none`) or an error. They never write anywhere, never mutate their input, and cannot leave two records for one slot. The caller persists the result (a repository, later; a state update in the UI).

| Function | Behaviour |
|---|---|
| `recordDose` | No record yet → **creates** one, copying the dose amount and unit as they are now (DEC-07). Same status already recorded → `unchanged` (safe to repeat, e.g. double click). **Different status already recorded → error `already-recorded`**: nothing is overwritten silently. |
| `changeDoseStatus` | Changes taken ↔ skipped by **updating the existing record** (same id; `recordedAt` becomes now; the originally recorded amount and unit are kept). No record → error `record-not-found` (never creates). Same status → `unchanged`. |
| `undoDose` | **Removes** the slot's record (the dose becomes unrecorded). No record → `none`: succeeds and creates nothing, so undo can be repeated. Other slots are untouched. |

Shared rules:

- `recordDose` and `changeDoseStatus` refuse a dose on a day **after today** (`future-date`). "Today" = the date in the user's IANA time zone at the injected `now`, so 22:30 UTC on the 15th is already the 16th in Warsaw. Undo is not date-restricted.
- `recordDose` refuses a dose whose amount or unit is unusable (`invalid-dose`) rather than storing a misleading record.
- Several records for one slot (impossible with the database's unique key) → `conflicting-records`; nothing is changed, because guessing which to keep or remove could destroy the wrong one.
- The id for a new record is passed in (`newLogId`) so the function stays deterministic.
- The UI disables a slot's buttons while its request is in flight.

### 7.3 Stock estimation

`estimateStock({ medication, doseLogs, today })` in `features/medications/logic/stock.ts`. Explicit assumptions (shown to the user in a help text):

1. Stock is the quantity the user entered, in **`stock.unit`**, valid *as of* `stock.asOf` (DEC-15).
2. `remaining = quantity − Σ doseAmount` over **taken** records of this medication whose `recordedAt ≥ asOf`. The amount is the snapshot stored in the record, not the current schedule amount. Skipped and unrecorded doses consume nothing. (Consequence: forgetting to record a dose makes the estimate optimistic – hence "estimate". Known limitation: changing a taken record to skipped and back after `asOf` moves its `recordedAt`, so a dose taken *before* the stock was entered could then be counted.)
3. `plannedDaily = Σ doseAmount` over the normalised schedule (§7.1; daily schedule only in the MVP).
4. `daysRemaining = floor(remaining / plannedDaily)`.
5. `remaining` is clamped at 0. All arithmetic is done in whole thousandths, so decimal doses cannot drift (0.3 ÷ 0.1 is exactly 3 days, not 2).
6. **Units are never converted.** Compared case-insensitively and ignoring surrounding/repeated spaces ("Tabletka " = "tabletka"); "mg" ≠ "ml".

The result is a discriminated union: `{ available: true, remaining, unit, daysRemaining }` or `{ available: false, reason }`. **Zero stock is an available estimate (`remaining: 0`)**, which is different from an unavailable one. Reasons, checked in this order:

| Reason | When |
|---|---|
| `no-stock` | The user entered no stock. |
| `invalid-data` | The stored quantity is negative, not finite or over-precise, or a counted record has an unusable amount. The data is not trusted and nothing is calculated. |
| `ended` | `endDate` is before today (on the last day an estimate is still given). |
| `no-schedule` | No usable schedule times. |
| `incompatible-units` | Stock unit ≠ dose unit, or a counted record's unit ≠ stock unit. |

`buildMedicationStock` validates stock typed into a form (quantity ≥ 0 with at most 3 decimals and at most 9 999 999.999; unit non-blank, at most 30 characters, trimmed) and stamps it with `asOf`. `isLowStock` is true only for an *available* estimate below `LOW_STOCK_THRESHOLD_DAYS` (7); unavailable is never "low". The threshold is a display constant, not medical guidance.

### 7.4 Appointments

`features/appointments/logic/`.

- Stored status: `scheduled | completed | cancelled`. The phase is **derived** by `classifyAppointment(appointment, now)` and never written back; the stored status changes only on user action:
  - `upcoming`: status `scheduled` and `scheduledAt ≥ now` (an appointment starting at exactly `now` still counts as upcoming);
  - `needs-confirmation`: status `scheduled` but `scheduledAt < now` (A-7); listed with past appointments;
  - `past`: status `completed` or `cancelled`, whatever the time (a cancelled future appointment is "past", A-6).
- `splitAppointments` returns `upcoming` (soonest first) and `past` (most recent first, includes `needs-confirmation`); ties are broken by id.
- `changeAppointmentStatus` allows `scheduled → completed | cancelled` and `completed | cancelled → scheduled` (correction). Going **directly between completed and cancelled is refused** (`invalid-transition`); the same status again succeeds with `changed: false`. Date and time are never touched. Marking a not-yet-started appointment completed is allowed (not blocked; reversible).
- `validateAppointmentDraft(draft, timeZone)` trims text (blank → `null`), requires a doctor or a specialty, checks the DATABASE length limits (120/120/200/1000), requires a real calendar date and a valid `HH:mm`, then converts date + time to an instant in the user's zone (DEC-19). It returns issue codes (`doctor-or-specialty-required`, `too-long`, `invalid-date`, `invalid-time`, `nonexistent-time`), never Polish text.

### 7.5 Dates, times and instants

- `LocalDate` (`YYYY-MM-DD`) and `LocalTime` (`HH:mm`) are **branded strings** produced only by `parseLocalDate` / `parseLocalTime`, which reject impossible dates (30 February, 29 February outside leap years), invalid times (`24:00`, `08:60`) and anything not in the exact format (DEC-18). The `as…` variants throw and are meant for constants and tests.
- `Timestamp` is a UTC instant in canonical form (`2026-10-15T08:30:00.000Z`). `parseTimestamp` accepts only ISO strings with an explicit `Z` or offset (such as Postgres returns) and normalises them.
- Calendar arithmetic (`addDays`, comparisons) works on dates only. Anything that needs a time zone (`getLocalDateInZone`, `localDateTimeToTimestamp`) lives in `utils/timeZone.ts` and uses the standard `Intl` API. No date library.
- Business functions never read the system clock: "now" is a `Timestamp` argument and "today" is derived from it and an IANA time zone.

## 8. Technology and dependency rationale

| Dependency | Purpose |
|---|---|
| React, React DOM | UI. |
| TypeScript (strict) | Static typing of domain model and UI. |
| Vite | Dev server and build. |
| Tailwind CSS | Utility styling with a small design-token set (colours, spacing, radii). |
| React Router | Client-side routing. |
| React Hook Form + Zod (+ resolver) | Forms with schema-based validation; the same Zod schemas can validate data at repository boundaries. |
| Supabase JS client | Auth and Postgres access (stage 11). |
| Vitest, React Testing Library, jsdom | Unit and component tests. |
| Playwright | End-to-end tests. |
| ESLint (typescript-eslint, react-hooks, jsx-a11y), Prettier | Static analysis and formatting. |
| *(stage 11)* TanStack Query | Server state for Supabase data: caching, invalidation, mutations (DEC-12). Not installed before then. |

Versions: the latest mutually compatible stable releases at the time of stage 1, pinned by the lockfile; exact versions are recorded in the README.

## 9. Data minimisation and privacy

Collected: e-mail (auth, later), display name (optional), time zone, medications (name, unit, notes, stock), schedule, intake records, appointments (doctor/specialty, location, notes).
Not collected: diagnoses, prescription numbers, national ID (PESEL), insurance data, photos, geolocation.
User notes are free text and may contain sensitive data – the UI should discourage entering more than necessary.
Before public release: document limitations, review GDPR (health data is a special category – Art. 9; explicit consent, privacy policy, data export/deletion, EU hosting region), and review security. This is tracked as the last roadmap stage.

## 10. Architecture

### 10.1 Principles

- **Feature folders** keep related UI, hooks, schemas and logic together.
- **Pure domain logic** (`logic/`) has no React or Supabase imports and is unit-tested directly.
- **Repository interfaces** (`services/`) hide the data source. Components and hooks depend on the interface; the mock and Supabase implementations are swappable.
- **Clock injection**: nothing in `logic/` or `utils/` reads the system clock. "Now" is a `Timestamp` argument and "today" is derived from it and an IANA time zone (stage 2). The React side will supply the current time through a provider (stage 3/4), so tests can freeze it.
- **Thin pages**: `pages/` only composes feature components for a route.
- No global state library: React state + context for clock/repositories; server state via small custom hooks until stage 11, then TanStack Query (DEC-12).

### 10.2 Directory structure

```
pigoowa/
├─ docs/                       Project documentation
├─ e2e/                        Playwright tests
├─ supabase/                   (stage 10+) migrations/ and database tests/
├─ public/
├─ src/
│  ├─ app/                     App root, router, providers (clock, repositories)
│  ├─ components/
│  │  ├─ ui/                   Generic primitives: Button, Field, Input, Select, Dialog,
│  │  │                        ConfirmDialog, Badge, Card, Spinner, EmptyState, ErrorState
│  │  └─ layout/               AppShell, SideNav, BottomNav, PageHeader
│  ├─ features/
│  │  ├─ medications/          components/, hooks/, logic/ (units, schedule, stock),
│  │  │                        schemas.ts (stage 5), types.ts
│  │  ├─ doses/                components/, hooks/, logic/ (slots, scheduledDoses, recording),
│  │  │                        types.ts   — daily doses and intake history
│  │  ├─ appointments/         components/, hooks/, logic/ (validation, status), types.ts
│  │  └─ dashboard/            components/ (composes the features above)
│  ├─ hooks/                   Cross-feature hooks (e.g. useClock)
│  ├─ lib/                     Configuration, Supabase client (later)
│  ├─ pages/                   Route-level components
│  ├─ services/                Repository interfaces + mock/ and supabase/ implementations
│  ├─ test/                    Test setup and fixtures (builders, assertOk)
│  ├─ types/                   Shared primitive types (Id, LocalDate, LocalTime, Timestamp)
│  ├─ utils/                   date.ts, timeZone.ts, quantity.ts; format.ts (pl-PL, stage 3+)
│  └─ main.tsx
└─ README.md
```

Deviation from the suggested layout: `doses` is its own feature because both Medications and Dashboard use it and it holds the most delicate logic; keeping it separate avoids circular dependencies between `medications` and `dashboard`.

Dependency direction: `pages → features → (components, hooks, services, utils, types)`. Features may import `types` from other features but not their components, except `dashboard`, which composes them.

### 10.3 Domain types (implemented in stage 2)

The code is the source of truth; this section only says where things live and what is notable.

| File | Contents |
|---|---|
| `src/types/primitives.ts` | `Id`, and the branded strings `LocalDate`, `LocalTime`, `Timestamp` |
| `src/features/medications/types.ts` | `Medication`, `ScheduleTime` (the schedule *rule*), `MedicationStock` |
| `src/features/doses/types.ts` | `DoseSlot` (medication + date + time: the uniqueness key), `DoseLog` (the *fact*), `ScheduledDose` (*derived*, never stored), `RecordedDoseStatus`, `DoseStatus` |
| `src/features/appointments/types.ts` | `Appointment`, `AppointmentStatus` |

Notable points:

- **Quantities** are a number plus a unit string: `ScheduleTime.doseAmount` (unit = `Medication.doseUnit`), `DoseLog.doseAmount` + `doseUnit` (a snapshot), `MedicationStock.quantity` + `unit` (DEC-15). Amounts are > 0 (doses) or ≥ 0 (stock), at most 3 decimals, at most 9 999 999.999 (matching `numeric(10,3)`); see `utils/quantity.ts`.
- **Branded strings** were kept because they cost almost nothing (a cast in three parse functions) and stop an unvalidated string from reaching date logic. Repositories must run values from storage through the parse functions.
- Stock estimates are a discriminated union (`StockEstimate`) so "unavailable" cannot be mistaken for a number.

### 10.4 Data layer (implemented in stage 4; `countForMedication` added in stage 5)

The code is the source of truth (`src/services/repositories.ts` has the interfaces with their documented behaviour); this section explains the design.

```ts
interface MedicationRepository {
  list(); get(id); create(medication); update(medication); remove(id);   // remove also deletes the history
}
interface DoseLogRepository {
  listByDateRange(from, to); countForMedication(medicationId); upsert(log); remove(slot);
}
interface AppointmentRepository {
  list(); get(id); create(appointment); update(appointment); remove(id);
}
```

- **All methods are async** and fail by rejecting with a `RepositoryError` whose `code` says why (`not-found`, `duplicate-id`, `duplicate-slot`, `missing-reference`, `invalid-input`, `data-corrupted`, `unsupported-version`, `storage-unavailable`, `storage-full`, `storage-write-failed`, `demo-data-not-empty`, `unexpected`). The message is Polish and never contains stored values; the `detail` is an English hint (such as the path of an invalid field) that is safe to log.
- **Repositories are plain storage.** They validate what they store but contain no business rules (DEC-20). Callers supply ids and timestamps. There is no `setStatus`: changing an appointment's status is `changeAppointmentStatus` (stage 2) followed by `update`.
- **Dose log semantics** (DEC-24): `upsert` stores a record by id. A different record already in the same slot is **not** overwritten but rejected (`duplicate-slot`); a record whose medication does not exist is rejected (`missing-reference`). `remove(slot)` on a slot without a record succeeds, so undo can be repeated.
- **Medication deletion** deletes its intake history too (DEC-09). Updating or ending a medication never touches the history, and records keep the amount and unit they were recorded with.
- **Returned objects are copies**; changing one never changes what is stored.
- **Services** are supplied once at the top as one `AppServices` object (`clock`, `timeZone`, `createId`, `repositories`, `demoData`) through a React context. Business functions still receive `now`/`today` as arguments; only the code that calls them reads the clock, through `useClock()`.
- **Data hooks** (`useMedications`, `useMedication(id)`, `useDoseLogs(from, to)`, `useAppointments`) return `{ data, error, isLoading, reload }` as a union: exactly one of loading, loaded or failed, so a failure is never an empty list (DEC-25).

#### Browser-storage implementation (`src/services/local`)

| Item | Decision |
|---|---|
| Keys | One key per collection: `pigoowa:v1:medications`, `pigoowa:v1:dose-logs`, `pigoowa:v1:appointments`; the backup is `pigoowa:v1:backup`. A problem in one collection never affects another. |
| Format and version | Each key holds `{ "version": 1, "items": [ ... ] }`. Data with another version is refused (`unsupported-version`), never guessed at. There are no migrations because there is nothing to migrate yet (DEC-21). |
| Validation | Everything is validated field by field when **read** (TypeScript says nothing about stored JSON) and before it is **written**, with the limits of docs/DATABASE.md. Timestamps are normalised to UTC. |
| Corrupt data | Not valid JSON, wrong shape, missing or invalid fields, duplicate ids, two records in one slot: `data-corrupted`. The operation stops before writing, so damaged data is **never treated as empty and never overwritten**. Leftover intake records whose medication no longer exists are tolerated (shown as history), not an error (DEC-22). |
| Storage failures | Storage that cannot be read: `storage-unavailable`. A refused write: `storage-full` (quota) or `storage-write-failed`; the previous data stays in place. The storage is looked up on every call, so even a blocked `window.localStorage` is reported inside the operation. |
| Atomicity | One key is written in one step. Deleting a medication writes two keys (medication, then history); if the second write fails, the first is restored. If even that fails the error says so. |
| Several operations | Every operation reads the current stored state, changes it and writes it in one synchronous step with nothing cached, so operations in one tab cannot interleave or overwrite each other's data. Several tabs are not coordinated: the last write wins. |
| Privacy | `localStorage` is readable plain text. It is acceptable only for fictional demo data and development, not for real health information (see §9). Nothing is logged to the console (enforced by a test). |

#### Demo data

`createDemoData({ now, timeZone })` (`src/services/demo`) is a pure function producing four medications, intake records and five appointments, all invented, with dates relative to today so "upcoming" stays upcoming. It covers the interesting cases for the Stage 2 rules: a schedule changed 10 days ago with older history, an ended medication, stock that is available and unavailable, and appointments that are upcoming, completed, cancelled and needing confirmation. Everything has an id starting with `demo-` (`isDemoId`), so the UI can mark sample data and tell it from the user's own (DEC-23).

- Nothing loads or resets demo data implicitly: reading and ordinary writes never touch it.
- `loadDemoData()` fills **empty** storage and refuses (`demo-data-not-empty`) if anything, even damaged data, is stored.
- `resetDemoData()` replaces everything. The previous raw contents of the three keys, damaged or not, are first copied to the backup key (one slot: only the most recent previous state is kept); if the backup cannot be written nothing is changed, and if writing the demo data fails the previous data is restored.

## 11. Main risks and edge cases

| Risk | Mitigation |
|---|---|
| Rewriting history when a schedule is edited | DEC-02, DEC-03, DEC-07, D-9. Unit tests with edited schedules. |
| DST changes (e.g. 02:30 does not exist on the spring-forward night; 02:30 occurs twice in autumn) | Slots are wall-clock values, never converted to instants; only "today" and `recordedAt` use the zone. Tests for 2026-03-29 and 2026-10-25 in `Europe/Warsaw`. |
| Midnight boundary (22:00 UTC is already tomorrow in Poland) | "Today" always computed through the user's zone; test at 23:30 and 00:30 local. |
| Duplicate submissions / double clicks | DB unique key + upsert; UI disables controls while pending; tests. |
| Misleading stock estimates | §7.3 explicit rules, labelled estimates, unavailable state. |
| Health-advice liability | §2; neutral wording ("Nie zapisano", not "Pominięto/Zapomniałeś"). |
| RLS misconfiguration | Composite FKs + policies + two-account tests (stage 10). |
| Mock-to-Supabase swap breaking behaviour | Shared repository contract tests run against both implementations. |
| localStorage holding health data | Fictional demo data only; real data only after Supabase. |
| Scope creep | Roadmap exit criteria per stage; excluded list §3.2. |
| Accessibility regressions | jsx-a11y lint rules, role/label-based RTL queries, Playwright keyboard-flow test. |

## 12. Testing strategy

- **Unit (Vitest):** slot generation, stock estimation, appointment grouping/status, date utils (DST, midnight), validation functions (Zod schemas join in stage 5).
- **Component (RTL):** forms (validation messages, no double submit), dose list actions, confirmation dialogs, empty/loading/error states.
- **Contract tests:** repository behaviour shared by mock and Supabase implementations.
- **E2E (Playwright):** the main journey — open dashboard → add medication → configure schedule → mark dose taken → verify history → add appointment → edit/cancel it. Uses the fixed clock (`page.clock`) and resets demo data before each test.
- **Database security (stage 10):** two test users; each must be unable to read, insert, update or delete the other's rows in every table.
- Checks run after every stage: `typecheck`, `lint`, `test`, and (when relevant) `build` and `e2e`.
