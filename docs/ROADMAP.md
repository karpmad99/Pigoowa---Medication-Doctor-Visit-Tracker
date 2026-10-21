# Pigoowa — Roadmap

Development proceeds in small stages. A stage is **done** only when all its completion criteria are met and the checks have actually been run. Every stage ends with a summary (what changed, which checks ran and their results, known limitations, what to understand next) and **waits for approval** before the next stage starts.

**Standard checks** (introduced in stage 1, run at the end of every stage): `typecheck`, `lint`, `format:check`, `test`, and `build`. `e2e` is added from stage 1 (smoke test) and extended in stage 9.

Legend: ☐ not started · ◐ in progress · ☑ done

| # | Stage | Status |
|---|---|---|
| 0 | Planning and documentation | ☑ (approved with adjustments) |
| 1 | Project scaffold and quality tooling | ☑ |
| 2 | Domain types and business logic | ☑ |
| 3 | Design foundation and app shell | ☑ |
| 4 | Mock data layer | ☑ |
| 5 | Medications: CRUD and schedule | ☑ |
| 6 | Daily doses, history and stock | ☑ |
| 7 | Doctor appointments | ☑ |
| 8 | Dashboard | ☑ |
| 9 | End-to-end tests, accessibility, demo deployment (MVP complete) | ◐ (deployed; a phone check of the live demo is still open) |
| F0 | Medication features: decisions and documentation | ◐ (decisions approved; the final text awaits the owner's review) |
| F1 | Medication features: storage v2 migration | ☐ |
| F2 | Medication features: time field | ☐ |
| F3 | Medication features: visual refresh, next unrecorded dose | ☐ |
| F4 | Medication features: dosage form, units and strength | ☐ |
| F5 | Medication features: details page and own low-stock threshold | ☐ |
| F6 | Medication features: stock events and refill | ☐ |
| F7 | Medication features: wasted medicine | ☐ |
| F8 | Medication features: actually taken amount and note | ☐ |
| 10 | Supabase schema and Row Level Security | ☐ |
| 11 | Authentication and Supabase persistence | ☐ |
| 12 | Pre-release review (privacy, security, limitations) | ☐ |

---

## Stage 0 — Planning and documentation ☑

Deliverables: `README.md`, `docs/PROJECT_SPEC.md`, `docs/ROADMAP.md`, `docs/DATABASE.md`.
Done when: you have reviewed the plan and approved (or changed) the decisions in PROJECT_SPEC §6.

## Stage 1 — Project scaffold and quality tooling

**Why first:** every later stage depends on automated checks. Having `typecheck`/`lint`/`test`/`build`/`e2e` working on an almost empty app means every following change is verified from its first commit, and the toolchain choices (TypeScript strictness, Tailwind, Router, test runners) are settled while it is cheap to change them.

Scope (kept deliberately minimal): Vite + React + TypeScript (strict), Tailwind CSS, React Router with placeholder routes (`/`, `/medications`, `/appointments`), ESLint (typescript-eslint, react-hooks, jsx-a11y), Prettier, Vitest + React Testing Library, Playwright with one smoke test, npm scripts, `.gitignore`, one GitHub Actions workflow running the checks, README setup section. No `.env.example` yet (there is no configuration to put in it until stage 11), no data libraries, no UI kit.

Completion criteria:
- [x] `npm run dev` serves a placeholder app in Polish with working navigation between three routes.
- [x] `npm run typecheck`, `lint`, `format:check`, `test`, `build` and `e2e` all pass; results reported verbatim.
- [x] `tsconfig` has `strict: true`; no lint rules disabled.
- [x] At least one component test and one Playwright smoke test exist and pass.
- [x] CI workflow runs the same checks (written; **not yet observed running on GitHub** — confirm on the first pull request).
- [x] Dependency list matches PROJECT_SPEC §8 (without TanStack Query); versions recorded in README.

## Stage 2 — Domain types and business logic

**Why now:** the riskiest part of the app is time/schedule/stock logic, not the UI. Implementing it as pure, fully tested functions first means the UI later only displays already-verified results.

Scope (as implemented): shared primitive types and branded date/time types; `utils/date.ts` (strict parsing, calendar arithmetic, instants), `utils/timeZone.ts` (zone-aware "today", local date/time → instant with a documented DST policy), `utils/quantity.ts`; dose generation (§7.1); record / change / undo of intake records (§7.2); stock estimation (§7.3); appointment validation, phase and status handling (§7.4); schedule and stock validation. **No UI, no new dependencies.**

Changes against the original scope (see PROJECT_SPEC DEC-15 to DEC-19):
- **Zod schemas moved to stage 5.** Stage 2 adds no runtime dependency, so validation is done by plain functions returning issue codes; the stage 5 schemas will reuse these rules.
- **No `Clock` abstraction yet.** Business functions take `now` / `today` as arguments. A React-side provider for the current time belongs with the UI stages (3/4).
- **`pl-PL` formatting (`utils/format.ts`) moved to stage 3**, where the first screens need it.
- **Stock got an explicit unit** (DEC-15) and the dose actions are three explicit functions instead of one upsert (DEC-17).

Completion criteria:
- [x] Unit tests cover: once/multiple daily doses; start/end date boundaries; `scheduleEffectiveFrom`; taken vs skipped vs unrecorded; orphan logs; future-date rejection; duplicate action idempotency; stock available/unavailable cases; DST days 2026-03-29 and 2026-10-25 in `Europe/Warsaw`; midnight boundaries; appointment upcoming/past/needs-confirmation; validation issue codes (the originally listed "schema validation messages" move to stage 5 with Zod).
- [x] No `any`; no React, Supabase, storage or system-clock access in `logic/`, `utils/` or `types/` (checked with a search, and enforced for `any` by the lint rules).
- [x] All standard checks pass (results in the stage 2 report).

## Stage 3 — Design foundation and app shell

Scope: Tailwind design tokens (calm palette, typography, spacing, radius), `components/ui` primitives (Button, Field/Input/Select/Textarea, Badge, Card, Spinner, EmptyState, ErrorState, native-`<dialog>` Dialog and ConfirmDialog), responsive `AppShell` (sidebar on desktop, bottom nav on mobile), page headers, safety note component, a temporary internal page showing the primitives.

As delivered: all of the above, plus `utils/format.ts` (`pl-PL` date, time-stamp and number formatting, moved here from stage 2), a `usePageTitle` hook and a few inline SVG icons (no icon library). The temporary primitives page is at `/dev/components` and exists **only in development builds** (it is removed from production bundles). The Pulpit, Leki and Wizyty pages are still placeholders: they have the final page header and say plainly that their content is not built yet, with no fake controls. Their real content belongs to stages 5 to 8 and needs the stage 4 data layer, so none of it was started.

Completion criteria:
- [x] Layout works at 360 px, tablet and desktop widths. Looked at in a real browser with screenshots at 390 px, 768 px and 1280 px; 360 px, 767 px and the other widths are covered by automated browser checks (no horizontal scrolling on every page, bottom bar vs. sidebar switch exactly at 768 px, touch targets, nothing hidden behind the bottom bar), not by eye.
- [x] Keyboard-only navigation works; focus is visible; dialogs keep focus away from the page behind them and close on Escape. Verified in Chromium: the skip link is the first stop and moves focus to the content; the page behind an open dialog is inert; Tab cycles through the dialog's own controls and may make one stop outside the page (the browser's own interface) before re-entering, which is how the native `<dialog>` behaves; Escape closes and returns focus to the opener.
- [x] Component tests for Button states, Field label/error association, ConfirmDialog confirm/cancel (plus Dialog, feedback components, shell landmarks, page titles, formatting). jsdom cannot trap focus or react to Escape, so those two behaviours are tested in Playwright, not in unit tests.
- [x] Contrast of text/background token pairs verified (≥ 4.5:1 for text, ≥ 3:1 for borders, focus ring and accents). The test reads the colours from `src/index.css`, so it re-checks them whenever they change.
- [x] All standard checks pass (results in the stage 3 report).

