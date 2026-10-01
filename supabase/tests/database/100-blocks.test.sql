-- Sprint 4: block types, URL policy, caps, optimistic concurrency, snapshot v2, old snapshots and
-- the social-links data migration. Mirrors apps/web/src/modules/blocks (ADR 0008).
begin;
select plan(41);

select tests.remember('owner', tests.create_user('owner4@example.test', 'Olívia'));
select tests.remember('editor', tests.create_user('editor4@example.test', 'Enzo'));
select tests.remember('outsider', tests.create_user('outsider4@example.test', 'Otávio'));

select tests.authenticate_as(tests.id('owner'));
select public.ensure_personal_workspace();
select tests.remember('ws', public.create_agency_workspace('Agência Blocos'));
select tests.clear_authentication();

update public.workspaces set plan_id = 'agency' where id = tests.id('ws');
insert into public.workspace_memberships (workspace_id, user_id, role, invited_by, accepted_at)
values (tests.id('ws'), tests.id('editor'), 'editor', tests.id('owner'), now());

select tests.authenticate_as(tests.id('owner'));
insert into public.profiles (workspace_id, title, slug) values (tests.id('ws'), 'Studio Blocos', 'studio-blocos');
select tests.remember('page', (select id from public.profiles where slug = 'studio-blocos'));
insert into public.profiles (workspace_id, title, slug) values (tests.id('ws'), 'Página Antiga', 'pagina-antiga-v1');
select tests.remember('old_page', (select id from public.profiles where slug = 'pagina-antiga-v1'));
insert into public.profiles (workspace_id, title, slug) values (tests.id('ws'), 'Redes Legadas', 'redes-legadas');
select tests.remember('legacy_page', (select id from public.profiles where slug = 'redes-legadas'));
select tests.clear_authentication();

select tests.authenticate_as(tests.id('outsider'));
select tests.remember('ws_out', public.ensure_personal_workspace());
select tests.clear_authentication();

-- ---- Every block type, written by an editor through the Data API -----------------------------
select tests.authenticate_as(tests.id('editor'));
select lives_ok(
  format($f$update public.profiles set title = 'Studio Blocos', bio = 'Bio', blocks = '[
    {"id":"7a000000-0000-4000-8000-000000000001","type":"social","visible":true,"items":[{"network":"instagram","url":"https://www.instagram.com/studio"},{"network":"tiktok","url":"https://www.tiktok.com/@studio"}]},
    {"id":"7a000000-0000-4000-8000-000000000002","type":"link","visible":true,"title":"Agenda","url":"https://exemplo.com.br/agenda"},
    {"id":"7a000000-0000-4000-8000-000000000003","type":"text","visible":true,"text":"Linha 1\nLinha 2 <b>texto</b>"},
    {"id":"7a000000-0000-4000-8000-000000000004","type":"whatsapp","visible":true,"label":"Fale comigo","phone":"5511912345678","message":"Olá!"},
    {"id":"7a000000-0000-4000-8000-000000000005","type":"divider","visible":true},
    {"id":"7a000000-0000-4000-8000-000000000006","type":"link","visible":false,"title":"Oculto","url":"mailto:oi@exemplo.com.br?subject=Ol%%C3%%A1"},
    {"id":"7a000000-0000-4000-8000-000000000007","type":"social","visible":true,"items":[]},
    {"id":"7a000000-0000-4000-8000-000000000008","type":"whatsapp","visible":true,"label":"Portugal","phone":"351912345678","message":""},
    {"id":"7a000000-0000-4000-8000-000000000009","type":"link","visible":true,"title":"Ligar","url":"tel:+5511912345678"}
  ]' where id = %L$f$, tests.id('page')),
  'an editor saves link, text, social, whatsapp and divider blocks');
select is((select draft_revision from public.profiles where id = tests.id('page')), 2::bigint, 'one save bumps draft_revision once');

