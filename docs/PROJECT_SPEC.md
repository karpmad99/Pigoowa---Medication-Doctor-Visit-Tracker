# Pigoowa — Project Specification

> **Status:** the domain types and pure business logic described in §7 and §10.3 (stage 2), the design system (stage 3), the browser-storage data layer of §10.4 (stage 4), the medication screens (stage 5), the day view, intake history and stock display (stage 6), the appointment screens (stage 7), the dashboard (stage 8), and the demo notice, accessibility fixes, end-to-end tests and static-hosting configuration of stage 9 are implemented and tested, and the demo is deployed on Vercel (its live behaviour was checked by hand by the owner for the main routes only; see [ROADMAP.md](ROADMAP.md) stage 9). See [ROADMAP.md](ROADMAP.md) for progress. **A medication feature track (F0–F8: storage v2, a time field, a visual refresh, units and strength, details page and own low-stock threshold, stock events, actually taken amount) is decided and described here (DEC-44 to DEC-53, §4.5, §7.6, §10.5) but not implemented.** Everything in this document marked *planned* describes intended behaviour, not existing functionality.

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

AI assistant · OCR / prescription scanning · billing · family/caregiver sharing · external calendar sync · push notifications and dose reminders (a future requirement, see ROADMAP "Dose reminders"; nothing is promised about background delivery) · complex analytics · social features · interaction checking. A doctors table (DEC-05), weekly/custom recurrence rules and an i18n library (DEC-08) are also deferred.

## 4. Functional requirements

### 4.1 Medications (`Leki`)

