# Pigoowa — Project Specification

> **Status:** planning. Nothing described here is implemented yet. See [ROADMAP.md](ROADMAP.md) for progress.

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
| M-4 | Delete a medication after an explicit confirmation that states that its intake history will also be deleted. Ending a medication (setting an end date) is offered as the non-destructive alternative. |
| M-5 | Daily schedule: one or more administration times per day (`HH:mm`), each with its own dose amount (> 0). Two entries with the same time are rejected. |
| M-6 | Optional stock: current quantity (≥ 0), expressed **in the medication's dose unit**, recorded "as of" a moment. Updating stock resets that moment. |
| M-7 | Show an estimated remaining stock and days remaining **only if computable** (§7.3); otherwise show *"Szacunek niedostępny"* with the reason. |

### 4.2 Doses and intake history

| ID | Requirement |
|---|---|
| D-1 | For any selected day, show the scheduled doses generated from the schedule rules (§7.1). Default day: today. |
| D-2 | Mark a dose as **taken** or **skipped**. Both are recorded; the two are visually and semantically distinct. |
| D-3 | A dose with no record is **unrecorded** (*"Nie zapisano"*). The app never infers "taken". |
| D-4 | A recorded dose can be changed (taken ↔ skipped) or cleared (back to unrecorded) to correct mistakes. |
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
| DEC-06 | **One dose unit per medication, dose amount per schedule time.** Stock is entered in the same unit. | Prevents unit-conversion guesses (§7.3). Example: morning 1 tabletka, evening 2 tabletki. |
| DEC-07 | **Dose records snapshot amount and unit** at recording time. | Later edits of a medication must not rewrite history; stock maths uses the snapshot. |
| DEC-08 | **No i18n library.** Polish strings live in components; shared validation messages live in Zod schemas. | YAGNI for a single-language MVP. Reversible by extracting strings later. |
| DEC-09 | **Medication deletion is a hard delete** (cascades to schedule and history) after strong confirmation. Archiving = setting an end date. | Right to delete personal data is simplest to honour. Archive/restore can be added if users want it. |
| DEC-10 | **Default time zone** comes from the browser; later stored in the user's profile (default `Europe/Warsaw`). | Poland-first, but not hard-coded. |
| DEC-11 | **Mock data is persisted in `localStorage`** behind the same repository interface the Supabase implementation will use, with a "reset demo data" action. | Lets reviewers and E2E tests exercise real flows with reloads. localStorage is acceptable only because the data is fictional; it is not a persistence layer for real health data. |
| DEC-12 | **Server-state library (TanStack Query) is a *proposed* addition**, to be confirmed in stage 4. | Needed for loading/error/mutation/invalidated-cache handling once data is async; hand-rolling this is error-prone. Alternative: small custom hooks. This is the only dependency outside your list, so it needs your approval. |
| DEC-13 | **Native `<dialog>` for modals/confirmations; no UI kit.** | Built-in focus trapping and Escape handling; fewer dependencies. Reversible with Radix/Headless UI. |
| DEC-14 | **ID generation with `crypto.randomUUID()`** in the client for mock data; `gen_random_uuid()` in Postgres. | UUIDs avoid guessable IDs; same format both sides. |

## 7. Business rules

### 7.1 Generating scheduled doses for a date

Input: `medications`, `doseLogs`, `date: LocalDate`. Pure function, no clock access.

1. A medication is **active on `date`** when `startDate ≤ date`, (`endDate` is null or `date ≤ endDate`) and `date ≥ scheduleEffectiveFrom`.
2. For each active medication, each schedule time produces one slot `(medicationId, date, time, doseAmount, doseUnit)`.
3. A slot's **status** comes from the matching record (same medication, date and time): `taken`, `skipped`, or `unrecorded` if none.
4. Records for that date that match no slot are returned separately as *outside current schedule* (D-9).
5. Slots are sorted by time, then medication name.

### 7.2 Recording a dose

