-- Personal workspace provisioning and agency workspace creation.
begin;
select plan(14);

select tests.remember('ana', tests.create_user('ana@example.test', 'Ana Lima'));
select tests.remember('unconfirmed', tests.create_user('pending@example.test', null, false));

-- Unconfirmed accounts never get tenant rows.
select tests.authenticate_as(tests.id('unconfirmed'));
select throws_ok('select public.ensure_personal_workspace()', '42501', null,
  'an unconfirmed user cannot provision a workspace');
select tests.clear_authentication();

select tests.authenticate_as(tests.id('ana'));
select tests.remember('ana_ws', public.ensure_personal_workspace());
select is(public.ensure_personal_workspace(), tests.id('ana_ws'), 'a second call returns the same workspace');
select is(public.ensure_personal_workspace(), tests.id('ana_ws'), 'a third call is still idempotent');
select is((select count(*)::int from public.workspaces), 1, 'the user sees exactly one workspace');
select tests.clear_authentication();

select is(
  (select count(*)::int from public.workspaces where created_by = tests.id('ana') and kind = 'personal'),
  1, 'exactly one personal workspace exists');
select is(
  (select count(*)::int from public.workspace_memberships
   where workspace_id = tests.id('ana_ws') and user_id = tests.id('ana') and role = 'owner' and status = 'active'),
  1, 'the user owns it through one active membership');
select is(
  (select display_name from public.user_accounts where id = tests.id('ana')),
  'Ana Lima', 'the account row keeps the sign-up display name');
select is(
  (select count(*)::int from public.audit_events where workspace_id = tests.id('ana_ws') and action = 'workspace.created'),
  1, 'workspace.created is recorded once despite repeated calls');

select tests.authenticate_anon();
select throws_ok('select public.ensure_personal_workspace()', '42501', null, 'anon cannot call the RPC');
select tests.clear_authentication();

-- Agency workspaces
select tests.authenticate_as(tests.id('ana'));
select tests.remember('agency_1', public.create_agency_workspace('Agência Aurora'));
select is(
  (select role::text from public.workspace_memberships where workspace_id = tests.id('agency_1')),
  'owner', 'the creator owns the new agency workspace');
select is((select kind::text from public.workspaces where id = tests.id('agency_1')), 'agency', 'kind is agency');
select throws_ok($$ select public.create_agency_workspace('A') $$, '23514', null, 'a one-letter name is rejected');
select public.create_agency_workspace('Agência 2');
select public.create_agency_workspace('Agência 3');
select throws_ok($$ select public.create_agency_workspace('Agência 4') $$, 'LK050', null,
  'a user cannot own more than three live agency workspaces');
select is((select count(*)::int from public.workspaces), 4, 'personal + three agency workspaces are visible');
select tests.clear_authentication();

select * from finish();
rollback;