| ID | Requirement |
|---|---|
| M-1 | List all the user's medications. Empty state with a call to action. |
| M-2 | Add a medication: name (required), dose unit (required, free text with suggestions, e.g. *tabletka, ml, mg, kropla*; **a choice from a list that depends on the dosage form is planned, F-1, DEC-45**), notes (optional), start date (default today), end date (optional). |
| M-3 | Edit a medication. |
| M-4 | **Ending a medication** (setting an end date) is the preferred, primary way to stop using it: the medication leaves today's and future schedules but its intake history is preserved. **Permanent deletion** is a secondary, clearly separated action. Its confirmation dialog must state explicitly: that the medication, its schedule **and its entire intake history will be permanently deleted**, how many history records will be lost (count), and that this cannot be undone; it offers "End medication instead" as the first alternative and requires a deliberate confirm action (not the default-focused button). |
| M-5 | Daily schedule: one or more administration times per day (`HH:mm`), each with its own dose amount (> 0). Two entries with the same time are rejected. |
| M-6 | Optional stock: current quantity (≥ 0, at most 3 decimals) with an explicit unit (the form pre-fills the medication's dose unit), recorded "as of" a moment. Updating stock resets that moment. *(Planned: refills and waste as separate events, F-5 to F-7, DEC-47.)* |
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
| B-4 | Stock summary: medications with a computable estimate, soonest-to-run-out first; medications with an estimate shorter than 7 days are highlighted. Medications without stock info are not listed as "low". *(Planned: a medication's own threshold replaces the 7-day rule for that medication, F-4, DEC-46.)* |
| B-5 | Clear navigation to Leki and Wizyty. |
| B-6 | Loading, empty, error and partial-data states for every panel; one failing panel must not blank the whole page. |

### 4.5 Planned medication features (F-track; not implemented)

These requirements are decided in stage F0 and implemented in stages F2–F8 (ROADMAP). The sections 4.1 to 4.4 above still describe what exists today. Technical decisions: DEC-44 to DEC-53; rules: §7.6.

| ID | Requirement | Stage |
|---|---|---|
| F-1 | **Dosage form and units from lists.** A medication has an optional dosage form. The dose unit and the stock unit are chosen from lists that depend on the form, not typed. A unit that is not on the list (data saved earlier) stays visible and unchanged until the user chooses another one. No conversion between units, ever. | F4 |
| F-2 | **Strength is information.** An optional strength (a number and a unit such as *mg*) can be added to a medication. It is shown, but it is not the dose unit or the stock unit and takes no part in any calculation. | F4 |
| F-3 | **A time field that can be typed.** Times can be typed (`7:30`, `0730`, `07:30`) or chosen with large quick-pick buttons, with the system picker as an option. Invalid input gives a clear message. | F2 |
| F-4 | **Own low-stock threshold.** Per medication, the user can set a quantity (in the stock unit). The app warns when the estimated stock is **at or below** it. Without a threshold the 7-day rule applies as today. The warning is shown in the medication's details and on the dashboard. | F5 |
| F-5 | **Medication details.** A page for one medication with its schedule, stock estimate, threshold and the history of stock events, and the place for the actions below. | F5 |
| F-6 | **Refill stock.** An action in the medication's details adds a quantity to the stock, in the stock unit. It records when and how much, keeps the earlier history, does not allow a past date in the first version, and never counts anything twice. It can be reversed. Tracking can be started from the details page by counting what is there or by starting from a new package, never from an invented or unknown-as-zero quantity (DEC-52). | F6 |
| F-7 | **Wasted medicine.** A separate event reduces the stock by an amount, with an optional note that belongs to the event. It does not mark any dose as taken and is not a skipped dose. It can be reversed. | F7 |
| F-8 | **Actually taken amount.** A taken dose can record a different amount than planned (for example 2 tablets instead of 1), with an optional note that belongs to the dose record. The plan stays recorded next to it. The schedule and the doctor's recommendation are never changed. The stock estimate uses the amount actually taken. | F8 |
| F-9 | **Next unrecorded dose.** On the dashboard the next dose without a record is highlighted. This is presentation only: it is not a status and uses no new rule (DEC-50). | F3 |

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
| DEC-21 | **Storage format: one versioned envelope per collection, no migrations.** *(The "no migrations" part is superseded for the F-track by DEC-44: the first migration, v1 to v2, is planned.)* | Lets a future release recognise old data. Refusing unknown versions is safer than guessing; migrations would be speculative. |
| DEC-22 | **Corrupt or unknown stored data is an explicit error, never "empty", and is never overwritten.** Leftover records of a deleted medication are tolerated. | Treating damage as empty would let the next write destroy recoverable data. Tolerating orphans is needed because a medication deletion cannot be made atomic across two storage keys. |
| DEC-23 | **Demo data is loaded or reset only by explicit calls; reset backs up first; sample data is recognised by the `demo-` id prefix.** | No silent data changes; recoverable even from damage; no new field on the domain types is needed to tell sample data from the user's own. |
| DEC-24 | **`DoseLogRepository.upsert` stores by id and rejects a different record in the same slot (`duplicate-slot`).** *(Refines DEC-02 / DEC-17.)* | The Stage 2 functions decide create, update or no-op; storage must not silently replace some other record. The Supabase implementation maps its unique-violation to the same error. |
| DEC-25 | **Data hooks return a loading / loaded / failed union plus `reload`; the loader must keep its identity; superseded and late answers are ignored; reloading goes back through loading.** | Makes "failure shown as empty list" unrepresentable and prevents stale answers overwriting newer ones. TanStack Query (stage 11) replaces the internals only. |
| DEC-26 | **Development-only page `/dev/data` is the place where demo data is loaded and reset in stage 4.** | The roadmap asks for a reset action but no settings screen. A dev page exercises the layer in a browser without inventing production UI; it is excluded from production builds. |
| DEC-27 | **Zod is a thin adapter over the Stage 2 plain validation.** `medicationFormSchema` calls `validateMedicationForm` inside `superRefine` and maps issue codes to Polish messages. React Hook Form, Zod and `@hookform/resolvers` were installed in stage 5. *(Fulfils DEC-16.)* | One source of truth for the rules; the schema adds only messages and field paths. |
| DEC-28 | **`DoseLogRepository.countForMedication(medicationId)`** returns the number of intake records of a medication (0 for an unknown id; storage problems are errors, never 0). | The delete dialog must say how many records will be lost (M-4). The method is the smallest addition; the contract suite covers it. |
| DEC-29 | **Editing rules.** The effective date follows the start date only if it equalled the old start date, otherwise it is kept but never earlier than the new start; `applyScheduleChange` moves it to today only when the schedule really changes. Schedule row ids are kept. Stock keeps its `asOf` when the quantity is unchanged, is rebuilt (unit = dose unit, `asOf` = now) when changed and is removed when cleared. Intake records are never touched. | Preserves history and keeps the stock estimate honest (DEC-15). |
| DEC-30 | **Ending vs deleting in the UI.** Ending sets only `endDate` (and `updatedAt`) and keeps all history; deletion is a secondary action after counting the records, with an "end instead" alternative. If the count fails, deletion is not offered. A failed rollback is reported as possibly inconsistent data, never as success. | History is the user's record (DEC-09); consequences must be known before a destructive action. |
| DEC-31 | **Routes and navigation for stage 6.** The day view is `/doses` (`?date=YYYY-MM-DD`), the history `/doses/history` (`?from=&to=&medication=&status=`), both under the navigation item *Dawki*. State lives in the address, so a reload or the back button keeps it. An invalid value in the address is ignored and the user is told. | The roadmap names no routes. The address as state makes the views linkable and testable without extra state code. |
| DEC-32 | **Dose writes read storage first and are single-flight.** `applyDoseAction` reads the slot's records from storage, applies Stage 2's `recordDose` (unrecorded on screen) or `changeDoseStatus` (recorded on screen) or `undoDose`, then `upsert` / `remove`. A stale screen therefore gets `already-recorded` / `record-not-found` and a refresh, never an overwrite or a resurrected record. One write runs at a time; the buttons stay disabled until the refresh after it finished. | D-4/D-7 hold even with two tabs or a double click; the screen is never trusted over storage. |
| DEC-33 | **Records are loaded once and sliced in memory.** Both pages load all intake records (`EARLIEST..LATEST`) once; the day, the history filters and the stock estimates are derived from that. After a write the list is refreshed with `keepDataOnReload`; a failed refresh becomes an error. | No per-day request can arrive late and overwrite another day; no spinner flash after small writes. Fine for a local, single-user data set; stage 11 revisits it with TanStack Query and server-side range queries. |
| DEC-34 | **Records outside the current schedule are read-only in the day view and can be deleted, one at a time, from the history.** They are shown with *Poza aktualnym harmonogramem* and a reason that is certain (medication deleted, before the start, after the end, before the schedule change, time not in the schedule). They cannot be changed or recorded again. The history offers *Usuń zapis…* for exactly these records only; a confirmation dialog states what goes (this record, permanently, no undo) and what stays (schedule, other records), with Cancel focused first. `deleteOutsideScheduleRecord` re-checks against storage that the slot still holds the same record (id and status) and that it is still outside the schedule, then uses the slot-based `remove`. | A historical fact must not be rewritten or duplicated by accident (D-9), yet a wrongly recorded dose must not be uncorrectable (the day view cannot reach it, and deleting the medication would destroy all its history). No new repository method or domain type was needed. Residual risk: the repository has no compare-and-delete, so a change by another tab in the milliseconds between the check and the removal cannot be excluded. |
| DEC-35 | **Unit grammar is limited to known units.** `formatAmount` inflects a small table of common Polish units (and keeps `ml`, `mg`, ... unchanged); any other unit is shown exactly as typed. | The unit is free text; guessing grammar for arbitrary words would be wrong more often than right, and changing the user's text is worse. |
| DEC-36 | **Appointment screens use the Stage 2 rules unchanged.** Tabs, grouping, labels and actions are derived from `classifyAppointment`, `splitAppointments`, `changeAppointmentStatus` and `validateAppointmentDraft`; the Zod schema only adds Polish messages and field paths. Routes: `/appointments` (`?tab=past`), `/appointments/new`, `/appointments/:id/edit`. An appointment is grouped under the calendar date on the wall clock in the user's zone. | One source of truth for the rules; no new classification was invented (A-5 to A-7). |
| DEC-37 | **Appointment writes read storage first.** Status changes and edits are applied to the STORED appointment (`appointmentActions.ts`); a refused transition (`invalid-transition`) or an appointment deleted elsewhere is reported and the list refreshed; an edit with nothing changed writes nothing; editing never changes `id`, `status` or `createdAt`. If the typed date and time are the ones the appointment already has, its exact instant is kept. | A stale screen must not overwrite a newer status; re-saving must not silently move a visit at the repeated 02:30 by an hour. |
| DEC-38 | **Elapsed appointments are only ever labelled.** *Do potwierdzenia* is a label with quick actions; nothing marks, hides or deletes an appointment because its time has passed (A-7). A restored (completed/cancelled → scheduled) appointment whose time has passed is *Do potwierdzenia* again, and the notice says so. | The app cannot know what happened at the visit. |
| DEC-39 | **The dashboard composes existing logic and adds none.** Dose rows, counts, writes, stock estimates, appointment classification and labels are the Stage 6 and 7 ones (`generateScheduledDoses`, `summarizeDay`, `applyDoseAction`, `estimateStock`, `splitAppointments`, `classifyAppointment`). Two thin selectors were added: `summarizeStock` (computable estimates only, fewest days first, count of the rest) and `selectDashboardAppointments` (next three, count awaiting confirmation). Counts only: no percentages, no adherence score (B-1). | One source of truth; nothing for the dashboard to get subtly different. |
| DEC-40 | **Panels fail independently.** Doses and stock share one read of medications and intake records (a write must update both); appointments are read separately. A failing read shows an error with a retry in the panels that need it and never hides the others or becomes an empty state (B-6). Ended medications are neither listed nor counted as "no estimate"; this is decided by the medication's status, because an estimate without stock says "no stock" before "ended". | Honest partial data; no false "all fine" and no blank page. |
| DEC-41 | **Browser accessibility is checked with axe-core, as a dev dependency.** `@axe-core/playwright` scans the rendered pages (contrast, names, landmarks, forms) for the WCAG 2.0/2.1 A/AA and best-practice rules; the static `jsx-a11y` lint cannot see these. A self-check proves the scan detects injected problems, and the 44 px touch-target rule (stricter than axe's 24 px) is its own test. Automated checks are not a substitute for manual review with assistive technology. | Runtime checks catch what static checks cannot; the dependency is dev-only (MPL-2.0) and ships nothing to users. |
| DEC-42 | **The demo says what it is on every page.** A non-dismissible region states that the data is fictional, kept only in this browser, not encrypted, and that real medical or personal data must not be entered. It is a demo-build element that disappears when protected persistence arrives (stages 10-11). | A deep link must never land on a page that looks like a real health service. |
| DEC-43 | **The demo is a static site that starts empty.** `vercel.json` rewrites non-file paths to `/index.html`; no backend, secrets or environment variables exist. The sample-data loader stays development-only, so visitors enter invented data themselves. The production build is verified by `npm run e2e:preview`; the live hosting was checked by hand by the owner (main routes, reload, response headers, `/dev/data` absent), not by an automated test. No Content-Security-Policy has been designed or tested. | Keeps the demo honest and simple; says only what was observed. |
| DEC-44 | **Storage versioning: envelope version 2 with a migration and backups (option B).** The F-track adds persisted fields and a collection. The envelope version of every collection becomes `2`; the storage **keys keep their names** (`pigoowa:v1:…`). The migration works **one collection at a time**: it validates the stored version 1 text, copies that text verbatim into that collection's own backup key, reads the copy back, and only then rewrites the collection as version 2 with the same items. New code never writes over a version 1 collection (the write gate, DEC-53). The migration is resumable, **not atomic**. States, interruption behaviour, what is and is not guaranteed, old copies, the backup policy and the quota: §10.5. | Option A (new optional fields, version stays 1) is simpler, but any older copy of the app (another tab, an older deployment) would silently **drop** the new fields on its next write, because the validators rebuild every record from the known fields only (`src/services/local/validation.ts`). With version 2 an older copy refuses to read (`unsupported-version`) and, through its normal screens, writes nothing (the exceptions are in §10.5). New keys (`pigoowa:v2:…`) were rejected: an old tab would keep writing the old keys and the two copies would drift apart without any error. |
| DEC-45 | **Dosage form and units from lists; strength is separate information; nothing is converted.** `Medication.dosageForm?` (optional: *tablet, capsule, liquid, drops, injection, sachet, patch, suppository, inhaler, other*) selects the lists of dose units and stock units offered. `Medication.strength?` (`{ value, unit }`) is information only. Three quantities are kept apart: **strength** (what the product contains), **dose amount** (how much is taken, in the dose unit) and **stock quantity** (how much is left, in the stock unit). Stored units remain plain text, so existing values such as `tabletka` or `ml` are valid without being rewritten. A stored unit that is not on the list for the form stays displayed and is never replaced automatically; it is kept until the user picks another unit, and once replaced it cannot be typed again. A stock unit that differs from the dose unit is allowed, but the form says at once that no estimate will be possible (units are never converted). What the user sees for such a unit, and how incompatible units are kept out of every calculation, is in §7.6 ("Units that are not on the list"). The lists are given in §7.6 and are final when F4 is done. | Today `Medication.doseUnit` is free text and the form even suggests *mg* as a dose unit (`MedicationForm.tsx`), which mixes the strength of a product with the thing that is counted. Lists remove typing errors; keeping stored text avoids rewriting anyone's data. |
| DEC-46 | **Own low-stock threshold per medication.** `Medication.lowStockThreshold?: { quantity, unit } \| null`: a quantity in a unit. If it is set, the unit equals the stock unit, and the estimate is available, the warning shows when `remaining <= threshold.quantity`. Without a threshold the existing rule applies unchanged (fewer than 7 days, `LOW_STOCK_THRESHOLD_DAYS`). If the threshold's unit differs from the stock unit (the stock was counted again in another unit), the threshold is **not applied**, the 7-day rule applies, and the app says so. An unavailable estimate is never "low", as today. | The user asked for a per-medication quantity. Storing the unit next to it (like DEC-15) keeps an old number from being reinterpreted; falling back to the 7-day rule errs on the side of warning. |
| DEC-47 | **Stock changes are an append-only ledger of events.** A new collection `pigoowa:v1:stock-events` (envelope version 2) holds `StockEvent` records of kind `refill` or `waste` (§7.6). The stock itself stays the existing snapshot (`MedicationStock`: quantity, unit, `asOf`); events never edit it. The estimate adds refills and subtracts waste that were recorded at or after `asOf`, exactly like taken doses. An event is never deleted by the app: reversing it sets `reversedAt`, so the history is kept. Events are appended with **one write to one collection**, so no operation needs atomicity across keys. Deleting a medication deletes its events with the existing rollback pattern (as for its dose records), now over three keys. No back-dating in the first version: `recordedAt` is the moment of entry. A refill needs an existing stock (a baseline) and uses its unit; a medication without a baseline starts tracking as described in DEC-52. An event's note belongs to the event itself (`StockEvent.note`), for refills and for waste. | The snapshot-plus-events model reuses the rule that already decides what counts (`recordedAt >= asOf`, §7.3), so a refill cannot be counted twice and entering a new count simply makes older events historical. Editing the quantity for a refill would lose what was added and when. |
| DEC-48 | **The amount actually taken is stored next to the plan, never instead of it.** `DoseLog.doseAmount` and `doseUnit` stay the snapshot of the **plan** (DEC-07). New optional `takenAmount` (only for `taken`, in `doseUnit`) and `note` (only for `taken`). Absent `takenAmount` means "as planned". The stock estimate uses `takenAmount ?? doseAmount`. Changing a record to *skipped* removes both; changing back to *taken* starts from the plan again. Editing the amount or the note does **not** move `recordedAt`. A separate pure action (`adjustTakenAmount`) edits them, checks that the stored record is the one the user saw, and treats the same value as unchanged; repeating `recordDose` with the same status stays `unchanged`. **Notes belong to the thing they explain:** the `note` of a taken dose is stored on the dose record (`DoseLog.note`) and only for a taken dose; a note about wasted medicine is stored on the `waste` event (`StockEvent.note`) and never on a dose record, because a waste event has no dose slot. The limit of 500 characters, **approved by the owner**, applies to this note on its own; the note of a stock event has its own limit of 500 (§7.6). The notes of medications and appointments allow 1000. | The existing message *Zapisana dawka … (obecnie w harmonogramie …)* means "the schedule changed after recording" and must not also mean "taken differently". Not moving `recordedAt` avoids the known problem of §7.3 (a changed record counting again). |
| DEC-49 | **The time field is a text input with normalisation, quick picks and an optional system picker.** One field accepts `7:30`, `0730`, `730`, `07:30` and `7.30`, shows `GG:MM` after leaving the field, and rejects everything else with a message. Large quick-pick buttons offer common times; a button opens the native picker where the browser supports it. The value in the form stays the text `HH:mm`, so the schema and the stored data do not change. | The system picker of a phone is drawn by the operating system and a page cannot make it accept typing or make its icon larger. |
| DEC-50 | **"Next unrecorded dose" is a presentation choice, not a rule.** On the dashboard the first dose of today, in schedule order, whose status is *unrecorded* is highlighted. It does not look at the clock, so it can never be read as "late" or "missed"; the wording stays neutral (as *Nie zapisano*, D-3). No such dose: nothing is highlighted. The choice is a pure function with tests. Wording and look are fixed in F3. | The user wants the next action to be obvious. Using only the schedule order adds no domain rule and no claim about what the user did. |
| DEC-51 | **The F-track is described before Stage 10 and planned to be built before it.** The new fields and the stock events table are in DATABASE.md (§3.2, §3.4, §3.6, §9) so that the stage 10 schema contains them. If the owner builds Stage 10 first, it must still create them. The order of F0 to F8 among themselves is in the ROADMAP dependency table. | One schema, not a schema plus an immediate migration. |
| DEC-52 | **Starting stock tracking without a known quantity (accepted by the owner).** A refill needs a baseline, so the medication's details page (F6) offers one clear way to create it, *Zacznij śledzić zapas*, with two explicit choices. (a) **"Policzyłem, ile mam teraz"**: the user types the quantity (a typed `0` is allowed, an empty field is not zero and is refused) and the baseline gets `basis: 'counted'`; this is what editing the stock does today. (b) **"Zaczynam od nowego opakowania"**: the user types the size of the new package and the baseline gets `basis: 'new-package'`: the estimate counts from the new package and does **not** count anything left from before, and the screen says so in words (*Liczone od nowego opakowania … Wcześniejszej pozostałości nie uwzględniamy*, §7.6). If the user does neither, nothing is created and the estimate stays unavailable (`no-stock`): **an unknown quantity is never stored as zero, and no quantity is invented.** `MedicationStock.basis?` is optional; absent means `counted`, so existing data is unchanged. Editing the quantity in the medication form is a count and sets `counted`. `basis` is not used in the formula; it only changes what the screens say, and the three states (counted, new package, unknown) are worded and presented differently (§7.6, "The three stock states on screen"). The empty field is never zero. | Rejected: a refill with no baseline (it would not change any estimate, and "I added 30 and still see nothing" would mislead); an informational refill recorded at the same instant as a new count (it would be counted twice, because events at or after `asOf` count). Choice (b) underestimates when something was left, which is the safe direction, and it says what it assumes. |
| DEC-53 | **The migration is made resumable by four stated mechanisms; it is not atomic and it is not full protection (accepted by the owner on condition).** The owner's conditions: the write gate, the per-collection backup, the verification and the absence of automatic deletion are kept, and the mechanism is never presented as full protection against old copies, races between tabs or browser failures; §10.5 is worded accordingly. (1) **Write gate:** new code accepts only version 2 (or an absent key) as the state of a collection it is about to write; a version 1 collection can be read, if its format is fully recognised (§10.5, "Recognition"), but every write to it is refused (`migration-required`, a new error code), so no version 2 write can come before that collection's backup. The gate is derived from the stored version at the moment of the write, so it holds in every tab running new code and keeps no flag that could go stale. (2) **Per-collection backup**, written and read back before that collection is rewritten. A backup is never trusted because it exists: in each run the original, the backup and its provenance entry are classified (§10.5, "Resuming"). A backup is written or replaced only while the original is version 1; **the backup of a collection that is already version 2 is never written, replaced or deleted by the migration**, even though it differs from the original. The copy is identified by a fingerprint (the SHA-256 of its exact text, recorded in `meta` before the rewrite): length and record count alone do not identify a copy, and the fingerprint is not protection against deliberate change. (3) **Compare before write:** the stored text is read again immediately before the rewrite and the rewrite is abandoned if it changed. (4) **Read-back verification** after the rewrite. A collection whose original format is not unambiguously recognised and supported is neither read nor written. The migration backup is **never deleted automatically**; removing it is an explicit user action, offered only for a verified backup, and is not part of F1. **There is no migration without a backup:** when there is no room for a collection's backup, that collection stops and a message is shown (decision of the owner). A restore screen was deferred by the owner; the requirements for a future tool are in §10.5. Limits that remain, including the race between two tabs, old copies, browser failures and the storage quota: §10.5. | Atomic multi-key writes do not exist in `localStorage`, so the design makes every intermediate state readable and every step repeatable, and says plainly what it cannot exclude. |

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
- The UI (stage 6, DEC-32) disables **all** dose buttons while a write runs and while the list refreshes after it, so a click cannot land on a row that is about to change.

### 7.3 Stock estimation

`estimateStock({ medication, doseLogs, today })` in `features/medications/logic/stock.ts`. Explicit assumptions (shown to the user in a help text):

1. Stock is the quantity the user entered, in **`stock.unit`**, valid *as of* `stock.asOf` (DEC-15).
2. `remaining = quantity − Σ doseAmount` over **taken** records of this medication whose `recordedAt ≥ asOf`. (`recordedAt` is *when the user recorded, or last changed, the record in the app* (§7.2): it is not the dose's scheduled time and not when the pill was physically taken, which the app does not know. Stage 6 checked every path that writes it, see below.) The amount is the snapshot stored in the record, not the current schedule amount. Skipped and unrecorded doses consume nothing. (Consequence: forgetting to record a dose makes the estimate optimistic – hence "estimate". Known limitation: changing a taken record to skipped and back after `asOf` moves its `recordedAt`, so a dose taken *before* the stock was entered could then be counted.)
3. `plannedDaily = Σ doseAmount` over the normalised schedule (§7.1; daily schedule only in the MVP).
4. `daysRemaining = floor(remaining / plannedDaily)`.
5. `remaining` is clamped at 0. All arithmetic is done in whole thousandths, so decimal doses cannot drift (0.3 ÷ 0.1 is exactly 3 days, not 2).
6. **Units are never converted.** Compared case-insensitively and ignoring surrounding/repeated spaces ("Tabletka " = "tabletka"); "mg" ≠ "ml".

**What `recordedAt` does to the estimate (verified in stage 6 by `stockWithRecording.test.ts`, which runs the real recording path at chosen moments):**

| Situation | Effect on the estimate |
|---|---|
| A dose recorded as *taken* after the stock was entered | Counted once. |
| *Skipped*, or never recorded | Not counted. |
| *Taken* changed to *skipped* | The amount comes back. Changed back to *taken*: counted again, once (it is the same single record). |
| A *taken* record cleared | The amount comes back. A new record later is counted from its own `recordedAt`. |
| Repeating the same status | No change, and `recordedAt` does not move. |
| The schedule amount edited after recording | The recorded amount is still the one subtracted. |
| The stock edited (quantity changed) | `asOf` becomes now: only doses recorded from then on count. With an unchanged quantity `asOf` is kept. |

Two consequences follow from using the *recording* moment and are **accepted limitations, not bugs**, because the app has no "taken at" time to use instead (and the alternative, using the scheduled time, goes wrong in the opposite cases):
1. **Recording late.** A dose taken in the morning, before the stock was counted at noon, but entered in the afternoon is counted again, so the estimate is too low (the safe direction).
2. **Correcting later.** A *taken* record made before the count is not counted; if it is changed to *skipped* and back to *taken* after the count, `recordedAt` is "last changed", so it is then counted.

The remedy for both is to enter the actual quantity again in the medication's edit form, which starts the count afresh. The stock explanation in the app says so. A real fix (a separate "taken at" time on the record) would be a domain-model change and is left to a later decision.

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

### 7.6 Planned stock and intake rules (F-track; not implemented)

Nothing in this section exists in the code yet; §7.3 is what the application does today. The planned rules **extend** §7.3 and keep its principles: units are never converted, an estimate is shown only when it can be computed, and what the user did is never invented.

**Types (planned).**

```ts
type DosageForm = 'tablet' | 'capsule' | 'liquid' | 'drops' | 'injection'
  | 'sachet' | 'patch' | 'suppository' | 'inhaler' | 'other';

MedicationStock += { basis?: 'counted' | 'new-package' }                      // absent = counted (DEC-52)
Medication  += { dosageForm?: DosageForm;
                 strength?: { value: number; unit: string } | null;          // information only
                 lowStockThreshold?: { quantity: number; unit: string } | null }
DoseLog     += { takenAmount?: number; note?: string | null }                // only when status = 'taken'
StockEvent   = { id; medicationId; kind: 'refill' | 'waste';
                 amount: number; unit: string; recordedAt: Timestamp;
                 note: string | null; reversedAt: Timestamp | null }
```

Limits: quantities as everywhere (`> 0` for amounts and events, `>= 0` for thresholds, at most 3 decimals, at most 9 999 999.999); notes at most 500 characters after trimming, **separately** for `DoseLog.note` and for `StockEvent.note` (approved by the owner; the notes of medications and appointments allow 1000).

**Where notes live.** `DoseLog.note` explains an amount actually taken and exists only on a taken dose. `StockEvent.note` explains a refill or a waste event and exists only on that event. A waste note is never written to a dose record, and a waste event is never attached to a dose slot. Hint text under both fields says what the existing note fields say: *Nie wpisuj więcej danych, niż potrzebujesz.*

**The estimate with events.** With `asOf = stock.asOf`:

```
remaining = stock.quantity
          + Σ amount of refills                       (not reversed, recordedAt >= asOf)
          − Σ amount of waste                         (not reversed, recordedAt >= asOf)
          − Σ (takenAmount ?? doseAmount) of taken    (recordedAt >= asOf)
```

Arithmetic in whole thousandths; `remaining` is not shown below 0 (as today, §7.3 item 5) but the application also knows that the sum went below zero and says that the stock may have run out earlier. `daysRemaining = floor(remaining / plannedDaily)` still uses the **planned** daily amount, not what was taken. An event or record in a unit other than the stock unit makes the estimate unavailable (`incompatible-units`), exactly as a dose record does today; the forms refuse to create such an event. Orphaned events (the medication was deleted by another tab) are ignored and tolerated, like orphaned dose records (DEC-22).

**Low stock.** `lowStock = available && (threshold applies ? remaining <= threshold.quantity : daysRemaining < 7)`, where the threshold applies when it is set and its unit matches the stock unit. Unavailable is never low.

**What each action does to the estimate (planned; the tests of the stages F5 to F8 must show every row):**

| Action | Effect |
|---|---|
| Record *taken* as planned | Counts `doseAmount` once (as today). |
| Record *taken* with another amount | Counts `takenAmount` once; `doseAmount` keeps the plan. |
| Change the amount or note of a taken record | The difference applies; `recordedAt` does not move; the same value changes nothing. |
| Taken → skipped | `takenAmount` and `note` are removed; nothing is counted. Back to taken: the plan, counted once. |
| Clear a record | Nothing is counted (as today). |
| Click twice | One record, one event (id per opened dialog; a second `append` with the same id is rejected as a duplicate). |
| Start tracking: counted | Creates the baseline from the typed quantity (`basis: 'counted'`, `asOf` now). Zero only if typed. |
| Start tracking: new package | Creates the baseline from the package size (`basis: 'new-package'`, `asOf` now); earlier leftovers are not counted and the screen says so. |
| Refill | Adds its amount from `recordedAt`. Needs a baseline in the same unit; without one it is refused and the page offers to start tracking (DEC-52). |
| Waste | Subtracts its amount; marks no dose; has no slot. Allowed even if it exceeds the estimate (an estimate must not block a fact); the application warns. |
| Reverse an event | `reversedAt` is set: it stops counting and stays in the history. Reversing it again changes nothing. |
| Count the stock again (edit the quantity) | `asOf` becomes now: earlier events and doses stay in the history but no longer count. The history says so. |
| Change the dose unit or the form | Earlier records and events keep their own units. If the stock unit and the dose unit now differ, the estimate is unavailable and the form says so (as today). |

**Known limits that stay.** `recordedAt` is still the moment of entry, so the two limits of §7.3 (late entry, correction after a count) apply to events too. A refill cannot be dated in the past in the first version, so a purchase remembered a day later is entered with today's time.

**Units offered (planned; final when F4 is done).** The stored value is the singular Polish noun (or symbol) already used by `unitForms.ts`, so existing data is valid without rewriting.

| Dosage form | Dose unit | Stock unit |
|---|---|---|
| tablet | tabletka | tabletka |
| capsule | kapsułka | kapsułka |
| liquid | ml | ml |
| drops | kropla | kropla, ml (an estimate is then unavailable: drops and millilitres are not converted) |
| injection | ampułka, wstrzyknięcie, ml | ampułka, wstrzyknięcie, ml (same unit as the dose) |
| sachet | saszetka | saszetka |
| patch | plaster | plaster |
| suppository | czopek | czopek |
| inhaler | dawka | dawka |
| other | none offered | none offered |
| not chosen (older data) | the stored unit, shown as it is | the stored unit |

Strength units: *mg, mcg, g, IU, mg/ml, mcg/ml, %*. The strength is never offered as a dose unit or a stock unit.

**The three stock states on screen (planned; DEC-52).** A medication's stock information is in exactly one of three states, and each is worded and presented differently. The Polish texts below show the intent; the final wording is fixed in F6.

| State | When | What the screen states | How the estimate is presented |
|---|---|---|---|
| **Counted** | a stock exists and `basis` is `counted` or absent | *Policzono {date}: {quantity} {unit}.* (the date of `asOf`, in the user's zone) | The estimate as today: *Pozostało ok. X, wystarczy na ok. N dni*, labelled as an estimate. A counted zero reads *Zapas wyczerpany*. |
| **New package** | `basis` is `new-package` | *Liczone od nowego opakowania z {date}: {size} {unit}. Wcześniejszej pozostałości nie uwzględniamy, więc zapas może być większy.* | The same numbers, but **every place that shows them** (details page, day view, dashboard stock panel) also carries the label *od nowego opakowania*. It is never described as counted. A low-stock warning is worded as based on a count from the new package that ignores earlier leftovers. |
| **Unknown** | there is no stock (`stock` is absent) | *Nie śledzisz zapasu.* and the action *Zacznij śledzić zapas* | **No number at all:** *Szacunek niedostępny: zapas nie został policzony.* Not zero, not *Zapas wyczerpany*, never *Niski zapas*, and not listed in the dashboard stock panel (the medication only adds to its count of medications without an estimate, as today). |

Rules that follow:
- **Unknown is never zero.** Zero exists only when the user typed `0` in a count; an empty field means unknown (M-6, as today) and is never turned into `0` anywhere, in the form, in storage or in a message.
- **New package is never shown as counted.** The two statements differ, and the label stays wherever the number appears. A later count (editing the quantity in the medication form) makes the state *counted*.
- After a refill or waste event the state does not change; the events only change the number.
- The state is conveyed in words, not by colour or an icon alone.
- Tests of F6 check, for each of the three states and each screen that shows stock, the exact statement, the label for *new package*, and that the unknown state renders no number, no zero and no warning.

**Units that are not on the list (planned; DEC-45).** What the user sees and keeps:

- *Edit form.* If the stored dose or stock unit is not on the list for the chosen form (or no form is chosen), the unit selector shows the stored value as its **selected first option**, written as the user stored it and labelled *dotychczasowa, spoza listy*, with the listed units below it. A short text says the unit is not on the list, that it can stay, and that once another unit is saved the old one cannot be chosen again. Saving without touching the selector stores the **original text exactly as it was** (no trimming, no change of case, no replacement by a listed unit). While the form is open the old option stays selectable; after another unit is saved it is gone.
- *A listed unit written differently* (for example `Tabletka ` for `tabletka`) is compared with `unitsMatch` for calculations and shown as selected for convenience, but the stored text is rewritten only if the user picks something.
- *Everywhere else* (medication card, details, dose rows, history) the unit is shown as stored, by `formatAmount`, which already prints an unknown unit as typed; the card and the details page add a neutral label *Jednostka spoza listy* with the explanation.
- *Changing the dosage form* never changes the stored units.

How wrong calculations are kept out, in layers:

1. **The calculation refuses.** `estimateStock` compares the stock unit with the dose unit, every counted dose record and every counted event with `unitsMatch`; any difference gives `incompatible-units` (no number). A threshold in another unit is not applied (DEC-46). Nothing is converted.
2. **The forms do not create the problem.** Stock-unit choices come from the form's list; refill and waste dialogs show the stock unit as text, with no unit field; logic refuses an event whose unit differs (`incompatible-units`).
3. **The screens say it at once.** When the chosen stock unit differs from the dose unit, the form and the details page state that no estimate can be computed because units are not converted, and what to do (enter the stock again in the dose unit).
4. **Strength cannot get in.** `strength` is not part of the input type of the stock logic, and a test changes the strength and checks that the estimate is identical.
5. **History is not reinterpreted.** Dose records and events keep their own unit; changing the medication's unit afterwards leads, at worst, to an unavailable estimate and a visible explanation, never to a recalculation.

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
| Format and version | Each key holds `{ "version": 1, "items": [ ... ] }`. Data with another version is refused (`unsupported-version`), never guessed at. There are no migrations because there is nothing to migrate yet (DEC-21). *(Planned change: version 2 and a migration, §10.5.)* |
| Validation | Everything is validated field by field when **read** (TypeScript says nothing about stored JSON) and before it is **written**, with the limits of docs/DATABASE.md. Timestamps are normalised to UTC. |
| Corrupt data | Not valid JSON, wrong shape, missing or invalid fields, duplicate ids, two records in one slot: `data-corrupted`. The operation stops before writing, so damaged data is **never treated as empty and never overwritten**. Leftover intake records whose medication no longer exists are tolerated (shown as history), not an error (DEC-22). |
| Storage failures | Storage that cannot be read: `storage-unavailable`. A refused write: `storage-full` (quota) or `storage-write-failed`; the previous data stays in place. The storage is looked up on every call, so even a blocked `window.localStorage` is reported inside the operation. |
| Atomicity | One key is written in one step. Deleting a medication writes two keys (medication, then history); if the second write fails, the first is restored. If even that fails the error says so. *(Planned: with stock events it is three keys, §10.5.)* |
| Several operations | Every operation reads the current stored state, changes it and writes it in one synchronous step with nothing cached, so operations in one tab cannot interleave or overwrite each other's data. Several tabs are not coordinated: the last write wins. |
| Privacy | `localStorage` is readable plain text. It is acceptable only for fictional demo data and development, not for real health information (see §9). Nothing is logged to the console (enforced by a test). |

#### Demo data

`createDemoData({ now, timeZone })` (`src/services/demo`) is a pure function producing four medications, intake records and five appointments, all invented, with dates relative to today so "upcoming" stays upcoming. It covers the interesting cases for the Stage 2 rules: a schedule changed 10 days ago with older history, an ended medication, stock that is available and unavailable, and appointments that are upcoming, completed, cancelled and needing confirmation. Everything has an id starting with `demo-` (`isDemoId`), so the UI can mark sample data and tell it from the user's own (DEC-23).

- Nothing loads or resets demo data implicitly: reading and ordinary writes never touch it.
- `loadDemoData()` fills **empty** storage and refuses (`demo-data-not-empty`) if anything, even damaged data, is stored.
- `resetDemoData()` replaces everything. The previous raw contents of the three keys, damaged or not, are first copied to the backup key (one slot: only the most recent previous state is kept); if the backup cannot be written nothing is changed, and if writing the demo data fails the previous data is restored.

### 10.5 Storage v2: migration, backup and old copies (design, F0; not implemented)

Decisions DEC-44 (approved) and DEC-53 (accepted by the owner on condition that this section never presents the mechanism as full protection). **Nothing here runs yet:** the code reads and writes version 1 only and no data has been migrated. This section says what the mechanism does and what it does not guarantee. Where a claim depends on an assumption, the assumption is named, and the tests that check it are listed at the end. The migration is described as *resumable*, never as *atomic* or simply *safe*: `localStorage` has no transaction across keys and no compare-and-swap.

**What changes.** The envelope version of every collection becomes `2` (`{ "version": 2, "items": [ ... ] }`). The data keys keep their names. A version 1 to version 2 step changes **no value**: the new fields are optional and absent in migrated records, so the items are written back with the same ids, units and timestamps. In particular **no unit is rewritten, normalised or replaced**; values that are not on the new lists stay exactly as stored. (Unknown extra fields in a stored record are already dropped by every version 1 write, because the validators rebuild a record from its known fields; they are dropped by the migration too, and stay in the backup text.)

**Why bump the version at all.** To make an older copy of the app fail instead of damaging the data: an older copy refuses version 2 (below). With version 1 and optional fields it would read the records, drop the fields it does not know and write the shortened records back, with no error.

**Keys.**

| Key | Content |
|---|---|
| `pigoowa:v1:medications`, `pigoowa:v1:dose-logs`, `pigoowa:v1:appointments` | The data collections: version 1 today, version 2 after migration. |
| `pigoowa:v1:stock-events` | New collection (F6). Version 2 from its first write. An absent key is an empty collection; nothing to migrate. |
| `pigoowa:v1:migration-backup:medications`, `…:dose-logs`, `…:appointments` | One key per collection holding **the exact text of that collection as it was at version 1**, verbatim, and nothing else. |
| `pigoowa:v1:migration-backup:meta` | Small JSON: `{ "version": 1, "entries": { "<collection>": { "backedUpAt", "characters", "items", "unknownFieldRecords", "sha256", "verifiedAt" } } }`. Each entry is the **provenance record** of one backup: it is written in step 3, **before** the collection is rewritten, with the fingerprint of the exact backup text (`sha256`), and completed with `verifiedAt` in step 7. `characters` and `items` are quick consistency checks; **the fingerprint is what identifies the copy**. Losing it never endangers the data, but without it a backup's origin can no longer be established (see "Resuming"). |
| `pigoowa:v1:backup` | Exists today. The demo reset's backup slot; the migration never touches it and the demo reset never touches the migration backup. |

Why one raw key per collection and not one JSON value with three texts (a refinement of the first F0 draft): the text is kept verbatim without JSON-in-JSON escaping (about 13 % larger on a sample dose record, 36 extra characters on 270), each backup is written with a single-key write instead of a read-modify-write of a shared value, and restoring a collection is copying one value back.

**States of a collection.** Recognised from its stored text alone; no separate "migration in progress" flag exists, because a flag could itself go stale.

| State | Stored | What the new code does |
|---|---|---|
| `absent` | no key | Reads as empty. The first write creates a version 2 envelope (nothing exists that could be lost). |
| `pending` | a version 1 envelope whose format is **fully recognised** (see "Recognition") | Reads with the version 1 rules. **Every write is refused** (`migration-required`) until the collection is migrated. |
| `migrated` | a valid version 2 envelope | Normal reads and writes. |
| `damaged` | anything that is not fully recognised: not JSON, wrong structure, a `version` that is not exactly the number 1 or 2, an invalid or duplicate record | **Reads and writes are both refused** (existing behaviour: `data-corrupted`, `unsupported-version`): never read as empty, never written, never migrated. |

**Recognition: when a `pending` collection may be read at all.** A collection is `pending`, and therefore readable, only when its original format is unambiguously recognised and supported: the stored text is JSON; it is an object whose `version` is the number `1`; `items` is a list; and **every** record passes the version 1 validators exactly as they are today (a frozen copy of them is kept for the tests), with unique ids and unique dose slots. There is no partial or best-effort reading: one unrecognised record makes the whole collection `damaged`, as it does today. A `version` of `1.5`, `"1"`, `3` or anything else is not recognised. In every such case the new code **refuses to read and refuses to write**, never treats the collection as empty and never migrates it. Records that carry fields the version 1 validators do not know are still recognised (as today they are accepted and the unknown fields ignored); the migration counts them, records the number as `unknownFieldRecords` in the `meta` entry, and those fields survive only in the backup text.

**The write gate (DEC-53).** New code accepts only `absent` or `migrated` as the state of a collection it is about to write. This is derived from the stored version at the moment of each write, in every tab that runs new code. Consequence: **no version 2 write can precede that collection's backup**, whatever happens to the start-up migration (it may have failed, been interrupted, or not yet run in this tab). A new `RepositoryError` code, `migration-required`, carries it, with a Polish message.

**Collections are independent.** As in §10.4, a problem in one collection never affects another: a damaged `appointments` does not stop `medications` from migrating. A mixed state (some `pending`, some `migrated`) is a normal intermediate state and is read correctly by new code. (The first F0 draft stopped the whole migration if any collection was damaged; per-collection independence follows §10.4 and avoids blocking healthy data.)

**When it runs.** Once, explicitly, at application start, before the first repository read, through a function that returns a result for each collection: `migrated`, `already-migrated`, `absent`, `damaged`, or `failed` with a reason (`backup-failed`, `changed-concurrently`, `write-failed`, `verification-failed`). Reading never migrates and never writes (an existing invariant of `readCollection`). It runs again at every start and on an explicit retry. Collections are processed from the smallest stored text to the largest, so that a lack of space blocks as little as possible.

**The steps for one collection.** All are synchronous, with nothing awaited between them, so that nothing in this tab can interleave.

1. Read the stored text *R* and determine the state of the collection ("States", above). Only a `pending` collection, that is one recognised as version 1, continues. `damaged` (including a text that is not recognised as version 1) and `absent` stop here: nothing written, no backup made. `migrated` (for instance because another tab has just migrated it) leaves this procedure and is handled by the table in "Resuming"; nothing is written to its backup.
2. **Backup.** Only a `pending` collection gets here, and this is the only situation in which a backup is written or replaced (see "Resuming" below). Write *R* verbatim to the collection's backup key. If that key already holds exactly *R*, nothing is written. If it holds something else, it is replaced by *R*, because *R* is the state about to be rewritten. If the write fails (for example no space), stop: the collection stays `pending` and unchanged, and a message says that space is needed. There is no way to continue without the backup (decision of the owner).
3. Read the backup key back. It must equal *R*; otherwise stop. **Then write the provenance entry** for this collection in `meta`: `backedUpAt`, `characters` (the length of *R*), `items` (its record count), `unknownFieldRecords`, **`sha256` (the fingerprint of the exact text *R*, below)**, and no `verifiedAt` yet; any `verifiedAt` from an earlier migration is dropped, because it described a different state. If `meta` is unreadable or of an unknown version, it is replaced by a new one that holds only this entry (the entries of other collections are then lost, and their backups fall into the class *origin cannot be established*). If the entry cannot be written, the collection stops, exactly as for a backup that cannot be written; nothing else has changed. The entry is written **before** the rewrite so that, whatever happens next, the backup can later be recognised as the copy the migration made.
4. **Compare.** Read the collection's text again. It must equal *R*; otherwise another copy changed it meanwhile: go back to step 1, at most three times, then stop with `changed-concurrently`.
5. Write `{ "version": 2, "items": <the validated items> }`. If the write fails, stop; the storage keeps the old value.
6. **Verify.** Read the collection back and validate it as version 2. The items must equal the validated items, value for value. If not, write *R* back (best effort) and report `verification-failed`.
7. **Confirm, then complete.** Read the backup key again and compute its fingerprint: it must equal the `sha256` recorded in step 3 (identity), and step 6 has just shown agreement. Only then complete the entry with `verifiedAt`. If the backup text no longer matches, do not set `verifiedAt`, report "backup changed", and write nothing to the backup. A failure to write the entry changes nothing else: the entry stays without `verifiedAt` and the next start completes it by the verification described below.

Steps 4 and 5 are **not** an atomic compare-and-swap, because `localStorage` offers none: another tab could still write in the instant between those two calls. The window is the time between two consecutive synchronous calls, but it is not zero. The design narrows it; it does not close it. The same kind of window exists between steps 1 and 2: another tab could migrate the collection in that instant, and the backup would then be written from a text that is no longer the original. The effect is that a backup is overwritten with an earlier version 1 text of the same collection (identical unless the collection was edited in between); it is not excluded.

**The fingerprint.** The length and the record count do not identify a copy: another valid version 1 text, for instance an earlier state with one amount edited, can have the same length and the same number of records, and the validated items drop unknown fields, so equal items do not prove an identical text. The entry therefore carries `sha256`: the SHA-256 of the **exact text of the backup**, that is the UTF-8 bytes of the string as `getItem` returned it, with no trimming, no normalisation and no re-serialisation, written as 64 lowercase hexadecimal characters. It is computed from *R* in step 3, after the read-back showed that the backup equals *R*. Requirements for the implementation (F1):

- The computation is **synchronous**, because the steps are synchronous by design (nothing may be awaited between them); `crypto.subtle` is asynchronous, so a small pure function is used, with **no new dependency**, and it is tested against published SHA-256 test vectors (the empty text, `abc` and the standard multi-block vectors) and, for text with non-ASCII characters, against an independent reference implementation available in the test environment (Node's built-in `crypto`, used by the tests only and not shipped, so not an added dependency).
- It is computed in step 3, again in step 7, and later only for a `migrated` collection that is not yet verified (to classify its backup); never for every collection at every start. Its cost grows with the size of the text and is measured in F1 on a collection of the size estimated under "Quota"; it must not make start-up noticeably slow.
- **What it is for:** to detect that the stored backup is not the text the migration recorded: an accidental change, a truncation, an older or foreign version 1 text, a different collection's text, a manual replacement. **What it is not:** protection against deliberate change. `localStorage` is plain text that any script on the page can rewrite, together with `meta`; a fingerprint kept next to the data it describes cannot stop that.
- Where both texts are at hand (*B* and *R*), string equality stays the primary check; the fingerprint is what allows the identity of *B* to be confirmed when *R* no longer exists, that is, when the original is already version 2.

**Three different questions, answered differently.**

| Question | Answered by | What it does not tell |
|---|---|---|
| Is the stored backup the text the migration recorded? (integrity and identity of the copy) | The fingerprint, with the length and the record count as quick checks. | Nothing about the migrated data, and nothing about deliberate change. |
| Do the migrated records agree with the backup? (agreement of the data) | Comparing the migrated items with the items validated from the backup text, at migration time or at the first later start that can still do it. | Not the texts (they differ by the version number), and not later edits: it cannot be repeated after the user has changed data. |
| Was the backup or `meta` changed on purpose? (deliberate manipulation) | **Not answered.** There is no protection against it (see "What it is not" above). | Everything. |

**What is left behind if the work stops** (tab closed, browser killed, quota error, power loss). The assumption behind every row is that a browser stores a value whole or not at all when `setItem` returns or throws; this cannot be tested except by simulated failures, and it is not guaranteed for a power loss in the middle of a write. The classes used in the last column are defined in "Resuming" below.

| Stopped at | Stored afterwards | Original / backup | Next start |
|---|---|---|---|
| Step 1 | nothing changed | `pending`, no backup | repeats from step 1 |
| Step 2 (backup write failed or never ran) | the old backup value or none; collection still version 1 | `pending` | repeats steps 2 and 3; step 3 rejects a partial copy |
| Inside step 3, after the read-back, before the entry is written | backup equals *R*; no entry; collection still version 1 | `pending`; backup of *origin cannot be established* | step 2 writes nothing, step 3 writes the entry, the run continues |
| After step 3, before step 5 | backup equals *R*; entry with `sha256` and without `verifiedAt`; collection still version 1 | `pending`; *expected pre-migration copy* equal to *R* | step 2 writes nothing; continues from step 4 |
| Step 5 | the old version 1 text or the new version 2 text, whole (assumption) | `pending` or `migrated` | repeats from step 1, or continues as in the next row |
| **After step 5, before 6 or 7** | **version 2 present; the backup still holds the version 1 text; entry present, with `sha256` and without `verifiedAt`** | **`migrated`; *expected pre-migration copy*, different from the original as text** | **the backup is kept untouched.** The run checks identity (the fingerprint of the stored backup text equals the recorded `sha256`) and agreement (the migrated items equal the items of the backup), and only then sets `verifiedAt`; if the items differ it reports "changed since", if the fingerprint does not match it classifies the backup as inconsistent, and in both cases it marks nothing |
| After step 5, the entry later lost or replaced (for example `meta` deleted) | version 2 present; valid version 1 backup; no entry for it | `migrated`; backup of *origin cannot be established* | the backup is kept untouched; reported; not marked verified |
| Between collections | any set of collections migrated | mixed | each `pending` collection is migrated on its own |

**How an incomplete migration is recognised.** After the start-up run, the migration is incomplete if any collection is still `pending`. A `migrated` collection without `verifiedAt` is not "incomplete" but **not verified**, and the run reports why (changed since, backup unusable, origin cannot be established, backup missing). Completeness is **derived from the stored versions**, never from a stored "done" flag. A `damaged` collection is reported as such and is not counted as "pending migration".

**Resuming: what is checked and what the run does.** The existence of a backup is never enough, and the migration never resumes *from* a backup: it never rewrites a collection from the backup text (only the explicit restore function does that). Every run starts afresh and, for each collection, reads the original, the backup and the `meta` entry again, classifies them as below, and acts by the table below.

*The original* is in one of four states: `absent`, `pending` (a recognised version 1), `migrated` (a recognised version 2), or `damaged` (everything else, including a version above 2).

*The backup* (the text *B* under the collection's backup key, with the collection's `meta` entry *E*) is judged in one of three classes, whatever the state of the original:

| Class | Condition | What it means |
|---|---|---|
| **Expected pre-migration copy** | *B* is recognised as version 1, **and** *E* exists (in a `meta` format the code knows) with `characters` equal to the length of *B*, `items` equal to its record count, **and `sha256` equal to the fingerprint of the exact text of *B*** | The migration recorded exactly this text before the rewrite, and what is stored is that text. |
| **Damaged or inconsistent** | *B* is missing or not recognised as version 1, **or** *E* has a fingerprint but disagrees with *B* in `characters`, `items` or `sha256` | The stored text is not the one that was recorded, or it is unusable. A different valid version 1 text with the same length and record count lands here, because its fingerprint differs. |
| **Origin cannot be established** | *B* is recognised as version 1, but *E* is absent, unreadable or of an unknown version, **or *E* has no `sha256`**, so nothing records that the migration made *B*, or which text it was | A valid version 1 text of unknown provenance. That its content equals the data shows what it holds, not where or when it came from, so equality does not change this class. |

**Order of classification:** first, a backup that is missing or not recognised as version 1 is *damaged or inconsistent*; second, a recognised backup whose entry is absent, unreadable, of an unknown version or without a fingerprint is *origin cannot be established*; third, an entry that disagrees with the text in length, record count or fingerprint is *damaged or inconsistent*; otherwise the backup is the *expected pre-migration copy*.

*The rule that decides everything:* **a backup is written or replaced only while the original is `pending`**, because only then is *R* the text that is about to be rewritten. When the original is `migrated`, the version 2 original can never be written into a version 1 backup, so **the backup of a `migrated` collection is never written, replaced or deleted by the migration**, whatever class it is in and however much it differs from the original. A difference between a version 1 backup and a version 2 original is expected (the texts differ by the version number, and the items may have been edited since); it is never a reason to replace the backup. **No class changes this: a fingerprint that is missing or does not match never leads to a write to the backup of a `migrated` collection.** It changes only the class, and so what is reported and whether `verifiedAt` may be set.

| Original | Backup | What the run does |
|---|---|---|
| `pending` | expected copy, *B* equals *R* | Step 2 writes nothing, step 3 passes, continues. |
| `pending` | expected copy, *B* differs from *R* | *B* holds an earlier version 1 state; *R* is the current one and is about to be rewritten. *B* is replaced by *R*, read back equal, and the entry is rewritten; continues only if equal. The earlier state is not kept: this arises only when the version 1 text changed after the backup (an older copy wrote, or someone restored by hand). |
| `pending` | damaged or inconsistent, origin unknown, or missing | Replaced (or written) from *R* in the same way; continues only if the read-back is equal. |
| `pending` | cannot be written (no room, storage error) | **Stops this collection:** it stays `pending`, writes to it are refused, a message is shown. No migration without a backup. |
| `migrated`, with `verifiedAt` | any | Nothing to do. |
| `migrated`, no `verifiedAt` | expected copy, and the migrated items equal the items of *B* | **Keep *B*.** Set `verifiedAt`. Identity was confirmed by the fingerprint and agreement by comparing the items (the items, not the texts, which differ by the version number). |
| `migrated`, no `verifiedAt` | expected copy, but the items differ | **Keep *B*.** Report "changed since" (edited after the migration, or by another tab). Nothing is marked; not verified. |
| `migrated`, no `verifiedAt` | damaged or inconsistent | **Keep it as it is.** Report "backup unusable" (this includes a text whose fingerprint does not match the recorded one). Not verified, not recreated (the version 1 original no longer exists); the restore function refuses it. |
| `migrated`, no `verifiedAt` | origin cannot be established | **Keep it as it is.** Report "origin cannot be established" (this includes an entry without a fingerprint). Not verified; removal of the backup is never offered for it; the restore function accepts it only with an explicit statement that its origin is unverified. |
| `migrated`, no `verifiedAt` | missing | Report "cannot be verified". Nothing is recreated. |
| `damaged` | any | Nothing written, the backup untouched, reported. |
| `absent` | any | Nothing to migrate. A backup that exists is left alone and reported; it is never deleted. |

**Conditions for resuming a `pending` collection.** It is resumed only if *all* of these hold. If any fails it stays `pending` (readable with the version 1 rules, writes refused), nothing is destroyed, and the start-up run reports why; it is tried again at the next start or on an explicit retry.

1. Its original format is recognised as version 1 (otherwise it is `damaged` and not touched).
2. The storage can be read and written, with room for the backup and the entry of that collection. **With no room, this collection stops.**
3. The backup text equals *R*, established by reading both in this run (step 3), and the entry is written.
4. The text did not change between that comparison and the rewrite (step 4).
5. The version is exactly 1 (a version above 2 means a *newer* app wrote it: refuse, `unsupported-version`).

Equality of *B* and *R* shows that the two texts matched at the instant of the comparison. It does not show that *B* is the state from before the very first attempt; when an earlier backup is replaced, *R* is by definition the state that is about to be migrated.

**What the mechanism guarantees and what it does not.**

| Claim | Because | Checked by | Limit |
|---|---|---|---|
| The known fields of every record are unchanged by the migration. | The items written are the validated copies read from the same text. | A field-by-field equality test on version 1 fixtures; a test that units survive byte for byte. | Unknown fields of version 1 records are not carried over (they were already dropped by any version 1 write); they stay in the backup text. |
| No version 2 write of a collection precedes that collection's verified backup. | The write gate, and the order of steps 2, 3 and 5. | Tests: a write to a `pending` collection is refused; a failing backup stops before step 5. | Relies on the whole-value assumption above. |
| After an interruption, the data can still be read by new code and the migration can be finished. | Every collection is readable at version 1 or 2; steps are repeatable. | A storage fake that fails the *n*th write, for every *n*, during a full migration. | A power loss or a kill in the middle of one `setItem` cannot be tested. |
| Running the migration again does no harm. | Idempotent steps; a `migrated` collection is never rewritten. | A run-twice test and an interrupted-then-resumed test. | None known. |
| A backup is accepted as the pre-migration copy only if its exact text is the one that was recorded. | The `sha256` of the exact text is recorded in `meta` before the rewrite and compared before a copy is classified as expected. | Tests with a text of the same length and record count, and with an entry that has no fingerprint. | It detects accidental, partial or foreign change, not deliberate change, and it depends on `meta` surviving (otherwise: origin cannot be established). |
| The version 1 backup of a collection that is already version 2 is never altered by the migration, however it differs from the original. | Only a `pending` collection ever gets its backup written or replaced; the entry is written before the rewrite, so the copy stays recognisable after an interruption. | A test that interrupts after step 5 and checks, with a write spy, that nothing is written to the backup key on the next start. | If the entry is lost, the backup is kept but its origin can no longer be established. |

**Not guaranteed:** atomicity across collections; protection against a write by another tab in the instant between steps 4 and 5, and against another tab's migration in the instant between steps 1 and 2; that the browser keeps the data at all (the user clearing site data, private browsing, storage eviction; persistent storage is neither requested nor verified); that there is room for the backup; that data survives a manual restore of an old backup (below).

**Old copies and rollbacks.** Three things must be kept apart: what the *already deployed* code does, what the *new* code adds, and what **nobody can detect**.

*A. What the existing code already does, verified and limited* (verified in the source: `src/services/local/collection.ts` has not changed since the stage 4 commit `00043dc`; `localRepositories.ts` changed once since, in `5c92186` (`countForMedication`), and keeps the same read-before-write pattern, so every build since stage 4 has this behaviour):

- Every repository operation reads and validates a collection before it writes it. A version other than 1 throws `unsupported-version` **before any write**. So an old copy cannot overwrite a `migrated` collection through its screens. The user sees the existing Polish message (*"Zapisane dane pochodzą z innej wersji aplikacji i nie można ich odczytać. Nic nie zostało zmienione."*) in the error state of the screen (DEC-25), and a dose action that fails is never reported as done (DEC-32; saving a medication or an appointment shows its own error as well).
- An old copy **can** still read and write a collection that is `absent` or `pending`: it writes valid version 1 text. New code sees that as `pending` and migrates it at the next start (step 2 replaces the stale backup by the newer text), so nothing is lost.
- The only old-code paths that write without having just read the same key are (1) the rollback in `medications.remove`, which puts back the text it read earlier if the second write fails (it would downgrade a collection only if that failure and a migration by another tab coincide), and (2) the demo controls on `/dev/data`, which exist in development builds only and replace everything after an explicit confirmation.

*B. What the new code adds:* the write gate; the backup before the rewrite; the compare before the write; the verification after it; refusal of versions above 2. None of it can reach into an old copy that is already running. **The new code gives no protection against an old tab; it relies on what the old code already does (A).**

*C. Risks that nobody can detect, or that the mechanism does not remove:*

| Scenario | What actually happens | Residual risk |
|---|---|---|
| An old tab is open when the new code migrates | Its next read or write of a `migrated` collection is refused (A). It writes nothing. Its screen may show old data until it is reloaded; the user has to reload. | The old tab cannot tell the user to reload; the message only says the data comes from another version. |
| An old tab writes to a still-`pending` or `absent` collection during the migration | Succeeds as version 1; migrated at the next start. | A write between steps 4 and 5 of that collection can be lost; neither copy can detect it. |
| The old **deployment** is restored (for example an instant rollback on Vercel) | The old code cannot read version 2: the app is unusable, the data is intact. | There is no screen for recovering; a user who clears site data to get the app working destroys the data, and nothing warns them. The migration backup holds only the version 1 state from before. |
| Someone restores a backup by hand after using the new version | The restored version 1 text replaces the newer data of that collection. The new code sees `pending` and migrates it again; the post-migration changes are gone, and stock events may refer to medications that are not there (orphans are tolerated and ignored, DEC-22). | Data loss by design of the action; it must be an explicit decision. |
| Stock events and an old copy | Old code neither reads nor writes `pigoowa:v1:stock-events`; it cannot run on `migrated` data anyway. | After a manual restore, old events apply again to the restored data and the estimate may differ from before. |
| Two tabs of the **new** code start at once | Both run the migration; steps 4 and 5 make a collision unlikely and the result is identical either way. | Same instant-sized window as above. |

**In short.** The mechanism makes damage from an old copy unlikely in normal use and keeps a way back. It does **not** prevent it. It is not protection against old tabs, against races between tabs, against a rollback of the deployment, or against a browser that limits, loses or clears the data.

**Backup policy (DEC-53).**

- **Retention.** The migration backup is kept until the user removes it explicitly. It is **never deleted automatically**, neither after a time nor after a successful verification. F1 provides no removal action; it is a later, separate decision (ROADMAP).
- **What "verified" means.** `verifiedAt` is set only after two comparisons have actually been made. **Identity:** the stored backup text, read again at the moment `verifiedAt` is set, has the fingerprint that was recorded before the rewrite (and in step 3 that text had been read back equal to the original). **Agreement:** the migrated collection's items equal the items validated from that very text (step 6 in the same run, or on a later start for a `migrated` collection whose backup is an expected copy). A backup that is merely a valid version 1 text, or merely has the recorded length and record count, is never marked verified, and neither is one of unknown origin or one inconsistent with its entry. It still does not mean that anyone looked at the data; it cannot be recomputed after the user has made changes (the migrated data then differs legitimately); and the fingerprint does not protect against deliberate change.
- **When removal may be offered.** Only when every migrated collection has `verifiedAt`, no collection is `damaged` or `pending`, and the app has started on version 2 data without a migration error. The dialog must say that afterwards the data from before version 2 cannot be recovered. A `storage-full` error may *mention* that the backup takes space and offer that removal; it never removes anything by itself.
- **Recovery.** A tested function restores one collection from its backup: it checks that the backup is an *expected pre-migration copy* (its exact text has the recorded fingerprint; a backup of unknown origin only if the caller also states that its origin is unverified; a damaged or inconsistent one is refused), refuses unless the caller states that the changes made since the migration will be lost, writes the text back as version 1, reads it back and compares it with the backup, and so returns the collection to `pending`. F1 builds and tests the function but **no screen** for it: a screen on the development page was **deferred by the owner**, and the requirements for a future tool are listed below. In the public demo there is no recovery action. By hand, an owner can copy the value of a backup key into the data key in the browser's developer tools and reload; this discards everything entered since and must not be advised to end users. A recovery that has never been tested is not a recovery, which is why the function is part of F1.
- **Quota.** The backup holds one more copy of the data. Size: a dose record is about 246 characters (computed from the type, with 36-character ids) and a medication about 500, so five medications taken twice a day produce roughly 3 650 records, about 0.9 million characters, a year. Browsers allow a limited amount of text per origin, commonly a few megabytes, counted differently by browser; **not measured for this app**. If there is no room for a collection's backup, **that collection's migration stops**: it stays `pending` (readable, writes refused) and a clear message says that space is needed. The app never deletes anything to make room. **There is no "migrate without a backup" option: the owner rejected it,** because it would remove the only way back. While the data is fictional demo data, clearing the site data is the practical remedy for a user who cannot free space.
- The demo reset's own backup slot (`pigoowa:v1:backup`) also takes space; it is replaced by each reset and is a separate matter.

**Requirements for a future restore tool (deferred by the owner; nothing is built and no screen is added).** If a screen or command is ever added, it must:

- work on **one collection at a time**, named in the interface, and never run automatically or on a schedule;
- first show what it will replace: the collection's current record count and the backup's, `backedUpAt`, whether `verifiedAt` is set, and the statement that **everything entered since the migration in that collection will be lost**;
- show the class of the backup (expected pre-migration copy, origin cannot be established, damaged or inconsistent), refuse a backup that is missing, unreadable, not recognised as version 1 or inconsistent with its entry, and for one of unknown origin require an extra, explicit statement;
- require a deliberate confirmation (a typed word or a separate confirm step, not a single click) and never be reachable from a place where it can be triggered by accident;
- keep a copy of the current text before overwriting (a separate key that is never overwritten without a new confirmation), so that the restore itself can be undone;
- use the tested restore function and report the result per collection, including a failure and what is left;
- say that the collection will be migrated again at the next start, so the restored data becomes version 2 again;
- be limited to development builds unless the owner decides otherwise; no restore action exists in the public demo;
- have Polish texts, be keyboard-operable and pass the accessibility checks like any screen;
- be tested: refusal paths, the confirmation, the safety copy, and a round trip with the migration.

**Other collections and operations.**

- **Delete a medication** removes the medication, its dose records and its stock events. Three keys are written in a fixed order, and a failure restores the keys already written (the existing two-step pattern, extended to three); if even that fails the error says so. Events whose medication no longer exists are tolerated and ignored (DEC-22).
- **Demo data reset and backup.** The list of data keys used by the demo controls (`DATA_KEYS` in `src/services/local/localDemoData.ts`) must include the stock events, so a reset clears them and the demo backup keeps their raw text. Without that, a reset would leave orphaned events and the backup would be incomplete. The migration backup keys are **not** data keys for the demo controls: a reset leaves them alone. The demo data must be extended with the new optional fields and a few events; demo loading and reset write version 2.
- **Privacy:** unchanged. Everything, including the backup, is readable plain text (§9, DEC-42).

**Tests the migration needs (F1).** Fixtures of real version 1 JSON of every collection. Migrated items equal the originals field by field; units preserved byte for byte (including `mg` as a dose unit, mixed case and trailing spaces). The backup equals the original text, verbatim. A frozen copy of the current version 1 reader and validators (as at commit `7b649cb`) refuses a version 2 collection and writes nothing. A storage fake that fails the *n*th write, for every *n*, during a full migration, and the state after each failure is read by the new code and finished by the next run. A simulated second tab that changes the text between steps 4 and 5 (retry, then `changed-concurrently`). A failing backup writes nothing else; a stale backup is replaced only for a still-`pending` collection. A damaged collection does not stop the others and is not written. The write gate: a write to a `pending` collection is refused. An old-copy write of version 1 to a `pending` or `absent` collection is migrated at the next start. A version 3 collection is refused. Running twice changes nothing the second time. Empty storage creates no keys. Restore: a round trip, and a refusal without the confirmation. Quota failure at each step. A collection with an unrecognised record, or with a `version` of `1.5`, `"1"` or `3`, is neither read nor written, and the others are unaffected. A backup that is stale, belongs to another collection, is unreadable, or equals the original each lead to the behaviour of the table above, and the existence of a backup alone never lets a step be skipped. No room for the backup stops that collection and shows the message; no code path migrates without a backup. Records with unknown fields are counted in `meta`. A `migrated` collection without `verifiedAt` is verified, reported as changed since, or reported as not verifiable, as above. The interruption after step 5, before 6 or 7: on the next start the version 1 backup is byte for byte unchanged and nothing is written to the backup key (a write spy), and `verifiedAt` is set once the migrated items equal the backup's items. A `migrated` collection with an expected copy whose items differ is reported as changed since and nothing is marked. A `migrated` collection with a backup that is damaged, inconsistent with its entry, of unknown origin (entry absent or unknown) or missing keeps the backup as it is and reports the matching reason. A `damaged` or `absent` original never causes a write to any backup. The entry is written before the rewrite and a failure to write it stops the collection. The fingerprint: SHA-256 against published test vectors (the empty text, `abc`, the multi-block vectors) and against Node's built-in `crypto` as the reference for non-ASCII and large texts (tests only); the fingerprint is of the exact text, so one changed character or space changes it; the entry written in step 3 holds the fingerprint of *R*. A backup with the same length, the same record count and a different text is classified as inconsistent: under a `pending` original it is replaced by *R*, under a `migrated` original it is kept, not marked verified, and nothing is written to the backup key. An entry without a fingerprint gives *origin cannot be established* with the same non-writing for `migrated`. `verifiedAt` is never set for a backup that is merely a valid version 1 text or has only matching length and record count. The time to compute the fingerprint on a collection of the size estimated under "Quota" is measured and reported. `verifiedAt` is not set when the backup text changes between step 3 and step 7 (simulated); the result is "backup changed" and nothing is written to the backup. A simulated second tab that migrates the collection between steps 1 and 2 shows the documented window (it is not excluded).

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
| *(planned)* An older copy of the app silently dropping new fields | DEC-44: envelope version 2, so an older copy refuses to read and writes nothing; migration tests; §10.5 documents what a user sees. |
| *(planned)* Stock counted twice or lost by a refill, waste or a corrected amount | DEC-47, DEC-48, §7.6: one rule (`recordedAt >= asOf`), append-only events with one write, id per dialog, `recordedAt` not moved by edits; tests per row of the action table. |
| *(planned)* Mixing strength, dose and stock units | DEC-45: three separate fields, units from lists, no conversion, unlisted values kept visible and never replaced. |
| *(planned)* Partial migration across keys | §10.5: per-collection steps, backup verified before each rewrite, a write gate, resumable and idempotent; mixed states are valid for the new code. Not atomic, and the document says what it cannot exclude. |
| *(planned)* Not enough `localStorage` space for the migration backup | §10.5: the collection stays readable and pending, writes to it are refused, a clear message; nothing is deleted to make room. |
| *(planned)* Starting stock tracking with an unknown quantity | DEC-52: count or new package, never invented or unknown-as-zero. |
| Accessibility regressions | jsx-a11y lint rules, role/label-based RTL queries, Playwright keyboard-flow test. |

## 12. Testing strategy

- **Unit (Vitest):** slot generation, stock estimation, appointment grouping/status, date utils (DST, midnight), validation functions (Zod schemas join in stage 5).
- **Component (RTL):** forms (validation messages, no double submit), dose list actions, confirmation dialogs, empty/loading/error states.
- **Contract tests:** repository behaviour shared by mock and Supabase implementations.
- **E2E (Playwright):** the main journey — open dashboard → add medication → configure schedule → mark dose taken → verify history → add appointment → edit/cancel it. Uses the fixed clock (`page.clock`) and resets demo data before each test.
- **Database security (stage 10):** two test users; each must be unable to read, insert, update or delete the other's rows in every table.
- *(planned, F-track)* **Migration and data-preservation tests** (§10.5, including a frozen copy of the version 1 reader, a storage that fails at every step and a simulated second tab), **contract tests** extended by the stock events repository (`duplicate-id`, missing medication, cascade, reversal), **estimate tests** for every row of the §7.6 action table (through the real recording path, like `stockWithRecording.test.ts`), **page tests** for the new dialogs (double submit is one event, a failed write keeps the form), and **E2E** at phone width, including a real-device checklist for the time field (iOS Safari, Android Chrome). Automated tests cannot reproduce the operating-system pickers.
- Checks run after every stage: `typecheck`, `lint`, `test`, and (when relevant) `build` and `e2e`.