-- ---- URL policy (same table as modules/blocks/url-cases.ts, hex-encoded) ---------------------
create temporary table malicious_urls (label text, value text) on commit drop;
insert into malicious_urls values
  ('javascript scheme', convert_from(decode('6a6176617363726970743a616c657274283129', 'hex'), 'UTF8')),
  ('mixed-case javascript', convert_from(decode('4a6156615363526950743a616c657274283129', 'hex'), 'UTF8')),
  ('leading space', convert_from(decode('206a6176617363726970743a616c657274283129', 'hex'), 'UTF8')),
  ('leading newline', convert_from(decode('0a6a6176617363726970743a616c657274283129', 'hex'), 'UTF8')),
  ('tab inside scheme', convert_from(decode('6a617661097363726970743a616c657274283129', 'hex'), 'UTF8')),
  ('control character inside scheme', convert_from(decode('6a617661017363726970743a616c657274283129', 'hex'), 'UTF8')),
  ('percent-encoded scheme', convert_from(decode('2536416176617363726970743a616c657274283129', 'hex'), 'UTF8')),
  ('decimal entity', convert_from(decode('26233130363b6176617363726970743a616c657274283129', 'hex'), 'UTF8')),
  ('hex entity', convert_from(decode('26237836413b6176617363726970743a616c657274283129', 'hex'), 'UTF8')),
  ('named entity colon', convert_from(decode('6a61766173637269707426636f6c6f6e3b616c657274283129', 'hex'), 'UTF8')),
  ('data URL', convert_from(decode('646174613a746578742f68746d6c3b6261736536342c50484e6a636d6c776444356862475679644367784b54777663324e796158423050673d3d', 'hex'), 'UTF8')),
  ('vbscript', convert_from(decode('76627363726970743a6d7367626f78283129', 'hex'), 'UTF8')),
  ('file', convert_from(decode('66696c653a2f2f2f6574632f706173737764', 'hex'), 'UTF8')),
  ('blob', convert_from(decode('626c6f623a68747470733a2f2f6578656d706c6f2e636f6d2e62722f30663363', 'hex'), 'UTF8')),
  ('about', convert_from(decode('61626f75743a626c616e6b', 'hex'), 'UTF8')),
  ('android intent', convert_from(decode('696e74656e743a2f2f7363616e2f23496e74656e743b736368656d653d7a78696e673b656e64', 'hex'), 'UTF8')),
  ('custom app scheme', convert_from(decode('77686174736170703a2f2f73656e643f70686f6e653d35353131393132333435363738', 'hex'), 'UTF8')),
  ('ftp', convert_from(decode('6674703a2f2f6578656d706c6f2e636f6d2e62722f6172717569766f', 'hex'), 'UTF8')),
  ('protocol-relative', convert_from(decode('2f2f6576696c2e6578616d706c652f6c6f67696e', 'hex'), 'UTF8')),
  ('relative path', convert_from(decode('2f6170702f772f313233', 'hex'), 'UTF8')),
  ('credentials', convert_from(decode('68747470733a2f2f757365723a70617373406578656d706c6f2e636f6d2e62722f', 'hex'), 'UTF8')),
  ('username only', convert_from(decode('68747470733a2f2f75736572406578656d706c6f2e636f6d2e62722f', 'hex'), 'UTF8')),
  ('whitespace inside', convert_from(decode('68747470733a2f2f6578656d706c6f2e636f6d2e62722f612062', 'hex'), 'UTF8')),
  ('bidi override', convert_from(decode('68747470733a2f2f6578656d706c6f2e636f6d2e62722fe280ae67706a2e657865', 'hex'), 'UTF8')),
  ('localhost', convert_from(decode('687474703a2f2f6c6f63616c686f73743a333030302f', 'hex'), 'UTF8')),
  ('IPv4 host', convert_from(decode('687474703a2f2f3139322e3136382e302e312f', 'hex'), 'UTF8')),
  ('mailto without address', convert_from(decode('6d61696c746f3a', 'hex'), 'UTF8')),
  ('tel without digits', convert_from(decode('74656c3a', 'hex'), 'UTF8'));
grant select on malicious_urls to authenticated;

select tests.clear_authentication();
select is(
  (select array_agg(label order by label) from malicious_urls where private.is_allowed_block_url(value)),
  null, 'the URL policy accepts none of the malicious destinations');
