-- Sprint 3: draft validation, publishing, idempotency, rollback, retention and snapshot immutability.
begin;
select plan(43);

select tests.remember('owner', tests.create_user('owner3@example.test', 'Olga'));
select tests.remember('editor', tests.create_user('editor3@example.test', 'Edu'));
select tests.remember('outsider', tests.create_user('outsider3@example.test', 'Otto'));

select tests.authenticate_as(tests.id('owner'));
select public.ensure_personal_workspace();
select tests.remember('ws', public.create_agency_workspace('Agência Aurora'));
select tests.clear_authentication();

update public.workspaces set plan_id = 'agency' where id = tests.id('ws');
insert into public.workspace_memberships (workspace_id, user_id, role, invited_by, accepted_at)
values (tests.id('ws'), tests.id('editor'), 'editor', tests.id('owner'), now());

select tests.authenticate_as(tests.id('owner'));
insert into public.profiles (workspace_id, title, slug) values (tests.id('ws'), 'Café Ipê', 'cafe-ipe-pub');
select tests.remember('page', (select id from public.profiles where slug = 'cafe-ipe-pub'));
select tests.clear_authentication();

select tests.authenticate_as(tests.id('outsider'));
select tests.remember('ws_out', public.ensure_personal_workspace());
insert into public.profiles (workspace_id, title, slug) values (tests.id('ws_out'), 'Otto', 'otto-pub');
select tests.remember('page_out', (select id from public.profiles where slug = 'otto-pub'));
select tests.remember('pub_out', (select publication_id from public.publish_profile(tests.id('page_out'))));
select tests.clear_authentication();

-- ---- Draft content validation (editor writes through the Data API) --------------------------
select tests.authenticate_as(tests.id('editor'));
select lives_ok(
  format($f$update public.profiles set
    social_links = '[{"network":"instagram","url":"https://www.instagram.com/cafeipe"}]',
    blocks = '[{"id":"6f1c1d2e-0000-4000-8000-000000000001","type":"link","title":"Cardápio","url":"https://cafe.example/menu","visible":true},
               {"id":"6f1c1d2e-0000-4000-8000-000000000002","type":"link","title":"Oculto","url":"tel:+5511999999999","visible":false}]'
    where id = %L$f$, tests.id('page')),
  'editor saves valid social links and link blocks');
select is((select draft_revision from public.profiles where id = tests.id('page')), 2::bigint, 'a content change bumps draft_revision once');

select throws_ok(
  format($f$update public.profiles set blocks = '[{"id":"6f1c1d2e-0000-4000-8000-000000000003","type":"link","title":"x","url":"javascript:alert(1)","visible":true}]' where id = %L$f$, tests.id('page')),
  'LK040', null, 'javascript: URLs are rejected by the database');
select throws_ok(
  format($f$update public.profiles set social_links = '[{"network":"instagram","url":"https://instagram.com.evil.example/x"}]' where id = %L$f$, tests.id('page')),
  'LK040', null, 'a look-alike host for a social network is rejected');
select throws_ok(
  format($f$update public.profiles set social_links = '[{"network":"instagram","url":"http://instagram.com/x"}]' where id = %L$f$, tests.id('page')),
  'LK040', null, 'social links must use https');
select throws_ok(
  format($f$update public.profiles set social_links = '[{"network":"instagram","url":"https://evil@instagram.com/x"}]' where id = %L$f$, tests.id('page')),
  'LK040', null, 'userinfo in a social URL is rejected');
select lives_ok(
  format($f$update public.profiles set social_links = '[{"network":"tiktok","url":"https://www.tiktok.com/@cafeipe"},{"network":"instagram","url":"https://www.instagram.com/cafeipe"}]' where id = %L$f$, tests.id('page')),
  '"@" is accepted in the path of a social URL');
select throws_ok(
  format($f$update public.profiles set blocks = '[{"id":"6f1c1d2e-0000-4000-8000-000000000004","type":"link","title":"x","url":"https://a.example","visible":true,"onclick":"x"}]' where id = %L$f$, tests.id('page')),
  'LK040', null, 'blocks with unexpected keys are rejected');
select throws_ok(
  format($f$update public.profiles set blocks = '[{"id":"6f1c1d2e-0000-4000-8000-000000000005","type":"link","title":"a","url":"https://a.example","visible":true},{"id":"6f1c1d2e-0000-4000-8000-000000000005","type":"link","title":"b","url":"https://b.example","visible":true}]' where id = %L$f$, tests.id('page')),
  'LK040', null, 'duplicate block ids are rejected');
select throws_ok(format('update public.profiles set draft_revision = 99 where id = %L', tests.id('page')), '42501', null, 'draft_revision is not writable');
select throws_ok(format('update public.profiles set live_publication_id = %L where id = %L', tests.id('pub_out'), tests.id('page')), '42501', null, 'live_publication_id is not writable');
select throws_ok(format('update public.profiles set status = %L where id = %L', 'published', tests.id('page')), '42501', null, 'status is not writable');

-- ---- Publish (editor may publish) and idempotency --------------------------------------------
select results_eq(format('select version, created from public.publish_profile(%L)', tests.id('page')), $$values (1, true)$$, 'editor publishes version 1');
select results_eq(format('select version, created from public.publish_profile(%L)', tests.id('page')), $$values (1, false)$$, 'publishing an unchanged draft is idempotent');
select is((select status::text from public.profiles where id = tests.id('page')), 'published', 'page status becomes published');
select is(
  (select jsonb_array_length(pp.document -> 'blocks') from public.profile_publications pp join public.profiles p on p.live_publication_id = pp.id where p.id = tests.id('page')),
  1, 'hidden blocks are not part of the snapshot');
