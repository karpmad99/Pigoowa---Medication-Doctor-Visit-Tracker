-- DATABASE.md §6: the rules are enforced by the database, not by form validation alone.
-- Each negative test names the constraint it expects, so a constraint that is dropped or renamed fails here.
begin;
select plan(53);

insert into auth.users (id, email) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'alice@example.invalid');
insert into public.profiles (id, display_name) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Alice');
insert into public.medications (id, user_id, name, dose_unit, start_date, schedule_effective_from) values
  ('a1000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Alice med', 'tabl.', '2026-01-01', '2026-01-01');

-- Everything below runs as the signed-in user, i.e. through RLS as well.
set local role authenticated;
set local request.jwt.claim.sub = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

-- ----- medications -----
-- A valid row first (so the failures below are about the one column under test).
select lives_ok($$insert into public.medications (name, dose_unit, start_date, schedule_effective_from,
    stock_quantity, stock_unit, stock_as_of, stock_basis, dosage_form, strength_value, strength_unit,
    low_stock_threshold, low_stock_threshold_unit)
  values ('Full row', 'tabl.', '2026-01-01', '2026-01-01', 12.5, 'tabl.', now(), 'new-package', 'tablet', 500, 'mg', 10, 'tabl.')$$,
  'a medication with every optional field is accepted');
select lives_ok($$insert into public.medications (name, dose_unit, start_date, schedule_effective_from)
  values ('Old record', 'u', '2026-01-01', '2026-01-01')$$,
  'a medication without any optional field (an older record) is accepted');
select lives_ok($$insert into public.medications (name, dose_unit, start_date, schedule_effective_from, stock_quantity, stock_unit, stock_as_of)
  values ('Zero stock', 'u', '2026-01-01', '2026-01-01', 0, 'u', now())$$,
  'a counted zero stock is accepted (unknown stock is NULL, zero is a value)');
select lives_ok($$insert into public.medications (name, dose_unit, start_date, schedule_effective_from)
  values ('Odd unit', 'kropla na łyżkę', '2026-01-01', '2026-01-01')$$,
  'a unit that is on no list is kept as typed');

select throws_like($$insert into public.medications (name, dose_unit, start_date, schedule_effective_from) values ('  ', 'u', '2026-01-01', '2026-01-01')$$,
  '%medications_name_length%', 'blank name is rejected');
select throws_like($$insert into public.medications (name, dose_unit, start_date, schedule_effective_from) values (repeat('a', 121), 'u', '2026-01-01', '2026-01-01')$$,
  '%medications_name_length%', 'name over 120 characters is rejected');
select throws_like($$insert into public.medications (name, dose_unit, start_date, schedule_effective_from) values ('x', repeat('a', 31), '2026-01-01', '2026-01-01')$$,
  '%medications_dose_unit_length%', 'dose unit over 30 characters is rejected');
select throws_like($$insert into public.medications (name, dose_unit, start_date, schedule_effective_from, notes) values ('x', 'u', '2026-01-01', '2026-01-01', repeat('a', 1001))$$,
  '%medications_notes_length%', 'notes over 1000 characters are rejected');
select throws_like($$insert into public.medications (name, dose_unit, start_date, end_date, schedule_effective_from) values ('x', 'u', '2026-01-10', '2026-01-09', '2026-01-10')$$,
  '%medications_end_after_start%', 'end date before start date is rejected');
select throws_like($$insert into public.medications (name, dose_unit, start_date, schedule_effective_from) values ('x', 'u', '2026-01-10', '2026-01-09')$$,
  '%medications_schedule_from_start%', 'schedule effective before the start date is rejected');

-- stock snapshot: all or none
select throws_like($$insert into public.medications (name, dose_unit, start_date, schedule_effective_from, stock_quantity) values ('x', 'u', '2026-01-01', '2026-01-01', 5)$$,
  '%medications_stock_all_or_none%', 'stock quantity without unit and date is rejected');
select throws_like($$insert into public.medications (name, dose_unit, start_date, schedule_effective_from, stock_unit) values ('x', 'u', '2026-01-01', '2026-01-01', 'u')$$,
  '%medications_stock_all_or_none%', 'stock unit alone is rejected');