select is(
  (select array_agg(value order by value) from (values
    ('https://exemplo.com.br/'), ('http://exemplo.com.br/'), ('https://xn--caf-dma.com.br/menu'),
    ('https://exemplo.com.br:8080/a?x=1#y'), ('mailto:Ana@exemplo.com.br?subject=Ol%C3%A1'), ('tel:+5511912345678')
  ) v(value) where not private.is_allowed_block_url(value)),
  null, 'normalized destinations produced by the app are accepted');
select is(
  (select array_agg(value order by value) from (values ('https://Exemplo.com.br/'), ('exemplo.com.br'), ('https://exemplo.com.br/a%20b c'), (repeat('a', 2050))) v(value)
   where private.is_allowed_block_url(value)),
  null, 'non-normalized or oversized destinations are refused');

-- The same table through the trigger, as a signed-in editor bypassing the UI.
select tests.authenticate_as(tests.id('editor'));
do $$
declare
  v_case record;
  v_accepted text[] := '{}';
begin
  for v_case in select label, value from malicious_urls loop
    begin
      update public.profiles
      set blocks = jsonb_build_array(jsonb_build_object('id', '7a000000-0000-4000-8000-0000000000aa', 'type', 'link', 'visible', true, 'title', 'x', 'url', v_case.value))
      where id = tests.id('page');
      v_accepted := v_accepted || v_case.label;
    exception when sqlstate 'LK040' then
      null;
    end;
  end loop;
  perform set_config('tests.accepted_urls', array_to_string(v_accepted, ','), true);
end;
$$;
select is(current_setting('tests.accepted_urls'), '', 'the draft validator refuses every malicious link, even without the UI');

-- ---- Per-type validation ------------------------------------------------------------------------
select throws_ok(
  format($f$update public.profiles set blocks = jsonb_build_array(jsonb_build_object('id','7a000000-0000-4000-8000-0000000000b1','type','whatsapp','visible',true,'label','Zap','phone',%L,'message','')) where id = %L$f$, v.phone, tests.id('page')),
  'LK040', null, 'invalid WhatsApp number is rejected: ' || v.phone)
from (values ('+5511912345678'), ('5501912345678'), ('55119123456789'), ('1234567'), ('https://evil.example')) v(phone);
select throws_ok(
  format($f$update public.profiles set blocks = jsonb_build_array(jsonb_build_object('id','7a000000-0000-4000-8000-0000000000b2','type','text','visible',true,'text','a' || chr(7) || 'b')) where id = %L$f$, tests.id('page')),
  'LK040', null, 'control characters in text are rejected');
select throws_ok(
  format($f$update public.profiles set blocks = jsonb_build_array(jsonb_build_object('id','7a000000-0000-4000-8000-0000000000b3','type','text','visible',true,'text',repeat('x', 1001))) where id = %L$f$, tests.id('page')),
  'LK040', null, 'text longer than 1000 characters is rejected');
select throws_ok(
  format($f$update public.profiles set blocks = jsonb_build_array(jsonb_build_object('id','7a000000-0000-4000-8000-0000000000b4','type','link','visible',true,'title',repeat('x', 81),'url','https://exemplo.com.br/')) where id = %L$f$, tests.id('page')),
  'LK040', null, 'link titles longer than 80 characters are rejected');
select throws_ok(
  format($f$update public.profiles set blocks = '[{"id":"7a000000-0000-4000-8000-0000000000b5","type":"embed","visible":true,"html":"<script>"}]' where id = %L$f$, tests.id('page')),
  'LK040', null, 'unknown block types are rejected');
select throws_ok(
  format($f$update public.profiles set blocks = '[{"id":"7a000000-0000-4000-8000-0000000000b6","type":"divider","visible":true,"style":"x"}]' where id = %L$f$, tests.id('page')),
  'LK040', null, 'unexpected keys are rejected for every type');
select throws_ok(
  format($f$update public.profiles set blocks = '[{"id":"7a000000-0000-4000-8000-0000000000b7","type":"divider","visible":"true"}]' where id = %L$f$, tests.id('page')),
  'LK040', null, 'visible must be a boolean');
select throws_ok(
  format($f$update public.profiles set blocks = '[{"id":"7a000000-0000-4000-8000-0000000000b8","type":"social","visible":true,"items":[{"network":"instagram","url":"https://instagram.com.evil.example/a"}]}]' where id = %L$f$, tests.id('page')),
  'LK040', null, 'a social block keeps the per-network host allowlist');
