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
| 9 | End-to-end tests, accessibility, demo deployment (MVP complete) | ☑ |
| F0 | Medication features: decisions and documentation | ☑ |
| F1 | Medication features: storage v2 migration | ☑ |
| F2 | Medication features: time field | ◐ |
| F3 | Medication features: visual refresh, next unrecorded dose | ☑ |
| F4 | Medication features: dosage form, units and strength | ☑ |
| F5 | Medication features: details page and own low-stock threshold | ☑ |
| F6 | Medication features: stock events and refill | ☑ |
| F7 | Medication features: wasted medicine | ☑ |
| F8 | Medication features: actually taken amount and note | ☑ |
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

## Stage 9 — End-to-end tests, accessibility, demo deployment (MVP complete) ☑

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
- [x] Deployed demo works on mobile and desktop; contains only fictional data. The owner checked the main routes, reload, saving a fictional medication, the security headers and the absence of `/dev/data` by hand, and later reported that the application works well on a phone; it contains no data of its own. (The owner's report is the evidence; no automated test runs against the live site.)
- [x] README has screenshots, live link, accurate setup instructions (the link is the one the owner supplied; the screenshots come from fictional data).
- [x] All standard checks pass (results in the stage 9 report). GitHub CI has not been observed. **Stage 9 is closed on the owner's decision: the MVP, a demo that keeps fictional data in the browser, is complete as the roadmap defines it.** What the closing does not cover is listed above under "Still open or not verified" (a screen reader test, the browser console and network panel of the live site, the routes the owner did not list, and GitHub Actions); none of it blocks later work, and the interface improvements the owner asked for are the F-track below.

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

### The owner's interface and medication wishes, and where each one lives

All of these are requirements of later stages; none is part of F1. Nothing in them is implemented yet.

| # | Wish | Stage |
|---|---|---|
| 1 | Clearer cards and a clearer separation of the modules on *Pulpit* and *Dawki* | F3 |
| 2 | An interface that suits older users too: large enough texts and buttons, contrast, clear statuses | F3 (and every later screen: F5 to F8) |
| 3 | Choosing or suggesting the dose unit from a list, to reduce typing errors | F4 |
| 4 | On a phone, typing the time by hand and using the native time picker where the platform allows it | F2 |
| 5 | An easily reachable *Uzupełnij zapas leku* action | F6 (reachable in one step from the medication card and from the dashboard stock panel) |
| 6 | A configurable low-stock warning threshold | F5 |
| 7 | Recording the amount actually taken, with an optional note | F8 |
| 8 | A separate report of a wasted tablet or other unit that lowers the stock but does not mark the dose as taken | F7 |

Strength and dosage form stay **informational**: nothing converts a strength into a number of tablets or one unit into another (DEC-45, DEC-06).

### F0 — Decisions and documentation ☑

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
- [x] The owner reviewed and approved the final text of the three documents (committed as `b321477`).

Open questions are listed under the stage that must answer them.

### F1 — Storage v2 migration ☑

Scope: envelope version 2; the migration of each collection with a verbatim backup in its own key, the `meta` entry with the SHA-256 fingerprint of the backup text, the compare before the write and the read-back after it (PROJECT_SPEC §10.5); reading versions 1 and 2 per collection; the write gate and the `migration-required` error; the explicit start-up migration with a visible result for each collection and a retry; a tested function that restores one collection from its backup (no screen); a frozen copy of the current version 1 reader for the tests. No new field and no screen change apart from the messages of the migration and of a refused write.

As delivered (code in `src/services/local/migration.ts`, `collection.ts`, `localRepositories.ts`, `src/services/migrationReport.ts`, `src/utils/sha256.ts`, `src/components/layout/MigrationNotice.tsx`, `src/main.tsx`; the table in PROJECT_SPEC §10.5, "As implemented", lists everything):
- Every collection is written as version 2. A collection is read as version 1 or 2; a version 1 collection is never written by ordinary operations (`migration-required`), a damaged one is neither read nor written.
- `src/main.tsx` runs the migration once before the first render. It migrates each recognised version 1 collection (smallest first): backup verbatim, read-back, provenance entry with the SHA-256 of the exact text, compare, rewrite as version 2, read-back, then `verifiedAt` after the identity (fingerprint) and agreement (records) checks. A failure stops that collection only and leaves it as it was; the next start or a retry resumes.
- The backup of a collection that is already version 2 is never written, replaced or deleted, whatever its state (checked by tests with a write spy and by a test that no key is ever removed).
- `<MigrationNotice>` appears only when a collection failed (with a retry) or is damaged.
- Measured: the fingerprint of 0.9 million characters takes about 27 ms (Node 22, development machine; not measured on a phone). The main bundle grew from 547.99 kB to 556.61 kB.
- The behaviour of other screens is unchanged. Tests that seeded a version 1 envelope to write to it, or that expected `version: 1` or `version: 2` to be refused, were updated: that is the intended change of F1.

Changes against the design, none against an approved decision: the `failed` result has one more reason, `storage-unavailable`; the write gate is per collection, so recording a dose still works while the medications are version 1 and the reverse (the end-to-end test shows it).

Not done or not covered: no screen for the restore function (deferred by the owner); no removal of the migration backup (a later decision, never automatic); the older copies of the application that are already running cannot be changed, so an old tab is only told by its own existing message that the data comes from another version; a real second tab, a power loss in the middle of a write and a browser that clears the data cannot be tested, and the limits in PROJECT_SPEC §10.5 stand. Not measured: the browser's `localStorage` limit and the fingerprint time on a phone.

Completion criteria:
- [x] Migrated items equal the originals field by field; units preserved byte for byte (`migration.test.ts`; `e2e/migration.spec.ts` keeps `"Tabletka "` as stored).
- [x] The backup equals the original text verbatim and is read back before the rewrite; a failed or mismatching backup changes nothing.
- [x] The write gate: a write to a `pending` collection is refused; no version 2 write precedes the collection's backup (tested).
- [x] A collection whose original format is not unambiguously recognised (invalid record, `version` that is not exactly 1 or 2) is neither read, written nor migrated, and does not stop the others; only a fully recognised version 1 collection is readable as `pending`.
- [x] Resuming classifies the original (absent, version 1, version 2, damaged) and the backup (expected pre-migration copy, damaged or inconsistent, origin cannot be established) in each run and behaves as the table in §10.5 says; the existence of a backup alone never lets a step be skipped.
- [x] The version 1 backup of a collection that is already version 2 is never written, replaced or deleted by the migration, even though it differs from the original; in particular an interruption after the version 2 write and before the verification leaves it byte for byte unchanged and the next start verifies it (tested with a write spy).
- [x] The provenance entry carries the SHA-256 of the exact backup text (computed synchronously by a small pure function, no new dependency, tested against published vectors including the empty text, and against an independent reference for non-ASCII text) and is written before the rewrite; a failure to write it stops that collection.
- [x] A backup is classified as the expected pre-migration copy only if its exact text has the recorded fingerprint: a valid version 1 text with the same length and record count but another text is not accepted (tested); a missing or mismatching fingerprint never causes a write to the backup of a `migrated` collection.
- [x] `verifiedAt` is set only after both identity (the fingerprint, checked again at the moment it is set) and agreement (the migrated items equal the backup's items) have been checked; a merely valid version 1 text never sets it, and a backup that changed after step 3 is reported and does not set it (tested).
- [x] The time to compute the fingerprint on a collection of the size estimated in PROJECT_SPEC §10.5 is measured and reported (above; development machine only).
- [x] A storage that fails at every step in turn leaves a state the new code reads and the next start finishes; running twice changes nothing.
- [x] Another tab changing the text before the compare is detected: the collection is read again, and after three attempts it is reported (`changed-concurrently`). A change in the instant between the compare and the write cannot be detected; it stays documented as not excluded.
- [x] The frozen version 1 reader refuses version 2 data and writes nothing (tested).
- [x] Reading never migrates or writes.
- [x] Restore round trip works and is refused without the confirmation, or for a missing, unusable or unverifiable backup.
- [x] No backup is ever deleted by the code (tested: no key is removed by any migration, verification or restore).
- [x] No room for a collection's backup stops that collection with a message and a retry; no code path migrates without a backup (unit and browser tests).
- [x] All standard checks pass: `typecheck`, `lint`, `format:check` clean; `test` 1167 tests in 65 files (1076 in 62 before F1); `build` ok with the known chunk-size warning (main chunk 556.61 kB); `e2e` 190 passed (186 before); `e2e:preview` 11 passed. GitHub CI has not been observed.

### F2 — Time field ◐

Scope: the text time field with normalisation, quick picks and an optional system picker (DEC-49) in the medication schedule and the appointment form. No data change.

Status: implemented and verified by the automated checks below. **Not ☑**: the criterion about real devices needs the owner, because the system pickers of iOS Safari and Android Chrome cannot be reproduced by any test here.

As delivered (code in `src/utils/timeInput.ts`, `src/components/ui/TimeField.tsx`, `src/components/ui/quickTimes.ts`, `ScheduleTimesEditor.tsx`, `AppointmentForm.tsx`):
- Before: `<input type="time">`. On a phone it opens the system picker and often cannot be typed into; its size and icon are the system's.
- After: a text box with the digit keypad (`inputmode="numeric"`) that accepts `7:30`, `0730`, `730`, `07:30` and `7.30`; hours 0–23, minutes two digits 00–59. Seconds, other separators, letters, a lone hour and `7:5` are not times.
- While typing nothing is changed or erased and no message appears. The form receives the normalised `HH:mm` as soon as the text is a complete, existing time (so the schema, the duplicate-time check and the stored value never see another shape); before that it receives what was typed, and the existing rule refuses it on save. Leaving the field shows a valid entry as `HH:mm`.
- An entry that is not a time stays as typed after leaving the field, with a message (`Wpisz godzinę w formacie GG:MM, na przykład 07:30.` or `Taka godzina nie istnieje. Wpisz godzinę od 00:00 do 23:59.`). When the form already shows its own error for the field, only that one is shown. The messages of the two schemas now give the same format hint.
- Quick picks: buttons at least 44 px tall, one Tab stop (arrow keys, Home and End move between them), `aria-pressed` for the chosen time. Medications: 06:00, 08:00, 12:00, 18:00, 20:00, 22:00; appointments: 08:00, 09:00, 10:00, 12:00, 14:00, 16:00. They only fill the field; no schedule is suggested.
- The system picker is a transparent `<input type="time">` laid over a visible button "Zegar", so a tap reaches the platform's own control (the click also calls `showPicker()` inside a `try`). It is left out where the browser has no time control. Typing is never affected by it.
- Stored data and existing records are untouched: the value is still the text `HH:mm`; no migration; a stored time is shown and saved as it was.
- Measured: main bundle 556.61 → 564.14 kB.

Not covered or limits: the OS pickers, the phone keyboard's behaviour (some Android keyboards show no `:` or `.` on the digit keypad, which is why `0730` is accepted), voice input, and autofill cannot be tested here. Chromium with touch emulation is not iOS Safari or Android Chrome. On a browser where `showPicker()` is refused, the transparent control still opens the picker by a direct tap on the platforms that do so; this was not verified on a device.

Manual checklist for the owner (iOS Safari and Android Chrome; record device, browser version, date and the result of each item here):
1. Tap the time box: a digit keypad appears. Type `0730` without a colon, tap elsewhere: it shows `07:30`.
2. Type `7:30`, `730`: the same. Type `07:` and leave: the text stays and the message appears; go back and finish it: the message disappears.
3. Type `2560` and save: nothing is saved, the field says the time does not exist, the text is still there.
4. Tap "Zegar": the system picker opens; choose a time: it appears in the box. Type after using it: typing still works.
5. Tap a quick pick: the box shows that time and the button is marked.
6. Zoom the browser text to its largest setting: nothing is cut off or overlaps; every button is easy to hit.
7. Do the same in the appointment form; add an appointment and check the hour in the list.
8. Open a medication saved before this change: its times are unchanged.

Completion criteria:
- [x] Unit tests for every accepted and rejected format (`timeInput.test.ts`, 72 tests); component tests for typing, normalisation, quick picks, messages, the clock and the disabled state (`TimeField.test.tsx`, 30 tests); the form pages' tests updated for the new field.
- [x] Works at phone width in the browser tests (`e2e/timeField.spec.ts`, 20 tests: touch emulation at 360 px, typing, quick picks, the clock control, messages, saving, 200 % text size, appointments, existing records), with the keyboard (`MedicationFormPages.test.tsx`, the Tab order), and with the system picker control where the browser has one (Chromium; the control accepts a chosen time).
- [ ] A checklist of manual tests on real devices (iOS Safari, Android Chrome) is done and recorded (the checklist is above; open: needs the owner).
- [x] Accessibility scan and touch-target test pass (`e2e/accessibility.spec.ts` and the new spec; the transparent clock control had been 42 px tall and was fixed).
- [x] All standard checks pass: `typecheck`, `lint`, `format:check` clean; `test` 1269 tests in 67 files (1167 in 65 before F2); `build` ok with the known chunk-size warning; `e2e` 210 passed (190 before); `e2e:preview` 11 passed. GitHub CI has not been observed.

### F3 — Visual refresh and next unrecorded dose ☑

Scope (suited to older users as well: large texts and buttons, contrast, statuses in words): module cards, larger headings and dose rows, larger badges, a darker card border, a clearer low-stock line on the dashboard and the highlight of the next unrecorded dose (DEC-50). No domain rule changes; no new colours beyond one accent and the existing warning colour.

Dependency: F0 approved (committed as `b321477`). F3 changes no data and does not need F1 or F2.

As delivered:
- Module cards: `ModuleCard` (`src/components/ui/ModuleCard.tsx`) is a labelled region with a darker border (`--color-line-card`) and a 24 px heading. The three panels of *Pulpit* (through `DashboardPanel`) and the three sections of *Dawki* use it; the rows inside are lighter (canvas background, ordinary border). `Card` uses the darker border too.
- Larger: page title (`text-3xl`, `sm:text-4xl`), page description, rows of doses (time `text-3xl`, medication and amount `text-lg`), body text of the panels (`text-base`), buttons (`text-base`, 48 px tall; the compact `sm` size is unchanged), badges (`text-sm`, larger padding and icon).
- Highlight: `selectNextUnrecordedDose` (`src/features/doses/logic/nextDose.ts`) returns the first dose without a record in the order of the day view; it has no clock input and does not depend on the order of its argument. On the dashboard that row gets a frame in the brand colour (the one accent), a tinted background and the label **"Następna dawka bez zapisu"** (with an arrow icon). The wording says only that no record exists; it never says late or missed, also when the dose is hours past. It moves to the next dose without a record when one is recorded and disappears when none is left. It is shown on the dashboard only (F-9), not on the day view.
- Low stock: above the list in *Zapasy leków*, a line in the warning colour with an icon says how many medications are low and the limit (`Niski zapas: 2 leki. Szacunek wystarczy na mniej niż 7 dni.`); each low row is framed in that colour and keeps its "Niski zapas" text. A count only, from the existing `isLowStock`; the 7-day rule itself is unchanged (a medication's own threshold is F5).
- Colours: one new token, `--color-line-card`; the accent is the existing brand colour and the warning colour is the existing one. `tokens.test.ts` checks the new pairs (card border on white and on canvas, brand-700 on brand-50, warning-800 on warning-50 and white, ink and muted ink on brand-50 and warning-50).
- Decision on the open point: the wording and look above.
- Measured: main bundle 564.14 → 564.92 kB.

Behaviour that changed on purpose: buttons are 48 px instead of 44 px tall and have 16 px text; badges, headings and dose rows are larger; the dashboard and the day view are laid out as cards. The existing tests that picked the medication name by its CSS class were changed to the new class; one end-to-end test that matched "Niski zapas" as a substring now matches the exact badge text.

Not covered: the look was checked in screenshots of the dashboard at 390 and 1280 px, not on a real phone, and no one older has tried it: whether the sizes are enough for the people this is meant for is a judgement for the owner. The axe scans and the browser tests cannot judge clarity.

Completion criteria:
- [x] New colour pairs are checked by `tokens.test.ts`; the axe scans (now at 360, 390 and 1280 px) and the touch-target tests (phone widths 360 and 390 px, where touch targets matter; the compact buttons at 1280 px are meant for a mouse) pass.
- [x] The selection of the highlighted dose is a tested pure function that does not read the clock (`nextDose.test.ts`, 9 tests; dashboard tests for the label, its movement and its absence).
- [x] No percentage or score appears; the wording stays neutral (tests: no `%`, no "late/missed" wording).
- [x] All standard checks pass: `typecheck`, `lint`, `format:check` clean; `test` 1294 tests in 68 files (1269 in 67 before F3); `build` ok with the known chunk-size warning; `e2e` 224 passed (210 before); `e2e:preview` 11 passed. GitHub CI has not been observed.

### F4 — Dosage form, units and strength ☑

Scope: `dosageForm`, the unit lists, the handling of stored units that are not on a list, `strength` (DEC-45). The first stage that persists new fields; it needs F1 (done: the storage is version 2).

As delivered (code in `src/features/medications/logic/dosageForms.ts`, `medicationForm.ts`, `saveMedication.ts`, `components/MedicationForm.tsx`, `MedicationCard.tsx`, `src/services/local/validation.ts`, `src/services/demo/demoData.ts`):
- New optional fields `Medication.dosageForm` and `Medication.strength` (`{ value, unit }`). They are **absent** on every medication saved before: nothing assigns a form, a strength or a unit to an old record, reading never writes, and saving an old medication without choosing them adds neither (tested at every level, including the browser). Clearing a field removes it.
- The form has *Postać leku* (optional; "Nie wybrano" first), *Jednostka dawki*, an optional *Moc leku* group (a number and a unit from a list) and *Jednostka zapasu*. The final lists are the ones in PROJECT_SPEC §7.6, unchanged from the proposal.
- With a form that has a list, the dose and stock units are selectors. **With no form, or with "other", the unit is typed** (a text field, as before): the lists "none offered" of the table mean exactly that, and it is how a medication without a form stays editable. The stock unit left empty means "the same as the dose unit".
- A stored unit that is not on the list for the chosen form is the **first, selected option**, written as stored and labelled *dotychczasowa, spoza listy*, with a text that it can stay and cannot be chosen again once another unit is saved. A stored unit that is only written differently (`Tabletka `) shows the listed unit as selected, and the stored text stays until a person picks. Saving without touching a unit stores its text **byte for byte** (the dose unit, and the stock unit together with its "as of" moment).
- Choosing another form never changes a stored unit. A unit that was picked in the open form and is not on the new list is cleared, never replaced by another.
- A stock unit that differs from the dose unit is allowed; the form says at once ("Zapas jest liczony w jednostce „ml”, a dawka w jednostce „kropla”. Nie przeliczamy jednostek…") in a `role="status"` line, and `estimateStock` returns `incompatible-units` (no number). Changing only the stock unit counts the stock again from now.
- The strength is information: it is in the form and on the medication card with a note that it changes no dose or stock; `estimateStock` does not take it (a test makes its field throw if read), and no calculation reads the form either.
- The card shows the form and the strength, and a neutral *Jednostka spoza listy* label for a unit outside the list of its form. Demo data: Demoxal (tablet, 500 mg) and Przykładyna (liquid, 50 mg/ml) have the new fields; Testovit and Dawnoxin stay as older data is.
- Storage: `validateMedication` accepts the new fields (a missing one stays missing, an invalid one is refused with its path), so nothing is dropped when a collection is rewritten; the repository contract tests cover them for every implementation.
- Messages: the "unit required" message now says to choose or type a unit; the old "stock unit" warning of the edit form was replaced by the one above.
- Measured: main bundle 564.92 → 573.20 kB.

Decisions taken here (the roadmap left them open): the final lists are the proposal; an unlisted unit appears in the same selector as its first option; where a form has no list the field is a text field.

Not covered: the details page and the *Jednostka spoza listy* label there (F5); no screen to convert units (never); whether the selectors are easy enough on a real phone (the browser tests check size, labels and overflow at 360 px, not a real device).

Completion criteria:
- [x] A medication saved before this stage opens, shows its unit unchanged and can be saved without changing it (`MedicationUnitsPages.test.tsx`, `e2e/units.spec.ts`; the stored text and `asOf` compared byte for byte).
- [x] A stored unit that is not on the list is the first, selected option, labelled as outside the list; saving without touching it stores the original text byte for byte; once another unit is saved the old one cannot be chosen again (tested in `dosageForms.test.ts`, the page tests and the browser).
- [x] No unit is converted or replaced automatically; the strength never changes any estimate (`saveMedication.test.ts`, `stock.test.ts`, the page tests).
- [x] The form says at once when the stock unit differs from the dose unit, and no number is computed for such a medication (tested through `estimateStock` and the form).
- [x] `strength` is not part of the input of the stock logic and changing it never changes an estimate (`stock.test.ts`: six strengths, four forms, a field that throws when read).
- [x] Contract, validation and demo data tests cover the new fields (`repositoryContract.ts`, `localRepositories.test.ts`, `demoData.test.ts`).
- [x] All standard checks pass: `typecheck`, `lint`, `format:check` clean; `test` 1429 tests in 70 files (1294 in 68 before F4); `build` ok with the known chunk-size warning; `e2e` 236 passed (224 before); `e2e:preview` 11 passed. GitHub CI has not been observed.

### F5 — Details page and own low-stock threshold ☑

Scope: the medication details page (`/medications/:id`), the threshold with its unit, the rule of DEC-46 and the warning on the details page and the dashboard. Needs F1 and F4 (both done).

As delivered (code in `src/features/medications/logic/stock.ts`, `components/MedicationDetails.tsx`, `src/pages/MedicationDetailsPage.tsx`, `medicationForm.ts`, `saveMedication.ts`, `components/MedicationForm.tsx`, `StockSummary.tsx`, `src/features/dashboard/components/StockPanel.tsx`, `src/services/local/validation.ts`):
- **Details page.** Reached from a *Szczegóły* button on every medication card (its accessible name says which medication: "Szczegóły leku Demoxal") and from the address. It has a way back (*Wróć do listy leków*) and to the edit form. Four labelled parts: *Informacje* (status, form, strength with the note that it is information, period, notes), *Dawkowanie* (the schedule with units, and since when it applies), *Jednostki* (dose unit and stock unit, each with the neutral *Jednostka spoza listy* label when it applies) and *Zapas* (when it was counted, the estimate or the reason for none, the threshold rule in words, the explanation, a link to edit). Whatever is missing is said so ("Nie wybrano", "Nie podano", "Nie śledzisz zapasu"); nothing is guessed. It only shows; every change goes through the edit form.
- **Storage.** `Medication.lowStockThreshold?: { quantity, unit } | null`. Absent on every medication saved before (and stays absent unless set; clearing it removes it). Quantity ≥ 0 (zero allowed), at most 3 decimals; the unit is stored with it (like the stock's own unit). A threshold needs a stock: storage refuses one without (`validateMedication`), and so does the form.
- **Rule (DEC-46), `isLowStock(estimate, threshold?)`.** If the threshold is set, the estimate is available and the threshold's unit matches the stock unit (`unitsMatch`), the stock is low when `remaining <= threshold.quantity`, compared in whole thousandths (at the threshold, a warning; one thousandth above, none). Otherwise the existing 7-day rule (`daysRemaining < 7`) applies unchanged. An unavailable estimate is never low. The threshold is never converted between units. `lowStockRule` says which rule decided; `thresholdUnitDiffers` is true for a threshold in another unit than the stock.
- **Form.** *Własny próg niskiego zapasu* (optional) under the stock unit, counted in the stock unit (the hint says so and says what happens without a threshold). A number typed now is stored in the stock unit it is saved with. A stored threshold keeps its own unit: when it differs from the stock unit the form says at once that it is not applied and that the 7-day rule is used, and offers one explicit button to count it in the stock unit (no number is changed). Removing the stock quantity while a threshold is set is refused, not silently dropped.
- **Where it warns.** The *Niski zapas* badge (medication card, day view, details, dashboard) and the dashboard line use the same function. A row low by its own threshold says "Zapas jest na poziomie Twojego progu (N unit) lub poniżej". The dashboard line keeps its old sentence when no threshold is involved; otherwise it says that medications with an own threshold warn at the threshold and the others below 7 days. The details page says in words, for a threshold in another unit, that it is not applied.
- Demo data: Przykładyna has a threshold of 20 ml (not reached with 120 ml).
- Measured: main bundle 573.20 → 582.25 kB.

Decision on the open point: the details page does **not** replace actions on the list card; the card keeps *Edytuj*, *Zakończ* and *Usuń trwale…* and gains *Szczegóły*. The details page has no end or delete action.

Not covered: the history of stock events and the refill action (F6; the page has no placeholder for them); the order of the dashboard stock list is still by days remaining, not by threshold; whether the page is comfortable on a real phone (the browser tests check size, labels and overflow at 360 px).

Completion criteria:
- [x] The warning follows `remaining <= threshold` when it applies and the 7-day rule otherwise; a threshold in another unit is not applied and the page says so (`stock.test.ts`, `MedicationDetailsPage.test.tsx`, `MedicationThresholdPages.test.tsx`, `e2e/details.spec.ts`).
- [x] Unavailable estimates are never "low" (`stock.test.ts` for every reason, with and without a threshold; the dashboard and details tests).
- [x] Page, logic and browser tests; accessibility scan of the new page (`accessibility.spec.ts` at 360, 390 and 1280 px; the touch-target test visits it at the two phone widths).
- [x] All standard checks pass: `typecheck`, `lint`, `format:check` clean; `test` 1532 tests in 72 files (1429 in 70 before F5); `build` ok with the known chunk-size warning; `e2e` 248 passed (236 before); `e2e:preview` 11 passed. GitHub CI has not been observed.

### F6 — Stock events and refill ☑

Scope: the `StockEvent` model and repository, the estimate with events, *Zacznij śledzić zapas* with `MedicationStock.basis` (DEC-52), the *Uzupełnij zapas* action reachable in one step from the medication card and from the dashboard stock panel, the refill dialog and the history of stock events, reversal, deletion with the medication, demo reset and backup including the events (DEC-47, PROJECT_SPEC §7.6, §10.5). Needs F1 and F5 (both done).

As delivered:
- **Data.** `StockEvent { id, medicationId, kind: 'refill' | 'waste', amount, unit, recordedAt, note, reversedAt }` (`src/features/stock/types.ts`) in a new collection `pigoowa:v1:stock-events` (envelope version 2, absent until the first event, so it needs no migration). `MedicationStock.basis?: 'counted' | 'new-package'` (absent means counted). Both are validated on read and write (`validateStockEvent` refuses a reversal before the event, a note over 500 characters, and an amount that is not above zero or has more than three decimals).
- **Repository** (`StockEventRepository`, local implementation in `localRepositories.ts`): `list`, `listForMedication`, `append` (one write to one collection; `duplicate-id`, `missing-reference`, `invalid-input`), `reverse` (sets `reversedAt`; reversing again returns the event untouched and writes nothing), `countForMedication`. Nothing deletes an event except deleting its medication. The shared contract tests cover all of it, so the future Supabase repository must pass them too.
- **Deleting a medication** now writes up to three keys and remembers each write that succeeded, so a failure of a later one restores every earlier one (`rolled back`, or `rollback failed` said plainly). The confirmation dialog states the number of events that will go with it, and the message afterwards does.
- **Demo data and reset.** The demo data has two events for Demoxal (one before the count, one reversed). `loadDemoData` and `resetDemoData` cover the events key; the reset backup contains its exact text (or `null`). The rollback of a failed reset no longer tries to rewrite a key whose write was the one refused.
- **The estimate** (`estimateStock`, new optional `stockEvents`): events of the medication, not reversed, recorded at or after `asOf` count; refills add, waste subtracts (stage F7 only adds the screens), in whole thousandths. An event in another unit makes the estimate unavailable (`incompatible-units`); nothing is converted. The days still use the planned daily amount. When the sum goes below zero the amount is held at zero and the estimate carries `wentBelowZero`; the details page says the stock may have run out earlier. All screens that show stock (card, details, dashboard, day view) read the events.
- **Uzupełnij zapas** (`RefillDialog`, `buildRefill`): one dialog with the amount, an optional note and the confirmation. The unit is the stock unit, shown as text (no unit field); the moment is the confirmation (no back-dating). Nothing is recorded before the confirmation, an invalid form is refused with a message at the field, the event id is created when the dialog is opened, a double click records one event, and a failed write keeps the dialog and what was typed and says why. Reachable from the medication card (*Uzupełnij zapas leku …*), from every row of the dashboard stock panel and from the details page. After it the estimate, the warning line and the own threshold of F5 are recomputed (tested at the threshold and one thousandth above it).
- **Zacznij śledzić zapas** (`StartTrackingDialog`, `buildStartTracking`): for a medication with no stock, reachable from its card and from the details page. Two explicit choices with no default, *Policzyłem, ile mam teraz* and *Zaczynam od nowego opakowania*; the quantity is in the dose unit. Neither choice, an empty field, an invalid number, or a package of size zero creates nothing and the estimate stays unavailable; a counted zero is stored as zero and shown as used up. `basis` is stored. Editing the quantity in the medication form is still a count (no basis, a new moment); saving without touching the stock keeps its basis and moment.
- **History** (`StockHistory`, on the details page): the events of the medication, newest first, with the note, and in words what each does now: *Wliczone w szacunek*, *Cofnięte* (with when), *Sprzed ostatniego liczenia, nie wlicza się*. A reversed event and an event older than the last count are kept, never hidden. **Reversal** asks for confirmation, keeps the event and stops counting it; a failed reversal keeps the dialog.
- **The three stock states** (`StockStatement`, `StockSummary`): counted (*Policzono {date}: …*), new package (*Liczone od nowego opakowania z {date}: … Wcześniejszej pozostałości nie uwzględniamy, więc zapas może być większy.*, and the label *od nowego opakowania* wherever the number appears, also on a low-stock warning, which says it ignores what was left before), unknown (*Nie śledzisz zapasu.* and *Szacunek niedostępny: zapas nie został policzony.*, no number, no zero, no warning, not listed on the dashboard). This replaces the old "zapas nie został skonfigurowany".
- Measured: main bundle 582.25 → 602.00 kB.

Decisions taken here (the roadmap left them open or implied them):
- **A refill is not offered for an ended medication** (the card, the dashboard and the details page do not offer it, the details page says why, and `buildRefill` refuses it). Nothing is lost: a medication whose end date is changed can be refilled again.
- Starting to track uses the dose unit as the stock unit and has no unit field; another unit is chosen in the medication form, as before.
- The history has no filters or paging; it lists every event of one medication.
- The *Uzupełnij zapas* action is not on the day view (not required).

Not covered: the screens for waste (F7); a refill dated in the past (not in the first version); editing an event (events are corrected by reversing and adding a new one); an older copy of the application that is already open cannot see or write the events key (it ignores it), and two tabs can still overwrite each other (§10.5); whether the dialogs are comfortable on a real phone (the browser tests check size, labels, overflow and the keyboard-free flow at 360 px).

Completion criteria:
- [x] Every refill row of the §7.6 action table is tested through the real code path: start tracking counted and new package, refill, click twice, count again, reverse (`StockActionsPages.test.tsx`, `stock.test.ts`, `refill.test.ts`, `startTracking.test.ts`, `e2e/stock.spec.ts`).
- [x] A double submit gives one event; a failed write keeps the form and shows an error (page tests and browser tests).
- [x] Repository contract tests: duplicate id, missing medication, cascade, reversal, repeated reversal (`repositoryContract.ts`, run for the local implementation).
- [x] Deleting a medication removes its events (with rollback tests over the three keys, `localRepositories.test.ts`); the demo reset and its backup include the events (`localDemoData.test.ts`, `e2e/stock.spec.ts`).
- [x] *Zacznij śledzić zapas* offers "counted" and "new package": an empty field is refused and never stored as zero; `basis` is stored and the screens say what is and is not counted; doing neither leaves the estimate unavailable.
- [x] A refill without a stock baseline is refused (`buildRefill`) and the page offers to start tracking (the details page and the card show *Zacznij śledzić zapas* instead of the refill).
- [x] The note of an event is stored on the event (contract, page and browser tests).
- [x] The three stock states have distinct statements on the card, the details page, the dashboard and the day view; *od nowego opakowania* stays wherever the number appears; the unknown state shows no number, no zero and no warning (tested on each screen).
- [x] All standard checks pass: `typecheck`, `lint`, `format:check` clean; `test` 1725 tests in 77 files (1532 in 72 before F6); `build` ok with the known chunk-size warning; `e2e` 266 passed (248 before); `e2e:preview` 11 passed. GitHub CI has not been observed.

### F7 — Wasted medicine ☑

Scope: the `waste` event, its dialog and reversal (DEC-47). It never marks a dose and is never a skipped dose. Needs F6 (done).

As delivered:
- **No second mechanism.** A waste event is the `StockEvent` of F6 with `kind: 'waste'`: the same collection, repository (`append`, `reverse`), contract tests, estimate formula, history and reversal. The only new code is `buildWaste` (it shares one function with `buildRefill`, `src/features/stock/logic/refill.ts`), the copy of the dialog, and the buttons. `RefillDialog` became `StockChangeDialog`, which serves both kinds through the same form and checks.
- **Recording it.** *Zapisz stratę* (accessible name *Zapisz stratę leku …*) on the medication card, next to *Uzupełnij zapas*, and on the details page. One dialog: *Ile się zmarnowało*, an optional note and the confirmation; the unit is the stock unit shown as text (no unit field, nothing converted); the moment is the confirmation. The text says in words that it is **not a dose**: no dose is recorded as taken or skipped and the schedule does not change. Nothing is recorded before the confirmation; an amount that is empty, zero, negative, not a number or with more than three decimals is refused at the field; a note over 500 characters is refused; a double click records one event (the id is created when the dialog opens); a failed write keeps the dialog and what was typed and says why.
- **Who can record it.** A medication with a stock (a baseline) that has not ended. An unknown stock (no baseline) and an ended medication are not offered it; the details page says why (start tracking first), as for a refill. `buildWaste` refuses both too.
- **Effect.** The estimate drops by the amount (events not reversed and recorded at or after the stock's `asOf`, the same rule as for taken doses, in whole thousandths); the days still follow the planned daily use. A waste in another unit than the stock makes the estimate unavailable, nothing is converted. The warning of F5 (own threshold, at or below it; otherwise 7 days) is recomputed on every screen: a waste that brings the stock exactly to the threshold warns, and reversing it lifts the warning. After counting the stock again, earlier waste events stay in the history as *Sprzed ostatniego liczenia, nie wlicza się*.
- **History and reversal.** The details page lists it among the other events, newest first: *Strata: odjęto N …*, its note, and its state in words (*Wliczone w szacunek*, *Cofnięte*, *Sprzed ostatniego liczenia…*). *Cofnij* asks for confirmation, keeps the event, and the estimate is restored; a repeated reversal changes nothing.
- **Not a dose** (tested at every level): no intake record is created or changed, the day's dose stays *Nie zapisano* and the counts of taken and skipped doses do not change, the schedule and `scheduleEffectiveFrom` are untouched, and the note is stored on the event only (the medication's notes and the intake records are not written).
- Demo data: one more event for Demoxal, a waste event before the count (so no estimate changes).
- Measured: main bundle 602.00 → 604.19 kB.

Decision on the open point (the wording of the warning when the amount exceeds the estimate): the waste is **allowed and recorded** (an estimate must not block a fact), and while the person types the dialog says, in a status line with an icon, *Ta ilość jest większa niż szacowany zapas (N …). Zapiszemy ją mimo to, bo to fakt, który się wydarzył, ale zapas będzie pokazany jako wyczerpany. Jeśli szacunek się rozjechał, policz zapas ponownie w edycji leku.* An amount equal to the estimate gives no warning. Afterwards the estimate shows *Zapas wyczerpany (0 …)* and the details page says the stock may have run out earlier. Also decided, consistently with F6: no waste for an ended medication.

Not covered: no waste action on the dashboard or the day view (the card and the details page have it); no editing of an event (reverse it and add a new one); no back-dating; whether the dialog is comfortable on a real phone (the browser tests check size, labels and overflow at 360 px).

Completion criteria:
- [x] The estimate drops by the amount; no dose status changes and no dose record is touched (`stock.test.ts`, `StockWastePages.test.tsx`, `e2e/stock.spec.ts`: the intake records stay as they were, the doses stay unrecorded).
- [x] The note is stored on the `waste` event and nowhere else (contract, page and browser tests; the medication's notes and the intake records are untouched).
- [x] Reversal restores the estimate and keeps the history (unit, contract, page and browser tests).
- [x] Page and browser tests; accessibility scan (`accessibility.spec.ts`: the waste dialog with the warning and with an error, and the page after a waste, at 360, 390 and 1280 px).
- [x] All standard checks pass: `typecheck`, `lint`, `format:check` clean; `test` 1775 tests in 78 files (1725 in 77 before F7); `build` ok with the known chunk-size warning; `e2e` 274 passed (266 before); `e2e:preview` 11 passed. GitHub CI has not been observed.

### F8 — Actually taken amount and note ☑

Scope: `takenAmount` and `note` on taken doses, the action that edits them, the changed messages in the dose row and the history, the use in the estimate (DEC-48). Needs F1 (done).

Requirement from the owner, to be kept in this stage: a person may take a **larger** amount than the standard schedule on a doctor's specific recommendation, so the planned amount and the amount actually taken are separate values; the actual amount may be larger than the plan; an optional note can say why (for example that the dose was increased on the doctor's advice); saving is **never blocked** only because the amount differs from the plan (the only limits are those of any quantity: greater than zero, at most three decimals, at most `MAX_QUANTITY`); changing it never changes the standard schedule; the history and the stock estimate use the amount actually taken. The application never suggests increasing a dose and makes no medical decision: it only records faithfully what the user did. F1 does not touch this: it changes no dose record, and the `takenAmount` and `note` fields are optional additions that the storage format of F1 can carry.

As delivered:
- **Data** (`DoseLog`, `src/features/doses/types.ts`): `doseAmount` and `doseUnit` stay the snapshot of the **plan** and are never overwritten; new optional `takenAmount` (the amount actually taken, in `doseUnit`) and `note` (at most 500 characters after trimming). Both exist only on a `taken` record; absent `takenAmount` means "as planned" (an amount equal to the plan is stored as absent, by whole thousandths). Older records have neither field and are **not rewritten or migrated**: validation keeps an absent field absent (`validateDoseLog`), and the repository contract tests keep it that way. A skipped record never has an amount taken or a note (a `null` note is accepted as "none").
- **Logic** (`src/features/doses/logic/recording.ts`, `takenDetails.ts`): `recordDose` takes optional `details` (amount and note) for a dose with no record yet; `adjustTakenAmount` edits them on a taken record and is refused with `record-changed` if the stored record is not exactly the one the person saw (every stored field is compared), with `record-not-found`, `details-need-taken` (a skipped record) or `conflicting-records` otherwise; the same amount and note is `unchanged` and writes nothing; `recordedAt`, the plan, the id and the slot never change. `changeDoseStatus` to *skipped* removes both fields; back to *taken* starts from the plan again. `parseTakenDetails` knows nothing about the plan: any amount above zero with at most three decimals is accepted, larger or smaller (an empty amount is refused; it is neither zero nor "as planned"). `applyTakenDetails` (`applyDoseAction.ts`) runs these against the stored data, as `applyDoseAction` does, and writes one record through the same repository.
- **Screens.** The usual one tap is unchanged: *Oznacz jako przyjętą* still records the plan with no dialog and no new field. Next to the two usual buttons an unrecorded dose has a third, *Przyjęto inną ilość…*, and a taken dose has *Zmień ilość lub notatkę*; both open the same dialog (`TakenAmountDialog`) on the dashboard and on the day view. It shows the plan ("Zaplanowano: … Plan zostaje taki, jaki był."), asks *Ile przyjęto* (in the dose unit, starting from the plan or from what is stored) and for an optional note, and says that the application records what happened beside the plan, does not rate it, does not suggest a dose and does not change the schedule. A difference from the plan gets no warning, question or error. Invalid input is refused at the field; nothing is written before the confirmation; a double click saves once; a failed write keeps the dialog and what was typed and says why; a record changed in the meantime closes the dialog, says so and refreshes the screen, and nothing is overwritten.
- **Messages.** A dose taken differently shows both amounts and the note: *Przyjęto: 3 tabletki. Planowano wtedy: 1 tabletka.* (and *Obecnie w harmonogramie: …* when the schedule changed since). The older line *Zapisana dawka: … (obecnie w harmonogramie: …)* keeps its single meaning (the schedule changed) and is shown only for a record without an amount taken. The history shows *Przyjęto*, *Planowano* and the note; the feedback after saving states both amounts.
- **Estimate** (`estimateStock`): each counted taken record uses `takenAmount ?? doseAmount` (checked for validity and unit); the days still use the planned daily amount. Editing the amount applies the difference without moving `recordedAt` (so the record is not counted again); skipping removes it from the count; clearing removes the record.
- Demo data: one Demoxal dose (two days ago) was taken as 2 tablets instead of 1, with a fictional note; it is older than the stock count, so no estimate changes.
- Measured: main bundle 604.19 → 612.75 kB.

Decisions taken here (the roadmap left them open or implied them):
- The amount is set either with the dose (*Przyjęto inną ilość…*) or afterwards (*Zmień ilość lub notatkę*); both use one dialog and one rule. The usual confirmation was not changed.
- An empty amount is refused rather than read as "as planned"; to go back to the plan the person types the planned amount (it is then stored as "as planned").
- The amount taken is in the unit of the record; there is no unit field and nothing is converted.
- A note about wasted medicine belongs to the waste event of F7 (`StockEvent.note`) and has no place on a dose record (a skipped record cannot even hold a note).

Not covered: a dose amount cannot be set from the history page (only the day view and the dashboard); no filter of "doses taken differently"; no statistics or comparison with the plan (by design: the application makes no judgement); the schedule and the doctor's recommendation are never edited from here; whether the dialog is comfortable on a real phone (the browser tests check size, labels and overflow at 360 px). Two clicks arriving after the first save has closed the dialog land on whatever is under the button (a property of every dialog of the application, not of this one).

Completion criteria:
- [x] The plan (`doseAmount`) is never overwritten; both amounts are shown (`recording.test.ts`, `TakenAmountPages.test.tsx`, `e2e/takenAmount.spec.ts`).
- [x] The note is stored on the dose record, only for a taken dose, and a note about wasted medicine is never stored there (validation and contract tests refuse a note on a skipped record; the waste note lives on the `waste` event, F7).
- [x] Skipped removes the taken amount; editing never moves `recordedAt`; the same value is unchanged; a changed-meanwhile record is refused (`recording.test.ts`, `applyDoseAction.test.ts`, page and browser tests).
- [x] The schedule and the recommendation are not touched (the medication is compared before and after; tomorrow's plan is unchanged; no suggestion text, tested).
- [x] The estimate uses the amount actually taken: every taken row of the §7.6 action table (`stock.test.ts`, page tests on the dashboard and the day view).
- [x] All standard checks pass: `typecheck`, `lint`, `format:check` clean; `test` 1921 tests in 80 files (1775 in 78 before F8); `build` ok with the known chunk-size warning; `e2e` 289 passed (274 before); `e2e:preview` 11 passed. GitHub CI has not been observed.

## Stage 10 — Supabase schema and Row Level Security

Scope: local Supabase stack, migrations for all tables in DATABASE.md **including the tables, columns and constraints marked planned for the medication features track (F0–F8; DATABASE.md §3.2, §3.4, §3.6, §9)**, RLS policies, constraints, seed data, pgTAP tests, two-account integration tests. No UI changes.

**Status: ☑ closed on the evidence below** (the criteria were checked on a real local Supabase stack, not hosted). Nothing in the application uses the database yet (the demo still runs on `localStorage`); no hosted Supabase project exists or was touched.

Done (as of the end of Stage 10; Stage 11 later added a fourth migration that drops the `updated_at` trigger, raised the local sign-up rate limit in `config.toml`, and changed two pgTAP assertions, which still total 144): three migrations (`supabase/migrations/`), an intentionally empty `supabase/seed.sql`, a `supabase/config.toml` generated by `supabase init` (only `project_id` and the disabled unused services changed), four pgTAP files (144 assertions; each negative test names its constraint), `supabase/tests/client/isolation.test.ts` (two independent Supabase JS sessions, 16 tests, `npm run test:db-client`), the fallback `scripts/db/run-tests.sh` with `scripts/db/supabase-emulation.sql`, `src/databaseSchema.test.ts`, DATABASE.md updated (§6 test map, §7 how to start and stop the stack, §8 decisions, §10 verification table).

Completion criteria:
- [x] Database can be recreated from migrations alone. *`supabase start` and `supabase db reset` build it; a schema dump before and after a reset is identical.*
- [x] All tests listed in DATABASE.md §6 pass, including cross-user access attempts with two accounts. *`supabase test db`: 144 assertions pass; the two-session JS-client test: 16 pass.*
- [x] RLS enabled on every table (verified by a query that fails if any `public` table has it disabled). *`01_rls_and_privileges.sql` (the query was shown to fail when RLS is switched off) and a static check in `npm test`.*
- [x] DATABASE.md updated to match the implemented schema.
- [x] No privileged key in the repository or frontend bundle (checked). *`npm test` scans the sources and the database tooling; the built `dist/` was searched for `service_role`, `sb_secret_`, JWT-shaped strings and `supabase`: no match. The Git history is not scanned (Stage 12).*

Not covered, by design: a hosted project (none exists), the Stage 11 client and repositories, importing the browser data into an account.

## Stage 11 — Authentication and Supabase persistence

Scope: Supabase client (public URL + anon key only), **TanStack Query** replacing the custom data hooks' internals (DEC-12), `.env.example` with the public variables, sign up / sign in / sign out, protected routes, profile creation, Supabase repository implementations passing the same contract tests as the mocks, switchable by configuration; account-specific data; demo mode remains available.

**Status: implemented and verified automatically on the real LOCAL Supabase stack; not closed.** The criterion "two real users see only their own data in the UI" asks for a manual check as well, which nobody has done; and nothing was tried against a hosted Supabase project (none exists). The decisions are DEC-54 to DEC-60 in PROJECT_SPEC; the database side is DATABASE.md §3.1, §7 to §10.

What was built:
- **Two builds from one code base**, chosen by two public variables (`.env.example`): neither set = the public demonstration exactly as before (no sign-in, nothing downloaded from the account code); both set = accounts, with the demonstration one click away on the sign-in page. One set, a bad URL or a secret key = an error screen, and `vite` refuses to build or serve (DEC-54).
- **Supabase client** with the public key only (`src/services/supabase/client.ts`); **TanStack Query** behind the unchanged `useAsyncData` shape, one query client per account (DEC-55).
- **Sign up, sign in, sign out, protected routes** (`src/features/auth`, `src/app/SessionServices.tsx`, `src/pages/LoginPage.tsx`, `RegisterPage.tsx`), an account bar on every page, expired-session and network-failure handling, and the profile created by the client after the first sign-in (DEC-57, no new migration for it).
- **Supabase repositories** for medications, intake records, appointments and stock events (`src/services/supabase`), generated database types (`npm run db:types`), and one small migration (`20261023090000_updated_at_from_client.sql`, DEC-56).
- **Tests:** the shared repository contract against the real stack, two-session isolation through tables and through the repositories, the real Auth server's error answers, component tests of the whole account build, Playwright end-to-end tests of the build with accounts (journey, two browsers, error states, demonstration, axe scans), a bundle check.

Completion criteria:
- [x] Repository contract tests pass against both implementations. *The local implementation runs the 115 contract tests in `npm test`; the Supabase implementation runs the same 115, unedited except for one flag (`distinguishesNullFromAbsent`, DEC-56), against the real local stack with `npm run test:db-client`. Not part of `npm test`, which needs no services.*
- [ ] Two real users see only their own data in the UI (manual + automated check). *Automated: done, on the real stack, three ways: two browsers in Playwright (`e2e-accounts/isolation.spec.ts`), two sessions through the repositories, and two through raw tables, plus the pgTAP tests of Stage 10. **Manual: not done.** The box stays open until a person has used two accounts by hand.*
- [x] Auth error states handled (wrong password, expired session, network failure). *Unit tests with supabase-js's own error classes; the real Auth server's answers in `supabase/tests/client/auth.test.ts`; in the browser: wrong password, network failure on sign-in, on reading and on saving, a session revoked on the server (real, with the browser clock moved on), a refusal from PostgREST. Only the aborted network request is simulated. Not tried: a hosted project's e-mail confirmation, rate limits, password reset (not in scope).*
- [x] E2E journey passes with authentication. *`e2e-accounts/journey.spec.ts` on the real local stack.*
- [x] All standard checks pass. *`typecheck`, `lint`, `format:check` clean; `test` 2050 tests in 90 files; `build` ok with the known chunk-size warning; `e2e` 289 passed (one earlier run had 1 timeout of 30 s in an axe scan, which passed 9 of 9 times alone and in a full rerun); `e2e:preview` 13 passed. Against the local stack: `supabase test db` 144 assertions, `test:db-client` 161 tests, `e2e:accounts` 21 tests. GitHub CI has not been observed (and the CI workflow does not run the tests that need the local stack).*

Not part of this stage, by decision: importing the browser's data into an account (nothing reads, copies or deletes `localStorage` data when an account is open), password reset and e-mail change, account deletion and data export (Stage 12), a privacy policy and consent (Stage 12; the account bar and the sign-in pages say that real medical data does not belong in this version yet), offline use with a queue of unsent changes, real-time updates between devices.

To close the stage the owner needs: to use two accounts by hand against the local stack (`supabase start`, a `.env.local` made from `.env.example`, `npm run dev`); and, before any hosted use, to create a project, apply the migrations, set the two public variables and repeat the checks there.

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