select throws_like($$insert into public.medications (name, dose_unit, start_date, schedule_effective_from, stock_as_of) values ('x', 'u', '2026-01-01', '2026-01-01', now())$$,
  '%medications_stock_all_or_none%', 'stock date alone is rejected');
select throws_like($$insert into public.medications (name, dose_unit, start_date, schedule_effective_from, stock_quantity, stock_unit, stock_as_of) values ('x', 'u', '2026-01-01', '2026-01-01', -1, 'u', now())$$,
  '%medications_stock_quantity_not_negative%', 'negative stock is rejected');
-- numeric(10,3) rounds to 3 decimals; the application refuses more than 3 decimals before it gets here.
select lives_ok($$insert into public.medications (id, name, dose_unit, start_date, schedule_effective_from, stock_quantity, stock_unit, stock_as_of) values ('a1000000-0000-4000-8000-0000000000f1', 'Rounded', 'u', '2026-01-01', '2026-01-01', 0.30000000000000004, 'u', now())$$,
  'float noise in a quantity is accepted');
select is((select stock_quantity from public.medications where id = 'a1000000-0000-4000-8000-0000000000f1'), 0.300::numeric,
  'and is stored rounded to 3 decimals');
select throws_ok($$insert into public.medications (name, dose_unit, start_date, schedule_effective_from, stock_quantity, stock_unit, stock_as_of) values ('x', 'u', '2026-01-01', '2026-01-01', 10000000, 'u', now())$$,
  '22003', null, 'stock above 9 999 999.999 is rejected (numeric overflow)');
select throws_like($$insert into public.medications (name, dose_unit, start_date, schedule_effective_from, stock_quantity, stock_unit, stock_as_of) values ('x', 'u', '2026-01-01', '2026-01-01', 1, repeat('a', 31), now())$$,
  '%medications_stock_unit_length%', 'stock unit over 30 characters is rejected');
select throws_like($$insert into public.medications (name, dose_unit, start_date, schedule_effective_from, stock_quantity, stock_unit, stock_as_of, stock_basis) values ('x', 'u', '2026-01-01', '2026-01-01', 1, 'u', now(), 'guess')$$,
  '%medications_stock_basis_values%', 'unknown stock basis is rejected');
select throws_like($$insert into public.medications (name, dose_unit, start_date, schedule_effective_from, stock_basis) values ('x', 'u', '2026-01-01', '2026-01-01', 'counted')$$,
  '%medications_stock_basis_needs_stock%', 'a stock basis without a stock is rejected');

-- dosage form and strength
select throws_like($$insert into public.medications (name, dose_unit, start_date, schedule_effective_from, dosage_form) values ('x', 'u', '2026-01-01', '2026-01-01', 'gummy')$$,
  '%medications_dosage_form_values%', 'unknown dosage form is rejected');
select throws_like($$insert into public.medications (name, dose_unit, start_date, schedule_effective_from, strength_value) values ('x', 'u', '2026-01-01', '2026-01-01', 5)$$,
  '%medications_strength_both_or_none%', 'strength value without unit is rejected');
select throws_like($$insert into public.medications (name, dose_unit, start_date, schedule_effective_from, strength_unit) values ('x', 'u', '2026-01-01', '2026-01-01', 'mg')$$,
  '%medications_strength_both_or_none%', 'strength unit without value is rejected');
select throws_like($$insert into public.medications (name, dose_unit, start_date, schedule_effective_from, strength_value, strength_unit) values ('x', 'u', '2026-01-01', '2026-01-01', 0, 'mg')$$,
  '%medications_strength_positive%', 'zero strength is rejected');
select throws_like($$insert into public.medications (name, dose_unit, start_date, schedule_effective_from, strength_value, strength_unit) values ('x', 'u', '2026-01-01', '2026-01-01', 5, 'stones')$$,
  '%medications_strength_unit_values%', 'unknown strength unit is rejected');

-- own low-stock threshold
select throws_like($$insert into public.medications (name, dose_unit, start_date, schedule_effective_from, stock_quantity, stock_unit, stock_as_of, low_stock_threshold) values ('x', 'u', '2026-01-01', '2026-01-01', 5, 'u', now(), 3)$$,
  '%medications_threshold_both_or_none%', 'threshold without unit is rejected');
