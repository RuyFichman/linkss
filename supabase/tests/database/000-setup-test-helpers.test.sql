-- Test helpers shared by every pgTAP file (ADR 0006). This file COMMITS so the `tests` schema is
-- available to later files; it is not a migration and exists only in local/CI databases.
begin;
select plan(1);

create schema if not exists tests;
grant usage on schema tests to anon, authenticated, service_role;

-- Creates an auth user directly, as the Auth server would after sign-up.
create or replace function tests.create_user(
  p_email text,
  p_display_name text default null,
  p_confirmed boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := gen_random_uuid();
begin
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change
  ) values (
    '00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated', p_email, '',
    case when p_confirmed then now() end,
    '{"provider":"email","providers":["email"]}'::jsonb,
    case when p_display_name is null then '{}'::jsonb else jsonb_build_object('display_name', p_display_name) end,
    now(), now(), '', '', '', ''
  );
  return v_id;
end;
$$;

-- Simulates a PostgREST request from a signed-in user (role + JWT claims, transaction-local).
create or replace function tests.authenticate_as(p_user_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user_id, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

create or replace function tests.authenticate_anon()
returns void
language plpgsql
set search_path = ''
as $$
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  perform set_config('role', 'anon', true);
end;
$$;

create or replace function tests.authenticate_service()
returns void
language plpgsql
set search_path = ''
as $$
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  perform set_config('role', 'service_role', true);
end;
$$;

-- Back to the test runner's own role (postgres).
create or replace function tests.clear_authentication()
returns void
language plpgsql
set search_path = ''
as $$
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('role', 'postgres', true);
end;
$$;

-- Named fixtures stored in transaction-local settings so any role can read them.
create or replace function tests.remember(p_name text, p_id uuid)
returns uuid
language sql
set search_path = ''
as $$ select set_config('tests.' || p_name, p_id::text, true)::uuid $$;

create or replace function tests.id(p_name text)
returns uuid
language sql
stable
set search_path = ''
as $$ select current_setting('tests.' || p_name)::uuid $$;

grant execute on all functions in schema tests to anon, authenticated, service_role;

select ok(to_regnamespace('tests') is not null, 'test helper schema is installed');
select * from finish();
commit;
