-- Pigoowa: the tables (docs/DATABASE.md §3). Rules are constraints, not form validation alone.
-- Row Level Security and privileges are in 20261022090200_row_level_security.sql; the triggers are in
-- 20261022090100_create_triggers.sql. The browser-storage format maps onto these columns (DATABASE.md §9).
--
-- Quantities are numeric(10,3): at most 3 decimals and at most 9 999 999.999, like the application.
-- Units are free text with a length check: a unit saved earlier that is on no list stays as it is, and
-- no unit is ever converted into another (PROJECT_SPEC DEC-06, DEC-45).

-- 3.1 profiles -------------------------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  time_zone text not null default 'Europe/Warsaw',
  created_at timestamptz not null default now(),

  constraint profiles_display_name_length check (display_name is null or char_length(display_name) <= 80),
  constraint profiles_time_zone_length check (char_length(btrim(time_zone)) between 1 and 64)
);

comment on table public.profiles is
  'One row per account. time_zone is an IANA name, validated by a trigger (see the triggers migration).';

-- 3.2 medications ----------------------------------------------------------------------------------------
create table public.medications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  name text not null,
  dose_unit text not null,
  notes text,
  start_date date not null,
  end_date date,
  schedule_effective_from date not null,

  -- The stock snapshot: all three are null or all three are set. No stock is an UNKNOWN stock, not zero
  -- (a counted zero is stock_quantity = 0).
  stock_quantity numeric(10, 3),
  stock_unit text,
  stock_as_of timestamptz,
  -- How the baseline was started (PROJECT_SPEC DEC-52). Null means "counted". Never used in a calculation.
  stock_basis text,

  -- Information only, never a unit of a dose or of the stock, never part of an estimate.
  dosage_form text,
  strength_value numeric(10, 3),
  strength_unit text,

  -- The user's own warning level, in its own unit (PROJECT_SPEC DEC-46). Null means "the 7-day rule".
  low_stock_threshold numeric(10, 3),
  low_stock_threshold_unit text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- The target of the composite foreign keys of the child tables: a child can only point at a
  -- medication of the same user.
  constraint medications_id_user_id_key unique (id, user_id),

  constraint medications_name_length check (char_length(btrim(name)) between 1 and 120),
  constraint medications_dose_unit_length check (char_length(btrim(dose_unit)) between 1 and 30),
  constraint medications_notes_length check (notes is null or char_length(btrim(notes)) <= 1000),
  constraint medications_end_after_start check (end_date is null or end_date >= start_date),
  constraint medications_schedule_from_start check (schedule_effective_from >= start_date),

  constraint medications_stock_all_or_none check (
    (stock_quantity is null) = (stock_unit is null) and (stock_quantity is null) = (stock_as_of is null)
  ),
  constraint medications_stock_quantity_not_negative check (stock_quantity is null or stock_quantity >= 0),
  constraint medications_stock_unit_length check (
    stock_unit is null or char_length(btrim(stock_unit)) between 1 and 30
  ),
  constraint medications_stock_basis_values check (stock_basis is null or stock_basis in ('counted', 'new-package')),
  constraint medications_stock_basis_needs_stock check (stock_basis is null or stock_quantity is not null),

  constraint medications_dosage_form_values check (
    dosage_form is null
    or dosage_form in (
      'tablet', 'capsule', 'liquid', 'drops', 'injection', 'sachet', 'patch', 'suppository', 'inhaler', 'other'
    )
  ),
  constraint medications_strength_positive check (strength_value is null or strength_value > 0),
  constraint medications_strength_unit_values check (
    strength_unit is null or strength_unit in ('mg', 'mcg', 'g', 'IU', 'mg/ml', 'mcg/ml', '%')
  ),
  constraint medications_strength_both_or_none check ((strength_value is null) = (strength_unit is null)),

  constraint medications_threshold_not_negative check (low_stock_threshold is null or low_stock_threshold >= 0),
  constraint medications_threshold_unit_length check (
    low_stock_threshold_unit is null or char_length(btrim(low_stock_threshold_unit)) between 1 and 30
  ),
  constraint medications_threshold_both_or_none check (
    (low_stock_threshold is null) = (low_stock_threshold_unit is null)
  ),
  constraint medications_threshold_needs_stock check (low_stock_threshold is null or stock_quantity is not null)
);

create index medications_user_id_name_idx on public.medications (user_id, name);

comment on column public.medications.dose_unit is
  'Free text with a length check on purpose: a unit that is on no list stays as it was saved (DEC-45).';
comment on column public.medications.stock_basis is
  'counted (or null) or new-package: only changes what the screens say, never an estimate.';