select throws_like($$insert into public.medications (name, dose_unit, start_date, schedule_effective_from, stock_quantity, stock_unit, stock_as_of, low_stock_threshold, low_stock_threshold_unit) values ('x', 'u', '2026-01-01', '2026-01-01', 5, 'u', now(), -1, 'u')$$,
  '%medications_threshold_not_negative%', 'negative threshold is rejected');
select throws_like($$insert into public.medications (name, dose_unit, start_date, schedule_effective_from, low_stock_threshold, low_stock_threshold_unit) values ('x', 'u', '2026-01-01', '2026-01-01', 3, 'u')$$,
  '%medications_threshold_needs_stock%', 'a threshold without a stock is rejected');
select lives_ok($$insert into public.medications (name, dose_unit, start_date, schedule_effective_from, stock_quantity, stock_unit, stock_as_of, low_stock_threshold, low_stock_threshold_unit) values ('Zero threshold', 'u', '2026-01-01', '2026-01-01', 5, 'u', now(), 0, 'u')$$,
  'a zero threshold is accepted (the user turns the warning down on purpose)');

-- ----- medication_schedule_times -----
select lives_ok($$insert into public.medication_schedule_times (medication_id, time_of_day, dose_amount) values ('a1000000-0000-4000-8000-000000000001', '08:00', 1.5)$$,
  'a schedule time is accepted');
select throws_like($$insert into public.medication_schedule_times (medication_id, time_of_day, dose_amount) values ('a1000000-0000-4000-8000-000000000001', '08:00', 1)$$,
  '%medication_schedule_times_one_per_time%', 'the same time twice for one medication is rejected');
select throws_like($$insert into public.medication_schedule_times (medication_id, time_of_day, dose_amount) values ('a1000000-0000-4000-8000-000000000001', '09:00', 0)$$,
  '%medication_schedule_times_dose_positive%', 'a zero dose amount is rejected');
select throws_ok($$insert into public.medication_schedule_times (medication_id, time_of_day, dose_amount) values ('99999999-9999-4999-8999-999999999999', '09:00', 1)$$,
  '23503', null, 'a schedule time for a medication that does not exist is rejected');

-- ----- dose_logs -----
select lives_ok($$insert into public.dose_logs (medication_id, scheduled_date, scheduled_time, status, dose_amount, dose_unit)
  values ('a1000000-0000-4000-8000-000000000001', '2026-01-05', '08:00', 'taken', 1.5, 'tabl.')$$,
  'a dose log without taken_amount and note (an older record) is accepted');
select lives_ok($$insert into public.dose_logs (medication_id, scheduled_date, scheduled_time, status, dose_amount, dose_unit, taken_amount, note)
  values ('a1000000-0000-4000-8000-000000000001', '2026-01-06', '08:00', 'taken', 1.5, 'tabl.', 1, 'half a tablet less')$$,
  'a taken dose with the actual amount and a note is accepted');
select lives_ok($$insert into public.dose_logs (medication_id, scheduled_date, scheduled_time, status, dose_amount, dose_unit)
  values ('a1000000-0000-4000-8000-000000000001', '2026-01-07', '08:00', 'skipped', 1.5, 'tabl.')$$,
  'a skipped dose is accepted');
select throws_like($$insert into public.dose_logs (medication_id, scheduled_date, scheduled_time, status, dose_amount, dose_unit)
  values ('a1000000-0000-4000-8000-000000000001', '2026-01-05', '08:00', 'skipped', 1, 'tabl.')$$,
  '%dose_logs_one_per_slot%', 'a second record for the same slot is rejected');
select throws_like($$insert into public.dose_logs (medication_id, scheduled_date, scheduled_time, status, dose_amount, dose_unit)
  values ('a1000000-0000-4000-8000-000000000001', '2026-01-08', '08:00', 'delayed', 1, 'tabl.')$$,
  '%dose_logs_status_values%', 'an unknown status is rejected');
select throws_like($$insert into public.dose_logs (medication_id, scheduled_date, scheduled_time, status, dose_amount, dose_unit)
  values ('a1000000-0000-4000-8000-000000000001', '2026-01-08', '08:00', 'taken', 0, 'tabl.')$$,
  '%dose_logs_dose_positive%', 'a zero planned dose is rejected');
