-- AC4: soft delete and retention are represented and hidden by RLS.
begin;
select plan(14);

select tests.remember('ana', tests.create_user('ana@example.test', 'Ana'));
select tests.authenticate_as(tests.id('ana'));
select tests.remember('ws_personal', public.ensure_personal_workspace());
insert into public.profiles (workspace_id, title, slug) values (tests.id('ws_personal'), 'Página', 'pagina-da-ana');
select tests.remember('page', (select id from public.profiles where slug = 'pagina-da-ana'));

select public.soft_delete_profile(tests.id('page'));
select is((select count(*)::int from public.profiles where id = tests.id('page')), 0, 'a soft-deleted page is invisible');
update public.profiles set title = 'Ressuscitada' where id = tests.id('page');
select throws_ok(format('select public.soft_delete_profile(%L)', tests.id('page')), 'P0002', null, 'deleting twice answers not found');
select throws_ok(format('select public.soft_delete_workspace(%L)', tests.id('ws_personal')), '42501', null,
  'a personal workspace cannot be deleted by the user');

select tests.remember('ws_agency', public.create_agency_workspace('Agência Aurora'));
insert into public.profiles (workspace_id, title, slug) values (tests.id('ws_agency'), 'Cliente', 'cliente-aurora');
select public.soft_delete_workspace(tests.id('ws_agency'));
select is((select count(*)::int from public.workspaces where id = tests.id('ws_agency')), 0, 'a soft-deleted workspace is invisible');
select is((select count(*)::int from public.profiles where workspace_id = tests.id('ws_agency')), 0, 'its pages are invisible');
select is((select count(*)::int from public.workspace_memberships where workspace_id = tests.id('ws_agency')), 0, 'its memberships are invisible');
select tests.clear_authentication();

select is((select title from public.profiles where id = tests.id('page')), 'Página', 'updates cannot touch a soft-deleted page');
select ok(
  (select deleted_at is not null and purge_after = deleted_at + interval '30 days' from public.profiles where id = tests.id('page')),
  'the page row is kept with purge_after = deleted_at + 30 days');
select ok(
  (select purge_after = deleted_at + interval '30 days' from public.workspaces where id = tests.id('ws_agency')),
  'the workspace row is kept with its purge date');
select is(
  (select count(*)::int from public.slug_history where profile_id = tests.id('page') and reason = 'deleted'),
  1, 'the deleted page releases its slug into the hold history');
select is(
  (select count(*)::int from public.audit_events where target_id = tests.id('page') and action = 'profile.deleted'),
  1, 'exactly one profile.deleted audit event');
select is(
  (select count(*)::int from public.audit_events where target_id = tests.id('ws_agency') and action = 'workspace.deleted'),
  1, 'exactly one workspace.deleted audit event');

-- Account soft delete (the Sprint 9 flow will set these through a server-side job).
update public.user_accounts set deleted_at = now(), purge_after = now() + interval '30 days' where id = tests.id('ana');
select tests.authenticate_as(tests.id('ana'));
select is((select count(*)::int from public.user_accounts), 0, 'a soft-deleted account is invisible to its owner');
select throws_ok('select public.ensure_personal_workspace()', '42501', null, 'a soft-deleted account cannot re-provision');
select tests.clear_authentication();

select * from finish();
rollback;
