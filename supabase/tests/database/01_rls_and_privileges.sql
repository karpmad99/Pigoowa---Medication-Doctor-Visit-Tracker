-- DATABASE.md §6 (RLS enabled everywhere, no anonymous access, no hidden privileges).
begin;
select plan(30);

-- All six tables exist, in the public schema.
select tables_are('public', array[
  'appointments', 'dose_logs', 'medication_schedule_times', 'medications', 'profiles', 'stock_events'
], 'public contains exactly the Pigoowa tables');

-- The check that makes forgetting RLS on a future table fail: no public table may have it disabled.
create function pg_temp.tables_without_rls() returns bigint language sql as $$
  select count(*)
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity
$$;

select is(pg_temp.tables_without_rls(), 0::bigint, 'row level security is enabled on every public table');

-- The same check does fail when RLS is switched off (proof that the query above can detect it).
alter table public.appointments disable row level security;
select is(pg_temp.tables_without_rls(), 1::bigint, 'the check notices a table with RLS disabled');
alter table public.appointments enable row level security;
select is(pg_temp.tables_without_rls(), 0::bigint, 'and passes again once RLS is back on');

-- Every table has a policy for each command the application may use, and only for `authenticated`.
select is(
  (select count(*) from pg_policies where schemaname = 'public' and roles <> array['authenticated']::name[]),
  0::bigint,
  'every policy is for the authenticated role only (none for anon or public)'
);
select is(
  (select count(*) from pg_policies where schemaname = 'public' and cmd = 'ALL'),
  0::bigint,
  'no catch-all policy: each command has its own'
);
select is(
  (select count(distinct tablename) from pg_policies where schemaname = 'public'),
  6::bigint,
  'every table has policies'
);
select is(
  (select count(*) from pg_policies where schemaname = 'public' and cmd in ('SELECT', 'DELETE') and with_check is not null),
  0::bigint,
  'select/delete policies have no with check'
);
select is(
  (select count(*) from pg_policies
   where schemaname = 'public' and cmd in ('INSERT', 'UPDATE') and with_check is null),
  0::bigint,
  'insert/update policies all have a with check'
);

select policies_are('public', 'stock_events',
  array['stock_events_select', 'stock_events_insert', 'stock_events_update'],
  'stock_events has no delete policy');
select policies_are('public', 'profiles',
  array['profiles_select', 'profiles_insert', 'profiles_update'],
  'profiles has no delete policy (the row goes with the account)');

-- Privileges: anon has none on any table, authenticated only what the app needs.
select is(
  (select count(*) from information_schema.role_table_grants
   where table_schema = 'public' and grantee in ('anon', 'public', 'PUBLIC')),
  0::bigint,
  'anon and PUBLIC hold no table privileges'
);
select table_privs_are('public', 'medications', 'authenticated',
  array['SELECT', 'INSERT', 'UPDATE', 'DELETE'], 'authenticated: medications');
select table_privs_are('public', 'medication_schedule_times', 'authenticated',
  array['SELECT', 'INSERT', 'UPDATE', 'DELETE'], 'authenticated: medication_schedule_times');
select table_privs_are('public', 'dose_logs', 'authenticated',
  array['SELECT', 'INSERT', 'UPDATE', 'DELETE'], 'authenticated: dose_logs');
select table_privs_are('public', 'appointments', 'authenticated',
  array['SELECT', 'INSERT', 'UPDATE', 'DELETE'], 'authenticated: appointments');
select table_privs_are('public', 'stock_events', 'authenticated',
  array['SELECT', 'INSERT', 'UPDATE'], 'authenticated: stock_events (no delete)');
select table_privs_are('public', 'profiles', 'authenticated',
  array['SELECT', 'INSERT', 'UPDATE'], 'authenticated: profiles (no delete)');

-- No TRUNCATE, REFERENCES or TRIGGER for the API roles anywhere.
select is(
  (select count(*) from information_schema.role_table_grants
   where table_schema = 'public' and grantee = 'authenticated'
     and privilege_type in ('TRUNCATE', 'REFERENCES', 'TRIGGER')),
  0::bigint,
  'authenticated cannot truncate or add triggers'
);

-- The trigger functions are not callable through the API.
select ok(not has_function_privilege('authenticated', 'public.guard_stock_event_update()', 'execute'),
  'guard_stock_event_update() is not executable by authenticated');
select ok(not has_function_privilege('anon', 'public.guard_stock_event_update()', 'execute'),
  'guard_stock_event_update() is not executable by anon');
select ok(not has_function_privilege('authenticated', 'public.prevent_owner_change()', 'execute'),
  'prevent_owner_change() is not executable by authenticated');
select ok(not has_function_privilege('authenticated', 'public.check_dose_log_date()', 'execute'),
  'check_dose_log_date() is not executable by authenticated');

-- Every function in public pins its search_path (a mutable search_path is a classic privilege-escalation hole).
select is(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prokind = 'f'
     and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')),
  0::bigint,
  'every function in public has a fixed search_path'
);

-- No function in public is SECURITY DEFINER (nothing runs with elevated rights behind the policies).
select is(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosecdef),
  0::bigint,
  'no SECURITY DEFINER function in public'
);

-- Anonymous (signed-out) requests: no table can be read, written or deleted.
set local role anon;
select throws_ok('select count(*) from public.medications', '42501', null, 'anon cannot read medications');
select throws_ok('select count(*) from public.dose_logs', '42501', null, 'anon cannot read dose_logs');
select throws_ok('select count(*) from public.stock_events', '42501', null, 'anon cannot read stock_events');
select throws_ok($$insert into public.appointments (user_id, doctor_name, scheduled_at)
  values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Fictional', now())$$, '42501', null, 'anon cannot insert');
select throws_ok('delete from public.medications', '42501', null, 'anon cannot delete');
reset role;

select * from finish();
rollback;
