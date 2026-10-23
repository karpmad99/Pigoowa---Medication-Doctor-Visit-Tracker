-- Minimal emulation of the parts of a Supabase project that the Pigoowa
-- migrations rely on, so the schema can be exercised on a plain PostgreSQL
-- server (no Docker, no Supabase CLI).
--
-- THIS IS NOT SUPABASE. It reproduces: the anon / authenticated / service_role
-- roles, the auth.users table, auth.uid() (reads the request.jwt.claim.sub GUC,
-- like PostgREST does), the `extensions` schema, and Supabase's default
-- privileges on the public schema (everything granted to the API roles, which
-- the migrations then narrow down). The authoritative check remains
-- `supabase db reset` + `supabase test db` against the real local stack.

do $$
begin
  if not exists (select from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end
$$;

create schema if not exists extensions;
create schema if not exists auth;

create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique
);

create function auth.uid() returns uuid
  language sql stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

grant usage on schema public, extensions, auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
grant select on auth.users to service_role;

alter default privileges in schema public
  grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on functions to anon, authenticated, service_role;
