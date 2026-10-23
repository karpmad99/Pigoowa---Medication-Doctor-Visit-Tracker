# Pigoowa — Database Design

> **Status (Stages 10 and 11): the schema is implemented as SQL migrations in `supabase/migrations/` and the application uses it, in the build with accounts (PROJECT_SPEC DEC-54).** On a real local Supabase stack (CLI 2.121.0, Docker; PostgreSQL 17) `supabase start` and `supabase db reset` build it from the migrations alone, `supabase test db` passes all 144 pgTAP assertions, the Supabase repositories pass the same 115 contract tests as the browser storage, two independent Supabase JS sessions (and two browsers) see only their own data, and the end-to-end tests of the build with accounts pass. The same pgTAP files also pass on a plain PostgreSQL 16 with a minimal emulation (`scripts/db/run-tests.sh`), which is only a fallback and is not Supabase. **No hosted Supabase project exists or was touched.** What was and was not verified is in §10. The demonstration build still keeps everything in the browser's `localStorage`; nothing is copied between the two.
>
> The *(planned)* markers below name the medication feature track (F0–F8). In the application that track is built; in the database every column and table marked planned exists in the migrations from the start (one schema, no follow-up migration, DEC-51).

PostgreSQL via Supabase. Schema changes are made exclusively through versioned SQL migrations in `supabase/migrations/` (Supabase CLI), so the schema is reproducible from an empty database.

## 1. Design principles

1. **Rules ≠ facts.** The schedule (rule) is stored in `medication_schedule_times`. What the user actually did is stored in `dose_logs`. Scheduled doses themselves are *not* stored; they are computed (PROJECT_SPEC DEC-01).
2. **Appointment time ≠ appointment status.** `scheduled_at` is when it happens; `status` is its lifecycle state. "Past" is derived.
3. **Ownership enforced by the database.** Every private table has `user_id` and RLS; child tables also reference their parent *together with* `user_id` (composite foreign key), so a row can never point at another user's parent.
4. **Wall-clock values for schedules, instants for events.** `date` / `time` columns for schedule slots, `timestamptz` for moments.
5. **Constraints over trust.** Validity rules (positive doses, unique slots, status values) are CHECK/UNIQUE constraints, not only form validation.
6. **No redundant data**, except deliberate snapshots (`dose_logs.dose_amount/dose_unit`) that preserve history.
7. *(planned)* **Three different quantities are never mixed:** the *strength* of a product (`strength_*`, information only), the *amount taken or planned* (`dose_amount`, `taken_amount`, in `dose_unit`) and the *amount in stock* (`stock_quantity`, `stock_events.amount`, in `stock_unit`). No conversion between units exists anywhere (PROJECT_SPEC DEC-06).

## 2. Entity overview

```
auth.users (managed by Supabase)
   │ 1
   │
   │ 1
profiles ──────────────────────────────┐
   │ 1                                  │
   ├───────< medications                │ 1
   │            │ 1                     │
   │            ├──────< medication_schedule_times   (the rule)
   │            ├──────< dose_logs                   (the facts)
   │            └──────< stock_events                (planned: refills and waste, the stock ledger)
   │
   └───────< appointments
```

All `user_id` columns reference `profiles(id)`, which references `auth.users(id)`.

## 3. Tables

### 3.1 `profiles`

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | `references auth.users(id) on delete cascade` |
| `display_name` | `text` null | length ≤ 80 |
| `time_zone` | `text` not null default `'Europe/Warsaw'` | IANA name (e.g. `Europe/Warsaw`); validated in the app and, since Stage 10, by a trigger |
| `created_at` | `timestamptz` not null default `now()` | |

Created **by the client**, once, after the first sign-in (`src/features/auth/profile.ts`, Stage 11): the signed-in user inserts her own row with `id = auth.uid()`, which the policy `profiles_insert` allows and nothing else. The browser's time zone is the default (PROJECT_SPEC DEC-10); a zone the database does not know falls back to the column default; an existing row always wins, so opening the application from another zone does not rewrite it; two tabs creating the row at once end with one row (the second insert's unique violation is read as "already there"). There is no trigger on `auth.users` and no migration for it (§8).