select throws_like($$insert into public.dose_logs (medication_id, scheduled_date, scheduled_time, status, dose_amount, dose_unit, taken_amount)
  values ('a1000000-0000-4000-8000-000000000001', '2026-01-08', '08:00', 'taken', 1, 'tabl.', 0)$$,
  '%dose_logs_taken_amount_positive%', 'a zero taken amount is rejected');
select throws_like($$insert into public.dose_logs (medication_id, scheduled_date, scheduled_time, status, dose_amount, dose_unit, taken_amount)
  values ('a1000000-0000-4000-8000-000000000001', '2026-01-08', '08:00', 'skipped', 1, 'tabl.', 1)$$,
  '%dose_logs_taken_amount_only_taken%', 'a taken amount on a skipped dose is rejected');
select throws_like($$insert into public.dose_logs (medication_id, scheduled_date, scheduled_time, status, dose_amount, dose_unit, note)
  values ('a1000000-0000-4000-8000-000000000001', '2026-01-08', '08:00', 'skipped', 1, 'tabl.', 'why')$$,
  '%dose_logs_note_only_taken%', 'a note on a skipped dose is rejected');
select throws_like($$insert into public.dose_logs (medication_id, scheduled_date, scheduled_time, status, dose_amount, dose_unit, note)
  values ('a1000000-0000-4000-8000-000000000001', '2026-01-08', '08:00', 'taken', 1, 'tabl.', repeat('a', 501))$$,
  '%dose_logs_note_length%', 'a dose note over 500 characters is rejected');
select throws_ok($$insert into public.dose_logs (medication_id, scheduled_date, scheduled_time, status, dose_amount, dose_unit)
  values ('a1000000-0000-4000-8000-000000000001', (now() at time zone 'UTC')::date + 3, '08:00', 'taken', 1, 'tabl.')$$,
  '23514', 'scheduled_date is too far in the future', 'a slot date days in the future is rejected');

-- ----- appointments -----
select lives_ok($$insert into public.appointments (doctor_name, scheduled_at) values ('Dr Fictional', now())$$, 'an appointment with a doctor only is accepted');
select lives_ok($$insert into public.appointments (specialty, scheduled_at) values ('Kardiologia', now())$$, 'an appointment with a specialty only is accepted');
select throws_like($$insert into public.appointments (scheduled_at) values (now())$$, '%appointments_who%', 'an appointment with neither doctor nor specialty is rejected');
select throws_like($$insert into public.appointments (doctor_name, scheduled_at, status) values ('x', now(), 'moved')$$, '%appointments_status_values%', 'an unknown appointment status is rejected');

-- ----- stock_events -----
select lives_ok($$insert into public.stock_events (id, medication_id, kind, amount, unit) values (gen_random_uuid(), 'a1000000-0000-4000-8000-000000000001', 'waste', 2, 'tabl.')$$, 'a waste event is accepted');
select throws_like($$insert into public.stock_events (id, medication_id, kind, amount, unit) values (gen_random_uuid(), 'a1000000-0000-4000-8000-000000000001', 'gift', 2, 'tabl.')$$,
  '%stock_events_kind_values%', 'an unknown stock event kind is rejected');
select throws_like($$insert into public.stock_events (id, medication_id, kind, amount, unit) values (gen_random_uuid(), 'a1000000-0000-4000-8000-000000000001', 'refill', 0, 'tabl.')$$,
  '%stock_events_amount_positive%', 'a zero stock event amount is rejected');
select throws_like($$insert into public.stock_events (id, medication_id, kind, amount, unit, recorded_at, reversed_at) values (gen_random_uuid(), 'a1000000-0000-4000-8000-000000000001', 'refill', 1, 'tabl.', '2026-02-02', '2026-02-01')$$,
  '%stock_events_reversed_after_recorded%', 'reversal before the event is rejected');
select throws_ok($$insert into public.stock_events (id, medication_id, kind, amount, unit) values ('a5000000-0000-4000-8000-000000000009', 'a1000000-0000-4000-8000-000000000001', 'refill', 1, 'tabl.'), ('a5000000-0000-4000-8000-000000000009', 'a1000000-0000-4000-8000-000000000001', 'refill', 1, 'tabl.')$$,
  '23505', null, 'a double submit with the same client id is one row at most');

reset role;
select * from finish();
rollback;
