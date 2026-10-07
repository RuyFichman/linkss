-- Sprint 7, part 1 (ADR 0012): archiving, duplication isolation (AC2), the page list, invitations
-- (AC3), the members read, and every role against every new RPC (AC1).
begin;
select plan(173);

create function pg_temp.token_hash(p_token text)
returns text
language sql
as $$ select encode(extensions.digest(p_token, 'sha256'), 'hex') $$;

-- Draft blocks without their ids, in order: what must be equal between a page and its copy.
create function pg_temp.blocks_without_ids(p_profile_id uuid)
returns jsonb
language sql
security definer
as $$
  select coalesce(jsonb_agg(b - 'id' order by ord), '[]'::jsonb)
  from public.profiles p, jsonb_array_elements(p.blocks) with ordinality t(b, ord)
  where p.id = p_profile_id
$$;

create function pg_temp.block_ids(p_profile_id uuid)
returns text[]
language sql
security definer
as $$
  select coalesce(array_agg(b ->> 'id' order by ord), '{}')
  from public.profiles p, jsonb_array_elements(p.blocks) with ordinality t(b, ord)
  where p.id = p_profile_id
$$;

select tests.remember('owner', tests.create_user('owner7@example.test', 'Olga Sete'));
select tests.remember('admin', tests.create_user('admin7@example.test', 'Alan Sete'));
select tests.remember('editor', tests.create_user('editor7@example.test', 'Edu Sete'));
select tests.remember('outsider', tests.create_user('outsider7@example.test', 'Otto Sete'));
select tests.remember('invitee', tests.create_user('Convidada7@Example.test', 'Carla Sete'));
select tests.remember('stranger', tests.create_user('stranger7@example.test', 'Sara Sete'));
select tests.remember('pending', tests.create_user('pending7@example.test', 'Paulo Sete', false));

select tests.authenticate_as(tests.id('owner'));
select public.ensure_personal_workspace();
select tests.remember('ws', public.create_agency_workspace('Agência Sete'));
select tests.clear_authentication();
select tests.authenticate_as(tests.id('outsider'));
select public.ensure_personal_workspace();
select tests.remember('ws_b', public.create_agency_workspace('Agência Vizinha'));
select tests.clear_authentication();
select tests.authenticate_as(tests.id('invitee'));
select public.ensure_personal_workspace();
select tests.clear_authentication();
select tests.authenticate_as(tests.id('stranger'));
select public.ensure_personal_workspace();
select tests.clear_authentication();

update public.workspaces set plan_id = 'agency' where id in (tests.id('ws'), tests.id('ws_b'));
insert into public.workspace_memberships (workspace_id, user_id, role, invited_by, accepted_at) values
  (tests.id('ws'), tests.id('admin'), 'admin', tests.id('owner'), now()),
  (tests.id('ws'), tests.id('editor'), 'editor', tests.id('owner'), now());
insert into public.user_accounts (id, display_name) values (tests.id('admin'), 'Alan Sete'), (tests.id('editor'), 'Edu Sete');

select tests.authenticate_as(tests.id('owner'));
insert into public.profiles (workspace_id, title, slug) values (tests.id('ws'), 'Café Ipê', 'cafe-ipe-sete');
select tests.remember('page', (select id from public.profiles where slug = 'cafe-ipe-sete'));
insert into public.profiles (workspace_id, title, slug) values (tests.id('ws'), '100% Natural_Loja', 'natural-loja-sete');
select tests.remember('page2', (select id from public.profiles where slug = 'natural-loja-sete'));
select tests.clear_authentication();
select tests.authenticate_as(tests.id('outsider'));
insert into public.profiles (workspace_id, title, slug) values (tests.id('ws_b'), 'Café Vizinho', 'cafe-vizinho-sete');
select tests.remember('page_b', (select id from public.profiles where slug = 'cafe-vizinho-sete'));
select tests.clear_authentication();

-- Media of the source page, as the upload pipeline would leave it (ready, older than the grace period).
select tests.remember('avatar', gen_random_uuid());
select tests.remember('image', gen_random_uuid());
select tests.remember('unused', gen_random_uuid());
insert into public.media_assets (id, workspace_id, profile_id, kind, status, width, height, bytes, variants, created_by, created_at, activated_at) values
  (tests.id('avatar'), tests.id('ws'), tests.id('page'), 'avatar', 'ready', 288, 288, 600,
    '[{"w":96,"h":96,"bytes":100},{"w":192,"h":192,"bytes":200},{"w":288,"h":288,"bytes":300}]', tests.id('owner'), now() - interval '3 days', now() - interval '3 days'),
  (tests.id('image'), tests.id('ws'), tests.id('page'), 'image', 'ready', 448, 300, 1000,
    '[{"w":448,"h":300,"bytes":1000}]', tests.id('owner'), now() - interval '3 days', now() - interval '3 days'),
  (tests.id('unused'), tests.id('ws'), tests.id('page'), 'image', 'ready', 448, 300, 700,
    '[{"w":448,"h":300,"bytes":700}]', tests.id('owner'), now() - interval '3 days', now() - interval '3 days');

select tests.authenticate_as(tests.id('owner'));
update public.profiles
set bio = 'Cafés especiais',
  avatar_path = tests.id('avatar')::text,
  theme = '{"background":"#ffffff","button":"#112233","buttonStyle":"filled","corners":"rounded","spacing":"regular","font":"system"}',
  blocks = jsonb_build_array(
    '{"id":"00000000-0000-4000-8000-000000000001","type":"link","title":"Cardápio","url":"https://example.com/cardapio","visible":true}'::jsonb,
    jsonb_build_object('id', '00000000-0000-4000-8000-000000000002', 'type', 'image', 'mediaId', tests.id('image')::text, 'width', 448, 'height', 300, 'alt', 'Balcão', 'decorative', false, 'visible', true),
    '{"id":"00000000-0000-4000-8000-000000000003","type":"pix","label":"Pague com Pix","keyType":"random","key":"123e4567-e89b-42d3-a456-426614174000","paymentUrl":"","visible":true}'::jsonb,
    '{"id":"00000000-0000-4000-8000-000000000004","type":"form","title":"Fale com a gente","fields":["name","email"],"buttonLabel":"Enviar","consentText":"Aceito ser contatado.","consentRequired":true,"visible":true}'::jsonb,
    '{"id":"00000000-0000-4000-8000-000000000005","type":"whatsapp","label":"WhatsApp","phone":"5511987654321","message":"","visible":true}'::jsonb)