### 3.2 `medications`

| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` PK | default `gen_random_uuid()` |
| `user_id` | `uuid` not null | FK → `profiles(id)` on delete cascade |
| `name` | `text` not null | `char_length(btrim(name)) between 1 and 120` |
| `dose_unit` | `text` not null | `char_length(btrim(dose_unit)) between 1 and 30` |
| `notes` | `text` null | length ≤ 1000 |
| `start_date` | `date` not null | |
| `end_date` | `date` null | `end_date >= start_date` |
| `schedule_effective_from` | `date` not null | `>= start_date` (see PROJECT_SPEC DEC-03) |
| `stock_quantity` | `numeric(10,3)` null | `>= 0` |
| `stock_unit` | `text` null | `char_length(btrim(stock_unit)) between 1 and 30`. Stored explicitly (not implied by `dose_unit`) so a later change of `dose_unit` cannot silently reinterpret an old quantity (PROJECT_SPEC DEC-15) |
| `stock_as_of` | `timestamptz` null | **the three stock columns are all null or all non-null** |
| `stock_basis` | `text` null | *(planned)* `check (stock_basis in ('counted','new-package'))` and `check (stock_basis is null or stock_quantity is not null)`. How the stock baseline was started: `counted` (the user counted what they have; also the meaning of null) or `new-package` (the estimate starts from a new package and does not count what was left before; PROJECT_SPEC DEC-52). Never used in the estimate formula; it only changes what the screens say. A medication with **no stock columns has an unknown stock, which is not zero** (a counted zero is `stock_quantity = 0`); the three states are presented differently (PROJECT_SPEC §7.6). |
| `dosage_form` | `text` null | *(planned)* `check (dosage_form in ('tablet','capsule','liquid','drops','injection','sachet','patch','suppository','inhaler','other'))`. Null means "not chosen" (a medication saved before the field existed). It decides which units the form offers; it is never used in a calculation. |
| `strength_value` | `numeric(10,3)` null | *(planned)* `> 0`. The strength of the product as printed on it (500 in "500 mg"). Information only: never a dose, never a stock unit, never part of the stock estimate. |
| `strength_unit` | `text` null | *(planned)* `check (strength_unit in ('mg','mcg','g','IU','mg/ml','mcg/ml','%'))`; **`strength_value` and `strength_unit` are both null or both non-null**. The list is final when stage F4 fixes it (PROJECT_SPEC DEC-45). |
| `low_stock_threshold` | `numeric(10,3)` null | *(planned)* `>= 0`. The user's own warning level, in `low_stock_threshold_unit`. Null means "no own threshold": the app uses the 7-day rule (PROJECT_SPEC DEC-46). |
| `low_stock_threshold_unit` | `text` null | *(planned)* `char_length(btrim(…)) between 1 and 30`; **threshold and unit are both null or both non-null**, and `check (low_stock_threshold is null or stock_quantity is not null)`. Stored with the quantity for the same reason as `stock_unit`: a later change of unit must not reinterpret an old number. The app applies the threshold only while the units match (`unitsMatch`). |
| `created_at`, `updated_at` | `timestamptz` not null default `now()` | both are sent by the application (its injected clock, PROJECT_SPEC DEC-20); the default applies only to a row inserted without them. No trigger stamps `updated_at` (§8) |

Extra: `unique (id, user_id)` — target for composite foreign keys.
Index: `(user_id, name)`.

*(planned)* Changing `dose_unit` or `dosage_form` never rewrites `dose_logs` (they keep their own snapshot) and never rewrites `stock_events` (they keep their own unit). A value of `dose_unit` that is not on the list for the form stays as it is (see PROJECT_SPEC DEC-45); the database therefore keeps `dose_unit` as free `text` with the length check above and does **not** constrain it to a list.

### 3.3 `medication_schedule_times` — the schedule rule

| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` PK | |
| `user_id` | `uuid` not null | |
| `medication_id` | `uuid` not null | `foreign key (medication_id, user_id) references medications (id, user_id) on delete cascade` |
| `time_of_day` | `time` not null | wall-clock; minute precision enforced in app |
| `dose_amount` | `numeric(10,3)` not null | `> 0` |

