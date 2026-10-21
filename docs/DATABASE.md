# Pigoowa — Database Design (preliminary)

> **Status:** design only. No database, migration or Supabase project exists yet. This document will be updated in stage 10 when the schema is actually implemented and tested.
>
> **Planned additions (medication feature track F0–F8, ROADMAP; decided in F0, not implemented).** Everything marked *(planned)* below is a design decision that exists only in this document: no code, no migration and no stored data uses it yet. It is written down now so that the stage 10 schema includes it from the start and does not need a migration straight after. The browser-storage format that corresponds to it is described in PROJECT_SPEC §10.5 and mapped in §9 below.

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
| `time_zone` | `text` not null default `'Europe/Warsaw'` | IANA name (e.g. `Europe/Warsaw`); validated in the app; database-level validation is an open question (§8) |
| `created_at` | `timestamptz` not null default `now()` | |

Created by a trigger on `auth.users` insert (stage 11).

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
| `created_at`, `updated_at` | `timestamptz` not null default `now()` | `updated_at` maintained by trigger |

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
- `user_id` defaults to `auth.uid()` on insert and `update` cannot change it (policy `with check` plus a trigger or column privilege, decided at implementation).
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

## 7. Migrations

- One migration per logical change, named with timestamp prefix (`supabase migration new …`).
- Applied to a local Supabase stack for development and tests; never edited after being applied to a shared database.
- Seed data (fictional only) lives in `supabase/seed.sql` and is used for the public demo.

## 8. Open questions (decide when implementing)

- Maximum allowed gap between `scheduled_date` and "now" for retroactive logging (currently unlimited into the past).
- Whether to enforce IANA time zone validity in the database.
- Retention: whether very old history should be exportable/deletable in bulk (likely part of the privacy stage).
- *(planned)* How to enforce "an event's unit equals the medication's `stock_unit`" in the database (a trigger, or leave it to the application and the shared repository contract tests).
- *(planned)* How to enforce "only `reversed_at` of a stock event may change, once" (trigger or column privileges).
- *(planned)* The exact lists behind `strength_unit` and `dosage_form` are fixed in stage F4; the `check` constraints must be generated from those same lists.
- *(planned)* The 500-character limit of the two notes was approved by the owner (the notes of medications and appointments allow 1000); it may be revisited once real use shows how notes are written.

## 9. Mapping from the browser-storage format *(planned)*

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

A v1 browser record has none of the optional fields; they read as absent, which means "not chosen", "no own threshold", "as planned", "counted" (for the stock basis) and "no events". No database migration of existing rows is needed, because stage 10 creates the schema once, including these columns.
