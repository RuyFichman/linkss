-- Sprint 5: attested uploads, Storage policies, quota, activation, lifecycle and cleanup (ADR 0009).
-- Mirrors apps/web/src/modules/media. The signing secret and the two signature vectors below are the
-- same ones apps/web/src/modules/media/media.test.ts computes (drift guard).
begin;
select plan(62);

-- The application server and the database share this secret; here it is the test value.
do $$
begin
  if exists (select 1 from vault.secrets where name = 'media_signing_secret') then
    perform vault.update_secret((select id from vault.secrets where name = 'media_signing_secret'), 'test-media-signing-secret-0123456789');
  else
    perform vault.create_secret('test-media-signing-secret-0123456789', 'media_signing_secret');
  end if;
end;
$$;

-- What the application server does with MEDIA_SIGNING_SECRET.
create function pg_temp.sign(p_payload text)
returns text
language sql
security definer
as $$ select encode(extensions.hmac(convert_to(p_payload, 'UTF8'), convert_to('test-media-signing-secret-0123456789', 'UTF8'), 'sha256'), 'hex') $$;

create function pg_temp.register_signature(p_media uuid, p_profile uuid, p_kind public.media_kind, p_width integer, p_height integer, p_variants jsonb)
returns text
language sql
security definer
as $$ select pg_temp.sign(private.media_register_payload(p_media, p_profile, p_kind, p_width, p_height, p_variants)) $$;

-- What the Storage API does when an upload finishes: the object row gets its size.
create function pg_temp.finish_upload(p_name text, p_size integer)
returns void
language sql
security definer
as $$ update storage.objects set metadata = jsonb_build_object('size', p_size, 'mimetype', 'image/webp') where bucket_id = 'media' and name = p_name $$;

select tests.remember('owner', tests.create_user('owner5@example.test', 'Olívia'));
select tests.remember('editor', tests.create_user('editor5@example.test', 'Enzo'));
select tests.remember('outsider', tests.create_user('outsider5@example.test', 'Otávio'));

select tests.authenticate_as(tests.id('owner'));
select public.ensure_personal_workspace();
select tests.remember('ws', public.create_agency_workspace('Agência Mídia'));
select tests.clear_authentication();

update public.workspaces set plan_id = 'agency' where id = tests.id('ws');
insert into public.workspace_memberships (workspace_id, user_id, role, invited_by, accepted_at)
values (tests.id('ws'), tests.id('editor'), 'editor', tests.id('owner'), now());

select tests.authenticate_as(tests.id('owner'));
insert into public.profiles (workspace_id, title, slug) values (tests.id('ws'), 'Studio Mídia', 'studio-midia');
select tests.remember('page', (select id from public.profiles where slug = 'studio-midia'));
insert into public.profiles (workspace_id, title, slug) values (tests.id('ws'), 'Outra Página', 'outra-pagina-midia');
select tests.remember('page2', (select id from public.profiles where slug = 'outra-pagina-midia'));
select tests.clear_authentication();

select tests.authenticate_as(tests.id('outsider'));
select tests.remember('ws_out', public.ensure_personal_workspace());
insert into public.profiles (workspace_id, title, slug) values (tests.id('ws_out'), 'Otávio', 'otavio-midia');
select tests.remember('page_out', (select id from public.profiles where slug = 'otavio-midia'));
select tests.clear_authentication();

select tests.remember('m1', '9b000000-0000-4000-8000-000000000001');
select tests.remember('m2', '9b000000-0000-4000-8000-000000000002');
select tests.remember('m3', '9b000000-0000-4000-8000-000000000003');
select tests.remember('m4', '9b000000-0000-4000-8000-000000000004');
select tests.remember('m5', '9b000000-0000-4000-8000-000000000005');
select tests.remember('m6', '9b000000-0000-4000-8000-000000000006');
select set_config('tests.image_variants', '[{"w": 416, "h": 312, "bytes": 1111}, {"w": 832, "h": 624, "bytes": 2222}]', true);
select set_config('tests.avatar_variants', '[{"w": 96, "h": 96, "bytes": 500}, {"w": 192, "h": 192, "bytes": 900}, {"w": 288, "h": 288, "bytes": 1500}]', true);