## Stage 4 — Mock data layer

Scope: repository interfaces; `localStorage` implementations with fictional seed data and a reset action; providers (clock, repositories); small custom data hooks returning `{ data, error, isLoading }` (TanStack Query is deliberately **not** used yet — DEC-12, added in stage 11); repository contract tests written so they can later run against Supabase.

As delivered: repository interfaces for medications, intake records (dose logs) and appointments (`src/services/repositories.ts`); `localStorage` implementations that validate everything they read and write; typed `RepositoryError`s; fictional demo data with explicit `loadDemoData` / `resetDemoData` actions (reset keeps a backup); a `Clock`, time zone and id generator supplied through a `ServicesProvider`; the hooks `useMedications`, `useDoseLogs` and `useAppointments` on top of a small `useAsyncData`; a reusable repository contract suite. The reset action is a developer utility, not a user-facing control: it lives on the development-only page `/dev/data` (removed from production builds). A real settings screen is not part of this stage.

Changes against the original plan (see PROJECT_SPEC DEC-20 to DEC-26):
- Repositories contain no business rules and do not generate ids or timestamps: callers supply them, as the Stage 2 functions already expect. For that reason the `setStatus` method listed in the spec's first draft does not exist; a status change is Stage 2's `changeAppointmentStatus` followed by `update`. `get` was added for appointments.
- The two small hooks beyond the three data hooks (`useServices`, `useClock`) exist only to read the provider.

Completion criteria:
- [x] Contract tests pass for all repositories (create/read/update/delete, uniqueness of dose logs, error cases). The suite (`src/services/contract/repositoryContract.ts`) knows nothing about `localStorage`; Stage 11 runs the same suite against Supabase.
- [x] Hooks expose explicit loading / error / data states; tested (including late and superseded answers, unmount, reload and StrictMode).
- [x] Components import repositories only through hooks/context, never `localStorage` directly. Enforced by `src/architecture.test.ts`, which fails if browser storage is touched outside `src/services/local/storage.ts`, if UI code imports `@/services/local`, or if any source file uses `console`.
- [x] Seed data is clearly fictional (invented names, notes saying so, ids marked `demo-`).
- [x] All standard checks pass (results in the stage 4 report).

## Stage 5 — Medications: CRUD and schedule

Scope: Zod schemas wrapping the stage 2 validation rules (with Polish messages for the issue codes); medications list page with empty state; add/edit form (React Hook Form + Zod) including schedule-time editor and optional stock; **"end medication" as the primary way to stop a medication (history preserved)**; permanent deletion as a secondary action whose confirmation dialog explicitly states the consequences (M-4).

As delivered: the medications list (`/medications`) with loading, error + retry, empty and populated states, status shown as text, a *Przykład* badge for demo records and an honest stock summary; the add and edit forms (`/medications/new`, `/medications/:id/edit`) with a schedule-row editor; the "end medication" dialog; a permanent-deletion dialog that states the consequences and the number of history records and offers "end instead"; Zod schemas (`src/features/medications/schemas.ts`) that only adapt the plain Stage 2 validation; pure edit/end logic (`saveMedication.ts`, `endMedication.ts`, `status.ts`); `useMedication(id)` and a small `useAsyncAction` for writes.

Changes against the original plan (see PROJECT_SPEC DEC-27 to DEC-30):
- React Hook Form, Zod and `@hookform/resolvers` were not installed before this stage (DEC-16 deferred them to here); they are the only dependency change.
- `DoseLogRepository.countForMedication(medicationId)` was added so the delete dialog can show how many records will be lost. Contract tests cover it; the local implementation counts leftover records of a nonexistent medication too.
- Editing follows `applyScheduleChange` (Stage 2): the effective date moves to today only on a real schedule change, never on a rename. Changing only the dose unit leaves the stock's own unit alone, so the estimate becomes "units incompatible" rather than being reinterpreted.
- `useAsyncAction({ blockAfterSuccess })` exists because a second submit could pass asynchronous validation after the first save had finished. The add page also fixes the new medication's id once per mount, so a duplicate record is impossible in any case.
- Two existing tests changed their set-up, not their expectations: the router/shell tests now render inside a `ServicesProvider` (the page reads data), and `/medications` was removed from the table of "not built yet" placeholder pages.