-- 3.3 medication_schedule_times: the schedule RULE ------------------------------------------------------------
create table public.medication_schedule_times (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  medication_id uuid not null,
  time_of_day time not null,
  dose_amount numeric(10, 3) not null,

  constraint medication_schedule_times_medication_fkey
    foreign key (medication_id, user_id) references public.medications (id, user_id) on delete cascade,
  constraint medication_schedule_times_one_per_time unique (medication_id, time_of_day),
  constraint medication_schedule_times_dose_positive check (dose_amount > 0)
);

create index medication_schedule_times_medication_id_idx on public.medication_schedule_times (medication_id);

-- 3.4 dose_logs: what actually happened ----------------------------------------------------------------------
create table public.dose_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  medication_id uuid not null,
  scheduled_date date not null,
  scheduled_time time not null,
  status text not null,
  -- The snapshot of the PLAN at the moment of recording. Never overwritten (DEC-48).
  dose_amount numeric(10, 3) not null,
  dose_unit text not null,
  -- When the user recorded it. Editing the amount or the note does not move it: it decides which records
  -- count against the stock (PROJECT_SPEC §7.3).
  recorded_at timestamptz not null default now(),
  -- What the user says they actually took, in dose_unit. Null means "as planned".
  taken_amount numeric(10, 3),
  note text,

  constraint dose_logs_medication_fkey
    foreign key (medication_id, user_id) references public.medications (id, user_id) on delete cascade,
  -- One record per slot. There is deliberately NO foreign key to medication_schedule_times: a schedule
  -- may change while the history stays.
  constraint dose_logs_one_per_slot unique (medication_id, scheduled_date, scheduled_time),
  constraint dose_logs_status_values check (status in ('taken', 'skipped')),
  constraint dose_logs_dose_positive check (dose_amount > 0),
  constraint dose_logs_dose_unit_length check (char_length(btrim(dose_unit)) between 1 and 30),
  constraint dose_logs_taken_amount_positive check (taken_amount is null or taken_amount > 0),
  constraint dose_logs_taken_amount_only_taken check (taken_amount is null or status = 'taken'),
  constraint dose_logs_note_length check (note is null or char_length(btrim(note)) <= 500),
  constraint dose_logs_note_only_taken check (note is null or status = 'taken')
);

create index dose_logs_user_id_scheduled_date_idx on public.dose_logs (user_id, scheduled_date);
create index dose_logs_medication_id_scheduled_date_idx on public.dose_logs (medication_id, scheduled_date);

comment on column public.dose_logs.note is
  'About a taken amount only. A note about wasted medicine lives on the waste event in stock_events.';

-- 3.5 appointments --------------------------------------------------------------------------------------------
create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  doctor_name text,
  specialty text,
  scheduled_at timestamptz not null,
  location text,
  notes text,
  status text not null default 'scheduled',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint appointments_doctor_name_length check (doctor_name is null or char_length(btrim(doctor_name)) <= 120),
  constraint appointments_specialty_length check (specialty is null or char_length(btrim(specialty)) <= 120),
  constraint appointments_location_length check (location is null or char_length(btrim(location)) <= 200),
  constraint appointments_notes_length check (notes is null or char_length(btrim(notes)) <= 1000),
  constraint appointments_status_values check (status in ('scheduled', 'completed', 'cancelled')),
  constraint appointments_who check (doctor_name is not null or specialty is not null)
);

create index appointments_user_id_scheduled_at_idx on public.appointments (user_id, scheduled_at);

-- 3.6 stock_events: the stock ledger --------------------------------------------------------------------------
create table public.stock_events (
  -- Created by the client once per opened dialog, so a double submit is one row.
  id uuid primary key,
  user_id uuid not null default auth.uid(),
  medication_id uuid not null,
  kind text not null,
  amount numeric(10, 3) not null,
  -- The unit of the stock when the event was made. Not compared with medications.stock_unit here (decision
  -- of stage 10: the application and the repository contract tests keep that rule, see docs/DATABASE.md §8).
  unit text not null,
  -- When the user entered it. No back-dating in the first version: the application sends the current instant.
  recorded_at timestamptz not null default now(),
  note text,
  -- A reversed event stays in the history and no longer counts. Set once, by a trigger-guarded update.
  reversed_at timestamptz,

  constraint stock_events_medication_fkey
    foreign key (medication_id, user_id) references public.medications (id, user_id) on delete cascade,
  constraint stock_events_kind_values check (kind in ('refill', 'waste')),
  constraint stock_events_amount_positive check (amount > 0),
  constraint stock_events_unit_length check (char_length(btrim(unit)) between 1 and 30),
  constraint stock_events_note_length check (note is null or char_length(btrim(note)) <= 500),
  constraint stock_events_reversed_after_recorded check (reversed_at is null or reversed_at >= recorded_at)
);

create index stock_events_medication_id_recorded_at_idx on public.stock_events (medication_id, recorded_at);
create index stock_events_user_id_idx on public.stock_events (user_id);

comment on table public.stock_events is
  'Append-only ledger of refills and waste. A waste event is not a dose: it has no slot and touches no dose_logs row.';