- Allowed only when `date ≤ today` (today computed from the injected clock and the user's time zone).
- Idempotent *upsert* keyed by the slot identity (DEC-02). Taken → skipped overwrites the status.
- "Clear" deletes the record.
- The UI disables the buttons of a slot while its request is in flight.

### 7.3 Stock estimation

Explicit assumptions (shown to the user in a help text):

1. Stock is a number the user entered, in the **dose unit** of the medication, valid *as of* a moment (`stockAsOf`).
2. `remaining = stockQuantity − Σ doseAmountSnapshot` over **taken** records whose `recordedAt ≥ stockAsOf`. Skipped and unrecorded doses consume nothing. (Consequence: forgetting to record a dose makes the estimate optimistic – hence "estimate".)
3. `plannedDaily = Σ doseAmount` over the current schedule times (daily schedule only in the MVP).
4. `daysRemaining = floor(remaining / plannedDaily)`.
5. Result is **unavailable** (with a reason: `no-stock`, `no-schedule`, `ended`) when stock is missing, the schedule is empty or sums to 0, or the medication has ended. `remaining` is clamped at 0.
6. No conversion between units is ever attempted.

The 7-day highlight threshold is a named constant, not medical guidance.

### 7.4 Appointment status

- Stored status: `scheduled | completed | cancelled`. "Past" and "needs confirmation" are **derived** from `scheduledAt` and the injected `now` (A-6, A-7); the stored status changes only on user action.

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
| *(proposed)* TanStack Query | Async state (DEC-12). |

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
- **Clock injection**: nothing in `logic/` or components calls `new Date()` directly; "now" comes from a `Clock` provided by context/arguments, so tests are deterministic.
- **Thin pages**: `pages/` only composes feature components for a route.
- No global state library: React state + context for clock/repositories; server state per DEC-12.

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
│  │  ├─ medications/          components/, hooks/, logic/ (schedule validation, stock),
│  │  │                        schemas.ts, types.ts
│  │  ├─ doses/                components/, hooks/, logic/ (slot generation, recording rules),
│  │  │                        types.ts   — daily doses and intake history
│  │  ├─ appointments/         components/, hooks/, logic/ (status, grouping), schemas.ts, types.ts
│  │  └─ dashboard/            components/ (composes the features above)
│  ├─ hooks/                   Cross-feature hooks (e.g. useClock)
│  ├─ lib/                     Configuration, Supabase client (later)
│  ├─ pages/                   Route-level components
│  ├─ services/                Repository interfaces + mock/ and supabase/ implementations
│  ├─ test/                    Test setup, fixtures, fake clock
│  ├─ types/                   Shared primitive types (Id, LocalDate, LocalTime, Timestamp)
│  ├─ utils/                   date.ts (zone-aware), format.ts (pl-PL)
│  └─ main.tsx
└─ README.md
```

Deviation from the suggested layout: `doses` is its own feature because both Medications and Dashboard use it and it holds the most delicate logic; keeping it separate avoids circular dependencies between `medications` and `dashboard`.

Dependency direction: `pages → features → (components, hooks, services, utils, types)`. Features may import `types` from other features but not their components, except `dashboard`, which composes them.

### 10.3 Draft domain types

Primitive aliases are *branded* strings so a `LocalDate` cannot be confused with an arbitrary string.

```ts
// src/types/primitives.ts
type Id = string;                 // UUID
type LocalDate = string & { __brand: 'LocalDate' };   // 'YYYY-MM-DD'
type LocalTime = string & { __brand: 'LocalTime' };   // 'HH:mm'
type Timestamp = string;          // ISO 8601 instant, UTC

// features/medications/types.ts
interface Medication {
  id: Id;
  name: string;
  doseUnit: string;                      // free text: 'tabletka', 'ml', ...
  notes: string | null;
  startDate: LocalDate;
  endDate: LocalDate | null;
  scheduleEffectiveFrom: LocalDate;      // DEC-03
  scheduleTimes: ScheduleTime[];         // daily schedule (rule)
  stock: MedicationStock | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
interface ScheduleTime { id: Id; timeOfDay: LocalTime; doseAmount: number }   // doseAmount > 0
interface MedicationStock { quantity: number; asOf: Timestamp }              // quantity >= 0, in doseUnit

// features/doses/types.ts
type RecordedDoseStatus = 'taken' | 'skipped';
type DoseStatus = RecordedDoseStatus | 'unrecorded';

interface DoseLog {                      // a FACT: what the user recorded
  id: Id;
  medicationId: Id;
  scheduledDate: LocalDate;
  scheduledTime: LocalTime;
  status: RecordedDoseStatus;
  doseAmount: number;                    // snapshot (DEC-07)
  doseUnit: string;                      // snapshot (DEC-07)
  recordedAt: Timestamp;
}

interface ScheduledDose {                // DERIVED, never stored (DEC-01)
  medicationId: Id;
  medicationName: string;
  date: LocalDate;
  time: LocalTime;
  doseAmount: number;
  doseUnit: string;
  status: DoseStatus;
  log: DoseLog | null;
}

// features/appointments/types.ts
type AppointmentStatus = 'scheduled' | 'completed' | 'cancelled';
interface Appointment {
  id: Id;
  doctorName: string | null;
  specialty: string | null;              // at least one of the two is non-null
  scheduledAt: Timestamp;                // the instant it takes place
  location: string | null;
  notes: string | null;
  status: AppointmentStatus;             // current state, separate from the date
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// Stock result: a discriminated union, so "unavailable" cannot be mistaken for a number.
type StockEstimate =
  | { available: true; remaining: number; unit: string; daysRemaining: number }
  | { available: false; reason: 'no-stock' | 'no-schedule' | 'ended' };
```

### 10.4 Repository interfaces (shape only)

```ts
interface MedicationRepository { list(); get(id); create(input); update(id, input); remove(id) }
interface DoseLogRepository   { listByDateRange(from, to); upsert(input); remove(key) }
interface AppointmentRepository { list(); create(input); update(id, input); setStatus(id, status); remove(id) }
```

All methods are `async` (so mock and Supabase share a contract) and fail with a typed `RepositoryError`.

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

- **Unit (Vitest):** slot generation, stock estimation, appointment grouping/status, date utils (DST, midnight), Zod schemas.
- **Component (RTL):** forms (validation messages, no double submit), dose list actions, confirmation dialogs, empty/loading/error states.
- **Contract tests:** repository behaviour shared by mock and Supabase implementations.
- **E2E (Playwright):** the main journey — open dashboard → add medication → configure schedule → mark dose taken → verify history → add appointment → edit/cancel it. Uses the fixed clock (`page.clock`) and resets demo data before each test.
- **Database security (stage 10):** two test users; each must be unable to read, insert, update or delete the other's rows in every table.
- Checks run after every stage: `typecheck`, `lint`, `test`, and (when relevant) `build` and `e2e`.