Completion criteria:
- [x] Add, edit, delete work against the mock repository; state survives reload (component tests and browser tests with real reloads).
- [x] Form validation tested (required fields, positive dose, duplicate times, end ≥ start, stock ≥ 0); errors are tied to their fields (`aria-describedby`, `aria-invalid`), the first invalid field gets focus, and the input is kept.
- [x] Double submit creates one medication (component test and browser test).
- [x] Ending a medication keeps its history (tested); the delete dialog names the consequences, shows the number of history records to be lost, and offers "end instead" (tested, including failures and a rollback failure).
- [x] Changing schedule times sets `scheduleEffectiveFrom` (tested); a rename does not.
- [x] Loading, empty and error states tested.
- [x] All standard checks pass (results in the stage 5 report). GitHub CI has not been observed.

## Stage 6 — Daily doses, history and stock

Scope: day view with date selector; dose rows with taken / skipped / clear actions; "outside current schedule" records; history page with filters; stock estimate display with explanation and unavailable state.

As delivered (no repository interface change was needed; Stage 2's logic and Stage 4's repositories were reused as they are):
- **Day view** `/doses` (nav item *Dawki*): day selector (previous / next day, date field, "Dziś"; the day is kept in the address as `?date=`), "today" from the injected clock and time zone; planned doses from `generateScheduledDoses`; each row shows time, medication, amount and unit, status and the actions that fit it (mark taken / skipped; change to the other status / clear). A day count line ("Przyjęte: n. Pominięte: n. Bez zapisu: n."), a separate section *Wpisy poza aktualnym harmonogramem* (read-only, with the reason when it is certain), and the stock estimate per medication of the day with an explanation (`Jak liczymy szacunkowy zapas?`).
- **History** `/doses/history`: recorded doses only, newest day first (earliest time first within a day), with the amount and unit as recorded, when each was recorded and the *Poza aktualnym harmonogramem* label with a reason; filters by date range, medication and status (kept in the address), count line, empty-history and no-match states, "Wyczyść filtry".
- **Writes** go through `applyDoseAction`, which reads the slot from storage first and applies Stage 2's `recordDose` / `changeDoseStatus` / `undoDose`, then the slot-based `upsert` / `remove`; `useDoseActions` runs one write at a time and reports success only after it finished.
- `useAsyncData` gained the opt-in `keepDataOnReload` (+ `isRefreshing`), so the day view does not flash a spinner after each write; `useDoseLogs` passes it through.
- **Stock and `recordedAt`**: the stock estimate counts *taken* records by when they were recorded in the app. This was reviewed path by path and is covered by regression tests (`stockWithRecording.test.ts`); two consequences (recording late, correcting later) are documented limitations with a remedy (re-enter the stock), see PROJECT_SPEC §7.3. The stock explanation in the app states the rule.
- Presentation fixes: Polish unit grammar for common units (`formatAmount`: 1 tabletka, 2 tabletki, 5 tabletek, 1,5 tabletki, 5 ml; unknown units are shown as typed) and an explicit "zapas nie został skonfigurowany" for missing stock, used on the medications list too.

Changes against the original plan (see PROJECT_SPEC DEC-31 to DEC-35):
- The roadmap names no routes; the day view is `/doses` and the history `/doses/history`, under one navigation item. The navigation now has four items (the grid and the keyboard-order tests were updated for it).
- The history is not a time-limited view: with no filters it shows every record (records are loaded once and filtered in memory). There is no paging yet.
- Records outside the current schedule are **read-only** in the day view (they cannot be changed or recorded again), but the **history offers "Usuń zapis…" for exactly those records**: a confirmation dialog (Cancel focused first) states that the record is deleted permanently and what stays, and the deletion re-checks against storage that the record is unchanged and still outside the schedule (`deleteOutsideScheduleRecord`, PROJECT_SPEC DEC-34). Records that match the schedule are corrected in the day view. No repository change was needed.
- Stock is shown in the day view (for the medications that have doses that day) and, as in Stage 5, on the medications list. It is always "as of today", whichever day is selected. It is not repeated in the history.
- Existing tests whose expectations changed because the product changed: unit grammar and the missing-stock wording in the Stage 5 stock tests, and the navigation tests (a new item in the keyboard order, and `/doses`, `/doses/history` as current pages). No assertion was removed.

Completion criteria:
- [x] Marking taken/skipped/clear works and never alters schedules or other days (tested: `applyDoseAction`, day view, browser).
- [x] Undo updates or removes the existing record and never creates a duplicate; repeated undo is a no-op (tested at logic (Stage 2), repository contract (Stage 4) and UI level).
- [x] Future days cannot be recorded (tested: the UI offers no recording, `applyDoseAction` refuses it, the local date comes from the time zone, not UTC).
- [x] Repeated clicks produce a single record (tested, including a slow write and a double click in the browser); buttons are disabled while a write or the refresh after it runs.
- [x] History shows snapshot amount/unit, even after the medication is edited (tested in the day view, the history and the browser).
- [x] Stock shows a value only when computable; otherwise shows the reason (tested: taken lowers it, skipped and unrecorded do not, missing stock, incompatible units, zero stock).
- [x] Skipped and taken are distinguishable without relying on colour (each status has its own word and icon).
- [x] All standard checks pass (results in the stage 6 report). GitHub CI has not been observed.

## Stage 7 — Doctor appointments

Scope: appointments page with Upcoming / Past tabs, list grouped by date, add/edit form, delete confirmation, mark completed / cancelled (and revert), "needs confirmation" state for elapsed scheduled visits.