where id = tests.id('page');
select public.publish_profile(tests.id('page'));
select tests.clear_authentication();

-- =============================================================================================
-- Archive and unarchive
-- =============================================================================================

select tests.authenticate_anon();
select throws_ok(format('select * from public.archive_profile(%L)', tests.id('page')), '42501', null, 'anon cannot archive');
select throws_ok(format('select public.unarchive_profile(%L)', tests.id('page')), '42501', null, 'anon cannot unarchive');
select tests.clear_authentication();

select tests.authenticate_as(tests.id('editor'));
select throws_ok(format('select * from public.archive_profile(%L)', tests.id('page')), '42501', null, 'an editor cannot archive');
select tests.clear_authentication();
select tests.authenticate_as(tests.id('outsider'));
select throws_ok(format('select * from public.archive_profile(%L)', tests.id('page')), 'P0002', null, 'a member of another workspace gets "not found" when archiving');
select tests.clear_authentication();
select tests.authenticate_as(tests.id('stranger'));
select throws_ok(format('select * from public.archive_profile(%L)', tests.id('page')), 'P0002', null, 'a signed-in non-member gets "not found" when archiving');
select tests.clear_authentication();
select is((select status::text from public.profiles where id = tests.id('page')), 'published', 'refused attempts changed nothing');

select tests.authenticate_as(tests.id('admin'));
select is((select was_published from public.archive_profile(tests.id('page'))), true, 'an admin archives a published page and learns it was on the air');
select tests.clear_authentication();
select is((select status::text from public.profiles where id = tests.id('page')), 'archived', 'the page is archived');
select is((select live_publication_id from public.profiles where id = tests.id('page')), null, 'archiving takes the page off the air');
select is((select count(*)::int from public.profile_publications where profile_id = tests.id('page')), 1, 'archiving keeps the snapshots');
select is((select slug from public.profiles where id = tests.id('page')), 'cafe-ipe-sete', 'the address stays with the archived page');

select tests.authenticate_anon();
select is((select state from public.get_public_page('cafe-ipe-sete')), 'unpublished', 'visitors get the same answer as for an unpublished page');
select tests.clear_authentication();

select tests.authenticate_as(tests.id('owner'));
select is((select was_published from public.archive_profile(tests.id('page'))), false, 'archiving again is a no-op');
select throws_ok(format('select * from public.publish_profile(%L)', tests.id('page')), 'LK070', null, 'an archived page cannot be published');
select throws_ok(
  format('select public.restore_profile_publication(%L, %L)', tests.id('page'), (select id from public.profile_publications where profile_id = tests.id('page'))),
  'LK070', null, 'an archived page cannot be restored to a snapshot');
select tests.clear_authentication();
select is((select count(*)::int from public.audit_events where target_id = tests.id('page') and action = 'profile.archived'), 1, 'archiving writes exactly one audit event');

select tests.authenticate_as(tests.id('editor'));
update public.profiles set title = 'Editada arquivada' where id = tests.id('page');
select throws_ok(format('select public.unarchive_profile(%L)', tests.id('page')), '42501', null, 'an editor cannot unarchive');
select tests.clear_authentication();
select is((select title from public.profiles where id = tests.id('page')), 'Café Ipê', 'the draft of an archived page is frozen');
select throws_ok(
  format('update public.profiles set live_publication_id = %L where id = %L', (select id from public.profile_publications where profile_id = tests.id('page')), tests.id('page')),
  '23514', null, 'the database refuses an archived page with a live snapshot');

select tests.authenticate_as(tests.id('outsider'));
select throws_ok(format('select public.unarchive_profile(%L)', tests.id('page')), 'P0002', null, 'another workspace cannot unarchive');
select tests.clear_authentication();

select tests.authenticate_as(tests.id('owner'));
select lives_ok(format('select public.unarchive_profile(%L)', tests.id('page')), 'an owner unarchives');
select lives_ok(format('select public.unarchive_profile(%L)', tests.id('page')), 'unarchiving again is a no-op');
select tests.clear_authentication();
select is((select status::text from public.profiles where id = tests.id('page')), 'draft', 'unarchiving returns the page to a draft');
select is((select live_publication_id from public.profiles where id = tests.id('page')), null, 'unarchiving does not republish');
select is((select count(*)::int from public.audit_events where target_id = tests.id('page') and action = 'profile.unarchived'), 1, 'unarchiving writes exactly one audit event');
select tests.authenticate_anon();
select is((select state from public.get_public_page('cafe-ipe-sete')), 'unpublished', 'the address still serves nothing after unarchiving');
select tests.clear_authentication();

select tests.authenticate_as(tests.id('owner'));
select is((select created from public.publish_profile(tests.id('page'))), true, 'publishing again is a separate, deliberate step');
select tests.clear_authentication();

-- =============================================================================================
-- Duplication (AC2)
-- =============================================================================================

-- History that must not follow the copy.
insert into public.form_leads (workspace_id, profile_id, block_id, publication_version, name, email, consent_given, consent_required, consent_text, consent_version, consented_at, dedupe_key, purge_after)
values (tests.id('ws'), tests.id('page'), '00000000-0000-4000-8000-000000000004', 1, 'Lia', 'lia@example.test', true, true, 'Aceito ser contatado.', md5('Aceito ser contatado.'), now(), md5('lia'), now() + interval '90 days');

