-- Stage 11: the application hands the repositories its own timestamps (PROJECT_SPEC DEC-20: callers supply
-- ids and timestamps, the clock is injected), and the shared repository contract requires that what is stored
-- is exactly what was given, so that the local and the Supabase implementation behave the same. The trigger of
-- 20261022090100 overwrote updated_at with now() on EVERY update, so a repository could not store the
-- application's value.
--
-- updated_at is informational: it drives no access rule and no calculation, and it belongs to the row's own
-- user. The column keeps its default (now()) for an insert that does not send it; an update changes it only
-- when the client sends a new value. The triggers and their function are removed.

drop trigger medications_set_updated_at on public.medications;
drop trigger appointments_set_updated_at on public.appointments;
drop function public.set_updated_at();