As delivered (no repository interface change and no change to the Stage 2 classification, validation or status rules):
- **List** `/appointments`: accessible *Nadchodzące* / *Minione* tabs (ARIA tabs pattern, arrow keys / Home / End; the selected tab is also bold and underlined; the choice is kept in the address as `?tab=past`), each list grouped by day in the user's time zone (`groupAppointmentsByDate`), upcoming soonest first, past newest first. Each card shows time, doctor, specialty, place, notes and its state in words with an icon: *Zaplanowana*, *Do potwierdzenia*, *Odbyła się*, *Odwołana*. Loading, error + retry, "no appointments yet" and per-tab empty states, each with an action to add one.
- **Classification** is `classifyAppointment` / `splitAppointments` (Stage 2) applied to the injected clock; an appointment at exactly the current instant is still upcoming; a cancelled or completed one is past whatever its time; an elapsed `scheduled` one is *Do potwierdzenia*, listed under *Minione* (and the *Nadchodzące* tab points to them), with quick *Oznacz jako odbytą* / *Oznacz jako odwołaną*. It is never changed automatically.
- **Add / edit** `/appointments/new`, `/appointments/:id/edit` (React Hook Form + a Zod schema that only adapts `validateAppointmentDraft`, with Polish messages): date and time required, doctor or specialty required (both fields are marked), length limits, a time that does not exist on a clock-change day is refused, a time that exists twice is flagged and saved as the earlier one. Input is kept on a failed validation or save; errors are tied to their fields; the first invalid field is focused; one write at a time and a per-form id make a double submit create one appointment.
- **Status**: mark completed / cancelled, and *Przywróć jako zaplanowaną* for a correction (Stage 2's `changeAppointmentStatus`; completed ↔ cancelled directly is not offered or accepted).
- **Delete**: *Usuń trwale…* opens a confirmation dialog (Cancel focused first) that says it is permanent and points to cancelling instead; failures stay in the dialog.
- **Writes** (`appointmentActions.ts`) read the appointment from storage first (like the dose writes), so a stale screen cannot overwrite a newer status or details; an edit is applied to the stored appointment and nothing is written if nothing changed; an appointment deleted elsewhere is reported, not recreated.
- A small utility, `getLocalTimeInZone`, gives the wall-clock time of an instant in a zone (used to show and edit times).

Changes against the original plan (see PROJECT_SPEC DEC-36 to DEC-38):
- Edit keeps the exact stored instant when the typed date and time are the ones the appointment already has (otherwise editing the place of a visit at the *second* 02:30 of the night clocks go back would silently move it an hour).
- After saving an appointment that is not upcoming, the user is taken to the *Minione* tab so the new entry is visible.
- `/appointments` is no longer a placeholder: the "not built yet" test table lost that row (the same premise change as for `/medications` in stage 5). No assertion was removed.
- Not done: reminders or notifications for appointments (a future requirement), recurring appointments, a separate doctors table (DEC-05).

Completion criteria:
- [x] Add, edit, delete, status change work and persist across reload (component tests and browser tests with real reloads).
- [x] Upcoming vs past classification tested with the fake clock, including the boundary instant and midnight (Stage 2 tests extended with local-midnight cases; page tests with different injected clocks; browser tests with a fixed clock and time zone).
- [x] Validation: date/time required; doctor or specialty required (also whitespace-only, limits, nonexistent time).
- [x] Empty/loading/error states tested.
- [x] All standard checks pass (results in the stage 7 report). GitHub CI has not been observed.

## Stage 8 — Dashboard

Scope: today's counts and dose list (reusing stage 6 components), next appointments, stock summary, navigation, independent loading/error handling per panel.

As delivered (no repository interface change, no change to the Stage 2 rules or to the dose, medication and appointment screens' behaviour):
- **`/` (Pulpit)** is the start page, with three labelled panels, each with its own loading, error (+ retry), empty and data states:
  - **Dzisiejsze dawki**: today's doses (local day from the injected clock and time zone), the Stage 6 rows (`ScheduledDoseRow`) and the same write path (taken / skipped / change / clear, single-flight, honest feedback, focus return), the counts "Przyjęte / Pominięte / Bez zapisu / Razem dziś" (`summarizeDay`; counts only, no percentage or score), and a link to the full day view. A new user sees "Dodaj pierwszy lek"; a day without doses says so.
  - **Najbliższe wizyty**: up to three upcoming appointments, soonest first (`selectDashboardAppointments` over `splitAppointments`), each with its state in words; a "Do potwierdzenia: n" note with a "Potwierdź" link to the Past tab when elapsed scheduled appointments exist (nothing is changed); "Brak nadchodzących wizyt" and "Wszystkie wizyty" / "Dodaj wizytę".
  - **Zapasy leków**: only medications whose estimate can be computed (`summarizeStock` over `estimateStock`), fewest days first, with the existing "Niski zapas" label; a count (not a list) of in-use medications without an estimate; a message when none can be computed; the explanation of how the estimate is made and the statement that it is not a guarantee of availability; a link to "Zarządzaj lekami".
- Doses and stock share one read of the medications and intake records (so marking a dose updates the counts and the stock together); appointments are read on their own. A read failure fails only the panels that depend on it.
- `useDoseListActions` and `DoseFeedbackMessage` were extracted from the day view so both screens share them; the day view behaves as before (its tests pass unchanged).
- Found in the final review and fixed with regression tests: (1) the shared write hook `useDoseActions` (stage 6) cleared its progress indicator on an ignored second click, so a very fast double click switched the spinner off while the first write was still running (it affected the day view too; the data was never at risk, since only one write happens); (2) a dashboard panel showed "no medication yet" next to a read error when the medications loaded empty but the intake records failed.
- The `PlaceholderPage` component, whose only user was the old dashboard, was removed together with the test that described placeholder pages (there are none left; that test now checks that every section has a single level-one heading).

Changes against the original plan (see PROJECT_SPEC DEC-39, DEC-40):
- The roadmap says "stock summary" without a layout; on desktop the doses panel is full width (its rows hold two buttons) and appointments and stock sit side by side from the tablet width up, stacked on phones.
- Elapsed appointments are shown as a count with a link, not as list items, to keep the panel short; the full "Do potwierdzenia" cards are on the appointments page.

Completion criteria:
- [x] No percentages or adherence scores are shown; counts only (tested, also in the browser).
- [x] A failing panel shows its own error while others render (tested: appointments, intake records and medications failing, with retry).
- [x] Empty states for new users with calls to action (tested at component and browser level).
- [x] Stock panel lists only computable estimates; says so when none are available (tested; a browser test found and fixed an ended medication without stock being counted as "unavailable").
- [x] All standard checks pass (results in the stage 8 report). GitHub CI has not been observed.

## Stage 9 — End-to-end tests, accessibility, demo deployment (MVP complete) ◐

Scope: Playwright main journey (open → dashboard → add medication → schedule → mark taken → history → add appointment → edit/cancel) with a fixed clock; keyboard-flow test; automated accessibility scan (e.g. `@axe-core/playwright`, if approved as a dev dependency) on main pages; visual polish pass; README screenshots; Vercel deployment of the **mock-data demo** with a visible "demo – fictional data" banner; `vercel.json` SPA rewrite.

As delivered (no change to domain rules, schedules, appointment statuses or stock; no reminders, notifications, authentication, Supabase, cloud sync or PWA):
- **E2E**: `e2e/journey.spec.ts` (fixed clock and time zone, empty start): add a medication with two times and a stock → list → dashboard counts and stock → mark a dose taken, reload, check what is stored → day view and history → add an appointment → dashboard → edit → cancel → restore. A second test does the main actions with the keyboard only (skip link, Enter on a dose, focus after the change, add-appointment form, tabs with arrow keys, delete dialog: focus on Cancel, Escape returns focus). Validation errors and failed reads/writes were already covered by the feature specs of stages 5–8 and were reused, not duplicated. The native date and time fields are filled with `fill`, because their segment order follows the browser's UI language, which a test cannot control.
- **Accessibility**: `@axe-core/playwright` was added as a dev dependency because the existing tooling (`eslint-plugin-jsx-a11y`) is static and cannot check colour contrast, names or landmarks in the rendered page. `e2e/accessibility.spec.ts` scans every main screen and state (with data, empty, validation errors, open dialogs, a failing panel, a status message) at 390 px and 1280 px with the WCAG 2.0/2.1 A and AA and best-practice rule sets, and a self-check shows that the scan reports injected problems. A separate test requires touch targets of at least 44 px on phones (axe's own rule only asks for 24 px).
- **Problems found and fixed**: (1) small buttons (medication cards, "Usuń godzinę N", buttons in notices) and the summary of "Jak liczymy szacunkowy zapas?" were 20–36 px high on phones: the `sm` button size is now 44 px on phones and coarse pointers and 36 px only for a mouse on tablets and larger, and the summary row has padding; (2) the native calendar button inside date fields had no brand focus outline; (3) the first version of the demo notice was a `role="note"`, which axe reported as content outside any landmark; it is now a named region; (4) the production build asked for a missing `/favicon.ico` (a 404 on every page; on a static host with an SPA rewrite it would have received the HTML page): a small favicon was added.
- **Demo notice**: a non-dismissible region on every page says that the data is fictional, kept only in this browser (`localStorage`), not encrypted, and that real medical or personal data must not be entered.
- **Deployment configuration**: `vercel.json` (SPA rewrite after the filesystem, basic security headers, immutable caching of `/assets/`), `src/deployment.test.ts` (checks the configuration: rewrite, no backend settings, no foreign hosts) and `npm run e2e:preview` with `playwright.preview.config.ts` (builds, serves the production build, opens every main route directly and after a reload, an unknown address, absence of `/dev/*`, empty start, a medication surviving a reload, no console/page errors, no request to another host). The CI workflow runs it. The production demo starts empty, because the demo data loader is development-only.
- **README**: instructions, demo limits, deployment steps, screenshots generated by `npm run screenshots` from the fictional demo data with a fixed date, and, after the deployment, the link to the live demo.
- **Deployment** (done by the project owner in Vercel, not by the assistant; no repository file changed for it): <https://pigoowa-medication-doctor-visit-tra.vercel.app/>. The build log the owner shared shows branch `claude/focused-keller-4a79xq`, commit `490cb55`, `npm ci` and `npm run build`, the same bundle files (names and sizes) as the local build, and a completed deployment. The owner checked by hand: the dashboard and its demo notice; `/medications`, `/doses`, `/appointments` opened directly and after a reload; a fictional medication saved and kept after a reload; the security headers (in developer tools and with `curl`); `/dev/data` not offering the development panel.

Still open or not verified: nobody has checked the live demo on a phone, in the browser console and network panel, on the routes not listed above, or with a screen reader; the rewrite and headers were therefore confirmed on the live site only for the pages and headers the owner looked at. No Content-Security-Policy was added. GitHub Actions has not been observed running: `ci.yml` starts on pushes to `main` and on pull requests, and the repository currently has only the working branch. No manual test with a screen reader or on a real phone was made. The Vite main chunk is about 547 kB (a build warning above 500 kB); splitting it is out of scope here.

Completion criteria:
- [x] The E2E journey passes reliably (the journey tests were run 5 times in a row without a failure; the full suite ran several times).
- [x] No serious/critical accessibility violations on main pages (axe reports none at all, including best-practice rules, on all scanned screens and states at 390 px and 1280 px; automated checks only).
- [ ] Deployed demo works on mobile and desktop; contains only fictional data. **Open:** the demo is deployed, and the owner confirmed by hand that the main routes, reload, saving a fictional medication, the security headers and the absence of `/dev/data` work (the device and screen size were not recorded); it contains no data of its own. It has not been confirmed on a phone, so this stays unchecked.
- [x] README has screenshots, live link, accurate setup instructions (the link is the one the owner supplied; the screenshots come from fictional data).
- [x] All standard checks pass (results in the stage 9 report). GitHub CI has not been observed. **The MVP is not declared complete until the open criterion (the live demo on mobile) is confirmed.**

## Medication features track (F0–F8): planned before Stage 10

Not part of the original stage list. The owner accepted an audit of the dashboard, doses and medication screens and asked for the changes below. The track sits between Stage 9 and Stage 10 because it changes the data model, and `DATABASE.md` must contain the new fields and the stock events table **before** the Stage 10 schema is made (PROJECT_SPEC DEC-51). The letters F0 to F8 avoid renumbering stages 10 to 12, which other documents refer to. **Stage 9 stays open** (the phone check of the live demo) and is not affected by this track.

The decisions are DEC-44 to DEC-53 in PROJECT_SPEC; the requirements are §4.5 (F-1 to F-9); the rules are §7.6 and §10.5; the database design is DATABASE.md §3.2, §3.4, §3.6 and §9. **Nothing of this exists in the code yet**: every item below, except F0, is planned.

Order and dependencies. F1 comes first among the data stages, because the first new persisted fields (F4) and the new collection (F6) must not be written in the version 1 format. F2 and F3 change no data.

| Stage | Needs | Why |
|---|---|---|
| F0 | none | documentation only |
| F1 | F0 approved | the migration and the write gate (PROJECT_SPEC §10.5) |
| F2 | F0 approved | no data change |
| F3 | F0 approved | no data change; the highlight is a pure function |
| F4 | F1 | first new persisted fields (`dosageForm`, `strength`) |
| F5 | F1, F4 | the threshold is persisted, and its unit comes from the lists of F4 |
| F6 | F1, F5 | new collection, `MedicationStock.basis`, and the details page that holds the actions |
| F7 | F6 | uses the stock events |
| F8 | F1 | persists `takenAmount` and `note`; independent of F4 to F7 |
| Stage 10 | F0 approved | the schema in DATABASE.md already contains every planned column and table |
| Stage 11 | Stage 10 | the Supabase repositories must satisfy the same contract tests, including stock events |

Building F1 to F8 before Stage 10 is **planned, not required** (DEC-51). If Stage 10 comes first, it must still create every planned column and table of DATABASE.md, and the F-stages then also need the Supabase side; nothing in F1 to F8 depends on a database.

### F0 — Decisions and documentation ◐

Scope: write the approved decisions down, in PROJECT_SPEC, DATABASE and this roadmap, before any implementation. Documentation only: no code, test, dependency or configuration changes, no migration run.

Decisions recorded (owner's answers):
1. Storage versioning: **option B**, a v1 to v2 migration with a backup and tests that data is preserved (DEC-44, §10.5).
2. Low-stock threshold: the user's own quantity in the stock unit, a warning when `remaining <= threshold`; without a threshold the 7-day rule stays (DEC-46).
3. **Strength** is an informational field; it is neither a dose unit nor a stock unit and takes no part in any calculation (DEC-45).
4. A refill cannot be back-dated in the first version (DEC-47).
5. The next unrecorded dose is highlighted on the dashboard, with no change to domain rules (DEC-50).
6. The new models and events are described before Stage 10 (DEC-51, DATABASE.md).

Decided in the second F0 pass (owner's answers):
- **DEC-52 accepted:** both ways of starting stock tracking are kept (count, or new package). An empty quantity is never zero, and the new-package variant says that earlier leftovers are not counted. The three stock states (counted, new package, unknown) are presented differently (PROJECT_SPEC §7.6).
- **DEC-53 accepted on condition:** the write gate, the per-collection backup, the verification and the absence of automatic deletion are kept; the mechanism is never presented as full protection against old copies, races or browser failures.
- **Note limit of 500 characters approved**, separately for the note of a taken dose (`DoseLog`) and for the note of a stock event (`StockEvent`). A note about wasted medicine belongs to the `waste` event, not to a dose record.
- **Migration without a backup rejected:** with no room, that collection's migration stops and a message is shown; the backup is never skipped.
- **A restore screen on the development page deferred:** only the requirements for a future tool are written down (PROJECT_SPEC §10.5); nothing is built.
- A `pending` collection is readable only when its original format is unambiguously recognised and supported; otherwise reading and writing are both refused (§10.5, "Recognition").
- A backup is not enough to resume: the original, the backup and the version are compared in the same run (§10.5, "Resuming").
- The details of how a unit outside the list is shown and kept, and how incompatible units are kept out of calculations (PROJECT_SPEC §7.6), stand as written in the second pass.

Changed against the first F0 draft, not against any approved decision: the migration backup is one raw key per collection instead of one JSON value; a damaged collection no longer stops the migration of the healthy ones; the migration is described as resumable and not atomic, with its limits listed.

Also recorded: the three quantities (strength, dose, stock) are kept apart; no unit conversion; units not on the new lists stay visible and are never replaced automatically; the stock events collection is part of the migration, the migration backup, the demo reset and the deletion of a medication; the risk of an older copy of the app in another tab or deployment after migration, the limits of `localStorage` and the lack of atomic writes across keys (§10.5).

Completion criteria:
- [x] PROJECT_SPEC, DATABASE and ROADMAP describe the decisions, the rules, the data model and the risks above, and mark everything as planned.
- [x] No file outside `docs/` was changed.
- [x] §10.5 states the collection states, the behaviour after an interruption, how an incomplete migration is recognised, the conditions for resuming, the old-copy risks, the backup policy and the quota, without describing the migration as atomic or as safe beyond what the mechanism gives.
- [x] Notes belong to the dose record (taken doses) and to the stock event (refill, waste); the 500-character limit is approved and applies to each separately.
- [x] The three documents agree on DEC numbers, storage keys, field names, formulas and dependencies (checked by reading them against each other).
- [x] Documentation formatting check passes.
- [x] The owner decided the proposals: DEC-52 accepted, DEC-53 accepted on condition, note limit approved, migration without a backup rejected, restore screen deferred.
- [ ] The owner has reviewed the final text of the three documents.

Open questions are listed under the stage that must answer them.

### F1 — Storage v2 migration

Scope: envelope version 2; the migration of each collection with a verbatim backup in its own key, the `meta` entry with the SHA-256 fingerprint of the backup text, the compare before the write and the read-back after it (PROJECT_SPEC §10.5); reading versions 1 and 2 per collection; the write gate and the `migration-required` error; the explicit start-up migration with a visible result for each collection and a retry; a tested function that restores one collection from its backup (no screen); a frozen copy of the current version 1 reader for the tests. No new field and no screen change apart from the messages of the migration and of a refused write.

Open: when and how removal of the migration backup is offered (a later decision; never automatic, only for a verified backup, not in F1); the text that tells a user of an older tab to reload (the older code cannot be changed). **Decided:** no migration without a backup (with no room that collection stops); the restore screen is deferred, only its requirements are written down (PROJECT_SPEC §10.5).

Completion criteria:
- [ ] Migrated items equal the originals field by field; units preserved byte for byte.
- [ ] The backup equals the original text verbatim and is read back before the rewrite; a failed or mismatching backup changes nothing.
- [ ] The write gate: a write to a `pending` collection is refused; no version 2 write precedes the collection's backup (tested).
- [ ] A collection whose original format is not unambiguously recognised (invalid record, `version` that is not exactly 1 or 2) is neither read, written nor migrated, and does not stop the others; only a fully recognised version 1 collection is readable as `pending`.
- [ ] Resuming classifies the original (absent, version 1, version 2, damaged) and the backup (expected pre-migration copy, damaged or inconsistent, origin cannot be established) in each run and behaves as the table in §10.5 says; the existence of a backup alone never lets a step be skipped.
- [ ] The version 1 backup of a collection that is already version 2 is never written, replaced or deleted by the migration, even though it differs from the original; in particular an interruption after the version 2 write and before the verification leaves it byte for byte unchanged and the next start verifies it (tested with a write spy).
- [ ] The provenance entry carries the SHA-256 of the exact backup text (computed synchronously by a small pure function, no new dependency, tested against published vectors including the empty text, and against an independent reference for non-ASCII text) and is written before the rewrite; a failure to write it stops that collection.
- [ ] A backup is classified as the expected pre-migration copy only if its exact text has the recorded fingerprint: a valid version 1 text with the same length and record count but another text is not accepted (tested); a missing or mismatching fingerprint never causes a write to the backup of a `migrated` collection.
- [ ] `verifiedAt` is set only after both identity (the fingerprint, checked again at the moment it is set) and agreement (the migrated items equal the backup's items) have been checked; a merely valid version 1 text never sets it, and a backup that changed after step 3 is reported and does not set it (tested).
- [ ] The time to compute the fingerprint on a collection of the size estimated in PROJECT_SPEC §10.5 is measured and reported.
- [ ] No room for a collection's backup stops that collection with a message; no code path migrates without a backup.
- [ ] A storage that fails at every step in turn leaves a state the new code reads and the next start finishes; running twice changes nothing.
- [ ] A second tab changing the text between the compare and the write is retried, then reported (`changed-concurrently`); the remaining race window is documented as not excluded.
- [ ] The frozen version 1 reader refuses version 2 data and writes nothing (tested).
- [ ] Reading never migrates or writes.
- [ ] Restore round trip works and is refused without the confirmation.
- [ ] No backup is ever deleted by the code.
- [ ] All standard checks pass.

### F2 — Time field

Scope: the text time field with normalisation, quick picks and an optional system picker (DEC-49) in the medication schedule and the appointment form. No data change.

Completion criteria:
- [ ] Unit tests for every accepted and rejected format; component tests for typing, normalisation, quick picks and messages.
- [ ] Works at phone width in the browser tests, with the keyboard, and with the system picker where available.
- [ ] A checklist of manual tests on real devices (iOS Safari, Android Chrome) is done and recorded; automated tests cannot reproduce the system pickers.
- [ ] Accessibility scan and touch-target test pass.
- [ ] All standard checks pass.

### F3 — Visual refresh and next unrecorded dose

Scope: module cards, larger headings and dose rows, larger badges, a darker card border, a clearer low-stock line on the dashboard and the highlight of the next unrecorded dose (DEC-50). No domain rule changes; no new colours beyond one accent and the existing warning colour.

Open: the wording and look of the highlight.

Completion criteria:
- [ ] New colour pairs are checked by `tokens.test.ts`; the axe scans and touch-target tests pass at 360, 390 and 1280 px.
- [ ] The selection of the highlighted dose is a tested pure function that does not read the clock.
- [ ] No percentage or score appears; the wording stays neutral.
- [ ] All standard checks pass.

### F4 — Dosage form, units and strength

Scope: `dosageForm`, the unit lists, the handling of stored units that are not on a list, `strength` (DEC-45). The first stage that persists new fields; it needs F1.

Open: the final unit lists (the table in PROJECT_SPEC §7.6 is the proposal); how an unlisted unit is shown in the select.

Completion criteria:
- [ ] A medication saved before this stage opens, shows its unit unchanged and can be saved without changing it.
- [ ] A stored unit that is not on the list is the first, selected option, labelled as outside the list; saving without touching it stores the original text byte for byte; once another unit is saved the old one cannot be chosen again (tested).
- [ ] No unit is converted or replaced automatically; the strength never changes any estimate (tested).
- [ ] The form says at once when the stock unit differs from the dose unit, and no number is computed for such a medication (tested through `estimateStock` and the form).
- [ ] `strength` is not part of the input of the stock logic and changing it never changes an estimate (tested).
- [ ] Contract, validation and demo data tests cover the new fields.
- [ ] All standard checks pass.

### F5 — Details page and own low-stock threshold

Scope: the medication details page (`/medications/:id`), the threshold with its unit, the rule of DEC-46 and the warning on the details page and the dashboard.

Open: whether the details page replaces some actions on the list card.

Completion criteria:
- [ ] The warning follows `remaining <= threshold` when it applies and the 7-day rule otherwise; a threshold in another unit is not applied and the page says so.
- [ ] Unavailable estimates are never "low".
- [ ] Page, logic and browser tests; accessibility scan of the new page.
- [ ] All standard checks pass.

### F6 — Stock events and refill

Scope: the `StockEvent` model and repository, the estimate with events, *Zacznij śledzić zapas* with `MedicationStock.basis` (DEC-52), the refill dialog and the history of stock events, reversal, deletion with the medication, demo reset and backup including the events (DEC-47, PROJECT_SPEC §7.6, §10.5).

Open: whether a refill is allowed for an ended medication.

Completion criteria:
- [ ] Every refill row of the §7.6 action table is tested through the real code path.
- [ ] A double submit gives one event; a failed write keeps the form and shows an error.
- [ ] Repository contract tests: duplicate id, missing medication, cascade, reversal, repeated reversal.
- [ ] Deleting a medication removes its events (with rollback tests); the demo reset and its backup include the events.
- [ ] *Zacznij śledzić zapas* offers "counted" and "new package" (DEC-52): an empty field is refused and never stored as zero; `basis` is stored and the screens say what is and is not counted; doing neither leaves the estimate unavailable.
- [ ] A refill without a stock baseline is refused and the page offers to start tracking.
- [ ] The note of an event is stored on the event.
- [ ] The three stock states (counted, new package, unknown) have distinct statements on every screen that shows stock; *od nowego opakowania* stays wherever the number appears; the unknown state shows no number, no zero and no warning (tested).
- [ ] All standard checks pass.

### F7 — Wasted medicine

Scope: the `waste` event, its dialog and reversal (DEC-47). It never marks a dose and is never a skipped dose.

Open: the wording of the warning when the amount exceeds the estimate.

Completion criteria:
- [ ] The estimate drops by the amount; no dose status changes and no dose record is touched (tested).
- [ ] The note is stored on the `waste` event and nowhere else.
- [ ] Reversal restores the estimate and keeps the history.
- [ ] Page and browser tests; accessibility scan.
- [ ] All standard checks pass.

### F8 — Actually taken amount and note

Scope: `takenAmount` and `note` on taken doses, the action that edits them, the changed messages in the dose row and the history, the use in the estimate (DEC-48).

Completion criteria:
- [ ] The plan (`doseAmount`) is never overwritten; both amounts are shown.
- [ ] The note is stored on the dose record, only for a taken dose, and a note about wasted medicine is never stored there.
- [ ] Skipped removes the taken amount; editing never moves `recordedAt`; the same value is unchanged; a changed-meanwhile record is refused (tested).
- [ ] The schedule and the recommendation are not touched.
- [ ] The estimate uses the amount actually taken (every taken row of the §7.6 action table).
- [ ] All standard checks pass.

## Stage 10 — Supabase schema and Row Level Security

Scope: local Supabase stack, migrations for all tables in DATABASE.md **including the tables, columns and constraints marked planned for the medication features track (F0–F8; DATABASE.md §3.2, §3.4, §3.6, §9)**, RLS policies, constraints, seed data, pgTAP tests, two-account integration tests. No UI changes.

Completion criteria:
- [ ] Database can be recreated from migrations alone.
- [ ] All tests listed in DATABASE.md §6 pass, including cross-user access attempts with two accounts.
- [ ] RLS enabled on every table (verified by a query that fails if any `public` table has it disabled).
- [ ] DATABASE.md updated to match the implemented schema.
- [ ] No privileged key in the repository or frontend bundle (checked).

## Stage 11 — Authentication and Supabase persistence

Scope: Supabase client (public URL + anon key only), **TanStack Query** replacing the custom data hooks' internals (DEC-12), `.env.example` with the public variables, sign up / sign in / sign out, protected routes, profile creation, Supabase repository implementations passing the same contract tests as the mocks, switchable by configuration; account-specific data; demo mode remains available.

Completion criteria:
- [ ] Repository contract tests pass against both implementations.
- [ ] Two real users see only their own data in the UI (manual + automated check).
- [ ] Auth error states handled (wrong password, expired session, network failure).
- [ ] E2E journey passes with authentication.
- [ ] All standard checks pass.

## Stage 12 — Pre-release review

Scope: privacy and legal review (GDPR, health data as special category, consent, privacy policy, data export/deletion), security review, documented limitations and medical disclaimer, error monitoring decision, dependency audit, backup/restore check.

Completion criteria:
- [ ] Limitations and disclaimer visible in the app and docs.
- [ ] Privacy policy and consent flow reviewed by someone qualified before real users are onboarded.
- [ ] `npm audit` reviewed; no secrets in history.
- [ ] Data export and account deletion work.

---

## After the MVP (not started until the above is stable)

Reminders (see "Dose reminders" below) · low-stock notifications · recurring appointment reminders · weekly/interval schedules · improved mobile experience (PWA) · deeper accessibility review · monitoring · additional tests.

### Dose reminders (future requirement; nothing of this exists yet)

Recorded now so it is not lost; **not part of the MVP and not started**. The wording to keep in the product: a reminder helps, it does not guarantee anything.

Requirements as stated by the product owner:
- On a phone, a reminder should play a clear, noticeable sound.
- If the user neither acknowledges nor dismisses it, it repeats at a configurable interval (initially about every 10 minutes).
- The user can mark the dose as taken, snooze the reminder or silence it.
- Several medications at the same time must not produce several alarms.
- Quiet hours and user-configurable behaviour should be considered.

Open questions that must be answered **before anything is promised** (research, not assumptions):
- What Android, iOS, browsers and installed PWAs actually allow in the background: a web page cannot be assumed to play audio while it is suspended or the phone is locked; timers in a closed tab do not run.
- Which route can deliver it: system notifications (Notification API, service workers, Web Push — with iOS limits for installed PWAs), a PWA, or a native app. Server-side scheduling would also need Supabase (stages 10–11) and consent.
- How to handle permissions being denied, battery optimisation, Do Not Disturb and time zone / daylight-saving changes.
- A reminder must never be described as guaranteed unless the chosen implementation and the target platform really guarantee it; if the platform cannot, the app must say so.