select tests.authenticate_anon();
select throws_ok(format('select public.duplicate_profile(%L, %L, %L)', tests.id('page'), 'Cópia', 'copia-anon-sete'), '42501', null, 'anon cannot duplicate');
select tests.clear_authentication();
select tests.authenticate_as(tests.id('editor'));
select throws_ok(format('select public.duplicate_profile(%L, %L, %L)', tests.id('page'), 'Cópia', 'copia-editor-sete'), '42501', null, 'an editor cannot duplicate');
select tests.clear_authentication();
select tests.authenticate_as(tests.id('outsider'));
select throws_ok(format('select public.duplicate_profile(%L, %L, %L)', tests.id('page'), 'Cópia', 'copia-vizinha-sete'), 'P0002', null, 'a page of another workspace cannot be duplicated');
select tests.clear_authentication();
select is((select count(*)::int from public.profiles where slug like 'copia-%-sete'), 0, 'refused duplications created nothing');

select tests.authenticate_as(tests.id('admin'));
select throws_ok(format('select public.duplicate_profile(%L, %L, %L)', tests.id('page'), 'Cópia', 'natural-loja-sete'), '23505', null, 'the copy needs an address of its own');
select throws_ok(format('select public.duplicate_profile(%L, %L, %L)', tests.id('page'), 'Cópia', 'app'), 'LK002', null, 'the copy cannot take a reserved address');
select throws_ok(format('select public.duplicate_profile(%L, %L, %L)', tests.id('page'), '   ', 'copia-sem-nome-sete'), '23514', null, 'the copy needs a name');
select tests.remember('copy', public.duplicate_profile(tests.id('page'), '  Padaria Jatobá ', 'Padaria Jatobá Sete'));
select tests.clear_authentication();

select is((select workspace_id from public.profiles where id = tests.id('copy')), tests.id('ws'), 'the copy lands in the source''s workspace, never elsewhere');
select is((select status::text from public.profiles where id = tests.id('copy')), 'draft', 'the copy is a draft');
select is((select slug from public.profiles where id = tests.id('copy')), 'padaria-jatoba-sete', 'the copy has its own normalized address');
select is((select title from public.profiles where id = tests.id('copy')), 'Padaria Jatobá', 'the copy has its own name');
select is((select live_publication_id from public.profiles where id = tests.id('copy')), null, 'the copy is not on the air');
select is((select created_by from public.profiles where id = tests.id('copy')), tests.id('admin'), 'the copy belongs to whoever duplicated');
select is((select duplicated_from from public.profiles where id = tests.id('copy')), tests.id('page'), 'the copy records where it came from');
select tests.remember('copy_revision', ('00000000-0000-4000-8000-' || lpad((select draft_revision::text from public.profiles where id = tests.id('copy')), 12, '0'))::uuid);
select tests.remember('page_revision', ('00000000-0000-4000-8000-' || lpad((select draft_revision::text from public.profiles where id = tests.id('page')), 12, '0'))::uuid);
select ok((select draft_revision from public.profiles where id = tests.id('copy')) >= 1, 'the copy starts its own draft revision counter');
select is(pg_temp.blocks_without_ids(tests.id('copy')), pg_temp.blocks_without_ids(tests.id('page')), 'the copy has the same blocks, in the same order');
select is((select count(*)::int from unnest(pg_temp.block_ids(tests.id('copy'))) c where c = any (pg_temp.block_ids(tests.id('page')))), 0, 'every block id of the copy is new');
select is((select count(distinct c)::int from unnest(pg_temp.block_ids(tests.id('copy'))) c), 5, 'the new block ids are distinct');
select is((select theme from public.profiles where id = tests.id('copy')), (select theme from public.profiles where id = tests.id('page')), 'the theme is copied');
select is((select bio from public.profiles where id = tests.id('copy')), 'Cafés especiais', 'the bio is copied');
select is((select avatar_path from public.profiles where id = tests.id('copy')), tests.id('avatar')::text, 'the avatar is carried over');
select is(
  (select count(*)::int from public.profile_publications where profile_id = tests.id('copy'))
  + (select count(*)::int from public.form_leads where profile_id = tests.id('copy'))
  + (select count(*)::int from public.slug_history where profile_id = tests.id('copy'))
  + (select count(*)::int from public.analytics_daily where profile_id = tests.id('copy'))
  + (select count(*)::int from public.analytics_events where profile_id = tests.id('copy')),
  0, 'the copy has no publications, leads, slug history or analytics');
select is((select count(*)::int from public.media_assets where profile_id = tests.id('copy')), 0, 'no asset row is duplicated');
select is((select array_agg(media_id order by media_id) from public.media_asset_shares where profile_id = tests.id('copy')),
  (select array_agg(i order by i) from unnest(array[tests.id('avatar'), tests.id('image')]) i), 'the copy gets a share of exactly the assets its draft uses');
select is(private.workspace_media_bytes(tests.id('ws')), 1600::bigint, 'shared images count once against the storage quota (the unused one is an orphan)');
select is((select count(*)::int from public.audit_events where target_id = tests.id('copy') and action = 'profile.duplicated'), 1, 'duplication writes exactly one audit event');
select is((select metadata ->> 'sourceProfileId' from public.audit_events where target_id = tests.id('copy') and action = 'profile.duplicated'), tests.id('page')::text, 'the audit event names the source');

-- Editing either page leaves the other unchanged.
select tests.authenticate_as(tests.id('editor'));
update public.profiles set title = 'Padaria Jatobá Centro',
  blocks = (select jsonb_agg(case when b ->> 'type' = 'pix' then jsonb_set(b, '{label}', '"Pix da padaria"') else b end order by ord) from jsonb_array_elements(blocks) with ordinality t(b, ord))
