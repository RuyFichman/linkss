-- Structural guarantees: RLS everywhere, no anon privileges, hardened functions, seeded catalogue.
begin;
select plan(44);

select has_table('public', 'user_accounts', 'user_accounts exists');
select has_table('public', 'workspaces', 'workspaces exists');
select has_table('public', 'workspace_memberships', 'workspace_memberships exists');
select has_table('public', 'profiles', 'profiles exists');
select has_table('public', 'plans', 'plans exists');
select has_table('public', 'plan_entitlements', 'plan_entitlements exists');
select has_table('public', 'reserved_slugs', 'reserved_slugs exists');
select has_table('public', 'slug_history', 'slug_history exists');
select has_table('public', 'audit_events', 'audit_events exists');
select has_table('public', 'profile_publications', 'profile_publications exists');
select has_table('public', 'media_assets', 'media_assets exists');
select has_table('public', 'form_leads', 'form_leads exists');
select has_table('public', 'form_submission_hits', 'form_submission_hits exists');
select has_table('public', 'analytics_events', 'analytics_events exists');
select has_table('public', 'analytics_daily', 'analytics_daily exists');
select has_table('public', 'analytics_day_status', 'analytics_day_status exists');
select has_table('public', 'analytics_settings', 'analytics_settings exists');
select has_table('public', 'analytics_rate_hits', 'analytics_rate_hits exists');
select has_table('public', 'workspace_invitations', 'workspace_invitations exists');
select has_table('public', 'media_asset_shares', 'media_asset_shares exists');
select has_table('public', 'report_links', 'report_links exists');
select has_table('public', 'report_lookup_failures', 'report_lookup_failures exists');
select has_table('public', 'plan_prices', 'plan_prices exists');
select has_table('public', 'billing_customers', 'billing_customers exists');
select has_table('public', 'billing_subscriptions', 'billing_subscriptions exists');
select has_table('public', 'billing_events', 'billing_events exists');
select has_table('public', 'billing_invoices', 'billing_invoices exists');

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
     'check_slug_availability', 'change_profile_slug', 'soft_delete_profile',
     'publish_profile', 'restore_profile_publication', 'unpublish_profile',
     'register_media_asset', 'activate_media_asset', 'fail_media_asset', 'workspace_storage_usage',
     'claim_media_cleanup', 'finish_media_cleanup', 'delete_form_lead', 'record_lead_export',
     'run_analytics_maintenance', 'get_profile_analytics', 'record_analytics_export',
     'archive_profile', 'unarchive_profile', 'duplicate_profile', 'list_workspace_profiles',
     'create_workspace_invitation', 'revoke_workspace_invitation', 'get_workspace_invitation',
     'accept_workspace_invitation', 'list_workspace_members',
     'begin_billing_checkout', 'register_billing_customer', 'begin_billing_change', 'run_billing_maintenance')
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
  (select array_agg(p.proname::text order by p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'private') and has_function_privilege('anon', p.oid, 'execute')),
  array['apply_billing_snapshot', 'get_public_page', 'get_shared_report', 'ingest_analytics_events', 'submit_form_lead'],
  'anon can execute only the public page lookup, the shared report read, the form submission and the two attested writes (analytics events, billing snapshots)'
);

select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'get_public_page' and p.prosecdef and p.provolatile = 's'),
  1,
  'get_public_page is a stable security definer function (read-only)'
);

select is(
  (select int_value from public.plan_entitlements where plan_id = 'free' and key = 'max_profiles'),
  1,
  'Free plan allows exactly one page'
);

select is(
  (select count(*)::int from public.plan_entitlements),
  21,
  'three plans with seven typed entitlements each are seeded'
);

select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('claim_media_cleanup', 'finish_media_cleanup')
     and (has_function_privilege('authenticated', p.oid, 'execute') or not has_function_privilege('service_role', p.oid, 'execute'))),
  0,
  'media cleanup is executable by the service role only'
);

select is(
  (select count(*)::int from information_schema.role_table_grants
   where grantee = 'authenticated' and table_schema = 'public' and table_name in ('media_assets', 'form_leads', 'form_submission_hits')
     and privilege_type <> 'SELECT'),
  0,
  'members cannot write media or lead tables directly'
);

select is(
  (select count(*)::int from pg_policies where schemaname = 'public' and tablename like 'analytics_%'),
  0,
  'analytics tables have no policies: they are reached only through functions'
);

select is(
  (select count(*)::int from information_schema.role_table_grants
   where grantee = 'authenticated' and table_schema = 'public' and table_name in ('workspace_invitations', 'media_asset_shares')
     and privilege_type <> 'SELECT'),
  0,
  'members cannot write invitations or media shares directly'
);

select is(
  (select count(*)::int from information_schema.column_privileges
   where grantee in ('authenticated', 'anon') and table_schema = 'public' and table_name = 'workspace_invitations' and column_name = 'token_hash'),
  0,
  'no client role can read an invitation token hash'
);

select is(
  (select count(*)::int from information_schema.role_table_grants
   where grantee = 'authenticated' and table_schema = 'public' and table_name in ('report_links', 'report_lookup_failures')
     and privilege_type <> 'SELECT'),
  0,
  'members cannot write report links or their lookup counters directly'
);

select is(
  (select count(*)::int from information_schema.column_privileges
   where grantee in ('authenticated', 'anon') and table_schema = 'public' and table_name = 'report_links' and column_name = 'token_hash'),
  0,
  'no client role can read a report token hash'
);

select * from finish();
rollback;