-- ---- Attestation: the vectors produced by the TypeScript signer ------------------------------
select is(
  private.media_register_payload('9a000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'image', 832, 624, '[{"w": 832, "h": 624, "bytes": 2222}, {"w": 416, "h": 312, "bytes": 1111}]'),
  'register:9a000000-0000-4000-8000-000000000001:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa:image:832x624:416x312x1111,832x624x2222',
  'the canonical payload orders variants by width');
select ok(
  private.media_signature_is_valid(
    'register:9a000000-0000-4000-8000-000000000001:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa:image:832x624:416x312x1111,832x624x2222',
    '28d2febaa767fd9545102718b06dacf2106a3077b3c029f0ca2400b4b373709a'),
  'the database accepts the register signature computed by the application');
select ok(
  private.media_signature_is_valid('activate:9a000000-0000-4000-8000-000000000001', 'a767f3e9bce85c2e97dfb5f1a082c3b4b21bc1eead59d627939bc6daa6c33cdd'),
  'the database accepts the activate signature computed by the application');
select is(
  (select array_agg(s order by s) from (values
    ('28d2febaa767fd9545102718b06dacf2106a3077b3c029f0ca2400b4b373709b'), (''), ('not-hex'), (repeat('0', 64)), (null)
  ) v(s) where private.media_signature_is_valid('activate:9a000000-0000-4000-8000-000000000001', s)),
  null, 'forged, empty and malformed signatures are refused');

-- ---- Variant plan (mirror of planVariants) -----------------------------------------------------
select is(
  (select array_agg(label order by label) from (values
    ('image 3 widths', 'image', 1248, 936, '[{"w":416,"h":312,"bytes":1},{"w":832,"h":624,"bytes":2},{"w":1248,"h":936,"bytes":3}]'),
    ('image between widths', 'image', 1000, 500, '[{"w":416,"h":208,"bytes":1},{"w":832,"h":416,"bytes":2},{"w":1000,"h":500,"bytes":3}]'),
    ('small image', 'image', 300, 200, '[{"w":300,"h":200,"bytes":1}]'),
    ('avatar', 'avatar', 288, 288, '[{"w":96,"h":96,"bytes":1},{"w":192,"h":192,"bytes":2},{"w":288,"h":288,"bytes":3}]')
  ) v(label, kind, w, h, variants)
  where not private.media_variants_are_valid(kind::public.media_kind, w, h, variants::jsonb)),
  null, 'the variant plans the application produces are accepted');
select is(
  (select array_agg(label order by label) from (values
    ('missing a width', 'image', 1248, 936, '[{"w":416,"h":312,"bytes":1},{"w":1248,"h":936,"bytes":3}]'),
    ('enlarged master', 'image', 2000, 1500, '[{"w":416,"h":312,"bytes":1},{"w":832,"h":624,"bytes":2},{"w":1248,"h":936,"bytes":2},{"w":2000,"h":1500,"bytes":3}]'),
    ('too small', 'image', 150, 150, '[{"w":150,"h":150,"bytes":1}]'),
    ('extreme aspect', 'image', 300, 2000, '[{"w":300,"h":2000,"bytes":1}]'),
    ('master mismatch', 'image', 832, 624, '[{"w":416,"h":312,"bytes":1},{"w":832,"h":700,"bytes":2}]'),
    ('oversized object', 'image', 300, 200, '[{"w":300,"h":200,"bytes":2097153}]'),
    ('extra key', 'image', 300, 200, '[{"w":300,"h":200,"bytes":1,"url":"https://evil.example"}]'),
    ('string numbers', 'image', 300, 200, '[{"w":"300","h":200,"bytes":1}]'),
    ('not an array', 'image', 300, 200, '{"w":300,"h":200,"bytes":1}'),
    ('avatar not square', 'avatar', 288, 288, '[{"w":96,"h":96,"bytes":1},{"w":192,"h":100,"bytes":2},{"w":288,"h":288,"bytes":3}]'),
    ('avatar wrong sizes', 'avatar', 512, 512, '[{"w":512,"h":512,"bytes":1}]')
  ) v(label, kind, w, h, variants)
  where private.media_variants_are_valid(kind::public.media_kind, w, h, variants::jsonb)),
  null, 'anything outside the variant plan is refused');

-- ---- Register: the editor's server call --------------------------------------------------------
select tests.authenticate_as(tests.id('editor'));
select lives_ok(
  format('select public.register_media_asset(%L, %L, %L, 832, 624, %L, %L)', tests.id('m1'), tests.id('page'), 'image', current_setting('tests.image_variants'),
    pg_temp.register_signature(tests.id('m1'), tests.id('page'), 'image', 832, 624, current_setting('tests.image_variants')::jsonb)),
  'an editor registers an upload the application signed');
select results_eq(
  format('select status::text, bytes, workspace_id, created_by from public.media_assets where id = %L', tests.id('m1')),
  format('values (%L, 3333, %L::uuid, %L::uuid)', 'pending', tests.id('ws'), tests.id('editor')),
  'the asset starts pending, owned by the page''s workspace, with the summed size');

select throws_ok(
  format('select public.register_media_asset(%L, %L, %L, 832, 624, %L, %L)', tests.id('m2'), tests.id('page'), 'image', current_setting('tests.image_variants'), repeat('0', 64)),
  'LK060', null, 'a registration without the application''s signature is rejected');
select throws_ok(
  format('select public.register_media_asset(%L, %L, %L, 832, 624, %L, %L)', tests.id('m2'), tests.id('page'), 'image', current_setting('tests.image_variants'),
    pg_temp.register_signature(tests.id('m1'), tests.id('page'), 'image', 832, 624, current_setting('tests.image_variants')::jsonb)),
  'LK060', null, 'a signature made for another media id cannot be replayed');
select throws_ok(
  format('select public.register_media_asset(%L, %L, %L, 832, 624, %L, %L)', tests.id('m2'), tests.id('page2'), 'image', current_setting('tests.image_variants'),
    pg_temp.register_signature(tests.id('m2'), tests.id('page'), 'image', 832, 624, current_setting('tests.image_variants')::jsonb)),
  'LK060', null, 'a signature made for one page cannot be used for another');
select throws_ok(
  format('select public.register_media_asset(%L, %L, %L, 832, 624, %L, %L)', tests.id('m2'), tests.id('page'), 'image', '[{"w": 416, "h": 312, "bytes": 1111}, {"w": 832, "h": 624, "bytes": 9999}]',
    pg_temp.register_signature(tests.id('m2'), tests.id('page'), 'image', 832, 624, current_setting('tests.image_variants')::jsonb)),
  'LK060', null, 'changing the signed sizes invalidates the signature');
select throws_ok(
  format('select public.register_media_asset(%L, %L, %L, 5000, 624, %L, %L)', tests.id('m2'), tests.id('page'), 'image', '[{"w": 5000, "h": 624, "bytes": 10}]', repeat('0', 64)),
  '22023', null, 'a description outside the variant plan is rejected');
select throws_ok(
  format('select public.register_media_asset(%L, %L, %L, 832, 624, %L, %L)', tests.id('m2'), tests.id('page_out'), 'image', current_setting('tests.image_variants'),
    pg_temp.register_signature(tests.id('m2'), tests.id('page_out'), 'image', 832, 624, current_setting('tests.image_variants')::jsonb)),
  'P0002', null, 'a page of another workspace is not found, even with a valid signature');

-- ---- Storage policy: only registered variants of the caller's pending asset -------------------
select lives_ok(
  format($f$insert into storage.objects (bucket_id, name, owner_id) values ('media', %L, %L)$f$, tests.id('m1') || '/416.webp', tests.id('editor')),
  'the registered variant can be written with the uploader''s session');
select throws_ok(
  format($f$insert into storage.objects (bucket_id, name, owner_id) values ('media', %L, %L)$f$, tests.id('m1') || '/9999.webp', tests.id('editor')),
  '42501', null, 'a name that is not a registered variant is rejected');
select throws_ok(
  format($f$insert into storage.objects (bucket_id, name, owner_id) values ('media', %L, %L)$f$, tests.id('m2') || '/416.webp', tests.id('editor')),
  '42501', null, 'a forged direct upload with no registration is rejected');
select throws_ok(
  format($f$insert into storage.objects (bucket_id, name, owner_id) values ('media', %L, %L)$f$, 'evil.html', tests.id('editor')),
  '42501', null, 'arbitrary object names are rejected');
select throws_ok(
  format($f$insert into storage.objects (bucket_id, name, owner_id) values ('other', %L, %L)$f$, tests.id('m1') || '/832.webp', tests.id('editor')),
  '42501', null, 'the policy applies to the media bucket only');
with changed as (
  update storage.objects set name = 'renamed.webp' where bucket_id = 'media' returning 1
)
select is((select count(*)::int from changed), 0, 'a user token cannot change stored objects');
select throws_ok($$delete from storage.objects where bucket_id = 'media'$$, '42501', null, 'a user token cannot delete stored objects');
select is((select count(*)::int from storage.objects where bucket_id = 'media'), 0, 'a user token cannot list stored objects');
select tests.clear_authentication();

select tests.authenticate_as(tests.id('owner'));
select throws_ok(
  format($f$insert into storage.objects (bucket_id, name, owner_id) values ('media', %L, %L)$f$, tests.id('m1') || '/832.webp', tests.id('owner')),
  '42501', null, 'another member cannot write into somebody else''s pending upload');
select tests.clear_authentication();

select tests.authenticate_anon();
select throws_ok(
  format($f$insert into storage.objects (bucket_id, name) values ('media', %L)$f$, tests.id('m1') || '/832.webp'),
  '42501', null, 'anon cannot upload');
select throws_ok('select 1 from public.media_assets limit 1', '42501', null, 'anon cannot read media assets');
select throws_ok(
  format('select public.register_media_asset(%L, %L, %L, 832, 624, %L, %L)', tests.id('m2'), tests.id('page'), 'image', current_setting('tests.image_variants'), repeat('0', 64)),
  '42501', null, 'anon cannot register media');
select tests.clear_authentication();

-- ---- Activate ------------------------------------------------------------------------------------
select tests.authenticate_as(tests.id('editor'));
select throws_ok(
  format('select public.activate_media_asset(%L, %L)', tests.id('m1'), pg_temp.sign('activate:' || tests.id('m1'))),
  'LK062', null, 'an asset is not activated while a variant is missing from the bucket');
insert into storage.objects (bucket_id, name, owner_id) values ('media', tests.id('m1') || '/832.webp', tests.id('editor'));
select tests.clear_authentication();
select pg_temp.finish_upload(tests.id('m1') || '/416.webp', 1111);
select pg_temp.finish_upload(tests.id('m1') || '/832.webp', 9999);
select tests.authenticate_as(tests.id('editor'));
select throws_ok(
  format('select public.activate_media_asset(%L, %L)', tests.id('m1'), pg_temp.sign('activate:' || tests.id('m1'))),
  'LK062', null, 'an asset is not activated when a stored size differs from the registered one');
select tests.clear_authentication();
select pg_temp.finish_upload(tests.id('m1') || '/832.webp', 2222);
select tests.authenticate_as(tests.id('editor'));
select throws_ok(
  format('select public.activate_media_asset(%L, %L)', tests.id('m1'), repeat('0', 64)),
  'LK060', null, 'activation needs the application''s signature too');
select lives_ok(
  format('select public.activate_media_asset(%L, %L)', tests.id('m1'), pg_temp.sign('activate:' || tests.id('m1'))),
  'the application activates the asset once every variant is stored');
select is((select status::text from public.media_assets where id = tests.id('m1')), 'ready', 'the asset is ready');
select lives_ok(
  format('select public.activate_media_asset(%L, %L)', tests.id('m1'), pg_temp.sign('activate:' || tests.id('m1'))),
  'activating twice is a no-op');
select throws_ok(
  format($f$insert into storage.objects (bucket_id, name, owner_id) values ('media', %L, %L)$f$, tests.id('m1') || '/1248.webp', tests.id('editor')),
  '42501', null, 'nothing more can be written once the asset is ready');
select tests.clear_authentication();

select tests.authenticate_as(tests.id('outsider'));
select is((select count(*)::int from public.media_assets where id = tests.id('m1')), 0, 'another workspace cannot see the asset');
select throws_ok(
  format('select public.activate_media_asset(%L, %L)', tests.id('m1'), pg_temp.sign('activate:' || tests.id('m1'))),
  'P0002', null, 'another person cannot activate it');
select tests.clear_authentication();

-- ---- Abandon a failed upload -------------------------------------------------------------------
select tests.authenticate_as(tests.id('editor'));
select public.register_media_asset(tests.id('m2'), tests.id('page'), 'avatar', 288, 288, current_setting('tests.avatar_variants')::jsonb,
  pg_temp.register_signature(tests.id('m2'), tests.id('page'), 'avatar', 288, 288, current_setting('tests.avatar_variants')::jsonb));
select tests.clear_authentication();
select tests.authenticate_as(tests.id('owner'));
select public.fail_media_asset(tests.id('m2'));
select is((select status::text from public.media_assets where id = tests.id('m2')), 'pending', 'only the uploader can abandon its pending upload');
select tests.clear_authentication();
select tests.authenticate_as(tests.id('editor'));
select public.fail_media_asset(tests.id('m2'));
select public.fail_media_asset(tests.id('m1'));
select is(
  (select array_agg(status::text order by id) from public.media_assets where id in (tests.id('m1'), tests.id('m2'))),
  array['ready', 'failed'], 'a pending upload becomes failed; a ready asset is untouched');
select throws_ok(
  format('select public.activate_media_asset(%L, %L)', tests.id('m2'), pg_temp.sign('activate:' || tests.id('m2'))),
  '42501', null, 'a failed upload cannot be activated');

-- ---- Quota and rate limit --------------------------------------------------------------------------
select results_eq(
  format('select used_bytes, limit_bytes from public.workspace_storage_usage(%L)', tests.id('ws')),
  $$values (3333::bigint, 524288000::bigint)$$, 'usage counts live assets against the plan''s storage_mb');
select tests.clear_authentication();
select tests.authenticate_as(tests.id('outsider'));
select throws_ok(format('select * from public.workspace_storage_usage(%L)', tests.id('ws')), 'P0002', null, 'another workspace cannot read the usage');
select tests.clear_authentication();

update public.plan_entitlements set int_value = 1 where plan_id = 'agency' and key = 'storage_mb';
select set_config('tests.big_variants', '[{"w": 416, "h": 312, "bytes": 500000}, {"w": 832, "h": 624, "bytes": 600000}]', true);
select tests.authenticate_as(tests.id('editor'));
select throws_ok(
  format('select public.register_media_asset(%L, %L, %L, 832, 624, %L, %L)', tests.id('m3'), tests.id('page'), 'image', current_setting('tests.big_variants'),
    pg_temp.register_signature(tests.id('m3'), tests.id('page'), 'image', 832, 624, current_setting('tests.big_variants')::jsonb)),
  'LK010', null, 'an upload over the workspace quota is rejected by the database');
select is((select count(*)::int from public.media_assets where id = tests.id('m3')), 0, 'nothing is registered for the rejected upload');
select tests.clear_authentication();
update public.plan_entitlements set int_value = 500 where plan_id = 'agency' and key = 'storage_mb';

insert into public.media_assets (id, workspace_id, profile_id, kind, status, width, height, bytes, variants, created_by)
select gen_random_uuid(), tests.id('ws'), tests.id('page2'), 'image', 'failed', 300, 200, 10, '[{"w": 300, "h": 200, "bytes": 10}]', tests.id('owner')
from generate_series(1, 58);
select tests.authenticate_as(tests.id('editor'));
select throws_ok(
  format('select public.register_media_asset(%L, %L, %L, 832, 624, %L, %L)', tests.id('m3'), tests.id('page'), 'image', current_setting('tests.image_variants'),
    pg_temp.register_signature(tests.id('m3'), tests.id('page'), 'image', 832, 624, current_setting('tests.image_variants')::jsonb)),
  'LK061', null, 'more than 60 uploads per workspace per hour are rejected');
select tests.clear_authentication();
delete from public.media_assets where profile_id = tests.id('page2');

-- ---- Lifecycle: references from the draft and from retained publications ---------------------
-- m1 is used by the draft, then published, then removed from the draft.
select tests.authenticate_as(tests.id('editor'));
update public.profiles
set blocks = jsonb_build_array(jsonb_build_object('id', '7c000000-0000-4000-8000-000000000001', 'type', 'image', 'visible', true,
  'mediaId', tests.id('m1'), 'width', 832, 'height', 624, 'alt', 'Vitrine', 'decorative', false))
where id = tests.id('page');
select public.publish_profile(tests.id('page'));
update public.profiles set blocks = '[]' where id = tests.id('page');
select tests.clear_authentication();
update public.media_assets set created_at = now() - interval '3 days' where id in (tests.id('m1'), tests.id('m2'));

select ok(private.media_is_referenced(tests.id('m1'), tests.id('page')), 'an image only a retained publication uses is still referenced');
select tests.authenticate_service();
select is(
  (select array_agg(media_id order by media_id) from public.claim_media_cleanup(200) where media_id in (tests.id('m1'), tests.id('m2'))),
  array[tests.id('m2')], 'cleanup claims the abandoned upload and leaves the published image alone');
select is(
  (select object_names from public.claim_media_cleanup(200) where media_id = tests.id('m2')),
  array[tests.id('m2') || '/96.webp', tests.id('m2') || '/192.webp', tests.id('m2') || '/288.webp'],
  'a claimed asset comes with its object names, and claiming again returns it again');
select is(public.finish_media_cleanup(array[tests.id('m2'), tests.id('m1')]), 1, 'only assets in the deleting state are forgotten');
select tests.clear_authentication();
select is((select status::text from public.media_assets where id = tests.id('m1')), 'ready', 'the referenced asset was not touched');

-- Rollback target: after the page is taken off the air the snapshot is still retained.
select tests.authenticate_as(tests.id('editor'));
select public.unpublish_profile(tests.id('page'));
select tests.clear_authentication();
select ok(private.media_is_referenced(tests.id('m1'), tests.id('page')), 'unpublishing keeps the image: the version can still be restored');

-- A recent unreferenced upload (not saved in the draft yet) is inside the grace period.
select tests.authenticate_as(tests.id('editor'));
select public.register_media_asset(tests.id('m4'), tests.id('page'), 'image', 832, 624, current_setting('tests.image_variants')::jsonb,
  pg_temp.register_signature(tests.id('m4'), tests.id('page'), 'image', 832, 624, current_setting('tests.image_variants')::jsonb));
select tests.clear_authentication();
update public.media_assets set status = 'ready', activated_at = now() where id = tests.id('m4');
select tests.authenticate_service();
select is((select count(*)::int from public.claim_media_cleanup(200) where media_id in (tests.id('m1'), tests.id('m4'))), 0, 'a fresh unreferenced image and a fresh pending upload are not claimed');
select tests.clear_authentication();
update public.media_assets set created_at = now() - interval '25 hours' where id = tests.id('m4');
select tests.authenticate_as(tests.id('editor'));
select is((select used_bytes from public.workspace_storage_usage(tests.id('ws'))), 3333::bigint, 'an orphan past the grace period stops counting against the quota');
select tests.clear_authentication();
select tests.authenticate_service();
select is((select array_agg(media_id) from public.claim_media_cleanup(200) where media_id in (tests.id('m1'), tests.id('m4'))), array[tests.id('m4')], 'an old unreferenced image is claimed');
select is(public.finish_media_cleanup(array[tests.id('m4')]), 1, 'and forgotten once its objects are gone');
select tests.clear_authentication();

-- A page past its recovery period releases everything, referenced or not.
select throws_ok(format('delete from public.profiles where id = %L', tests.id('page')), '23503', null, 'a page cannot be purged while it still owns stored objects');
update public.profiles set deleted_at = now() - interval '40 days', purge_after = now() - interval '10 days' where id = tests.id('page');
select tests.authenticate_service();
select is((select array_agg(media_id) from public.claim_media_cleanup(200) where media_id = tests.id('m1')), array[tests.id('m1')], 'media of a page past its purge date is claimed even when referenced');
select tests.clear_authentication();

-- ---- Cleanup is not a user action ----------------------------------------------------------------
select tests.authenticate_as(tests.id('owner'));
select throws_ok('select * from public.claim_media_cleanup(10)', '42501', null, 'members cannot run cleanup');
select throws_ok(format('select public.finish_media_cleanup(array[%L]::uuid[])', tests.id('m1')), '42501', null, 'members cannot delete asset rows');
select throws_ok(format('delete from public.media_assets where id = %L', tests.id('m1')), '42501', null, 'members cannot delete asset rows directly');
select throws_ok(format($f$update public.media_assets set status = 'ready' where id = %L$f$, tests.id('m1')), '42501', null, 'members cannot change asset state directly');
select tests.clear_authentication();

-- ---- Without the secret, uploads stop instead of being accepted ------------------------------------
delete from vault.secrets where name = 'media_signing_secret';
update public.profiles set deleted_at = null, purge_after = null where id = tests.id('page');
select tests.authenticate_as(tests.id('editor'));
select throws_ok(
  format('select public.register_media_asset(%L, %L, %L, 832, 624, %L, %L)', tests.id('m5'), tests.id('page'), 'image', current_setting('tests.image_variants'), repeat('0', 64)),
  'LK090', null, 'registration fails closed when the signing secret is not configured');
select tests.clear_authentication();

select results_eq(
  $$select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'media'$$,
  $$values (true, 2097152::bigint, array['image/webp'])$$, 'the media bucket is public, WebP only, 2 MiB per object');
select is(
  (select array_agg(polname::text order by polname) from pg_policy p join pg_class c on c.oid = p.polrelid join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'storage' and c.relname = 'objects'),
  array['media_objects_insert_registered'], 'the insert policy is the only policy on storage.objects');

select * from finish();
rollback;