where id = tests.id('copy');
select tests.clear_authentication();
select is((select title from public.profiles where id = tests.id('page')), 'Café Ipê', 'editing the copy leaves the original''s name');
select is(
  (select array[c.draft_revision, p.draft_revision] from public.profiles c, public.profiles p where c.id = tests.id('copy') and p.id = tests.id('page')),
  array[right(tests.id('copy_revision')::text, 12)::bigint + 1, right(tests.id('page_revision')::text, 12)::bigint],
  'editing the copy bumps its own draft revision and not the original''s');
select ok(pg_temp.blocks_without_ids(tests.id('page')) @> '[{"type":"pix","label":"Pague com Pix"}]', 'editing the copy leaves the original''s blocks');
select tests.authenticate_as(tests.id('editor'));
update public.profiles set bio = 'Novo texto do original' where id = tests.id('page');
select tests.clear_authentication();
select is((select bio from public.profiles where id = tests.id('copy')), 'Cafés especiais', 'editing the original leaves the copy');

-- Publishing either page leaves the other unchanged.
select tests.authenticate_as(tests.id('editor'));
select is((select version from public.publish_profile(tests.id('copy'))), 1, 'the copy is published with its own version 1');
select tests.clear_authentication();
select is((select count(*)::int from public.profile_publications where profile_id = tests.id('page')), 2, 'publishing the copy adds nothing to the original''s history');
select ok((select live_publication_id from public.profiles where id = tests.id('page')) <> (select live_publication_id from public.profiles where id = tests.id('copy')), 'each page has its own live snapshot');

-- Archiving and deleting the original leaves the copy, and its images, alone.
select tests.authenticate_as(tests.id('owner'));
select * from public.archive_profile(tests.id('page'));
select tests.clear_authentication();
select is((select status::text from public.profiles where id = tests.id('copy')), 'published', 'archiving the original leaves the copy published');
select tests.authenticate_anon();
select is((select state from public.get_public_page('padaria-jatoba-sete')), 'published', 'the copy stays on the air');
select tests.clear_authentication();

select tests.authenticate_as(tests.id('owner'));
select public.soft_delete_profile(tests.id('page'));
select tests.clear_authentication();
select tests.authenticate_as(tests.id('editor'));
update public.profiles set bio = 'Depois de excluir o original' where id = tests.id('copy');
select tests.clear_authentication();
select is((select bio from public.profiles where id = tests.id('copy')), 'Depois de excluir o original', 'the copy can still be saved with its images after the original is deleted');
select tests.authenticate_service();
select is((select count(*)::int from public.claim_media_cleanup(200) c where c.media_id in (tests.id('avatar'), tests.id('image'))), 0, 'cleanup does not claim images the copy uses while the original waits for purge');
select tests.clear_authentication();

-- The original's retention ends: its images move to the copy; what nobody uses is removed.
update public.profiles set deleted_at = now() - interval '31 days', purge_after = now() - interval '1 day' where id = tests.id('page');
select tests.authenticate_service();
select is((select array_agg(c.media_id) from public.claim_media_cleanup(200) c where c.media_id in (tests.id('avatar'), tests.id('image'), tests.id('unused'))),
  array[tests.id('unused')], 'at purge time only the image nobody uses is claimed');
select tests.clear_authentication();
select is((select array_agg(profile_id order by id) from public.media_assets where id in (tests.id('avatar'), tests.id('image'))),
  array[tests.id('copy'), tests.id('copy')], 'the images the copy uses now belong to the copy');
select is((select count(*)::int from public.media_asset_shares where profile_id = tests.id('copy')), 0, 're-homed images no longer need a share');
select is((select count(*)::int from public.media_assets where profile_id = tests.id('page') and status <> 'deleting'), 0, 'nothing keeps the deleted original from being purged');
select tests.authenticate_as(tests.id('editor'));
select is((select created from public.publish_profile(tests.id('copy'))), true, 'the copy publishes again with its images after the original is gone');
select tests.clear_authentication();

-- A copy of a copy, an archived source and a deleted source.
select tests.authenticate_as(tests.id('owner'));
select tests.remember('copy2', public.duplicate_profile(tests.id('copy'), 'Padaria Dois', 'padaria-dois-sete'));
select is((select count(*)::int from public.media_asset_shares where profile_id = tests.id('copy2')), 2, 'a copy of a copy shares the same two images');
select * from public.archive_profile(tests.id('copy2'));
select lives_ok(format('select public.duplicate_profile(%L, %L, %L)', tests.id('copy2'), 'Padaria Três', 'padaria-tres-sete'), 'an archived page can be duplicated');
select throws_ok(format('select public.duplicate_profile(%L, %L, %L)', tests.id('page'), 'Do excluído', 'do-excluido-sete'), 'P0002', null, 'a deleted page cannot be duplicated');
select tests.clear_authentication();

-- max_profiles: archived pages count, and duplication cannot go around the limit.
update public.workspaces set plan_id = 'free' where id = tests.id('ws');
select tests.authenticate_as(tests.id('owner'));
select throws_ok(format('select public.duplicate_profile(%L, %L, %L)', tests.id('copy'), 'Além do limite', 'alem-do-limite-sete'), 'LK010', null, 'duplication honors max_profiles');
select tests.clear_authentication();
update public.workspaces set plan_id = 'agency' where id = tests.id('ws');

-- =============================================================================================
-- Page list
-- =============================================================================================

select tests.authenticate_anon();
select throws_ok(format('select * from public.list_workspace_profiles(%L)', tests.id('ws')), '42501', null, 'anon cannot list pages');
select tests.clear_authentication();

