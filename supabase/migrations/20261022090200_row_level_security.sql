-- Pigoowa: Row Level Security and privileges (docs/DATABASE.md §6).
--
-- RLS is enabled on EVERY table. The policies are for the role `authenticated` only: `anon` has no policy and
-- no privilege, so a signed-out client reads and writes nothing. The API (PostgREST) runs every request as
-- `anon` or `authenticated`, and RLS is evaluated by the database, so hiding a screen is never the protection.
-- No privileged (service_role) key is used by the application; only the public URL and the anon key are.
--
-- `(select auth.uid())` lets Postgres evaluate the user once per query instead of once per row.
-- The table owner bypasses RLS: the foreign-key cascades (deleting a medication or an account) rely on it.

alter table public.profiles enable row level security;
alter table public.medications enable row level security;
alter table public.medication_schedule_times enable row level security;
alter table public.dose_logs enable row level security;
alter table public.appointments enable row level security;
alter table public.stock_events enable row level security;

-- Privileges: nothing for anon; what authenticated needs, and not more. Supabase grants everything on new
-- tables to anon and authenticated by default, so it is taken back explicitly first.
revoke all on table
  public.profiles,
  public.medications,
  public.medication_schedule_times,
  public.dose_logs,
  public.appointments,
  public.stock_events
from anon, authenticated;

grant select, insert, update on public.profiles to authenticated;
grant select, insert, update, delete on public.medications to authenticated;
grant select, insert, update, delete on public.medication_schedule_times to authenticated;
grant select, insert, update, delete on public.dose_logs to authenticated;
grant select, insert, update, delete on public.appointments to authenticated;
-- A stock event is appended and reversed, never deleted by a user.
grant select, insert, update on public.stock_events to authenticated;

-- profiles: the row of the account itself (created by a trigger on signing up, in stage 11). There is no
-- delete: an account is erased through auth.users, which cascades to everything below it.
create policy profiles_select on public.profiles
  for select to authenticated using ((select auth.uid()) = id);
create policy profiles_insert on public.profiles
  for insert to authenticated with check ((select auth.uid()) = id);
create policy profiles_update on public.profiles
  for update to authenticated
  using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

-- medications
create policy medications_select on public.medications
  for select to authenticated using ((select auth.uid()) = user_id);
create policy medications_insert on public.medications
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy medications_update on public.medications
  for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy medications_delete on public.medications
  for delete to authenticated using ((select auth.uid()) = user_id);

-- medication_schedule_times
create policy medication_schedule_times_select on public.medication_schedule_times
  for select to authenticated using ((select auth.uid()) = user_id);
create policy medication_schedule_times_insert on public.medication_schedule_times
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy medication_schedule_times_update on public.medication_schedule_times
  for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy medication_schedule_times_delete on public.medication_schedule_times
  for delete to authenticated using ((select auth.uid()) = user_id);

-- dose_logs
create policy dose_logs_select on public.dose_logs
  for select to authenticated using ((select auth.uid()) = user_id);
create policy dose_logs_insert on public.dose_logs
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy dose_logs_update on public.dose_logs
  for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy dose_logs_delete on public.dose_logs
  for delete to authenticated using ((select auth.uid()) = user_id);

-- appointments
create policy appointments_select on public.appointments
  for select to authenticated using ((select auth.uid()) = user_id);
create policy appointments_insert on public.appointments
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy appointments_update on public.appointments
  for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy appointments_delete on public.appointments
  for delete to authenticated using ((select auth.uid()) = user_id);

-- stock_events: no delete policy (and no delete privilege).
create policy stock_events_select on public.stock_events
  for select to authenticated using ((select auth.uid()) = user_id);
create policy stock_events_insert on public.stock_events
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy stock_events_update on public.stock_events
  for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
