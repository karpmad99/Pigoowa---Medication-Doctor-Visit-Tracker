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
| 5 | Medications: CRUD and schedule | ☐ |
| 6 | Daily doses, history and stock | ☐ |
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

Completion criteria:
- [ ] Add, edit, delete work against the mock repository; state survives reload.
- [ ] Form validation tested (required fields, positive dose, duplicate times, end ≥ start, stock ≥ 0); errors announced accessibly.
- [ ] Double submit creates one medication (tested).
- [ ] Ending a medication keeps its history (tested); the delete dialog names the consequences, shows the number of history records to be lost, and offers "end instead" (tested).
- [ ] Changing schedule times sets `scheduleEffectiveFrom` (tested).
- [ ] Loading, empty and error states tested.
- [ ] All standard checks pass.

## Stage 6 — Daily doses, history and stock

Scope: day view with date selector; dose rows with taken / skipped / clear actions; "outside current schedule" records; history page with filters; stock estimate display with explanation and unavailable state.

Completion criteria:
- [ ] Marking taken/skipped/clear works and never alters schedules or other days (tested).
- [ ] Undo updates or removes the existing record and never creates a duplicate; repeated undo is a no-op (tested at logic, repository and UI level).
- [ ] Future days cannot be recorded (tested).
- [ ] Repeated clicks produce a single record (tested); buttons disabled while pending.
- [ ] History shows snapshot amount/unit, even after the medication is edited (tested).
- [ ] Stock shows a value only when computable; otherwise shows the reason (tested).
- [ ] Skipped and taken are distinguishable without relying on colour.
- [ ] All standard checks pass.

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

Email/push reminders (with non-guarantee wording) · low-stock notifications · recurring appointment reminders · weekly/interval schedules · improved mobile experience (PWA) · deeper accessibility review · monitoring · additional tests.
