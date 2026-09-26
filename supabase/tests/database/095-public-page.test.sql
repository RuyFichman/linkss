-- Sprint 3: the anonymous public read surface (get_public_page) and its states.
begin;
select plan(22);

select tests.remember('ana', tests.create_user('ana3@example.test', 'Ana'));
select tests.remember('olga', tests.create_user('olga3@example.test', 'Olga'));

select tests.authenticate_as(tests.id('ana'));
select tests.remember('ws_free', public.ensure_personal_workspace());
insert into public.profiles (workspace_id, title, bio, slug) values (tests.id('ws_free'), 'Ana Lima', 'Nutricionista', 'ana-lima-pub');
select tests.remember('ana_page', (select id from public.profiles where slug = 'ana-lima-pub'));
select public.publish_profile(tests.id('ana_page'));
select tests.clear_authentication();

select tests.authenticate_as(tests.id('olga'));
select public.ensure_personal_workspace();
select tests.remember('ws_agency', public.create_agency_workspace('Agência Aurora'));
select tests.clear_authentication();
update public.workspaces set plan_id = 'agency' where id = tests.id('ws_agency');

select tests.authenticate_as(tests.id('olga'));
insert into public.profiles (workspace_id, title, slug) values (tests.id('ws_agency'), 'Loja Aurora', 'loja-aurora-pub');
insert into public.profiles (workspace_id, title, slug) values (tests.id('ws_agency'), 'Rascunho', 'rascunho-aurora');
select tests.remember('loja', (select id from public.profiles where slug = 'loja-aurora-pub'));
select public.publish_profile(tests.id('loja'));
select public.change_profile_slug(tests.id('loja'), 'loja-aurora-sp');
-- A draft edit after publishing must stay invisible.
update public.profiles set title = 'Loja Aurora (rascunho)' where id = tests.id('loja');
select tests.clear_authentication();

-- ---- Anonymous visitor -----------------------------------------------------------------------
select tests.authenticate_anon();
select ok(has_function_privilege('anon', 'public.get_public_page(text)', 'execute'), 'anon may execute get_public_page');
select results_eq(
  $$select state, canonical_slug, document ->> 'title', show_badge from public.get_public_page('ana-lima-pub')$$,
  $$values ('published', 'ana-lima-pub', 'Ana Lima', true)$$,
  'a published Free page returns its snapshot and shows the badge');
select is((select canonical_slug from public.get_public_page('  ANA-Lima-Pub ')), 'ana-lima-pub', 'lookup normalizes the address');
select results_eq(
  $$select state, document ->> 'title', show_badge from public.get_public_page('loja-aurora-sp')$$,
  $$values ('published', 'Loja Aurora', false)$$,
  'the live snapshot is served, not the draft; remove_badge hides the badge');
select results_eq(
  $$select state, canonical_slug from public.get_public_page('loja-aurora-pub')$$,
  $$values ('moved', 'loja-aurora-sp')$$,
  'a changed address points to the new one during its hold');
select results_eq(
  $$select state, document from public.get_public_page('rascunho-aurora')$$,
  $$values ('unpublished', null::jsonb)$$,
  'an unpublished page exposes no content');
select is((select state from public.get_public_page('nao-existe-aqui')), 'not_found', 'unknown address: not_found');
select is((select state from public.get_public_page('a')), 'not_found', 'malformed address: not_found');
select is((select state from public.get_public_page('entrar')), 'not_found', 'reserved address: not_found');
select is((select state from public.get_public_page(null)), 'not_found', 'null address: not_found');
select is(
  (select document ?| array['workspaceId', 'workspace_id', 'createdBy', 'publishedBy'] from public.get_public_page('ana-lima-pub')),
  false, 'public document carries no tenant or user identifiers');

select throws_ok('select 1 from public.profiles limit 1', '42501', null, 'anon cannot read profiles');
select throws_ok('select 1 from public.profile_publications limit 1', '42501', null, 'anon cannot read snapshots');
select throws_ok('select 1 from public.slug_history limit 1', '42501', null, 'anon cannot read slug history');
select tests.clear_authentication();

-- ---- Unpublished moved page, suspension and deletion ---------------------------------------
select tests.authenticate_as(tests.id('olga'));
select public.unpublish_profile(tests.id('loja'));
select tests.clear_authentication();
select tests.authenticate_anon();
select is((select state from public.get_public_page('loja-aurora-pub')), 'not_found', 'an old address of an unpublished page does not redirect');
select is((select state from public.get_public_page('loja-aurora-sp')), 'unpublished', 'unpublishing takes the page off the air');
select tests.clear_authentication();

select tests.authenticate_as(tests.id('olga'));
select public.restore_profile_publication(tests.id('loja'), (select id from public.profile_publications where profile_id = tests.id('loja') and version = 1));
select tests.clear_authentication();
update public.workspaces set status = 'suspended' where id = tests.id('ws_agency');
select tests.authenticate_anon();
select results_eq(
  $$select state, document from public.get_public_page('loja-aurora-sp')$$,
  $$values ('suspended', null::jsonb)$$,
  'a suspended workspace serves no content');
select is((select state from public.get_public_page('loja-aurora-pub')), 'not_found', 'old addresses of suspended pages do not redirect');
select tests.clear_authentication();

select tests.authenticate_as(tests.id('ana'));
select public.soft_delete_profile(tests.id('ana_page'));
select tests.clear_authentication();
select tests.authenticate_anon();
select is((select state from public.get_public_page('ana-lima-pub')), 'not_found', 'a deleted page is not served');
select tests.clear_authentication();

select tests.authenticate_as(tests.id('olga'));
select public.soft_delete_workspace(tests.id('ws_agency'));
select tests.clear_authentication();
select tests.authenticate_anon();
select is((select state from public.get_public_page('rascunho-aurora')), 'not_found', 'pages of a deleted workspace are not served');
select tests.clear_authentication();

-- ---- Hold expiry ------------------------------------------------------------------------------
update public.workspaces set deleted_at = null, purge_after = null, status = 'active' where id = tests.id('ws_agency');
select tests.authenticate_anon();
select is((select state from public.get_public_page('loja-aurora-pub')), 'moved', 'redirect works again once the workspace is active');
select tests.clear_authentication();
update public.slug_history set hold_until = released_at where slug = 'loja-aurora-pub';
select tests.authenticate_anon();
select is((select state from public.get_public_page('loja-aurora-pub')), 'not_found', 'after the hold the old address is not redirected');
select tests.clear_authentication();

select * from finish();
rollback;
