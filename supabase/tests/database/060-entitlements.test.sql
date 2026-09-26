-- Entitlements are enforced in the database, not only in the UI.
begin;
select plan(11);

select tests.remember('ana', tests.create_user('ana@example.test', 'Ana'));
select tests.authenticate_as(tests.id('ana'));
select tests.remember('ws', public.ensure_personal_workspace());

select is((select count(*)::int from public.plan_entitlements), 18, 'signed-in users read the entitlement catalogue');
select lives_ok(format('insert into public.profiles (workspace_id, title, slug) values (%L, %L, %L)', tests.id('ws'), 'Primeira', 'primeira-pagina'),
  'Free: the first page is allowed');
select throws_ok(format('insert into public.profiles (workspace_id, title, slug) values (%L, %L, %L)', tests.id('ws'), 'Segunda', 'segunda-pagina'),
  'LK010', null, 'Free: a second page is rejected by the database');
select throws_ok(format('update public.workspaces set plan_id = %L where id = %L', 'agency', tests.id('ws')), '42501', null,
  'a user cannot upgrade their own plan');

select public.soft_delete_profile((select id from public.profiles where slug = 'primeira-pagina'));
select lives_ok(format('insert into public.profiles (workspace_id, title, slug) values (%L, %L, %L)', tests.id('ws'), 'Nova', 'nova-pagina'),
  'soft-deleted pages free their seat');
select tests.clear_authentication();

update public.profiles set status = 'archived' where slug = 'nova-pagina';
select tests.authenticate_as(tests.id('ana'));
select throws_ok(format('insert into public.profiles (workspace_id, title, slug) values (%L, %L, %L)', tests.id('ws'), 'Outra', 'outra-pagina'),
  'LK010', null, 'archived pages still count against the limit');
select tests.clear_authentication();

select is(private.entitlement_int(tests.id('ws'), 'max_profiles'), 1, 'entitlement resolves from the workspace plan');

-- Billing (Sprint 8) moves the workspace to a larger plan through a server-side path.
update public.workspaces set plan_id = 'agency' where id = tests.id('ws');
select is(private.entitlement_int(tests.id('ws'), 'max_profiles'), 10, 'the agency plan resolves to ten pages');

select tests.authenticate_as(tests.id('ana'));
select lives_ok(
  format($$ insert into public.profiles (workspace_id, title, slug) select %L, 'Cliente ' || n, 'cliente-' || n from generate_series(1, 9) n $$, tests.id('ws')),
  'agency: nine more pages fit (ten in total)');
select throws_ok(format('insert into public.profiles (workspace_id, title, slug) values (%L, %L, %L)', tests.id('ws'), 'Onze', 'cliente-onze'),
  'LK010', null, 'agency: the eleventh page is rejected');
select tests.clear_authentication();

select tests.authenticate_anon();
select throws_ok('select * from public.plans', '42501', null, 'anon cannot read plans');
select tests.clear_authentication();

select * from finish();
rollback;
