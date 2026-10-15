# Pigoowa — Database Design (preliminary)

> **Status:** design only. No database, migration or Supabase project exists yet. This document will be updated in stage 10 when the schema is actually implemented and tested.

PostgreSQL via Supabase. Schema changes are made exclusively through versioned SQL migrations in `supabase/migrations/` (Supabase CLI), so the schema is reproducible from an empty database.

## 1. Design principles

1. **Rules ≠ facts.** The schedule (rule) is stored in `medication_schedule_times`. What the user actually did is stored in `dose_logs`. Scheduled doses themselves are *not* stored; they are computed (PROJECT_SPEC DEC-01).
2. **Appointment time ≠ appointment status.** `scheduled_at` is when it happens; `status` is its lifecycle state. "Past" is derived.
3. **Ownership enforced by the database.** Every private table has `user_id` and RLS; child tables also reference their parent *together with* `user_id` (composite foreign key), so a row can never point at another user's parent.
4. **Wall-clock values for schedules, instants for events.** `date` / `time` columns for schedule slots, `timestamptz` for moments.
5. **Constraints over trust.** Validity rules (positive doses, unique slots, status values) are CHECK/UNIQUE constraints, not only Zod validation.
6. **No redundant data**, except deliberate snapshots (`dose_logs.dose_amount/dose_unit`) that preserve history.

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
   │            └──────< dose_logs                   (the facts)
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
| `stock_as_of` | `timestamptz` null | **both stock columns null or both non-null** |
| `created_at`, `updated_at` | `timestamptz` not null default `now()` | `updated_at` maintained by trigger |

Extra: `unique (id, user_id)` — target for composite foreign keys.
Index: `(user_id, name)`.

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
| `dose_amount` | `numeric(10,3)` not null | `> 0`; snapshot |
| `dose_unit` | `text` not null | snapshot |
| `recorded_at` | `timestamptz` not null default `now()` | when the user recorded it; updated on status change |

`unique (medication_id, scheduled_date, scheduled_time)` — **one record per slot**; this is what makes repeated actions idempotent (via `insert … on conflict … do update`).
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

## 4. Time and time-zone handling

- `scheduled_time` / `scheduled_date` are wall-clock values in the user's time zone. They are never converted to UTC, so "08:00" stays 08:00 across DST changes.
- `scheduled_at`, `recorded_at`, `stock_as_of` are instants (`timestamptz`, displayed in the user's zone).
- "Today" is calculated in the browser from the injected clock and the user's zone, and passed to queries as a date. The database never decides what "today" is for a user.
- If a user changes time zone, existing wall-clock schedule values keep their meaning ("08:00 where I am"); instants are unaffected.

## 5. Deletion behaviour

| Action | Effect |
|---|---|
| Delete account (`auth.users` row) | cascades to `profiles` and every table below it: all user data is erased |
| Delete medication | cascades to its schedule times and dose logs (user is warned) |
| Edit schedule times | replaces `medication_schedule_times` rows; **dose logs are untouched** |
| Delete appointment | row removed |

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

Implementation: pgTAP tests (`supabase test db`) for policies and constraints, plus an integration test using two real auth sessions from the JS client.

## 7. Migrations

- One migration per logical change, named with timestamp prefix (`supabase migration new …`).
- Applied to a local Supabase stack for development and tests; never edited after being applied to a shared database.
- Seed data (fictional only) lives in `supabase/seed.sql` and is used for the public demo.

## 8. Open questions (decide when implementing)

- Maximum allowed gap between `scheduled_date` and "now" for retroactive logging (currently unlimited into the past).
- Whether to enforce IANA time zone validity in the database.
- Retention: whether very old history should be exportable/deletable in bulk (likely part of the privacy stage).
