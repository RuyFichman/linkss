-- Structural guarantees: RLS everywhere, no anon privileges, hardened functions, seeded catalogue.
begin;
select plan(17);

select has_table('public', 'user_accounts', 'user_accounts exists');
select has_table('public', 'workspaces', 'workspaces exists');
select has_table('public', 'workspace_memberships', 'workspace_memberships exists');
select has_table('public', 'profiles', 'profiles exists');
select has_table('public', 'plans', 'plans exists');
select has_table('public', 'plan_entitlements', 'plan_entitlements exists');
select has_table('public', 'reserved_slugs', 'reserved_slugs exists');
select has_table('public', 'slug_history', 'slug_history exists');
select has_table('public', 'audit_events', 'audit_events exists');

select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity),
  0,
  'every table in public has RLS enabled'
);

select is(
  (select count(*)::int from information_schema.role_table_grants
   where grantee = 'anon' and table_schema = 'public'),
  0,
  'anon holds no table privilege in public'
);

select is(
  (select count(*)::int from information_schema.role_column_grants
   where grantee = 'anon' and table_schema = 'public'),
  0,
  'anon holds no column privilege in public'
);

select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'private') and p.prosecdef
     and not coalesce(p.proconfig::text[] @> array['search_path=""'], false)),
  0,
  'every security definer function pins an empty search_path'
);

select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in (
     'ensure_personal_workspace', 'create_agency_workspace', 'soft_delete_workspace',
     'change_member_role', 'remove_workspace_member', 'record_auth_event',
     'check_slug_availability', 'change_profile_slug', 'soft_delete_profile')
     and has_function_privilege('anon', p.oid, 'execute')),
  0,
  'anon cannot execute any tenancy RPC'
);

select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'private'
     and p.proname not in ('member_workspace_ids', 'writable_workspace_ids', 'workspace_ids_with_role')
     and has_function_privilege('authenticated', p.oid, 'execute')),
  0,
  'authenticated can execute only the three RLS helper functions in private'
);

select is(
  (select int_value from public.plan_entitlements where plan_id = 'free' and key = 'max_profiles'),
  1,
  'Free plan allows exactly one page'
);

select is(
  (select count(*)::int from public.plan_entitlements),
  18,
  'three plans with six typed entitlements each are seeded'
);

select * from finish();
rollback;