select tests.authenticate_as(tests.id('editor'));
select is((select total_pages from public.list_workspace_profiles(tests.id('ws'))), 4, 'the list counts every live page of the workspace (the deleted one is gone)');
select is((select array[draft_pages, published_pages, archived_pages] from public.list_workspace_profiles(tests.id('ws'))), array[2, 1, 1], 'the list counts pages per status');
select is((select jsonb_array_length(items) from public.list_workspace_profiles(tests.id('ws'))), 4, 'an editor sees every page');
select is((select matched_pages from public.list_workspace_profiles(tests.id('ws'), 'PADARIA')), 3, 'search matches the name, ignoring case');
select is((select matched_pages from public.list_workspace_profiles(tests.id('ws'), '', 'natural-loja')), 1, 'search matches the address');
select is((select matched_pages from public.list_workspace_profiles(tests.id('ws'), 'jatobá', 'jatoba')), 1, 'name and address terms are alternatives');
select is((select matched_pages from public.list_workspace_profiles(tests.id('ws'), '', '', 'archived')), 1, 'the status filter narrows the list');
select is((select matched_pages from public.list_workspace_profiles(tests.id('ws'), 'padaria', '', 'published')), 1, 'search and filter combine');
select is((select total_pages from public.list_workspace_profiles(tests.id('ws'), 'nada-com-esse-nome')), 4, 'totals do not depend on the search');
select is((select items from public.list_workspace_profiles(tests.id('ws'), 'nada-com-esse-nome')), '[]'::jsonb, 'an empty search returns no items');
select is((select jsonb_array_length(items) from public.list_workspace_profiles(tests.id('ws'), '', '', null, 'recent', 1, 1)), 1, 'the list is paginated');
select is((select items -> 0 ->> 'title' from public.list_workspace_profiles(tests.id('ws'), '', '', null, 'name', 1, 0)), '100% Natural_Loja', 'ordering by name');
select is((select jsonb_array_length(items) from public.list_workspace_profiles(tests.id('ws'), '', '', null, 'recent', 100000, -5)), 4, 'limit and offset are clamped');
-- Wildcards and hostile strings are literal text.
select is((select matched_pages from public.list_workspace_profiles(tests.id('ws'), '%')), 1, '"%" matches only the name that contains it');
select is((select matched_pages from public.list_workspace_profiles(tests.id('ws'), '_')), 1, '"_" matches only the name that contains it');
select is((select matched_pages from public.list_workspace_profiles(tests.id('ws'), '%%%', '%')), 0, 'wildcards do not widen the search');
select is((select matched_pages from public.list_workspace_profiles(tests.id('ws'), '\')), 0, 'a backslash is literal');
select is((select matched_pages from public.list_workspace_profiles(tests.id('ws'), ''' or 1=1 --', '''; drop table public.profiles; --')), 0, 'a quoting attack is literal text');
select tests.clear_authentication();

select tests.authenticate_as(tests.id('editor'));
update public.profiles set bio = 'Mudou depois de publicar' where id = tests.id('copy');
select is((select items -> 0 ->> 'hasUnpublishedChanges' from public.list_workspace_profiles(tests.id('ws'), 'jatobá')), 'true', 'the list says when a published page has unpublished changes');
select tests.clear_authentication();

select tests.authenticate_as(tests.id('outsider'));
select is((select array[total_pages, matched_pages] from public.list_workspace_profiles(tests.id('ws'))), array[0, 0], 'another workspace''s member sees no page of this one');
select is((select items from public.list_workspace_profiles(tests.id('ws'), '%', '%')), '[]'::jsonb, 'whatever the search string, the list never crosses workspaces');
select is((select items from public.list_workspace_profiles(tests.id('ws'), 'Padaria', 'padaria')), '[]'::jsonb, 'an exact name from another workspace returns nothing');
select is((select total_pages from public.list_workspace_profiles(tests.id('ws_b'))), 1, 'the same person sees their own workspace');
select tests.clear_authentication();
select tests.authenticate_as(tests.id('stranger'));
select is((select total_pages from public.list_workspace_profiles(tests.id('ws'))), 0, 'a signed-in non-member sees nothing');
select tests.clear_authentication();

-- =============================================================================================
-- Members read
-- =============================================================================================

select tests.authenticate_anon();
select throws_ok(format('select * from public.list_workspace_members(%L)', tests.id('ws')), '42501', null, 'anon cannot list members');
select tests.clear_authentication();
select tests.authenticate_as(tests.id('outsider'));
select throws_ok(format('select * from public.list_workspace_members(%L)', tests.id('ws')), 'P0002', null, 'another workspace cannot list members');
select tests.clear_authentication();
select tests.authenticate_as(tests.id('owner'));
select is((select array_agg(role::text order by role) from public.list_workspace_members(tests.id('ws'))), array['owner', 'admin', 'editor'], 'an owner sees the three members');
select is((select count(*)::int from public.list_workspace_members(tests.id('ws')) where email is not null), 3, 'an owner sees the members'' addresses');
select tests.clear_authentication();
select tests.authenticate_as(tests.id('editor'));
select is((select array_agg(display_name order by display_name) from public.list_workspace_members(tests.id('ws'))), array['Alan Sete', 'Edu Sete', 'Olga Sete'], 'an editor sees who is in the workspace');
select is((select array_agg(email) from public.list_workspace_members(tests.id('ws')) where email is not null), array['editor7@example.test'], 'an editor sees only their own address');
select tests.clear_authentication();

-- =============================================================================================
-- Invitations (AC3)
-- =============================================================================================

-- 43 characters of base64url, as the application generates them.
select set_config('tests.t1', 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA1', true);
select set_config('tests.t2', 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA2', true);
select set_config('tests.t3', 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA3', true);
select set_config('tests.t4', 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA4', true);
select set_config('tests.t5', 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA5', true);
select set_config('tests.t6', 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA6', true);
select set_config('tests.t7', 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA7', true);
select set_config('tests.unknown', 'ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ', true);

-- Who may invite, and whom.
select tests.authenticate_anon();
select throws_ok(format('select * from public.create_workspace_invitation(%L, %L, %L, %L)', tests.id('ws'), 'x@example.test', 'editor', pg_temp.token_hash('x')), '42501', null, 'anon cannot invite');
select throws_ok(format('select * from public.accept_workspace_invitation(%L)', current_setting('tests.t1')), '42501', null, 'anon cannot accept');
select throws_ok(format('select * from public.get_workspace_invitation(%L)', current_setting('tests.t1')), '42501', null, 'anon cannot look an invitation up');
select throws_ok(format('select public.revoke_workspace_invitation(%L)', gen_random_uuid()), '42501', null, 'anon cannot revoke');
select tests.clear_authentication();
select tests.authenticate_as(tests.id('editor'));
select throws_ok(format('select * from public.create_workspace_invitation(%L, %L, %L, %L)', tests.id('ws'), 'x@example.test', 'editor', pg_temp.token_hash('x')), '42501', null, 'an editor cannot invite at all');
select tests.clear_authentication();
select tests.authenticate_as(tests.id('outsider'));
select throws_ok(format('select * from public.create_workspace_invitation(%L, %L, %L, %L)', tests.id('ws'), 'x@example.test', 'editor', pg_temp.token_hash('x')), 'P0002', null, 'another workspace cannot invite into this one');
select tests.clear_authentication();
select tests.authenticate_as(tests.id('admin'));
select throws_ok(format('select * from public.create_workspace_invitation(%L, %L, %L, %L)', tests.id('ws'), 'x@example.test', 'owner', pg_temp.token_hash('x')), '42501', null, 'an admin cannot invite an owner');
select throws_ok(format('select * from public.create_workspace_invitation(%L, %L, %L, %L)', tests.id('ws'), 'not-an-address', 'editor', pg_temp.token_hash('x')), '22023', null, 'the address must look like one');
select throws_ok(format('select * from public.create_workspace_invitation(%L, %L, %L, %L)', tests.id('ws'), 'x@example.test', 'editor', current_setting('tests.t1')), '22023', null, 'only a hash is accepted, never a token');
select throws_ok(format('select * from public.create_workspace_invitation(%L, %L, %L, %L)', tests.id('ws'), ' EDITOR7@example.test ', 'admin', pg_temp.token_hash('x')), 'LK081', null, 'an active member cannot be invited again');
select tests.clear_authentication();
select tests.authenticate_as(tests.id('owner'));
select throws_ok(format('select * from public.create_workspace_invitation(%L, %L, %L, %L)', tests.id('ws'), 'x@example.test', 'owner', pg_temp.token_hash('x')), '42501', null, 'not even an owner grants ownership by invitation');
select is((select count(*)::int from public.workspace_invitations), 0, 'refused invitations created nothing');

-- A valid invitation: the address is normalized, only the hash is stored.
select tests.remember('inv1', (select invitation_id from public.create_workspace_invitation(tests.id('ws'), '  CONVIDADA7@example.TEST ', 'editor', pg_temp.token_hash(current_setting('tests.t1')))));
select is((select email from public.workspace_invitations where id = tests.id('inv1')), 'convidada7@example.test', 'the owner reads the invitation with the normalized address');
select throws_ok('select token_hash from public.workspace_invitations', '42501', null, 'the token hash cannot be read through the API');
select tests.clear_authentication();
select is((select token_hash from public.workspace_invitations where id = tests.id('inv1')), pg_temp.token_hash(current_setting('tests.t1')), 'the stored value is the hash');
select is((select count(*)::int from public.workspace_invitations where token_hash = current_setting('tests.t1')), 0, 'the token itself is not stored');
select ok((select expires_at - created_at = interval '7 days' from public.workspace_invitations where id = tests.id('inv1')), 'an invitation lasts seven days');
select is((select metadata from public.audit_events where target_id = tests.id('inv1') and action = 'invitation.created'), '{"role": "editor", "superseded": false}'::jsonb, 'the audit event has the role and no address');

select tests.authenticate_as(tests.id('editor'));
select is((select count(*)::int from public.workspace_invitations), 0, 'an editor does not read invitations');
select tests.clear_authentication();
select tests.authenticate_as(tests.id('outsider'));
select is((select count(*)::int from public.workspace_invitations), 0, 'another workspace does not read invitations');
select tests.clear_authentication();

-- Wrong account: valid token, another address.
select tests.authenticate_as(tests.id('stranger'));
select is((select row(state, workspace_id, workspace_name, inviter_name)::text from public.get_workspace_invitation(current_setting('tests.t1'))), row('wrong_account'::text, null::uuid, null::text, null::text)::text, 'another account learns only that the invitation is not for it');
select is((select row(state, workspace_id)::text from public.accept_workspace_invitation(current_setting('tests.t1'))), row('wrong_account'::text, null::uuid)::text, 'another account cannot accept');
select tests.clear_authentication();
select tests.authenticate_as(tests.id('pending'));
select is((select state from public.accept_workspace_invitation(current_setting('tests.t1'))), 'wrong_account', 'an unconfirmed account cannot accept');
select tests.clear_authentication();
select is((select count(*)::int from public.workspace_memberships where workspace_id = tests.id('ws')), 3, 'refused acceptances created no membership');

-- The invited person.
select tests.authenticate_as(tests.id('invitee'));
select is((select row(state, workspace_id, workspace_name, role, inviter_name)::text from public.get_workspace_invitation(current_setting('tests.t1'))),
  row('valid'::text, tests.id('ws'), 'Agência Sete'::text, 'editor'::public.workspace_role, 'Olga Sete'::text)::text, 'the invited person sees the workspace, the role and who invited');
select is((select row(state, workspace_id)::text from public.accept_workspace_invitation(current_setting('tests.t1'))), row('accepted'::text, tests.id('ws'))::text, 'the invited person accepts');
select is((select role::text from public.workspace_memberships where workspace_id = tests.id('ws') and user_id = tests.id('invitee') and status = 'active'), 'editor', 'acceptance grants the invited role in the inviting workspace');
select is((select count(*)::int from public.workspace_memberships where user_id = tests.id('invitee') and workspace_id = tests.id('ws_b')), 0, 'and in no other workspace');
select is((select state from public.accept_workspace_invitation(current_setting('tests.t1'))), 'invalid', 'an invitation is accepted once and only once');
select is((select state from public.get_workspace_invitation(current_setting('tests.t1'))), 'invalid', 'a used invitation looks like any invalid one');
select tests.clear_authentication();
select is((select count(*)::int from public.audit_events where target_id = tests.id('inv1') and action = 'invitation.accepted'), 1, 'acceptance writes exactly one audit event');
select is((select accepted_by from public.workspace_invitations where id = tests.id('inv1')), tests.id('invitee'), 'the invitation records who accepted');

-- Expired, revoked, unknown and malformed tokens are indistinguishable.
select tests.authenticate_as(tests.id('owner'));
select tests.remember('inv2', (select invitation_id from public.create_workspace_invitation(tests.id('ws'), 'stranger7@example.test', 'editor', pg_temp.token_hash(current_setting('tests.t2')))));
select tests.clear_authentication();
-- Expired invitations stop holding a seat: the next one fits in the fifth seat.
update public.workspace_invitations set created_at = now() - interval '8 days', expires_at = now() - interval '1 day' where id = tests.id('inv2');
select tests.authenticate_as(tests.id('owner'));
select tests.remember('inv3', (select invitation_id from public.create_workspace_invitation(tests.id('ws'), 'outro7@example.test', 'admin', pg_temp.token_hash(current_setting('tests.t3')))));
select tests.clear_authentication();

select tests.authenticate_as(tests.id('editor'));
select throws_ok(format('select public.revoke_workspace_invitation(%L)', tests.id('inv3')), '42501', null, 'an editor cannot revoke');
select tests.clear_authentication();
select tests.authenticate_as(tests.id('outsider'));
select throws_ok(format('select public.revoke_workspace_invitation(%L)', tests.id('inv3')), 'P0002', null, 'another workspace cannot revoke');
select tests.clear_authentication();
select tests.authenticate_as(tests.id('admin'));
select lives_ok(format('select public.revoke_workspace_invitation(%L)', tests.id('inv3')), 'an admin revokes');
select lives_ok(format('select public.revoke_workspace_invitation(%L)', tests.id('inv3')), 'revoking twice is a no-op');
select tests.clear_authentication();
select is((select count(*)::int from public.audit_events where target_id = tests.id('inv3') and action = 'invitation.revoked'), 1, 'revocation writes exactly one audit event');

select tests.authenticate_as(tests.id('stranger'));
select is((select row(g.*)::text from public.get_workspace_invitation(current_setting('tests.t2')) g), row('invalid'::text, null::uuid, null::text, null::public.workspace_role, null::text, null::timestamptz)::text, 'an expired invitation answers "invalid" and nothing else');
select is((select row(g.*)::text from public.get_workspace_invitation(current_setting('tests.t3')) g), (select row(g.*)::text from public.get_workspace_invitation(current_setting('tests.t2')) g), 'a revoked invitation answers exactly like an expired one');
select is((select row(g.*)::text from public.get_workspace_invitation(current_setting('tests.unknown')) g), (select row(g.*)::text from public.get_workspace_invitation(current_setting('tests.t2')) g), 'an unknown token answers exactly like an expired one');
select is((select row(g.*)::text from public.get_workspace_invitation('not a token') g), (select row(g.*)::text from public.get_workspace_invitation(current_setting('tests.t2')) g), 'a malformed token answers exactly like an expired one');
select is((select row(a.*)::text from public.accept_workspace_invitation(current_setting('tests.t2')) a), row('invalid'::text, null::uuid)::text, 'an expired invitation cannot be accepted, even by its addressee');
select is((select row(a.*)::text from public.accept_workspace_invitation(current_setting('tests.t3')) a), row('invalid'::text, null::uuid)::text, 'a revoked invitation cannot be accepted');
select is((select row(a.*)::text from public.accept_workspace_invitation(current_setting('tests.unknown')) a), row('invalid'::text, null::uuid)::text, 'an unknown token cannot be accepted');
select is((select row(a.*)::text from public.accept_workspace_invitation(null) a), row('invalid'::text, null::uuid)::text, 'a missing token cannot be accepted');
select tests.clear_authentication();
select is((select count(*)::int from public.workspace_memberships where user_id = tests.id('stranger') and workspace_id = tests.id('ws')), 0, 'none of them granted access');

-- A new invitation to the same address supersedes the open one.
select tests.authenticate_as(tests.id('owner'));
select tests.remember('inv4', (select invitation_id from public.create_workspace_invitation(tests.id('ws'), 'stranger7@example.test', 'editor', pg_temp.token_hash(current_setting('tests.t4')))));
select tests.remember('inv5', (select invitation_id from public.create_workspace_invitation(tests.id('ws'), 'stranger7@example.test', 'admin', pg_temp.token_hash(current_setting('tests.t5')))));
select tests.clear_authentication();
select is((select count(*)::int from public.workspace_invitations where workspace_id = tests.id('ws') and email = 'stranger7@example.test' and revoked_at is null and accepted_at is null and expires_at > now()), 1, 'only one invitation per address stays open');
select tests.authenticate_as(tests.id('stranger'));
select is((select state from public.accept_workspace_invitation(current_setting('tests.t4'))), 'invalid', 'the superseded link stops working');
select tests.clear_authentication();

-- The seat limit is reached between invitation and acceptance.
update public.workspaces set plan_id = 'free' where id = tests.id('ws');
select tests.authenticate_as(tests.id('stranger'));
select is((select state from public.get_workspace_invitation(current_setting('tests.t5'))), 'limit_reached', 'the acceptance screen learns the workspace is full');
select is((select row(a.*)::text from public.accept_workspace_invitation(current_setting('tests.t5')) a), row('limit_reached'::text, null::uuid)::text, 'acceptance is refused when the limit was reached meanwhile');
select tests.clear_authentication();
select is((select count(*)::int from public.workspace_memberships where user_id = tests.id('stranger') and workspace_id = tests.id('ws')), 0, 'and no membership is created');
update public.workspaces set plan_id = 'agency' where id = tests.id('ws');

-- Open invitations hold seats: 4 members + 1 open invitation = 5 of 5.
select tests.authenticate_as(tests.id('owner'));
select throws_ok(format('select * from public.create_workspace_invitation(%L, %L, %L, %L)', tests.id('ws'), 'sexto7@example.test', 'editor', pg_temp.token_hash('sexto')), 'LK010', null, 'an invitation beyond team_members is refused');
select tests.clear_authentication();

-- A suspended workspace accepts nobody.
update public.workspaces set status = 'suspended' where id = tests.id('ws');
select tests.authenticate_as(tests.id('stranger'));
select is((select state from public.accept_workspace_invitation(current_setting('tests.t5'))), 'invalid', 'an invitation to a suspended workspace is invalid');
select tests.clear_authentication();
update public.workspaces set status = 'active' where id = tests.id('ws');

-- An invitation opened by someone who is already a member is closed without changing their role.
insert into public.workspace_memberships (workspace_id, user_id, role, accepted_at) values (tests.id('ws'), tests.id('stranger'), 'editor', now());
select tests.authenticate_as(tests.id('stranger'));
select is((select state from public.get_workspace_invitation(current_setting('tests.t5'))), 'already_member', 'a member opening an invitation is told so');
select is((select row(a.*)::text from public.accept_workspace_invitation(current_setting('tests.t5')) a), row('already_member'::text, tests.id('ws'))::text, 'accepting as a member changes nothing');
select tests.clear_authentication();
select is((select role::text from public.workspace_memberships where workspace_id = tests.id('ws') and user_id = tests.id('stranger')), 'editor', 'the member keeps the role they had (no escalation to admin)');
select ok((select revoked_at is not null from public.workspace_invitations where id = tests.id('inv5')), 'and the invitation stops holding a seat');

-- A removed member invited again comes back in the same row, with the new role.
select tests.remember('m_invitee', (select id from public.workspace_memberships where workspace_id = tests.id('ws') and user_id = tests.id('invitee')));
select tests.authenticate_as(tests.id('owner'));
select public.remove_workspace_member(tests.id('m_invitee'));
select tests.remember('inv6', (select invitation_id from public.create_workspace_invitation(tests.id('ws'), 'convidada7@example.test', 'admin', pg_temp.token_hash(current_setting('tests.t6')))));
select tests.clear_authentication();
select tests.authenticate_as(tests.id('invitee'));
select is((select count(*)::int from public.profiles where workspace_id = tests.id('ws')), 0, 'a removed member reads nothing on the next request');
update public.profiles set bio = 'Depois de removida' where id = tests.id('copy');
select is((select state from public.accept_workspace_invitation(current_setting('tests.t6'))), 'accepted', 'a removed member accepts a new invitation');
select tests.clear_authentication();
select isnt((select bio from public.profiles where id = tests.id('copy')), 'Depois de removida', 'a removed member''s save was refused');
select is((select row(id, status, role, revoked_at)::text from public.workspace_memberships where workspace_id = tests.id('ws') and user_id = tests.id('invitee')),
  row(tests.id('m_invitee'), 'active'::public.membership_status, 'admin'::public.workspace_role, null::timestamptz)::text, 'the same membership row is active again with the invited role');

-- The last-owner guard still holds on the paths the members screen uses.
select tests.authenticate_as(tests.id('owner'));
select throws_ok(format('select public.remove_workspace_member(%L)', (select id from public.workspace_memberships where workspace_id = tests.id('ws') and user_id = tests.id('owner'))), 'LK020', null, 'the sole owner cannot leave');
select throws_ok(format('select public.change_member_role(%L, %L)', (select id from public.workspace_memberships where workspace_id = tests.id('ws') and user_id = tests.id('owner')), 'admin'), 'LK020', null, 'the sole owner cannot step down');
select tests.clear_authentication();
select tests.authenticate_as(tests.id('invitee'));
select throws_ok(format('select public.change_member_role(%L, %L)', tests.id('m_invitee'), 'owner'), '42501', null, 'an invited admin cannot make themselves owner');
select tests.clear_authentication();

-- Finished invitations lose their address after the retention period; creation is rate limited.
update public.workspace_invitations set created_at = now() - interval '60 days', expires_at = now() - interval '53 days' where id = tests.id('inv2');
select tests.authenticate_as(tests.id('owner'));
select public.remove_workspace_member((select id from public.workspace_memberships where workspace_id = tests.id('ws') and user_id = tests.id('stranger')));
select tests.remember('inv7', (select invitation_id from public.create_workspace_invitation(tests.id('ws'), 'setimo7@example.test', 'editor', pg_temp.token_hash(current_setting('tests.t7')))));
select tests.clear_authentication();
select is((select count(*)::int from public.workspace_invitations where id = tests.id('inv2')), 0, 'an invitation that ended more than 30 days ago is deleted');

insert into public.workspace_invitations (workspace_id, email, role, token_hash, invited_by, expires_at, revoked_at)
select tests.id('ws'), 'lote' || n || '@example.test', 'editor', pg_temp.token_hash('lote' || n), tests.id('admin'), now() + interval '7 days', now()
from generate_series(1, 20) n;
select tests.authenticate_as(tests.id('owner'));
select throws_ok(format('select * from public.create_workspace_invitation(%L, %L, %L, %L)', tests.id('ws'), 'demais7@example.test', 'editor', pg_temp.token_hash('demais')), 'LK082', null, 'invitations are rate limited per workspace');
select tests.clear_authentication();

select is((select count(*)::int from public.audit_events where workspace_id = tests.id('ws') and action::text like 'invitation.%' and metadata::text ~ '@'), 0, 'no invitation audit event holds an address');
select is((select count(*)::int from public.audit_events where workspace_id = tests.id('ws') and action::text like 'invitation.%' and metadata::text ~ 'AAAAAAAA'), 0, 'no invitation audit event holds a token');

select * from finish();
rollback;