`unique (medication_id, time_of_day)`. Index: `(medication_id)`.

Only daily schedules are modelled in the MVP. Weekly/interval rules would add columns (e.g. `days_of_week`) or a separate rule table later; not built now.

### 3.4 `dose_logs` — what actually happened

| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` PK | |
| `user_id` | `uuid` not null | |
| `medication_id` | `uuid` not null | composite FK to `medications (id, user_id)` on delete cascade |
| `scheduled_date` | `date` not null | identifies the slot |
| `scheduled_time` | `time` not null | identifies the slot |
| `status` | `text` not null | `check (status in ('taken','skipped'))` |
| `dose_amount` | `numeric(10,3)` not null | `> 0`; snapshot (the app also rejects more than 3 decimals and values above 9 999 999.999, matching the column) |
| `dose_unit` | `text` not null | snapshot |
| `recorded_at` | `timestamptz` not null default `now()` | when the user recorded it; updated on status change |
| `taken_amount` | `numeric(10,3)` null | *(planned)* `> 0`; what the user says they actually took, in `dose_unit`. Null means "as planned" (`dose_amount`). `check (taken_amount is null or status = 'taken')`. `dose_amount` stays the snapshot of the **plan** and is never overwritten, so the original plan is always known (PROJECT_SPEC DEC-48). |
| `note` | `text` null | *(planned)* length ≤ 500 after trimming (limit approved by the owner; it applies to this note on its own); `check (note is null or status = 'taken')`. An optional explanation of a taken amount. It belongs to the dose record and only to a taken dose: a note about wasted medicine lives on the `waste` event in `stock_events`, never here. |

*(planned)* Changing `taken_amount` or `note` does **not** move `recorded_at`: that column decides which records count against the stock (PROJECT_SPEC §7.3), and moving it on an amount edit could make an old record count again.

`unique (medication_id, scheduled_date, scheduled_time)` — **one record per slot**. The application stores a record with `insert … on conflict (id) do update` (the Stage 2 functions decide whether it is a new record or a change to an existing one); a *different* record already in the slot violates the unique constraint, and the repository reports that as `duplicate-slot` instead of overwriting it (PROJECT_SPEC DEC-24). Undo deletes the row by the same slot key, so it can never leave a duplicate behind.
Indexes: `(user_id, scheduled_date)`, `(medication_id, scheduled_date)`.

There is deliberately **no foreign key to `medication_schedule_times`**: schedule times may be edited or removed while history must remain. A log with no matching current slot is displayed as "outside current schedule".

"Cannot record future doses" (D-6) depends on the user's local date, so it is enforced in the application; the database only enforces `scheduled_date <= (now() at time zone 'UTC')::date + 1` as a coarse sanity check (to be confirmed at implementation).

### 3.5 `appointments`

| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` PK | |
| `user_id` | `uuid` not null | FK → `profiles(id)` on delete cascade |
| `doctor_name` | `text` null | length ≤ 120 |
| `specialty` | `text` null | length ≤ 120 |
| `scheduled_at` | `timestamptz` not null | the moment of the visit |
| `location` | `text` null | length ≤ 200 |
| `notes` | `text` null | length ≤ 1000 |
| `status` | `text` not null default `'scheduled'` | `check (status in ('scheduled','completed','cancelled'))` |
| `created_at`, `updated_at` | `timestamptz` not null default `now()` | |

`check (doctor_name is not null or specialty is not null)` (after trimming empty strings to null in the app).
Index: `(user_id, scheduled_at)`.

