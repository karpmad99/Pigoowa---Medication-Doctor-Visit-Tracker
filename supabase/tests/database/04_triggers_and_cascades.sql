-- DATABASE.md §6: triggers (stock-event ledger, time zone, updated_at) and what happens on deletion.
begin;
select plan(27);

insert into auth.users (id, email) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'alice@example.invalid'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'bob@example.invalid');
insert into public.profiles (id, display_name) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Alice'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Bob');
insert into public.medications (id, user_id, name, dose_unit, start_date, schedule_effective_from, updated_at) values
  ('a1000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Alice med', 'tabl.', '2026-01-01', '2026-01-01', '2000-01-01'),
  ('b1000000-0000-4000-8000-000000000001', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Bob med', 'tabl.', '2026-01-01', '2026-01-01', '2000-01-01');
insert into public.medication_schedule_times (user_id, medication_id, time_of_day, dose_amount) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a1000000-0000-4000-8000-000000000001', '08:00', 1);
insert into public.dose_logs (user_id, medication_id, scheduled_date, scheduled_time, status, dose_amount, dose_unit) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a1000000-0000-4000-8000-000000000001', '2026-01-05', '08:00', 'taken', 1, 'tabl.');
insert into public.stock_events (id, user_id, medication_id, kind, amount, unit, recorded_at) values
  ('a5000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a1000000-0000-4000-8000-000000000001', 'refill', 30, 'tabl.', '2026-01-02'),
  ('a5000000-0000-4000-8000-000000000002', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a1000000-0000-4000-8000-000000000001', 'waste', 2, 'tabl.', '2026-01-03'),
  ('a5000000-0000-4000-8000-000000000003', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a1000000-0000-4000-8000-000000000001', 'refill', 5, 'tabl.', '2026-01-04');

-- ----- composite foreign key holds even for the table owner (a server-side path can't cross accounts either) -----
select throws_ok($$insert into public.medication_schedule_times (user_id, medication_id, time_of_day, dose_amount)
  values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'a1000000-0000-4000-8000-000000000001', '12:00', 1)$$,
  '23503', null, 'a child row cannot carry another user_id than its medication');
select throws_ok($$update public.dose_logs set user_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'$$,
  '23514', null, 'a dose log cannot change owner (even as the table owner)');

-- ----- updated_at belongs to the client (the application's clock): what it sends is what is stored -----
update public.medications set name = 'Alice med v2', updated_at = '2001-02-03T04:05:06Z' where id = 'a1000000-0000-4000-8000-000000000001';
select is((select updated_at from public.medications where id = 'a1000000-0000-4000-8000-000000000001'), '2001-02-03T04:05:06Z'::timestamptz,
  'a new updated_at sent by the owner is kept');
update public.medications set name = 'Alice med v3' where id = 'a1000000-0000-4000-8000-000000000001';
select is((select updated_at from public.medications where id = 'a1000000-0000-4000-8000-000000000001'), '2001-02-03T04:05:06Z'::timestamptz,
  'an update that does not send updated_at leaves it as it was');

-- ----- stock-event guard -----
set local role authenticated;
set local request.jwt.claim.sub = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

select lives_ok($$update public.stock_events set reversed_at = now() where id = 'a5000000-0000-4000-8000-000000000001'$$,
  'an event can be reversed once');
select throws_ok($$update public.stock_events set reversed_at = now() + interval '1 second' where id = 'a5000000-0000-4000-8000-000000000001'$$,
  '23514', 'a reversed stock event cannot be changed', 'a reversal cannot be moved');
select throws_ok($$update public.stock_events set reversed_at = null where id = 'a5000000-0000-4000-8000-000000000001'$$,
  '23514', 'a reversed stock event cannot be changed', 'a reversal cannot be undone');
select lives_ok($$update public.stock_events set reversed_at = reversed_at where id = 'a5000000-0000-4000-8000-000000000001'$$,
  'repeating the very same update changes nothing and is accepted');
select throws_ok($$update public.stock_events set amount = 1 where id = 'a5000000-0000-4000-8000-000000000002'$$,
  '23514', 'only reversed_at of a stock event can be set', 'the amount of an event cannot be edited');
select throws_ok($$update public.stock_events set kind = 'refill', reversed_at = now() where id = 'a5000000-0000-4000-8000-000000000002'$$,
  '23514', 'only reversed_at of a stock event can be set', 'kind cannot change together with a reversal');
select throws_ok($$update public.stock_events set note = 'later' where id = 'a5000000-0000-4000-8000-000000000002'$$,
  '23514', 'only reversed_at of a stock event can be set', 'the note of an event cannot be edited');
select throws_ok($$update public.stock_events set recorded_at = '2020-01-01' where id = 'a5000000-0000-4000-8000-000000000002'$$,
  '23514', 'only reversed_at of a stock event can be set', 'an event cannot be back-dated');
select throws_ok($$delete from public.stock_events where id = 'a5000000-0000-4000-8000-000000000003'$$,
  '42501', null, 'a stock event cannot be deleted through the API');

-- ----- profile -----
select lives_ok($$update public.profiles set time_zone = 'Europe/London' where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'$$, 'a real IANA time zone is accepted');
select throws_ok($$update public.profiles set time_zone = 'Mars/Olympus' where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'$$,
  '23514', 'time_zone is not a known IANA time zone', 'an unknown time zone is rejected');
select throws_like($$update public.profiles set display_name = repeat('a', 81) where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'$$,
  '%profiles_display_name_length%', 'a display name over 80 characters is rejected');
select throws_ok($$delete from public.profiles where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'$$,
  '42501', null, 'the profile cannot be deleted through the API');
reset role;

-- ----- the history survives a schedule change (no foreign key from dose_logs to the schedule) -----
delete from public.medication_schedule_times where medication_id = 'a1000000-0000-4000-8000-000000000001';
select is((select count(*) from public.dose_logs where medication_id = 'a1000000-0000-4000-8000-000000000001'), 1::bigint,
  'removing a schedule time keeps the dose history');

-- ----- deleting a medication removes its children, and only its children -----
set local role authenticated;
set local request.jwt.claim.sub = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
select lives_ok($$delete from public.medications where id = 'a1000000-0000-4000-8000-000000000001'$$,
  'a user can delete her medication, including its stock events');
reset role;
select is((select count(*) from public.dose_logs where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), 0::bigint, 'its dose logs went with it');
select is((select count(*) from public.stock_events where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), 0::bigint, 'its stock events went with it');
select is((select count(*) from public.medications where user_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'), 1::bigint, 'the other account''s medication is untouched');

-- ----- deleting an account removes all of its data (and only its data) -----
insert into public.appointments (user_id, doctor_name, scheduled_at) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Alice doctor', now()),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Bob doctor', now());
insert into public.medications (user_id, name, dose_unit, start_date, schedule_effective_from) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Another', 'u', '2026-01-01', '2026-01-01');
delete from auth.users where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
select is((select count(*) from public.profiles where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), 0::bigint, 'the profile is gone with the account');
select is((select count(*) from public.medications where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), 0::bigint, 'the medications are gone with the account');
select is((select count(*) from public.appointments where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), 0::bigint, 'the appointments are gone with the account');
select is((select count(*) from public.appointments where user_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'), 1::bigint, 'the other account''s appointment is untouched');
select is((select count(*) from public.profiles), 1::bigint, 'one profile remains');

select * from finish();
rollback;
