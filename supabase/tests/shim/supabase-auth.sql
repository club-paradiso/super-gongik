-- LOCAL TESTS ONLY. Never apply this to a Supabase project: Supabase already
-- provides these roles, the auth schema and auth.uid().
--
-- A minimal stand-in for what Supabase provides, so the migrations and their
-- RLS policies can be tested against a plain PostgreSQL 15+ server (CI or a
-- laptop) without Docker. auth.uid() reads the JWT claims exactly as
-- Supabase's own definition does.

set client_min_messages = warning;

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
  if not exists (select from pg_roles where rolname = 'authenticator') then
    create role authenticator login noinherit password 'authenticator';
  end if;
end;
$$;

grant anon, authenticated, service_role to authenticator;

create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key,
  email text
);

create or replace function auth.uid() returns uuid
language sql stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
