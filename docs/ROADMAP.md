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
| 7 | Doctor appointments | ☐ |
| 8 | Dashboard | ☐ |
| 9 | End-to-end tests, accessibility, demo deployment (MVP complete) | ☐ |
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

Completion criteria:
- [ ] Add, edit, delete, status change work and persist across reload.
- [ ] Upcoming vs past classification tested with the fake clock, including the boundary instant and midnight.
- [ ] Validation: date/time required; doctor or specialty required.
- [ ] Empty/loading/error states tested.
- [ ] All standard checks pass.

## Stage 8 — Dashboard

Scope: today's counts and dose list (reusing stage 6 components), next appointments, stock summary, navigation, independent loading/error handling per panel.

Completion criteria:
- [ ] No percentages or adherence scores are shown; counts only.
- [ ] A failing panel shows its own error while others render (tested).
- [ ] Empty states for new users with calls to action (tested).
- [ ] Stock panel lists only computable estimates; says so when none are available.
- [ ] All standard checks pass.

## Stage 9 — End-to-end tests, accessibility, demo deployment (MVP complete)

Scope: Playwright main journey (open → dashboard → add medication → schedule → mark taken → history → add appointment → edit/cancel) with a fixed clock; keyboard-flow test; automated accessibility scan (e.g. `@axe-core/playwright`, if approved as a dev dependency) on main pages; visual polish pass; README screenshots; Vercel deployment of the **mock-data demo** with a visible "demo – fictional data" banner; `vercel.json` SPA rewrite.

Completion criteria:
- [ ] The E2E journey passes reliably (run several times; no flakiness).
- [ ] No serious/critical accessibility violations on main pages.
- [ ] Deployed demo works on mobile and desktop; contains only fictional data.
- [ ] README has screenshots, live link, accurate setup instructions.
- [ ] All standard checks pass. **MVP is complete.**

## Stage 10 — Supabase schema and Row Level Security

Scope: local Supabase stack, migrations for all tables in DATABASE.md, RLS policies, constraints, seed data, pgTAP tests, two-account integration tests. No UI changes.

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