A separate `doctors` table is **not** part of the MVP (PROJECT_SPEC DEC-05).

### 3.6 `stock_events` — the stock ledger *(planned)*

What happened to the physical stock apart from taking a dose: a refill, or a medicine that was wasted. Events are **facts, appended and never edited**; a mistake is reversed (`reversed_at`), not deleted, so the history stays complete (PROJECT_SPEC DEC-47).

| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` PK | generated by the client once per opened dialog, so a double submit is one row |
| `user_id` | `uuid` not null | |
| `medication_id` | `uuid` not null | composite FK to `medications (id, user_id)` on delete cascade |
| `kind` | `text` not null | `check (kind in ('refill','waste'))` |
| `amount` | `numeric(10,3)` not null | `> 0`; in `unit` |
| `unit` | `text` not null | `char_length(btrim(unit)) between 1 and 30`. Equal to the medication's `stock_unit` when the event was made (checked in the app, which refuses an event in another unit; the database cannot compare it without a trigger, see §8) |
| `recorded_at` | `timestamptz` not null default `now()` | when the user entered it. **No back-dating in the first version**: the app always sends the current instant |
| `note` | `text` null | length ≤ 500 after trimming (limit approved by the owner; it applies to this note on its own, separately from `dose_logs.note`). The note of a refill or of a waste event belongs to the event; a waste event has no dose slot and is never attached to a `dose_logs` row. |
| `reversed_at` | `timestamptz` null | `check (reversed_at is null or reversed_at >= recorded_at)`. A reversed event stays in the history and no longer counts |

Indexes: `(medication_id, recorded_at)`, `(user_id)`. RLS exactly as for the other tables (§6). After insert only `reversed_at` may change, once; which mechanism enforces that (trigger or column privileges) is decided at implementation (§8).

A waste event is **not** a skipped dose: it has no slot, it changes no `dose_logs` row, and a dose is never marked as taken because of it.

## 4. Time and time-zone handling

- `scheduled_time` / `scheduled_date` are wall-clock values in the user's time zone. They are never converted to UTC, so "08:00" stays 08:00 across DST changes.
- `scheduled_at`, `recorded_at`, `stock_as_of` (and, planned, `stock_events.recorded_at` and `reversed_at`) are instants (`timestamptz`, displayed in the user's zone).
- "Today" is calculated in the browser from the injected clock and the user's zone, and passed to queries as a date. The database never decides what "today" is for a user.
- If a user changes time zone, existing wall-clock schedule values keep their meaning ("08:00 where I am"); instants are unaffected.

## 5. Deletion behaviour

| Action | Effect |
|---|---|
| Delete account (`auth.users` row) | cascades to `profiles` and every table below it: all user data is erased |
| End medication (set `end_date`) | **preferred**; nothing is deleted, history is preserved |
| Delete medication | permanent; cascades to its schedule times, dose logs and (planned) stock events. The UI must state this explicitly and show how many history records will be lost (PROJECT_SPEC M-4) |
| Edit schedule times | replaces `medication_schedule_times` rows; **dose logs are untouched** |
| Delete appointment | row removed |
| *(planned)* Reverse a stock event | sets `reversed_at`; the row stays and stops counting. Events are never deleted by the app except by the cascades above |
| *(planned)* Count the stock again (edit the quantity) | `stock_as_of` becomes now; earlier events and dose logs stay in the history but no longer count (PROJECT_SPEC §7.6) |

## 6. Row Level Security

RLS is **enabled on every table** listed above. No table is readable by `anon`.

Policy pattern (one policy per command, role `authenticated`):

```sql
alter table public.medications enable row level security;

create policy medications_select on public.medications
  for select to authenticated using ((select auth.uid()) = user_id);
create policy medications_insert on public.medications
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy medications_update on public.medications
  for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy medications_delete on public.medications
  for delete to authenticated using ((select auth.uid()) = user_id);
