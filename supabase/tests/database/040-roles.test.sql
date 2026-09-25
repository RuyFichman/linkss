-- Role matrix (ADR 0004) and the "at least one owner" invariant.
begin;
select plan(31);

select tests.remember('owner', tests.create_user('owner@example.test', 'Olga'));
select tests.remember('admin', tests.create_user('admin@example.test', 'Alan'));
select tests.remember('editor', tests.create_user('editor@example.test', 'Edu'));

select tests.authenticate_as(tests.id('owner'));
select public.ensure_personal_workspace();
select tests.remember('ws', public.create_agency_workspace('Agência Aurora'));
select tests.clear_authentication();

-- Team seats need the agency plan; Sprint 7 invitations will insert these through an RPC.
update public.workspaces set plan_id = 'agency' where id = tests.id('ws');
insert into public.workspace_memberships (workspace_id, user_id, role, invited_by, accepted_at) values
  (tests.id('ws'), tests.id('admin'), 'admin', tests.id('owner'), now()),
  (tests.id('ws'), tests.id('editor'), 'editor', tests.id('owner'), now());
select tests.remember('m_owner', (select id from public.workspace_memberships where workspace_id = tests.id('ws') and user_id = tests.id('owner')));
select tests.remember('m_admin', (select id from public.workspace_memberships where workspace_id = tests.id('ws') and user_id = tests.id('admin')));
select tests.remember('m_editor', (select id from public.workspace_memberships where workspace_id = tests.id('ws') and user_id = tests.id('editor')));

select tests.authenticate_as(tests.id('owner'));
insert into public.profiles (workspace_id, title, slug) values (tests.id('ws'), 'Café Ipê', 'cafe-ipe');
select tests.remember('page', (select id from public.profiles where slug = 'cafe-ipe'));
select tests.clear_authentication();

-- ---- Editor ----------------------------------------------------------------------------------
select tests.authenticate_as(tests.id('editor'));
select is((select count(*)::int from public.profiles where workspace_id = tests.id('ws')), 1, 'editor reads the workspace pages');
update public.profiles set bio = 'Café e bolos' where id = tests.id('page');
select is((select bio from public.profiles where id = tests.id('page')), 'Café e bolos', 'editor edits page content');
select throws_ok(
  format('insert into public.profiles (workspace_id, title, slug) values (%L, %L, %L)', tests.id('ws'), 'Nova', 'nova-do-editor'),
  '42501', null, 'editor cannot create pages');
select throws_ok(format('select public.change_profile_slug(%L, %L)', tests.id('page'), 'cafe-ipe-2'), '42501', null, 'editor cannot change the address');
select throws_ok(format('select public.soft_delete_profile(%L)', tests.id('page')), '42501', null, 'editor cannot delete pages');
select throws_ok(format('select public.change_member_role(%L, %L)', tests.id('m_admin'), 'editor'), '42501', null, 'editor cannot change roles');
select throws_ok(format('select public.remove_workspace_member(%L)', tests.id('m_admin')), '42501', null, 'editor cannot remove others');
select throws_ok(format('select public.soft_delete_workspace(%L)', tests.id('ws')), '42501', null, 'editor cannot delete the workspace');
update public.workspaces set name = 'Renomeada pelo editor' where id = tests.id('ws');
select is((select count(*)::int from public.audit_events), 0, 'editor cannot read the audit trail');
select tests.clear_authentication();
select is((select name from public.workspaces where id = tests.id('ws')), 'Agência Aurora', 'editor rename matched no row');

-- ---- Admin -----------------------------------------------------------------------------------
select tests.authenticate_as(tests.id('admin'));
update public.workspaces set name = 'Aurora Social' where id = tests.id('ws');
select is((select name from public.workspaces where id = tests.id('ws')), 'Aurora Social', 'admin renames the workspace');
select lives_ok(
  format('insert into public.profiles (workspace_id, title, slug) values (%L, %L, %L)', tests.id('ws'), 'Estúdio Norte', 'estudio-norte'),
  'admin creates pages');
select is(public.change_profile_slug(tests.id('page'), 'Café Ipê Centro'), 'cafe-ipe-centro', 'admin changes the address (normalized)');
select lives_ok(format('select public.change_member_role(%L, %L)', tests.id('m_editor'), 'admin'), 'admin promotes an editor to admin');
select throws_ok(format('select public.change_member_role(%L, %L)', tests.id('m_editor'), 'owner'), '42501', null, 'admin cannot grant owner');
select throws_ok(format('select public.change_member_role(%L, %L)', tests.id('m_owner'), 'admin'), '42501', null, 'admin cannot demote an owner');
select throws_ok(format('select public.remove_workspace_member(%L)', tests.id('m_owner')), '42501', null, 'admin cannot remove an owner');
select throws_ok(format('select public.soft_delete_workspace(%L)', tests.id('ws')), '42501', null, 'admin cannot delete the workspace');
select ok((select count(*) from public.audit_events where workspace_id = tests.id('ws')) > 0, 'admin reads the workspace audit trail');
select tests.clear_authentication();

select is(
  (select count(*)::int from public.audit_events where target_id = tests.id('m_editor') and action = 'membership.role_changed'),
  1, 'a role change writes exactly one audit event');
select is(
  (select metadata from public.audit_events where target_id = tests.id('m_editor') and action = 'membership.role_changed'),
  '{"from": "editor", "to": "admin"}'::jsonb, 'the role change audit keeps from/to only');

-- ---- Last owner ------------------------------------------------------------------------------
select tests.authenticate_as(tests.id('owner'));
select throws_ok(format('select public.change_member_role(%L, %L)', tests.id('m_owner'), 'admin'), 'LK020', null, 'the sole owner cannot demote themselves');
select throws_ok(format('select public.remove_workspace_member(%L)', tests.id('m_owner')), 'LK020', null, 'the sole owner cannot leave');
select lives_ok(format('select public.change_member_role(%L, %L)', tests.id('m_admin'), 'owner'), 'an owner promotes another owner');
select lives_ok(format('select public.change_member_role(%L, %L)', tests.id('m_owner'), 'admin'), 'with two owners, one may step down');
select tests.clear_authentication();

select tests.authenticate_as(tests.id('admin'));
select throws_ok(format('select public.remove_workspace_member(%L)', tests.id('m_admin')), 'LK020', null, 'the new sole owner cannot leave either');
select tests.clear_authentication();

select throws_ok(format('delete from public.workspace_memberships where id = %L', tests.id('m_admin')), 'LK020', null,
  'even a privileged delete of the last owner is rejected');
select throws_ok(format('update public.workspace_memberships set status = %L, revoked_at = now() where id = %L', 'revoked', tests.id('m_admin')), 'LK020', null,
  'revoking the last owner is rejected');

-- ---- Leaving and suspension ------------------------------------------------------------------
select tests.authenticate_as(tests.id('editor'));
select lives_ok(format('select public.remove_workspace_member(%L)', tests.id('m_editor')), 'a member may leave');
select is((select count(*)::int from public.workspaces where id = tests.id('ws')), 0, 'after leaving, the workspace is invisible');
select tests.clear_authentication();

update public.workspaces set status = 'suspended' where id = tests.id('ws');
select tests.authenticate_as(tests.id('admin'));
update public.profiles set title = 'Durante suspensão' where id = tests.id('page');
select is((select title from public.profiles where id = tests.id('page')), 'Café Ipê', 'a suspended workspace accepts no page edits');
select tests.clear_authentication();

select * from finish();
rollback;