select throws_ok(
  format($f$update public.profiles set blocks = '[{"id":"7a000000-0000-4000-8000-0000000000b9","type":"social","visible":true,"items":[{"network":"x","url":"https://x.com/a"},{"network":"x","url":"https://x.com/b"}]}]' where id = %L$f$, tests.id('page')),
  'LK040', null, 'a social block lists each network once');
select throws_ok(
  format($f$update public.profiles set blocks = '[{"id":"7a000000-0000-4000-8000-0000000000c1","type":"divider","visible":true},{"id":"7a000000-0000-4000-8000-0000000000c1","type":"divider","visible":true}]' where id = %L$f$, tests.id('page')),
  'LK040', null, 'duplicate block ids are rejected');

-- ---- Caps ----------------------------------------------------------------------------------------
select throws_ok(
  format($f$update public.profiles set blocks = (select jsonb_agg(jsonb_build_object('id', '7a000000-0000-4000-8000-' || lpad(i::text, 12, '0'), 'type', 'divider', 'visible', true)) from generate_series(1, 101) i) where id = %L$f$, tests.id('page')),
  '23514', null, 'more than 100 blocks is rejected');
select throws_ok(
  format($f$update public.profiles set blocks = (select jsonb_agg(jsonb_build_object('id', '7a000000-0000-4000-8000-' || lpad(i::text, 12, '0'), 'type', 'text', 'visible', true, 'text', repeat('x', 1000))) from generate_series(1, 70) i) where id = %L$f$, tests.id('page')),
  'LK040', null, 'a draft over 64 KiB is rejected');

-- ---- Optimistic concurrency ------------------------------------------------------------------
with stale as (
  update public.profiles set blocks = '[]' where id = tests.id('page') and draft_revision = 1 returning 1
)
select is((select count(*)::int from stale), 0, 'a save against a stale draft_revision changes nothing');
select is((select jsonb_array_length(blocks) from public.profiles where id = tests.id('page')), 9, 'the newer draft is intact after the stale save');
select tests.clear_authentication();

-- ---- Other tenants and anon --------------------------------------------------------------------
select tests.authenticate_as(tests.id('outsider'));
select is((select count(*)::int from public.profiles where id = tests.id('page')), 0, 'another workspace cannot read the draft');
with forged as (
  update public.profiles set blocks = '[]', title = 'Invadido' where id = tests.id('page') returning 1
)
select is((select count(*)::int from forged), 0, 'another workspace cannot write the draft with a forged profile id');
select throws_ok(
  format('update public.profiles set workspace_id = %L where id = %L', tests.id('ws'), (select id from public.profiles where workspace_id = tests.id('ws_out') limit 1)),
  '42501', null, 'the workspace of a page cannot be changed to reach another tenant');
select tests.clear_authentication();

select tests.authenticate_anon();
select throws_ok(format($f$update public.profiles set blocks = '[]' where id = %L$f$, tests.id('page')), '42501', null, 'anon cannot write drafts');
select throws_ok(format('select blocks from public.profiles where id = %L', tests.id('page')), '42501', null, 'anon cannot read drafts');
select tests.clear_authentication();

-- ---- Publishing: snapshot v2 keeps order and visibility ---------------------------------------
select tests.authenticate_as(tests.id('editor'));
select results_eq(format('select version, created from public.publish_profile(%L, 2)', tests.id('page')), $$values (1, true)$$, 'the editor publishes the reviewed revision');
select tests.clear_authentication();
select tests.remember('pub', (select live_publication_id from public.profiles where id = tests.id('page')));
select is((select schema_version from public.profile_publications where id = tests.id('pub')), 2::smallint, 'new snapshots are schema version 2');
select is(
  (select array_agg(b ->> 'id' order by ord) from public.profile_publications pp, jsonb_array_elements(pp.document -> 'blocks') with ordinality t(b, ord) where pp.id = tests.id('pub')),
  array['7a000000-0000-4000-8000-000000000001', '7a000000-0000-4000-8000-000000000002', '7a000000-0000-4000-8000-000000000003',
        '7a000000-0000-4000-8000-000000000004', '7a000000-0000-4000-8000-000000000005', '7a000000-0000-4000-8000-000000000008',
        '7a000000-0000-4000-8000-000000000009'],
  'the snapshot keeps draft order and drops hidden blocks and empty social rows');
