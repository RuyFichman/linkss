-- AC1: a user cannot read or change another workspace's data by forging identifiers.
begin;
select plan(35);

select tests.remember('ana', tests.create_user('ana@example.test', 'Ana'));
select tests.remember('bia', tests.create_user('bia@example.test', 'Bia'));

select tests.authenticate_as(tests.id('ana'));
select tests.remember('ws_a', public.ensure_personal_workspace());
insert into public.profiles (workspace_id, title, slug) values (tests.id('ws_a'), 'Página da Ana', 'ana-lima');
select tests.clear_authentication();

select tests.authenticate_as(tests.id('bia'));
select tests.remember('ws_b', public.ensure_personal_workspace());
insert into public.profiles (workspace_id, title, slug) values (tests.id('ws_b'), 'Página da Bia', 'bia-antiga');
select tests.remember('profile_b', (select id from public.profiles where slug = 'bia-antiga'));
-- Bia renames her address so a released slug exists in her history.
select public.change_profile_slug(tests.id('profile_b'), 'bia-costa');
select tests.clear_authentication();

select tests.remember('membership_b',
  (select id from public.workspace_memberships where workspace_id = tests.id('ws_b')));

-- ---- Positive: Ana works inside her own workspace -------------------------------------------
select tests.authenticate_as(tests.id('ana'));
select is((select count(*)::int from public.workspaces), 1, 'Ana sees only her workspace');
select is((select count(*)::int from public.profiles), 1, 'Ana sees only her page');
update public.profiles set title = 'Ana Lima — Nutrição' where slug = 'ana-lima';
select is((select title from public.profiles where slug = 'ana-lima'), 'Ana Lima — Nutrição', 'Ana edits her own page');

-- ---- Reads across tenants return nothing ----------------------------------------------------
select is((select count(*)::int from public.workspaces where id = tests.id('ws_b')), 0, 'select other workspace by id: 0 rows');
select is((select count(*)::int from public.workspace_memberships where workspace_id = tests.id('ws_b')), 0, 'other memberships: 0 rows');
select is((select count(*)::int from public.profiles where workspace_id = tests.id('ws_b')), 0, 'other pages: 0 rows');
select is((select count(*)::int from public.profiles where id = tests.id('profile_b')), 0, 'other page by id: 0 rows');
select is((select count(*)::int from public.slug_history where workspace_id = tests.id('ws_b')), 0, 'other slug history: 0 rows');
select is((select count(*)::int from public.audit_events where workspace_id = tests.id('ws_b')), 0, 'other audit events: 0 rows');
select is((select count(*)::int from public.user_accounts where id = tests.id('bia')), 0, 'other account: 0 rows');

-- ---- Writes with forged identifiers ---------------------------------------------------------
select throws_ok(
  format('insert into public.profiles (workspace_id, title, slug) values (%L, %L, %L)', tests.id('ws_b'), 'Intrusa', 'forjada'),
  '42501', null, 'insert with a forged workspace_id is rejected as forbidden (not as "limit reached")');
select lives_ok(
  format('update public.profiles set title = %L where id = %L', 'Hackeado', tests.id('profile_b')),
  'update of another tenant''s page runs but matches no row');
select lives_ok(
  format('update public.workspaces set name = %L where id = %L', 'Hackeado', tests.id('ws_b')),
  'update of another workspace runs but matches no row');
select lives_ok(
  format('update public.user_accounts set display_name = %L where id = %L', 'Hackeado', tests.id('bia')),
  'update of another account runs but matches no row');
select throws_ok(
  format('update public.profiles set workspace_id = %L where slug = %L', tests.id('ws_b'), 'ana-lima'),
  '42501', null, 'moving a page to another workspace is not permitted (no column grant)');
select throws_ok(format('delete from public.profiles where id = %L', tests.id('profile_b')), '42501', null, 'delete of pages is not granted');
select throws_ok(
  format('insert into public.workspace_memberships (workspace_id, user_id, role) values (%L, %L, %L)', tests.id('ws_b'), tests.id('ana'), 'owner'),
  '42501', null, 'self-inviting into another workspace is not granted');
select throws_ok(format('delete from public.workspaces where id = %L', tests.id('ws_b')), '42501', null, 'delete of workspaces is not granted');

-- ---- RPCs with forged identifiers answer "not found" ----------------------------------------
select throws_ok(format('select public.change_profile_slug(%L, %L)', tests.id('profile_b'), 'roubado'), 'P0002', null, 'change_profile_slug on another tenant');
select throws_ok(format('select public.soft_delete_profile(%L)', tests.id('profile_b')), 'P0002', null, 'soft_delete_profile on another tenant');
select throws_ok(format('select public.soft_delete_workspace(%L)', tests.id('ws_b')), 'P0002', null, 'soft_delete_workspace on another tenant');
select throws_ok(format('select public.change_member_role(%L, %L)', tests.id('membership_b'), 'editor'), 'P0002', null, 'change_member_role on another tenant');
select throws_ok(format('select public.remove_workspace_member(%L)', tests.id('membership_b')), 'P0002', null, 'remove_workspace_member on another tenant');
select is(
  (select status from public.check_slug_availability('bia-antiga', tests.id('ws_b'))),
  'held', 'passing another tenant''s workspace does not unlock its held slugs');
select tests.clear_authentication();

-- ---- Nothing changed for Bia ----------------------------------------------------------------
select is((select title from public.profiles where id = tests.id('profile_b')), 'Página da Bia', 'Bia''s page title is intact');
select is((select name from public.workspaces where id = tests.id('ws_b')), 'Bia', 'Bia''s workspace name is intact');
select is((select display_name from public.user_accounts where id = tests.id('bia')), 'Bia', 'Bia''s account is intact');
select is((select count(*)::int from public.workspace_memberships where workspace_id = tests.id('ws_b')), 1, 'Bia''s workspace still has one member');

-- ---- anon has no access at all ---------------------------------------------------------------
select tests.authenticate_anon();
select throws_ok('select * from public.workspaces', '42501', null, 'anon cannot read workspaces');
select throws_ok('select * from public.workspace_memberships', '42501', null, 'anon cannot read memberships');
select throws_ok('select * from public.profiles', '42501', null, 'anon cannot read pages');
select throws_ok('select * from public.audit_events', '42501', null, 'anon cannot read audit events');
select throws_ok('select * from public.user_accounts', '42501', null, 'anon cannot read accounts');
select throws_ok(
  format('insert into public.profiles (workspace_id, title, slug) values (%L, %L, %L)', tests.id('ws_a'), 'Anon', 'anonima'),
  '42501', null, 'anon cannot insert pages');
select throws_ok($$ select * from public.check_slug_availability('qualquer') $$, '42501', null, 'anon cannot probe slugs');
select tests.clear_authentication();

select * from finish();
rollback;
