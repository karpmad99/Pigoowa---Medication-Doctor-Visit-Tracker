-- DATABASE.md §6 (two accounts): one account can neither see nor change nor attach anything to the other's data.
-- Alice = aaaaaaaa-…, Bob = bbbbbbbb-…. Fictional data only.
begin;
select plan(34);

-- Fixture, written as the table owner (bypasses RLS), the way a restore would.
insert into auth.users (id, email) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'alice@example.invalid'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'bob@example.invalid');
insert into public.profiles (id, display_name) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Alice'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Bob');
insert into public.medications (id, user_id, name, dose_unit, start_date, schedule_effective_from) values
  ('a1000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Alice med', 'tabl.', '2026-01-01', '2026-01-01'),
  ('b1000000-0000-4000-8000-000000000001', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Bob med', 'tabl.', '2026-01-01', '2026-01-01');
insert into public.medication_schedule_times (id, user_id, medication_id, time_of_day, dose_amount) values
  ('a2000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a1000000-0000-4000-8000-000000000001', '08:00', 1),
  ('b2000000-0000-4000-8000-000000000001', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'b1000000-0000-4000-8000-000000000001', '08:00', 1);
insert into public.dose_logs (id, user_id, medication_id, scheduled_date, scheduled_time, status, dose_amount, dose_unit) values
  ('a3000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a1000000-0000-4000-8000-000000000001', '2026-01-05', '08:00', 'taken', 1, 'tabl.'),
  ('b3000000-0000-4000-8000-000000000001', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'b1000000-0000-4000-8000-000000000001', '2026-01-05', '08:00', 'taken', 1, 'tabl.');
insert into public.appointments (id, user_id, doctor_name, scheduled_at) values
  ('a4000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Alice doctor', '2026-02-01 10:00+00'),
  ('b4000000-0000-4000-8000-000000000001', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Bob doctor', '2026-02-01 10:00+00');
insert into public.stock_events (id, user_id, medication_id, kind, amount, unit) values
  ('a5000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a1000000-0000-4000-8000-000000000001', 'refill', 30, 'tabl.'),
  ('b5000000-0000-4000-8000-000000000001', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'b1000000-0000-4000-8000-000000000001', 'refill', 30, 'tabl.');

-- ===== signed in as Alice =====
set local role authenticated;
set local request.jwt.claim.sub = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

-- Reading
select is((select count(*) from public.profiles), 1::bigint, 'alice sees only her profile');
select is((select count(*) from public.medications), 1::bigint, 'alice sees only her medication');
select is((select count(*) from public.medication_schedule_times), 1::bigint, 'alice sees only her schedule times');
select is((select count(*) from public.dose_logs), 1::bigint, 'alice sees only her dose logs');
select is((select count(*) from public.appointments), 1::bigint, 'alice sees only her appointments');
select is((select count(*) from public.stock_events), 1::bigint, 'alice sees only her stock events');
select is(
  (select count(*) from public.medications where id = 'b1000000-0000-4000-8000-000000000001'),
  0::bigint, 'bob''s medication is invisible even when asked for by id'
);

-- Writing rows that belong to Bob (RLS "with check")
select throws_ok($$insert into public.medications (user_id, name, dose_unit, start_date, schedule_effective_from)
  values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'x', 'u', '2026-01-01', '2026-01-01')$$,
  '42501', null, 'alice cannot insert a medication for bob');
select throws_ok($$insert into public.appointments (user_id, doctor_name, scheduled_at)
  values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'x', now())$$,
  '42501', null, 'alice cannot insert an appointment for bob');
select throws_ok($$insert into public.profiles (id) values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')$$,
  '42501', null, 'alice cannot insert a profile for bob');
select throws_ok($$insert into public.dose_logs (user_id, medication_id, scheduled_date, scheduled_time, status, dose_amount, dose_unit)
  values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'b1000000-0000-4000-8000-000000000001', '2026-01-06', '08:00', 'taken', 1, 'tabl.')$$,
  '42501', null, 'alice cannot log a dose for bob');
select throws_ok($$insert into public.stock_events (id, user_id, medication_id, kind, amount, unit)
  values (gen_random_uuid(), 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'b1000000-0000-4000-8000-000000000001', 'refill', 1, 'tabl.')$$,
  '42501', null, 'alice cannot add a stock event for bob');

-- Attaching her own rows to Bob's medication (the composite foreign key)
select throws_ok($$insert into public.medication_schedule_times (user_id, medication_id, time_of_day, dose_amount)
  values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'b1000000-0000-4000-8000-000000000001', '12:00', 1)$$,
  '23503', null, 'alice cannot attach a schedule time to bob''s medication');
