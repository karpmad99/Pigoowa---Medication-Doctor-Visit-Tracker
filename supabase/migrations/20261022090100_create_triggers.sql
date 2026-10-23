-- Pigoowa: triggers (docs/DATABASE.md §3, §6, §8). Every function pins its search_path, so it cannot be
-- redirected to another schema, and none is callable by the API roles (the triggers fire regardless).

-- updated_at is maintained by the database, not trusted from the client.
create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger medications_set_updated_at
  before update on public.medications
  for each row execute function public.set_updated_at();

create trigger appointments_set_updated_at
  before update on public.appointments
  for each row execute function public.set_updated_at();

-- A row never changes owner. (RLS "with check" stops a user from writing another user's id; this stops a
-- user from re-assigning their own row to somebody else's.)
create function public.prevent_owner_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.user_id is distinct from old.user_id then
    raise exception 'user_id cannot be changed' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger medications_prevent_owner_change
  before update on public.medications
  for each row execute function public.prevent_owner_change();
create trigger medication_schedule_times_prevent_owner_change
  before update on public.medication_schedule_times
  for each row execute function public.prevent_owner_change();
create trigger dose_logs_prevent_owner_change
  before update on public.dose_logs
  for each row execute function public.prevent_owner_change();
create trigger appointments_prevent_owner_change
  before update on public.appointments
  for each row execute function public.prevent_owner_change();
create trigger stock_events_prevent_owner_change
  before update on public.stock_events
  for each row execute function public.prevent_owner_change();

create function public.prevent_profile_id_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id then
    raise exception 'id cannot be changed' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger profiles_prevent_id_change
  before update on public.profiles
  for each row execute function public.prevent_profile_id_change();

-- The time zone is an IANA name the database knows (decision of stage 10; it was an open question).
create function public.validate_profile_time_zone()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = new.time_zone) then
    raise exception 'time_zone is not a known IANA time zone' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger profiles_validate_time_zone
  before insert or update of time_zone on public.profiles
  for each row execute function public.validate_profile_time_zone();

-- A coarse sanity check on the slot date of a dose record: not more than one day after today in UTC (the
-- user's own "today" is decided in the application, and no time zone is more than 14 hours ahead of UTC).
-- It is a trigger and not a CHECK because it depends on now(); it is not re-run when other columns change.
create function public.check_dose_log_date()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.scheduled_date > ((now() at time zone 'UTC')::date + 1) then
    raise exception 'scheduled_date is too far in the future' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger dose_logs_check_date
  before insert or update of scheduled_date on public.dose_logs
  for each row execute function public.check_dose_log_date();

-- A stock event is a fact: after it is inserted, only reversed_at may change, once (decision of stage 10; it
-- was an open question). Repeating the very same update is accepted and changes nothing. Events are not
-- deleted by users at all (there is no delete policy); they go only with their medication or account.
create function public.guard_stock_event_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new is not distinct from old then
    return new;
  end if;
  if old.reversed_at is not null then
    raise exception 'a reversed stock event cannot be changed' using errcode = '23514';
  end if;
  if new.reversed_at is null
     or (new.id, new.user_id, new.medication_id, new.kind, new.amount, new.unit, new.recorded_at, new.note)
        is distinct from
        (old.id, old.user_id, old.medication_id, old.kind, old.amount, old.unit, old.recorded_at, old.note) then
    raise exception 'only reversed_at of a stock event can be set' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger stock_events_guard_update
  before update on public.stock_events
  for each row execute function public.guard_stock_event_update();

-- The trigger functions are not part of the API.
revoke all on function public.set_updated_at() from public, anon, authenticated;
revoke all on function public.prevent_owner_change() from public, anon, authenticated;
revoke all on function public.prevent_profile_id_change() from public, anon, authenticated;
revoke all on function public.validate_profile_time_zone() from public, anon, authenticated;
revoke all on function public.check_dose_log_date() from public, anon, authenticated;
revoke all on function public.guard_stock_event_update() from public, anon, authenticated;