```

(`profiles` uses `id = auth.uid()`.) The `(select auth.uid())` form lets Postgres evaluate it once per query rather than per row.

Defence in depth:

- Composite foreign keys stop a user from attaching a schedule time or log to someone else's medication, even with a correct `user_id`, because the parent must have the same `user_id`.
- `user_id` defaults to `auth.uid()` on insert. `update` cannot change it: the policy `with check` rejects another user's id, and the `prevent_owner_change` trigger rejects *any* change (decision of Stage 10). The trigger fires first, so the error a client sees is `23514`, not the RLS `42501`.
- `anon` holds no privilege on any table and no policy names it. `authenticated` gets only the commands the application uses: no `delete` on `stock_events` and `profiles`, no `truncate`, `references` or `trigger` anywhere.
- No `SECURITY DEFINER` function exists. Every trigger function has a fixed `search_path` and is not executable by the API roles.
- No `service_role` key in the frontend or the repository. Only `VITE_SUPABASE_URL` and the `anon` key (public by design, safe only because of RLS) are used client-side.

### Required tests (stage 10)

With two test users A and B and a signed-out client:

1. A cannot `select` B's rows in any table; result is empty, not an error leak.
2. A cannot `insert` a row with `user_id = B`.
3. A cannot `update` or `delete` B's rows, and cannot change `user_id` of its own rows.
4. A cannot insert a schedule time or dose log referencing B's medication (composite FK violation).
5. The signed-out client reads and writes nothing.
6. Duplicate dose log for the same slot is rejected / upserted to a single row.
7. CHECK constraints reject invalid values (negative dose, `end_date < start_date`, half-filled stock, unknown status).
8. *(planned)* The same two-account tests cover `stock_events`, and the checks of §3.2, §3.4 and §3.6 reject: half-filled strength or threshold, a threshold or a `stock_basis` without stock, a `taken_amount` or `note` on a skipped dose, a non-positive `amount` or `taken_amount`, an unknown `kind` or `dosage_form`, and `reversed_at` before `recorded_at`.
9. *(planned)* A user cannot attach a stock event to another user's medication (composite FK) and cannot change anything but `reversed_at` of an existing event.

Implementation: pgTAP tests (`supabase test db`) for policies and constraints, plus an integration test using two real auth sessions from the JS client.

Where each test lives (Stage 10; files in `supabase/tests/database/`):

| § | Test file |
|---|---|
| 1–3 (two accounts: read, insert, update, delete, change owner), 5 (signed out) | `02_cross_user_isolation.sql`, `01_rls_and_privileges.sql` (anon) |
| 4, 9 (composite FK, including as the table owner) | `02_cross_user_isolation.sql`, `04_triggers_and_cascades.sql` |
| 6 (one record per slot) | `03_constraints.sql` |
| 7, 8 (every CHECK, each by constraint name) | `03_constraints.sql` |
| 9 (only `reversed_at`, once) | `04_triggers_and_cascades.sql` |
| RLS enabled on every `public` table (the query fails if one is not) | `01_rls_and_privileges.sql`; also a static check in `src/databaseSchema.test.ts` |

The part that needs real sessions is `supabase/tests/client/isolation.test.ts` (Vitest, `npm run test:db-client`): two independent `@supabase/supabase-js` clients, each signed up as its own user with the public key only (no `service_role`), against the local stack. It checks that each user reads exactly her own rows in all six tables, gets an empty result (no error) when asking for the other's row by id, cannot insert rows owned by the other user (`42501`) or attach rows to the other's medication (`23503`), cannot hand rows over, that updates and deletes aimed at the other's rows touch nothing, that stock events accept only `reversed_at` once and cannot be deleted, and that a signed-out client reads and writes nothing. It is a **dev dependency and a test, not the Stage 11 client**: the application imports nothing from Supabase (checked by `src/databaseSchema.test.ts`). A mutation check (RLS switched off on `dose_logs`, a `using (true)` policy on `medications`) made 5 of its 16 tests fail.

## 7. Migrations

- One migration per logical change, named with timestamp prefix (`supabase migration new …`).
- Applied to a local Supabase stack for development and tests; never edited after being applied to a shared database.
- Seed data (fictional only) lives in `supabase/seed.sql`. In Stage 10 it is **empty on purpose**: rows need `auth.users` accounts, the public demo keeps its fictional data in the browser (`src/services/demo/demoData.ts`), and seeding accounts with known passwords into a shared database would be a credential in the repository.
- Current migrations: `20261022090000_create_tables.sql` (tables, CHECK/UNIQUE/FK, indexes), `20261022090100_create_triggers.sql` (owner and id immutability, time-zone validation, dose-date sanity, stock-event guard; its `updated_at` trigger was removed again, see the next file), `20261022090200_row_level_security.sql` (RLS, grants, policies), `20261023090000_updated_at_from_client.sql` (Stage 11: drops the `updated_at` triggers and their function).
- `supabase/config.toml` was generated by `supabase init` (CLI 2.121.0) and changed in three ways only: `project_id = "pigoowa"`; the services the application does not need are disabled (realtime, studio, local_smtp, storage, edge_runtime, analytics) so that only the database, Auth and the REST API start; and `[auth.rate_limit] sign_in_sign_ups` is raised from 30 to 1000 (the tests create many accounts from one address within minutes). It configures the LOCAL stack only. Local sign-ups need no e-mail confirmation (the generated default); a hosted project may require it, which the application handles (it shows "sprawdź skrzynkę" and does not sign in) but which was not tested. `supabase/.gitignore` (generated) keeps `.temp` out of Git.
- **Local environment, start and stop** (needs Docker and the Supabase CLI; the CLI is a Go binary, install it with `npm i -g supabase`, Homebrew, Scoop or a release download, see supabase.com/docs/guides/local-development/cli/getting-started):
  - `supabase start`: pulls the images on first use (a few minutes), starts the containers `supabase_db_pigoowa`, `supabase_auth_pigoowa`, `supabase_rest_pigoowa`, `supabase_kong_pigoowa`, applies the migrations and `seed.sql`. API on `http://127.0.0.1:54321`, database on `127.0.0.1:54322`.
  - `supabase db reset`: drops and recreates the local database from the migrations and the seed (this deletes local data, including the test users).
  - `supabase test db`: runs `supabase/tests/database/*.sql` with `pg_prove` (the CLI pulls the `pg_prove` image).
  - `npm run test:db-client`: the integration tests of `supabase/tests/client/` (the repository contract against the real stack, two independent sessions through raw tables and through the repositories, the real Auth server's error answers, the profile). It reads `API_URL` and `ANON_KEY` from `supabase status` (`scripts/db/run-client-isolation.sh`). The keys printed by `supabase status` are the well-known local development keys; they are not committed and the scripts never read the service-role key.
  - `npm run e2e:accounts`: the end-to-end tests of the build with accounts (`e2e-accounts/`, Playwright) against the same stack; `npm run check:account-bundle`: builds with the public variables and checks that the only key in the bundle is the public one.
  - `npm run db:types`: regenerates `src/services/supabase/database.types.ts` from the local database (run it after a migration that changes a table; the build then type-checks the repositories against the real schema).
  - `supabase status`: shows what runs. `supabase stop` stops the containers and keeps the data volumes; `supabase stop --no-backup` deletes them.
- Fallback without Docker or the CLI: `PGTAP_SQL=<generated pgtap.sql> scripts/db/run-tests.sh` applies the migrations to a scratch database on a plain PostgreSQL server and runs the same pgTAP files; `scripts/db/supabase-emulation.sql` stands in for the Supabase roles, `auth.users`, `auth.uid()` and default privileges. The emulation is **not** Supabase.

## 8. Decisions taken in Stages 10 and 11, and what stays open

Decided:

- **Time zone:** validated in the database. A trigger checks `profiles.time_zone` against `pg_timezone_names` on insert and on update of that column.
- **Retroactive logging:** unlimited into the past (unchanged). Into the future a trigger rejects a slot date more than one day after today in UTC (no zone is more than 14 hours ahead); the user's own "today" stays the application's decision. Dose logs before `start_date` are not rejected.
- **Stock-event unit = medication `stock_unit`:** *not* enforced in the database. The unit of the stock can change when the user counts again, and a comparison with the current value would reject legitimate history. The application and the shared repository contract tests keep the rule.
- **Stock events are facts:** after insert only `reversed_at` may be set, once (trigger `guard_stock_event_update`; repeating the identical update is accepted). Users have no `delete` privilege on `stock_events`; the rows go only with their medication or account (cascade).
- **Lists behind `strength_unit` and `dosage_form`:** the CHECK constraints repeat the application lists; `src/databaseSchema.test.ts` fails if the two drift apart. Dose and stock units stay free text with a length check (DEC-45).
- **Quantities:** `numeric(10,3)`. A value with more than three decimals is *rounded*, not rejected, by PostgreSQL; the application refuses such input before it gets here. Values above 9 999 999.999 overflow and are rejected.
- **`updated_at` (Stage 11):** the application supplies it, like every other timestamp (DEC-20), and the repository contract requires that what is stored is what was given, so the trigger that overwrote it with `now()` on every update was removed. The column is informational: it drives no access rule and no calculation.
- **Profile creation (Stage 11):** by the client after the first sign-in, not by a trigger on `auth.users` (§3.1). No migration was needed. If a later stage wants every account to have a profile even before its first sign-in (for example for an administrative export), a trigger can be added then.
- **`stock_events.id`** has no default: the client creates it once per dialog, so a double submit is one row.

Still open:

- Retention: whether very old history should be exportable/deletable in bulk (likely part of the privacy stage).
- Back-dating a refill (not allowed in the first version, DEC-47): nothing in the database stops a client from sending an earlier `recorded_at`; the rule lives in the application.
- *(planned)* The 500-character limit of the two notes was approved by the owner; it may be revisited once real use shows how notes are written.

## 9. Mapping from the browser-storage format

The browser-storage format of PROJECT_SPEC §10.5 (envelope version 2) is the shape the Supabase repositories of stage 11 must read and write, so that the shared repository contract tests apply to both.

| Browser storage (v2) | Database |
|---|---|
| `Medication.dosageForm?` | `medications.dosage_form` |
| `Medication.strength?: { value, unit } \| null` | `strength_value`, `strength_unit` |
| `Medication.lowStockThreshold?: { quantity, unit } \| null` | `low_stock_threshold`, `low_stock_threshold_unit` |
| `MedicationStock.basis?` | `medications.stock_basis` |
| `DoseLog.takenAmount?`, `DoseLog.note?` | `dose_logs.taken_amount`, `dose_logs.note` |
| collection `pigoowa:v1:stock-events` (`StockEvent`) | table `stock_events` |
| absent optional field | `null` |

How the Supabase repositories (Stage 11, `src/services/supabase/mappers.ts`) apply this mapping, and where the database differs from the browser storage:

- Every row read goes through the same validators as data read from the browser (`src/services/local/validation.ts`); a row that breaks the application's rules is reported as `data-corrupted`, never shown or repaired. The same validators check what is sent.
- A SQL NULL is both "left out" and "set to null": an optional field that is absent or `null` is stored as NULL and read back **absent** (the shared contract has a flag for this, `distinguishesNullFromAbsent`; the local storage keeps the difference, the database cannot).
- `time` columns come back as `HH:MM:SS` and are read as `HH:mm`; timestamps come back with an offset and are read in the application's own format (UTC, `.000Z`).
- Ids are UUIDs. The application always creates UUIDs (`crypto.randomUUID()`); the repositories treat any other id as one that does not exist (`not-found`, a count of 0, an empty list). The contract's readable ids (`m-1`) are translated to UUIDs by a test-only wrapper (`src/services/contract/uuidIds.ts`).
- A schedule time's `id` is a primary key of its own table, so it must be unique among **all** of a user's medications (UUIDs are); the browser storage only needed it unique within one medication.
- Quantities are `numeric(10,3)`: a value with more than three decimals is rounded by PostgreSQL (the application never sends one), a value above 9 999 999.999 is refused.
- PostgREST returns at most `max_rows` (1000) rows per request, silently; every list is read page by page until the exact count is reached.
- A medication and its schedule times are two tables and PostgREST runs one statement per request, so creating or changing a medication is a short sequence of requests with a best-effort undo of the part already done (a failed undo is reported as `rollback failed`, exactly like the local repository's). Deleting a medication is one statement and cascades inside the database. Moving this into one database function (an RPC) would make it atomic; it was left out to keep the schema as tested in Stage 10.
- The unique key on a dose slot is database-wide, so an attempt to record into a slot that another user's medication already holds is refused as `duplicate-slot`, which shows that a record exists to someone who already knows that medication's unguessable id. Nothing is read or changed.

A v1 browser record has none of the optional fields; they read as absent, which means "not chosen", "no own threshold", "as planned", "counted" (for the stock basis) and "no events". No database migration of existing rows is needed, because stage 10 creates the schema once, including these columns. Moving a person's existing browser data into their account is **not** part of Stages 10 or 11: nothing reads the `localStorage` data when an account is open, nothing copies it, and nothing deletes it. If an import is wanted later it is a separate, explicitly designed feature that must never delete the `localStorage` data without a tested mechanism.

## 10. Verification status (Stages 10 and 11)

Real local Supabase stack = the Supabase CLI 2.121.0 with Docker 29.8.2 (images `supabase/postgres:17.11.0.004`, `supabase/gotrue:v2.197.0`, `postgrest/postgrest:v16.4`, `kong:2.8.1`, pg_prove 3.36), on a single machine. The sandbox that ran it had to start the Docker daemon by hand.

| Check | Where | Result |
|---|---|---|
| `supabase start`, `supabase db reset` (several times, also after the Stage 11 migration) | real local stack | ok; a schema dump before and after a reset was byte-identical (Stage 10) |
| `supabase test db`: `01`–`04` pgTAP files | real local stack | 4 files, 144 assertions, PASS (Stage 11 changed one assertion and removed one) |
| `supabase db lint --local --level warning` | real local stack | no schema errors (Stage 10) |
| Repository contract, Supabase implementation (`supabase/tests/client/repositories.contract.test.ts`) | real local stack | 115 tests pass: the same contract the local implementation passes |
| Two independent sessions through raw tables (`isolation.test.ts`) and through the repositories (`repositories.isolation.test.ts`); more than 1000 rows read in pages | real local stack | pass |
| Auth and profile against the real Auth server (`auth.test.ts`): wrong password, unknown user, weak password, a revoked refresh token, an unreachable server, a bad token, no session | real local stack | pass |
| `npm run test:db-client` altogether | real local stack | 4 files, 161 tests pass |
| `npm run e2e:accounts` (journey, two browsers, error states, demonstration, axe scans of the new pages) | real local stack, Chromium | 21 tests pass |
| `npm run check:account-bundle` | real local stack | the only key in a bundle built with the public variables is the public one |
| The same pgTAP files | plain PostgreSQL 16.15 + emulation | 144 assertions pass in Stage 10 (fallback; not Supabase). Not re-run after Stage 11 |
| `src/databaseSchema.test.ts` | `npm test` | part of the suite |
| A hosted Supabase project | none exists | **none was created or touched** |
| Not verified | | behaviour on a hosted project (other versions, dashboard settings, Auth e-mail rules, the sign-up rate limit at its default); e-mail-confirmed sign-up; password reset; the Git history for keys (Stage 12); a manual check by a person with two real accounts |