select throws_ok($$insert into public.dose_logs (user_id, medication_id, scheduled_date, scheduled_time, status, dose_amount, dose_unit)
  values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'b1000000-0000-4000-8000-000000000001', '2026-01-06', '08:00', 'taken', 1, 'tabl.')$$,
  '23503', null, 'alice cannot log a dose against bob''s medication');
select throws_ok($$insert into public.stock_events (id, user_id, medication_id, kind, amount, unit)
  values (gen_random_uuid(), 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'b1000000-0000-4000-8000-000000000001', 'refill', 1, 'tabl.')$$,
  '23503', null, 'alice cannot add a stock event to bob''s medication');

-- Re-assigning her own rows to Bob
select throws_ok($$update public.medications set user_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  where id = 'a1000000-0000-4000-8000-000000000001'$$, '23514', null, 'alice cannot hand her medication to bob');
select throws_ok($$update public.appointments set user_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  where id = 'a4000000-0000-4000-8000-000000000001'$$, '23514', null, 'alice cannot hand her appointment to bob');
select throws_ok($$update public.stock_events set user_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  where id = 'a5000000-0000-4000-8000-000000000001'$$, '23514', null, 'alice cannot hand her stock event to bob');
select throws_ok($$update public.profiles set id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
  where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'$$, '23514', null, 'alice cannot change her profile id');

-- Updating / deleting Bob's rows: no error (RLS just hides them) and no effect.
update public.medications set name = 'hacked' where id = 'b1000000-0000-4000-8000-000000000001';
update public.medication_schedule_times set dose_amount = 99 where id = 'b2000000-0000-4000-8000-000000000001';
update public.dose_logs set status = 'skipped' where id = 'b3000000-0000-4000-8000-000000000001';
update public.appointments set doctor_name = 'hacked' where id = 'b4000000-0000-4000-8000-000000000001';
update public.stock_events set reversed_at = now() where id = 'b5000000-0000-4000-8000-000000000001';
update public.profiles set display_name = 'hacked' where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
delete from public.medications where id = 'b1000000-0000-4000-8000-000000000001';
delete from public.medication_schedule_times where id = 'b2000000-0000-4000-8000-000000000001';
delete from public.dose_logs where id = 'b3000000-0000-4000-8000-000000000001';
delete from public.appointments where id = 'b4000000-0000-4000-8000-000000000001';
-- A blanket delete touches only Alice's own rows.
select throws_ok('delete from public.stock_events', '42501', null, 'nobody can delete stock events through the API');

-- Alice can still manage her own data.
select lives_ok($$update public.medications set name = 'Alice med v2' where id = 'a1000000-0000-4000-8000-000000000001'$$,
  'alice can update her medication');
select lives_ok($$update public.stock_events set reversed_at = now() where id = 'a5000000-0000-4000-8000-000000000001'$$,
  'alice can reverse her stock event');
select lives_ok($$insert into public.appointments (doctor_name, scheduled_at) values ('Alice doctor 2', now())$$,
  'user_id defaults to auth.uid() on insert');
select is((select count(*) from public.appointments where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), 2::bigint,
  'the defaulted row is hers');
select lives_ok($$delete from public.appointments where doctor_name = 'Alice doctor 2'$$, 'alice can delete her appointment');

-- ===== back as the owner: Bob's data is untouched =====
reset role;
select is((select name from public.medications where id = 'b1000000-0000-4000-8000-000000000001'), 'Bob med', 'bob''s medication is unchanged');
select is((select dose_amount from public.medication_schedule_times where id = 'b2000000-0000-4000-8000-000000000001'), 1::numeric, 'bob''s schedule time is unchanged');
select is((select status from public.dose_logs where id = 'b3000000-0000-4000-8000-000000000001'), 'taken', 'bob''s dose log is unchanged');
select is((select doctor_name from public.appointments where id = 'b4000000-0000-4000-8000-000000000001'), 'Bob doctor', 'bob''s appointment is unchanged');
select is((select reversed_at from public.stock_events where id = 'b5000000-0000-4000-8000-000000000001'), null, 'bob''s stock event is unchanged');
select is((select display_name from public.profiles where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'), 'Bob', 'bob''s profile is unchanged');
select is((select count(*) from public.stock_events where user_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'), 1::bigint, 'bob''s stock event still exists');

-- ===== signed in with no usable identity (no sub claim): nothing is visible or writable =====
set local role authenticated;
set local request.jwt.claim.sub = '';
select is((select count(*) from public.medications), 0::bigint, 'an identity-less session sees no medications');
select throws_ok($$insert into public.appointments (doctor_name, scheduled_at) values ('x', now())$$,
  null, null, 'an identity-less session cannot insert (no owner can be set)');
reset role;

select * from finish();
rollback;