select is(
  (select pp.document ?| array['workspaceId', 'workspace_id', 'createdBy', 'publishedBy'] from public.profile_publications pp where pp.profile_id = tests.id('page')),
  false, 'the snapshot carries no tenant or user identifiers');

-- Draft edits do not reach the snapshot until the next publish.
update public.profiles set title = 'Café Ipê — novo' where id = tests.id('page');
select is(
  (select pp.document ->> 'title' from public.profile_publications pp join public.profiles p on p.live_publication_id = pp.id where p.id = tests.id('page')),
  'Café Ipê', 'a draft edit does not change the live snapshot');
select throws_ok(format('select * from public.publish_profile(%L, 1)', tests.id('page')), 'LK030', null, 'publishing a stale revision is rejected');
select results_eq(
  format('select version, created from public.publish_profile(%L, %s)', tests.id('page'), (select draft_revision from public.profiles where id = tests.id('page'))),
  $$values (2, true)$$, 'publishing the reviewed revision creates version 2');
select is((select count(*)::int from public.profile_publications where profile_id = tests.id('page')), 2, 'members read the version history');

-- ---- Snapshots are immutable -----------------------------------------------------------------
select throws_ok(format($f$update public.profile_publications set document = '{}' where profile_id = %L$f$, tests.id('page')), '42501', null, 'authenticated cannot update snapshots');
select throws_ok(format('delete from public.profile_publications where profile_id = %L', tests.id('page')), '42501', null, 'authenticated cannot delete snapshots');
select throws_ok(
  format($f$insert into public.profile_publications (profile_id, workspace_id, version, document, source_revision) values (%L, %L, 9, '{}', 1)$f$, tests.id('page'), tests.id('ws')),
  '42501', null, 'authenticated cannot insert snapshots');
select tests.clear_authentication();
select throws_ok(format($f$update public.profile_publications set document = '{}' where profile_id = %L$f$, tests.id('page')), '42501', null, 'even the table owner cannot rewrite a snapshot');
select throws_ok(
  format('update public.profiles set live_publication_id = %L where id = %L', tests.id('pub_out'), tests.id('page')),
  '23503', null, 'the live snapshot must belong to the same page');

-- ---- Cross-tenant attempts --------------------------------------------------------------------
select tests.authenticate_as(tests.id('outsider'));
select is((select count(*)::int from public.profile_publications where workspace_id = tests.id('ws')), 0, 'outsider reads no snapshots of another workspace');
select throws_ok(format('select * from public.publish_profile(%L)', tests.id('page')), 'P0002', null, 'outsider cannot publish another tenant''s page');
select throws_ok(
  format('select public.restore_profile_publication(%L, %L)', tests.id('page'), (select id from public.profile_publications where profile_id = tests.id('page') and version = 1)),
  'P0002', null, 'outsider cannot restore another tenant''s page');
select throws_ok(format('select public.unpublish_profile(%L)', tests.id('page')), 'P0002', null, 'outsider cannot unpublish another tenant''s page');
select tests.clear_authentication();
select tests.remember('pub_v1', (select id from public.profile_publications where profile_id = tests.id('page') and version = 1));

-- ---- Rollback and unpublish --------------------------------------------------------------------
select tests.authenticate_as(tests.id('editor'));
select throws_ok(format('select public.restore_profile_publication(%L, %L)', tests.id('page'), tests.id('pub_out')), 'P0002', null, 'a snapshot of another page cannot be restored');
select is(public.restore_profile_publication(tests.id('page'), tests.id('pub_v1')), 1, 'rollback restores version 1');
select is((select live_publication_id from public.profiles where id = tests.id('page')), tests.id('pub_v1'), 'version 1 is live again');
select is((select title from public.profiles where id = tests.id('page')), 'Café Ipê — novo', 'rollback does not touch the draft');
select lives_ok(format('select public.unpublish_profile(%L)', tests.id('page')), 'editor takes the page off the air');
select lives_ok(format('select public.unpublish_profile(%L)', tests.id('page')), 'unpublishing twice is a no-op');
select is(
  (select status::text || ':' || coalesce(live_publication_id::text, 'none') from public.profiles where id = tests.id('page')),
  'draft:none', 'unpublished page has no live snapshot');

-- ---- Retention: at most 10 versions per page ---------------------------------------------------
do $$
begin
  for i in 1..11 loop
    update public.profiles set bio = 'Versão ' || i where id = tests.id('page');
    perform public.publish_profile(tests.id('page'));
  end loop;
end;
$$;
select is((select count(*)::int from public.profile_publications where profile_id = tests.id('page')), 10, 'only the latest 10 versions are retained');
select is(
  (select pp.version from public.profile_publications pp join public.profiles p on p.live_publication_id = pp.id where p.id = tests.id('page')),
  13, 'the newest version is live after pruning');
select tests.clear_authentication();

select is(
  (select array_agg(action::text order by action::text) from (select distinct action from public.audit_events where target_id = tests.id('page') and action::text like 'profile.%') a),
  array['profile.publication_restored', 'profile.published', 'profile.unpublished'],
  'publish, restore and unpublish are audited');
select is(
  (select count(*)::int from public.audit_events where target_id = tests.id('page') and action = 'profile.unpublished'),
  1, 'the no-op unpublish wrote no second audit event');

-- ---- Suspended workspace and anon ---------------------------------------------------------------
update public.workspaces set status = 'suspended' where id = tests.id('ws');
select tests.authenticate_as(tests.id('owner'));
select throws_ok(format('select * from public.publish_profile(%L)', tests.id('page')), '42501', null, 'a suspended workspace cannot publish');
select tests.clear_authentication();

select tests.authenticate_anon();
select throws_ok(format('select * from public.publish_profile(%L)', tests.id('page')), '42501', null, 'anon cannot publish');
select tests.clear_authentication();

select * from finish();
rollback;