select is(
  (select pp.document -> 'blocks' -> 3 from public.profile_publications pp where pp.id = tests.id('pub')),
  '{"id": "7a000000-0000-4000-8000-000000000004", "type": "whatsapp", "label": "Fale comigo", "phone": "5511912345678", "message": "Olá!"}'::jsonb,
  'published blocks carry explicit fields and no visible flag');
select is(
  (select pp.document ?| array['socialLinks', 'workspaceId', 'workspace_id'] from public.profile_publications pp where pp.id = tests.id('pub')),
  false, 'the v2 document has no page-level social links and no tenant identifiers');
select throws_ok(
  format($f$insert into public.profile_publications (profile_id, workspace_id, version, schema_version, document, source_revision) values (%L, %L, 50, 1, '{"schemaVersion": 2, "title": "x"}', 1)$f$, tests.id('page'), tests.id('ws')),
  '23514', null, 'schema_version must match the document');

-- ---- Pre-Sprint-4 snapshots stay readable ---------------------------------------------------------
insert into public.profile_publications (profile_id, workspace_id, version, schema_version, document, source_revision)
values (tests.id('old_page'), tests.id('ws'), 1, 1,
  '{"schemaVersion": 1, "title": "Página Antiga", "bio": "", "avatarPath": null, "socialLinks": [{"network": "instagram", "url": "https://www.instagram.com/antiga"}], "blocks": [{"id": "7a000000-0000-4000-8000-0000000000d1", "type": "link", "title": "Site", "url": "https://exemplo.com.br/"}]}',
  1);
update public.profiles
set live_publication_id = (select id from public.profile_publications where profile_id = tests.id('old_page')), status = 'published', published_at = now()
where id = tests.id('old_page');
select tests.authenticate_anon();
select results_eq(
  $$select state, (document ->> 'schemaVersion')::int, document -> 'socialLinks' -> 0 ->> 'network' from public.get_public_page('pagina-antiga-v1')$$,
  $$values ('published'::text, 1, 'instagram'::text)$$,
  'a schema version 1 snapshot is still served to visitors');
select tests.clear_authentication();

-- ---- Data migration: social_links -> leading social block -------------------------------------
update public.profiles
set social_links = '[{"network": "instagram", "url": "https://www.instagram.com/legado"}]',
    blocks = '[{"id": "7a000000-0000-4000-8000-0000000000e1", "type": "link", "visible": true, "title": "Site", "url": "https://exemplo.com.br/"}]'
where id = tests.id('legacy_page');
-- A page that already has a social block keeps its blocks even with legacy links present.
update public.profiles set social_links = '[{"network": "x", "url": "https://x.com/studio"}]' where id = tests.id('page');
select set_config('tests.legacy_revision', (select draft_revision::text from public.profiles where id = tests.id('legacy_page')), true);
select cmp_ok(private.migrate_social_links_to_blocks(), '>=', 1, 'the migration converts pages that still have page-level social links');
select is(
  (select jsonb_build_object('type', blocks -> 0 ->> 'type', 'visible', blocks -> 0 -> 'visible', 'items', blocks -> 0 -> 'items', 'next', blocks -> 1 ->> 'id')
   from public.profiles where id = tests.id('legacy_page')),
  '{"type": "social", "visible": true, "items": [{"network": "instagram", "url": "https://www.instagram.com/legado"}], "next": "7a000000-0000-4000-8000-0000000000e1"}'::jsonb,
  'the social links become the first block and the other blocks keep their order');
select is(
  (select draft_revision::text from public.profiles where id = tests.id('legacy_page')),
  current_setting('tests.legacy_revision'), 'the migration does not bump draft_revision');
select is(private.migrate_social_links_to_blocks(), 0, 'running the migration again changes nothing (idempotent)');
select is(
  (select jsonb_array_length(blocks) from public.profiles where id = tests.id('page')), 9,
  'a page that already has a social block is left alone');

select * from finish();
rollback;
