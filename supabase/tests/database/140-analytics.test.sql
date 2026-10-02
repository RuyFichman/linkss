-- Sprint 6: customer analytics (ADR 0011). Attested anonymous ingestion validated against the LIVE
-- publication, deduplication, the visit rule, rate limits, the UTM cardinality cap, the form_submit
-- event recorded by submit_form_lead, reporting-day boundaries, idempotent aggregation, purge,
-- tenant isolation of the read function and the audited export.
-- Mirrors apps/web/src/modules/analytics. The signing secret and the signature vector below are the
-- same ones apps/web/src/modules/analytics/analytics.test.ts computes (drift guard).
begin;
select plan(154);

-- The application server and the database share this secret; here it is the test value.
do $$
begin
  if exists (select 1 from vault.secrets where name = 'analytics_signing_secret') then
    perform vault.update_secret((select id from vault.secrets where name = 'analytics_signing_secret'), 'test-analytics-signing-secret-0123456789');
  else
    perform vault.create_secret('test-analytics-signing-secret-0123456789', 'analytics_signing_secret');
  end if;
end;
$$;

-- Hermetic: whatever the local database already holds must not change the counts below.
delete from public.analytics_events;
delete from public.analytics_daily;
delete from public.analytics_day_status;
delete from public.analytics_rate_hits;

-- What the application server does with ANALYTICS_SIGNING_SECRET.
create function pg_temp.sign(p_payload text)
returns text
language sql
security definer
as $$ select encode(extensions.hmac(convert_to(p_payload, 'UTF8'), convert_to('test-analytics-signing-secret-0123456789', 'UTF8'), 'sha256'), 'hex') $$;

create function pg_temp.ingest_text(p_payload text)
returns jsonb
language sql
security definer
as $$ select public.ingest_analytics_events(p_payload, pg_temp.sign(p_payload)) $$;

create function pg_temp.ingest(p_slug text, p_visitor text, p_events jsonb, p_view jsonb default '{"source": "instagram", "device": "mobile", "country": "BR"}', p_client text default null)
returns jsonb
language sql
security definer
as $$ select pg_temp.ingest_text(jsonb_build_object('v', 1, 'slug', p_slug, 'visitor', p_visitor, 'client', p_client, 'view', p_view, 'events', p_events)::text) $$;

-- One event of the batch; the id is derived from a number so retries can repeat it.
create function pg_temp.ev(p_n integer, p_type text, p_block text default null)
returns jsonb
language sql
as $$ select jsonb_build_object('id', 'e0000000-0000-4000-8000-' || lpad(p_n::text, 12, '0'), 'type', p_type, 'block', p_block) $$;

create function pg_temp.events_of(p_profile uuid)
returns bigint
language sql
security definer
as $$ select count(*) from public.analytics_events where profile_id = p_profile $$;

-- A raw event stored directly, as the ingestion would have stored it at `p_at`.
create function pg_temp.store(p_profile uuid, p_at timestamptz, p_type public.analytics_event_type, p_block text default null, p_source public.analytics_source default null, p_utm text default null)
returns void
language sql
security definer
as $$
  insert into public.analytics_events (profile_id, event_id, workspace_id, occurred_at, day, event_type, source, device, country, block_id, utm_source, utm_medium, utm_campaign)
  select p.id, gen_random_uuid(), p.workspace_id, p_at, private.analytics_local_day(p_at), p_type,
    case when p_type = 'page_view' then coalesce(p_source, 'direct') end,
    case when p_type = 'page_view' then 'mobile'::public.analytics_device end,
    case when p_type = 'page_view' then 'BR' end,
    p_block, p_utm, case when p_utm is not null then 'bio' end, case when p_utm is not null then 'primavera' end
  from public.profiles p where p.id = p_profile
$$;

create function pg_temp.daily_fingerprint()
returns text
language sql
security definer
as $$ select md5(coalesce(string_agg(d::text, ';' order by d.profile_id, d.day, d.dimension, d.key, d.event_type), '')) from public.analytics_daily d $$;

select tests.remember('owner', tests.create_user('owner8@example.test', 'Olívia'));
select tests.remember('editor', tests.create_user('editor8@example.test', 'Enzo'));
select tests.remember('outsider', tests.create_user('outsider8@example.test', 'Otávio'));

select tests.authenticate_as(tests.id('owner'));
select public.ensure_personal_workspace();
select tests.remember('ws', public.create_agency_workspace('Agência Dados'));
select tests.clear_authentication();

update public.workspaces set plan_id = 'agency' where id = tests.id('ws');
insert into public.workspace_memberships (workspace_id, user_id, role, invited_by, accepted_at)
values (tests.id('ws'), tests.id('editor'), 'editor', tests.id('owner'), now());

select tests.authenticate_as(tests.id('owner'));
insert into public.profiles (workspace_id, title, slug) values (tests.id('ws'), 'Studio Dados', 'studio-dados');
select tests.remember('page', (select id from public.profiles where slug = 'studio-dados'));
insert into public.profiles (workspace_id, title, slug) values (tests.id('ws'), 'Rascunho Dados', 'rascunho-dados');
select tests.remember('draft_page', (select id from public.profiles where slug = 'rascunho-dados'));
insert into public.profiles (workspace_id, title, slug) values (tests.id('ws'), 'Outra Dados', 'outra-dados');
select tests.remember('other_page', (select id from public.profiles where slug = 'outra-dados'));
update public.profiles set blocks = '[
  {"id":"a6000000-0000-4000-8000-000000000001","type":"link","visible":true,"title":"Site","url":"https://exemplo.com.br/"},
  {"id":"a6000000-0000-4000-8000-000000000002","type":"social","visible":true,"items":[{"network":"instagram","url":"https://instagram.com/studio"}]},
  {"id":"a6000000-0000-4000-8000-000000000003","type":"whatsapp","visible":true,"label":"Fale comigo","phone":"5511912345678","message":""},
  {"id":"a6000000-0000-4000-8000-000000000004","type":"pix","visible":true,"label":"Pagar","keyType":"random","key":"123e4567-e89b-42d3-a456-426614174000","paymentUrl":"https://pag.exemplo.com.br/x"},
  {"id":"a6000000-0000-4000-8000-000000000005","type":"embed","visible":true,"provider":"youtube","ref":"dQw4w9WgXcQ","title":"Vídeo"},
  {"id":"a6000000-0000-4000-8000-000000000006","type":"form","visible":true,"title":"Contato","fields":["email"],"buttonLabel":"Enviar","consentText":"Aceito.","consentRequired":false},
  {"id":"a6000000-0000-4000-8000-000000000007","type":"link","visible":false,"title":"Oculto","url":"https://exemplo.com.br/oculto"},
  {"id":"a6000000-0000-4000-8000-000000000008","type":"text","visible":true,"text":"Olá"}
]' where id = tests.id('page');
select public.publish_profile(tests.id('page'));
-- Added to the draft after publishing: not on the air.
update public.profiles set blocks = blocks || '[{"id":"a6000000-0000-4000-8000-000000000009","type":"link","visible":true,"title":"Só no rascunho","url":"https://exemplo.com.br/novo"}]'::jsonb where id = tests.id('page');
update public.profiles set blocks = '[{"id":"a6000000-0000-4000-8000-00000000000a","type":"link","visible":true,"title":"Nunca publicado","url":"https://exemplo.com.br/"}]' where id = tests.id('draft_page');
update public.profiles set blocks = '[{"id":"a6000000-0000-4000-8000-00000000000b","type":"link","visible":true,"title":"Outra","url":"https://exemplo.com.br/"}]' where id = tests.id('other_page');
select public.publish_profile(tests.id('other_page'));
select tests.clear_authentication();

select tests.authenticate_as(tests.id('outsider'));
select public.ensure_personal_workspace();
select tests.clear_authentication();

select set_config('tests.today', private.analytics_today()::text, true);
select set_config('tests.link', 'a6000000-0000-4000-8000-000000000001', true);
select set_config('tests.social', 'a6000000-0000-4000-8000-000000000002', true);
select set_config('tests.whatsapp', 'a6000000-0000-4000-8000-000000000003', true);
select set_config('tests.pix', 'a6000000-0000-4000-8000-000000000004', true);
select set_config('tests.embed', 'a6000000-0000-4000-8000-000000000005', true);
select set_config('tests.form', 'a6000000-0000-4000-8000-000000000006', true);
select set_config('tests.va', repeat('a', 32), true);
select set_config('tests.vb', repeat('b', 32), true);
-- The vector analytics.test.ts signs with the same secret.
select set_config('tests.vector', '{"v":1,"slug":"studio-dados","visitor":null,"client":null,"view":{"source":"direct","device":"mobile","country":"ZZ","utm_source":null,"utm_medium":null,"utm_campaign":null},"events":[{"id":"e0000000-0000-4000-8000-000000000001","type":"page_view","block":null}]}', true);

-- ---- Structure and privileges ---------------------------------------------------------------------
select is(pg_temp.sign(current_setting('tests.vector')), '627bc7f51778e91d291b85981d5935056aafd7b4ec37c2b4764b3b59e87ba9da',
  'the database computes the same signature as the application for the shared vector');
select ok(has_function_privilege('anon', 'public.ingest_analytics_events(text, text)', 'execute'), 'anon may call the ingestion RPC');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('run_analytics_maintenance', 'get_profile_analytics', 'record_analytics_export')
     and has_function_privilege('anon', p.oid, 'execute')),
  0, 'anon cannot run the job, read a report or record an export');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'run_analytics_maintenance'
     and (has_function_privilege('authenticated', p.oid, 'execute') or not has_function_privilege('service_role', p.oid, 'execute'))),
  0, 'the job is executable by the service role only');
select is(
  (select count(*)::int from information_schema.role_table_grants
   where grantee in ('anon', 'authenticated') and table_schema = 'public' and table_name like 'analytics_%'),
  0, 'no client role holds any privilege on the analytics tables');
select is(
  (select array_agg(column_name::text order by column_name) from information_schema.columns
   where table_schema = 'public' and table_name like 'analytics_%' and column_name ~* '(^|_)(ip|address|user_agent|referrer|referer|url|path)($|_)'),
  null, 'no column stores an IP address, user agent, referrer or URL');
select is((select reporting_timezone from public.analytics_settings), 'America/Sao_Paulo', 'the reporting timezone is a stored setting');
select throws_ok($$update public.analytics_settings set reporting_timezone = 'Mars/Olympus'$$, null, null, 'an unknown timezone cannot be stored');

-- ---- Visitor: happy path through the real grant -----------------------------------------------------
select set_config('tests.vector_signature', pg_temp.sign(current_setting('tests.vector')), true);
select tests.authenticate_anon();
select is(
  public.ingest_analytics_events(current_setting('tests.vector'), current_setting('tests.vector_signature')) ->> 'accepted',
  '1', 'anon stores a signed page view of a published page');
select throws_ok('select 1 from public.analytics_events limit 1', '42501', null, 'anon cannot read raw events');
select throws_ok('select 1 from public.analytics_daily limit 1', '42501', null, 'anon cannot read aggregates');
select throws_ok('select 1 from public.analytics_day_status limit 1', '42501', null, 'anon cannot read the watermark');
select throws_ok('select 1 from public.analytics_settings limit 1', '42501', null, 'anon cannot read the settings');
select throws_ok(
  format($f$insert into public.analytics_events (profile_id, event_id, workspace_id, day, event_type) values (%L, gen_random_uuid(), %L, current_date, 'page_view')$f$, tests.id('page'), tests.id('ws')),
  '42501', null, 'anon cannot insert events directly');
select is(
  public.ingest_analytics_events(current_setting('tests.vector'), repeat('0', 64)) ->> 'status',
  'forbidden', 'a payload with a wrong signature is refused');
select is(
  public.ingest_analytics_events(current_setting('tests.vector'), null) ->> 'status',
  'forbidden', 'a payload without a signature is refused');
select is(
  public.ingest_analytics_events(replace(current_setting('tests.vector'), 'studio-dados', 'outra-dados'), current_setting('tests.vector_signature')) ->> 'status',
  'forbidden', 'a signature cannot be reused for another page');
select tests.clear_authentication();
select is(pg_temp.events_of(tests.id('other_page')), 0::bigint, 'and nothing was stored for it');

-- ---- Every event type ------------------------------------------------------------------------------
select is(
  pg_temp.ingest('studio-dados', current_setting('tests.va'), jsonb_build_array(
    pg_temp.ev(10, 'page_view'),
    pg_temp.ev(11, 'link_click', current_setting('tests.link')),
    pg_temp.ev(12, 'social_click', current_setting('tests.social')),
    pg_temp.ev(13, 'whatsapp_click', current_setting('tests.whatsapp')),
    pg_temp.ev(14, 'pix_copy', current_setting('tests.pix')),
    pg_temp.ev(15, 'pix_pay_click', current_setting('tests.pix')),
    pg_temp.ev(16, 'embed_load', current_setting('tests.embed')),
    pg_temp.ev(17, 'badge_click')),
    '{"source": "instagram", "device": "mobile", "country": "BR", "utm_source": "instagram", "utm_medium": "bio", "utm_campaign": "primavera"}'),
  '{"status": "ok", "accepted": 8, "duplicate": 0, "repeat": 0, "rejected": 0, "rate_limited": 0}'::jsonb,
  'a batch with every client event type is accepted');
select results_eq(
  format($f$select source::text, device::text, country, utm_source, utm_medium, utm_campaign, block_id, visitor_hash, workspace_id, day
    from public.analytics_events where profile_id = %L and event_id = 'e0000000-0000-4000-8000-000000000010'$f$, tests.id('page')),
  format($f$values ('instagram', 'mobile', 'BR', 'instagram', 'bio', 'primavera', null::text, %L, %L::uuid, current_setting('tests.today')::date)$f$, repeat('a', 32), tests.id('ws')),
  'a page view stores its dimensions, the salted hash, its tenant and the reporting day');
select is(
  (select count(*)::int from public.analytics_events
   where profile_id = tests.id('page') and event_type <> 'page_view'
     and (source is not null or device is not null or country is not null or utm_source is not null)),
  0, 'action events carry no visit dimensions');
select is(
  (select block_id from public.analytics_events where profile_id = tests.id('page') and event_type = 'pix_copy'),
  current_setting('tests.pix'), 'a block event stores the block it happened on');

-- ---- Deduplication ---------------------------------------------------------------------------------
select is(
  pg_temp.ingest('studio-dados', current_setting('tests.va'), jsonb_build_array(pg_temp.ev(11, 'link_click', current_setting('tests.link')))),
  '{"status": "ok", "accepted": 0, "duplicate": 1, "repeat": 0, "rejected": 0, "rate_limited": 0}'::jsonb,
  'the same event sent again is a duplicate, not an error');
select is(
  pg_temp.ingest('studio-dados', current_setting('tests.va'), jsonb_build_array(
    pg_temp.ev(10, 'page_view'), pg_temp.ev(11, 'link_click', current_setting('tests.link')), pg_temp.ev(12, 'social_click', current_setting('tests.social')),
    pg_temp.ev(13, 'whatsapp_click', current_setting('tests.whatsapp')), pg_temp.ev(14, 'pix_copy', current_setting('tests.pix')),
    pg_temp.ev(15, 'pix_pay_click', current_setting('tests.pix')), pg_temp.ev(16, 'embed_load', current_setting('tests.embed')), pg_temp.ev(17, 'badge_click'))) ->> 'duplicate',
  '8', 'the same batch sent again is stored once');
select is(pg_temp.events_of(tests.id('page')), 9::bigint, 'and the table holds each event once');
select is(
  pg_temp.ingest('studio-dados', current_setting('tests.va'), jsonb_build_array(pg_temp.ev(18, 'link_click', current_setting('tests.link')), pg_temp.ev(18, 'link_click', current_setting('tests.link')))),
  '{"status": "ok", "accepted": 1, "duplicate": 1, "repeat": 0, "rejected": 0, "rate_limited": 0}'::jsonb,
  'an id repeated inside one batch is stored once');
select is(
  pg_temp.ingest('outra-dados', current_setting('tests.va'), jsonb_build_array(pg_temp.ev(10, 'page_view'))) ->> 'accepted',
  '1', 'the deduplication scope is the page: the same id on another page is another event');

-- ---- Malformed payloads ----------------------------------------------------------------------------
select is(pg_temp.ingest_text(v.payload) ->> 'status', v.status, 'payload answers ' || v.status || ': ' || v.label)
from (values
  ('not JSON', 'invalid', '{"v":1,'),
  ('not an object', 'invalid', '[1]'),
  ('missing address', 'invalid', '{"v":1,"events":[{"id":"e0000000-0000-4000-8000-000000000020","type":"page_view"}]}'),
  ('events is not a list', 'invalid', '{"v":1,"slug":"studio-dados","events":{}}'),
  ('empty batch', 'invalid', '{"v":1,"slug":"studio-dados","events":[]}'),
  ('unknown contract version', 'unsupported', '{"v":2,"slug":"studio-dados","events":[{"id":"e0000000-0000-4000-8000-000000000020","type":"page_view"}]}'),
  ('version as text', 'unsupported', '{"v":"1","slug":"studio-dados","events":[{"id":"e0000000-0000-4000-8000-000000000020","type":"page_view"}]}'),
  ('malformed address', 'unavailable', '{"v":1,"slug":"../etc/passwd","events":[{"id":"e0000000-0000-4000-8000-000000000020","type":"page_view"}]}'),
  ('unknown address', 'unavailable', '{"v":1,"slug":"nao-existe-aqui","events":[{"id":"e0000000-0000-4000-8000-000000000020","type":"page_view"}]}'),
  ('a page that was never published', 'unavailable', '{"v":1,"slug":"rascunho-dados","events":[{"id":"e0000000-0000-4000-8000-000000000020","type":"page_view"}]}'),
  ('a reserved address', 'unavailable', '{"v":1,"slug":"entrar","events":[{"id":"e0000000-0000-4000-8000-000000000020","type":"page_view"}]}')
) v(label, status, payload);
select is(
  pg_temp.ingest('studio-dados', null, (select jsonb_agg(pg_temp.ev(100 + n, 'badge_click')) from generate_series(1, 11) n)) ->> 'status',
  'invalid', 'a batch with more than 10 events is refused');
select is(
  pg_temp.ingest_text(jsonb_build_object('v', 1, 'slug', 'studio-dados', 'junk', repeat('x', 9000), 'events', jsonb_build_array(pg_temp.ev(21, 'page_view')))::text) ->> 'status',
  'invalid', 'an oversized payload is refused');
select is(public.ingest_analytics_events(null, null) ->> 'status', 'invalid', 'a null payload is refused');

-- ---- Events that are rejected one by one -----------------------------------------------------------
select is(
  pg_temp.ingest('studio-dados', current_setting('tests.vb'), jsonb_build_array(v.event)),
  '{"status": "ok", "accepted": 0, "duplicate": 0, "repeat": 0, "rejected": 1, "rate_limited": 0}'::jsonb,
  'event is rejected: ' || v.label)
from (values
  ('unknown type', '{"id":"e0000000-0000-4000-8000-000000000030","type":"purchase"}'::jsonb),
  ('form_submit sent by a client', jsonb_build_object('id', 'e0000000-0000-4000-8000-000000000031', 'type', 'form_submit', 'block', current_setting('tests.form'))),
  ('malformed id', '{"id":"not-a-uuid","type":"page_view"}'::jsonb),
  ('uppercase id', '{"id":"E0000000-0000-4000-8000-000000000032","type":"page_view"}'::jsonb),
  ('id is not text', '{"id":42,"type":"page_view"}'::jsonb),
  ('not an object', '"page_view"'::jsonb),
  ('page view naming a block', jsonb_build_object('id', 'e0000000-0000-4000-8000-000000000033', 'type', 'page_view', 'block', current_setting('tests.link'))),
  ('block event without a block', '{"id":"e0000000-0000-4000-8000-000000000034","type":"link_click"}'::jsonb),
  ('block that is not in the publication', '{"id":"e0000000-0000-4000-8000-000000000035","type":"link_click","block":"a6000000-0000-4000-8000-0000000000ff"}'::jsonb),
  ('hidden block (not in the snapshot)', '{"id":"e0000000-0000-4000-8000-000000000036","type":"link_click","block":"a6000000-0000-4000-8000-000000000007"}'::jsonb),
  ('block that exists only in the draft', '{"id":"e0000000-0000-4000-8000-000000000037","type":"link_click","block":"a6000000-0000-4000-8000-000000000009"}'::jsonb),
  ('block of another page', '{"id":"e0000000-0000-4000-8000-000000000038","type":"link_click","block":"a6000000-0000-4000-8000-00000000000b"}'::jsonb),
  ('event type that does not match the block type', jsonb_build_object('id', 'e0000000-0000-4000-8000-000000000039', 'type', 'whatsapp_click', 'block', current_setting('tests.link'))),
  ('click on a block that has no action', '{"id":"e0000000-0000-4000-8000-00000000003a","type":"link_click","block":"a6000000-0000-4000-8000-000000000008"}'::jsonb),
  ('arbitrary text as block', '{"id":"e0000000-0000-4000-8000-00000000003b","type":"link_click","block":"<script>alert(1)</script>"}'::jsonb),
  ('legacy social id on a version-2 page', '{"id":"e0000000-0000-4000-8000-00000000003c","type":"social_click","block":"legacy-social"}'::jsonb)
) v(label, event);

-- ---- Dimensions are closed sets --------------------------------------------------------------------
select is(
  pg_temp.ingest('studio-dados', current_setting('tests.vb'), jsonb_build_array(pg_temp.ev(40, 'page_view')), v.view) ->> 'rejected',
  '1', 'a page view is rejected: ' || v.label)
from (values
  ('a referrer address instead of a source', '{"source": "https://l.instagram.com/?u=https%3A%2F%2Fexemplo.com%2Fa%3Fb%3D1", "device": "mobile", "country": "BR"}'::jsonb),
  ('unknown source', '{"source": "myspace", "device": "mobile", "country": "BR"}'::jsonb),
  ('missing source', '{"device": "mobile", "country": "BR"}'::jsonb),
  ('a user agent instead of a device class', '{"source": "direct", "device": "Mozilla/5.0 (iPhone)", "country": "BR"}'::jsonb)
) v(label, view);
select is(
  pg_temp.ingest('studio-dados', current_setting('tests.vb'), jsonb_build_array(pg_temp.ev(41, 'page_view')),
    jsonb_build_object('source', 'other', 'device', 'desktop', 'country', 'brazil; drop table', 'utm_source', 'Instagram?x=1', 'utm_medium', 'bio', 'utm_campaign', 'c')) ->> 'accepted',
  '1', 'a page view with a hostile country and UTM source is still counted');
select results_eq(
  format($f$select country, utm_source, utm_medium, utm_campaign from public.analytics_events where profile_id = %L and event_id = 'e0000000-0000-4000-8000-000000000041'$f$, tests.id('page')),
  $$values ('ZZ', null::text, null::text, null::text)$$,
  'with the country as unknown and without any UTM value (medium and campaign need a valid source)');
update public.analytics_events set occurred_at = occurred_at - interval '31 minutes' where profile_id = tests.id('page') and event_id = 'e0000000-0000-4000-8000-000000000041';
select is(
  pg_temp.ingest('studio-dados', current_setting('tests.vb'), jsonb_build_array(pg_temp.ev(42, 'page_view')),
    jsonb_build_object('source', 'other', 'device', 'desktop', 'country', 'PT', 'utm_source', 'newsletter', 'utm_medium', repeat('x', 41), 'utm_campaign', '=cmd|calc')) ->> 'accepted',
  '1', 'a page view with an oversized medium and a formula as campaign is counted');
select results_eq(
  format($f$select country, utm_source, utm_medium, utm_campaign from public.analytics_events where profile_id = %L and event_id = 'e0000000-0000-4000-8000-000000000042'$f$, tests.id('page')),
  $$values ('PT', 'newsletter', null::text, null::text)$$,
  'keeping the valid source and dropping the oversized and the hostile value');

-- ---- Visit rule ------------------------------------------------------------------------------------
select is(
  pg_temp.ingest('studio-dados', current_setting('tests.va'), jsonb_build_array(pg_temp.ev(50, 'page_view'))),
  '{"status": "ok", "accepted": 0, "duplicate": 0, "repeat": 1, "rejected": 0, "rate_limited": 0}'::jsonb,
  'a second view from the same visitor within 30 minutes is not a new visit');
select is(
  pg_temp.ingest('studio-dados', repeat('c', 32), jsonb_build_array(pg_temp.ev(51, 'page_view'), pg_temp.ev(52, 'page_view'))),
  '{"status": "ok", "accepted": 1, "duplicate": 0, "repeat": 1, "rejected": 0, "rate_limited": 0}'::jsonb,
  'another visitor is a visit, once, even with two views in one batch');
update public.analytics_events set occurred_at = occurred_at - interval '31 minutes'
where profile_id = tests.id('page') and event_type = 'page_view' and visitor_hash = repeat('a', 32);
select is(
  pg_temp.ingest('studio-dados', current_setting('tests.va'), jsonb_build_array(pg_temp.ev(53, 'page_view'))) ->> 'accepted',
  '1', 'after 30 minutes the same visitor counts as a new visit');
select is(
  pg_temp.ingest('outra-dados', current_setting('tests.va'), jsonb_build_array(pg_temp.ev(54, 'page_view'))) ->> 'repeat',
  '1', 'the visit window is per page');

-- ---- Rate limits -----------------------------------------------------------------------------------
select is(
  (select sum((pg_temp.ingest('studio-dados', repeat('d', 32), (select jsonb_agg(pg_temp.ev(1000 + batch * 10 + n, 'badge_click')) from generate_series(1, 10) n)) ->> 'accepted')::int)
   from generate_series(0, 5) batch),
  60::bigint, 'an address stores 60 events on a page in 10 minutes');
select is(
  pg_temp.ingest('studio-dados', repeat('d', 32), jsonb_build_array(pg_temp.ev(1100, 'badge_click'), pg_temp.ev(1101, 'link_click', current_setting('tests.link')))),
  '{"status": "ok", "accepted": 0, "duplicate": 0, "repeat": 0, "rejected": 0, "rate_limited": 2}'::jsonb,
  'the 61st event of that address is rate limited');
select is(
  pg_temp.ingest('studio-dados', repeat('e', 32), jsonb_build_array(pg_temp.ev(1102, 'badge_click'))) ->> 'accepted',
  '1', 'another address is not affected');
-- Same address (first half of the hash), a different user agent on every request (second half).
select is(
  (select sum((pg_temp.ingest('studio-dados', repeat('9', 16) || substr(md5(batch::text), 1, 16), (select jsonb_agg(pg_temp.ev(1400 + batch * 10 + n, 'badge_click')) from generate_series(1, 10) n)) ->> 'accepted')::int)
   from generate_series(0, 6) batch),
  60::bigint, 'rotating the user agent does not open a new bucket: the limit is per address');
select is(
  pg_temp.ingest('studio-dados', repeat('d', 32), jsonb_build_array(pg_temp.ev(1001, 'badge_click'))) ->> 'duplicate',
  '1', 'a retry of a stored event is still answered as a duplicate while the visitor is limited');
select is(
  (select sum((pg_temp.ingest('studio-dados', case when batch = 0 then null else 'forged-hash' end, (select jsonb_agg(pg_temp.ev(1200 + batch * 10 + n, 'badge_click')) from generate_series(1, 10) n)) ->> 'accepted')::int)
   from generate_series(0, 6) batch),
  59::bigint, 'requests without a valid hash share one bucket of 60 events (one was stored without a hash above)');
select is(pg_temp.events_of(tests.id('other_page')), 1::bigint, 'limits of one page do not spill into another');

select pg_temp.store(tests.id('other_page'), now() - interval '30 minutes', 'badge_click') from generate_series(1, 1999);
select is(
  pg_temp.ingest('outra-dados', repeat('f', 32), jsonb_build_array(pg_temp.ev(1300, 'page_view'), pg_temp.ev(1301, 'badge_click'))),
  '{"status": "ok", "accepted": 0, "duplicate": 0, "repeat": 0, "rejected": 0, "rate_limited": 2}'::jsonb,
  'a page stores at most 2,000 events per hour');
update public.analytics_events set occurred_at = occurred_at - interval '1 hour' where profile_id = tests.id('other_page');
select is(
  pg_temp.ingest('outra-dados', repeat('f', 32), jsonb_build_array(pg_temp.ev(1300, 'page_view'))) ->> 'accepted',
  '1', 'and accepts events again when the hour has passed');
delete from public.analytics_events where profile_id = tests.id('other_page');

-- ---- The same address across pages (the counter holds no page) ------------------------------------
select set_config('tests.client', repeat('7', 32), true);
select is(
  pg_temp.ingest('outra-dados', repeat('3', 32), jsonb_build_array(pg_temp.ev(1500, 'badge_click'), pg_temp.ev(1501, 'badge_click')), p_client => current_setting('tests.client')) ->> 'accepted',
  '2', 'events of an address are counted across pages');
select results_eq(
  $$select count, window_start = date_bin(interval '10 minutes', now(), timestamptz '2000-01-01 00:00:00+00') from public.analytics_rate_hits where client_hash = current_setting('tests.client')$$,
  $$values (2, true)$$, 'in one counter per 10-minute window');
select is(
  (select array_agg(column_name::text order by ordinal_position) from information_schema.columns where table_schema = 'public' and table_name = 'analytics_rate_hits'),
  array['client_hash', 'window_start', 'count'], 'the counter holds a hash, a window and a count: no page, workspace or event');
update public.analytics_rate_hits set count = 195 where client_hash = current_setting('tests.client');
select is(
  pg_temp.ingest('studio-dados', repeat('4', 32), (select jsonb_agg(pg_temp.ev(1510 + n, 'badge_click')) from generate_series(1, 10) n), p_client => current_setting('tests.client')),
  '{"status": "ok", "accepted": 5, "duplicate": 0, "repeat": 0, "rejected": 0, "rate_limited": 5}'::jsonb,
  'an address stores at most 200 events per window across all pages, whatever page it sends to');
select is((select count from public.analytics_rate_hits where client_hash = current_setting('tests.client')), 200, 'and the counter stops at the limit');
update public.analytics_rate_hits set count = 5, window_start = window_start - interval '2 hours' where client_hash = current_setting('tests.client');
insert into public.analytics_rate_hits (client_hash, window_start, count)
select current_setting('tests.client'), date_bin(interval '10 minutes', now(), timestamptz '2000-01-01 00:00:00+00') - n * interval '10 minutes', 199 from generate_series(1, 10) n;
select is(
  pg_temp.ingest('outra-dados', repeat('5', 32), (select jsonb_agg(pg_temp.ev(1530 + n, 'badge_click')) from generate_series(1, 10) n), p_client => current_setting('tests.client')),
  '{"status": "ok", "accepted": 5, "duplicate": 0, "repeat": 0, "rejected": 0, "rate_limited": 5}'::jsonb,
  'and at most 2,000 per day');
select is(
  pg_temp.ingest('outra-dados', repeat('6', 32), jsonb_build_array(pg_temp.ev(1550, 'badge_click')), p_client => repeat('8', 32)) ->> 'accepted',
  '1', 'another address is not affected');
select is(
  pg_temp.ingest('outra-dados', repeat('6', 32), jsonb_build_array(pg_temp.ev(1551, 'badge_click')), p_client => 'not-a-hash') ->> 'accepted',
  '1', 'a malformed client hash is ignored (the page limits still apply)');
select is((select count(*)::int from public.analytics_rate_hits where client_hash !~ '^[0-9a-f]{32}$'), 0, 'and never stored');

-- ---- Capacity guard --------------------------------------------------------------------------------
update public.analytics_settings set max_raw_events = 0;
select is(
  pg_temp.ingest('studio-dados', repeat('6', 32), jsonb_build_array(pg_temp.ev(1560, 'badge_click'))),
  '{"status": "shedding"}'::jsonb, 'at the capacity guard of the raw table every event is shed');
select is(public.ingest_analytics_events(current_setting('tests.vector'), repeat('0', 64)) ->> 'status', 'forbidden', 'an unsigned caller still learns nothing while shedding');
update public.analytics_settings set max_raw_events = 500000;
select is(
  pg_temp.ingest('outra-dados', repeat('6', 32), jsonb_build_array(pg_temp.ev(1561, 'badge_click'))) ->> 'accepted',
  '1', 'and ingestion resumes when the table is below the guard again');
delete from public.analytics_events where profile_id = tests.id('other_page');

-- ---- UTM cardinality cap ---------------------------------------------------------------------------
select is(
  (select sum((pg_temp.ingest('outra-dados', md5('utm' || n), jsonb_build_array(pg_temp.ev(2000 + n, 'page_view')),
      jsonb_build_object('source', 'other', 'device', 'mobile', 'country', 'BR', 'utm_source', 'fonte-' || n, 'utm_medium', 'm', 'utm_campaign', 'c')) ->> 'accepted')::int)
   from generate_series(1, 22) n),
  22::bigint, 'page views with 22 different UTM triples are all counted');
select is(
  (select count(distinct (utm_source, utm_medium, utm_campaign))::int from public.analytics_events where profile_id = tests.id('other_page') and utm_source is not null),
  20, 'but only 20 distinct triples per page per day are stored');
select is(
  (select count(*)::int from public.analytics_events where profile_id = tests.id('other_page') and event_type = 'page_view' and utm_source is null),
  2, 'the views beyond the cap are stored without UTM values');
select is(
  pg_temp.ingest('outra-dados', md5('utm-again'), jsonb_build_array(pg_temp.ev(2100, 'page_view')),
    jsonb_build_object('source', 'other', 'device', 'mobile', 'country', 'BR', 'utm_source', 'fonte-1', 'utm_medium', 'm', 'utm_campaign', 'c')) ->> 'accepted',
  '1', 'a triple that already exists today is still accepted at the cap');
select is(
  (select utm_source from public.analytics_events where profile_id = tests.id('other_page') and event_id = 'e0000000-0000-4000-8000-000000002100'),
  'fonte-1', 'and keeps its UTM values');
delete from public.analytics_events where profile_id = tests.id('other_page');

-- ---- Form submission is recorded by the database -------------------------------------------------
select tests.authenticate_anon();
select is(public.submit_form_lead('studio-dados', current_setting('tests.form'), '{"email": "ana@exemplo.com.br"}', false, '', repeat('a', 32)), 'ok', 'a visitor submits the form');
select is(public.submit_form_lead('studio-dados', current_setting('tests.form'), '{"email": "ana@exemplo.com.br"}', false, '', repeat('a', 32)), 'ok', 'and the retry answers ok');
select is(public.submit_form_lead('studio-dados', current_setting('tests.form'), '{"email": "nao-e-email"}', false, '', repeat('a', 32)), 'invalid', 'an invalid submission is refused');
select tests.clear_authentication();
select results_eq(
  format($f$select block_id, visitor_hash, source::text, day from public.analytics_events where profile_id = %L and event_type = 'form_submit'$f$, tests.id('page')),
  format($f$values (%L, null::text, null::text, current_setting('tests.today')::date)$f$, current_setting('tests.form')),
  'exactly one form_submit event exists: stored with the lead, not on the retry or the refusal, and without a visitor hash');
select is((select count(*)::int from public.form_leads where profile_id = tests.id('page')), 1, 'next to exactly one lead');

-- ---- Reporting day ---------------------------------------------------------------------------------
select is(private.analytics_local_day('2026-10-03 02:59:00+00'), date '2026-10-02', '23:59 in São Paulo belongs to that day');
select is(private.analytics_local_day('2026-10-03 03:01:00+00'), date '2026-10-03', '00:01 in São Paulo belongs to the next day');
select is(private.analytics_local_day('2026-10-02 23:59:00+00'), date '2026-10-02', '23:59 UTC is still the same São Paulo day');
select is(private.analytics_local_day('2026-10-03 00:01:00+00'), date '2026-10-02', 'and so is 00:01 UTC: the UTC date change does not change the reporting day');
select is(private.analytics_day_start(date '2026-10-03'), timestamptz '2026-10-03 03:00:00+00', 'a reporting day starts at São Paulo midnight');

-- ---- Aggregation: fixture across a day boundary ----------------------------------------------------
delete from public.analytics_events;
select set_config('tests.d1', (current_setting('tests.today')::date - 2)::text, true);
select set_config('tests.d2', (current_setting('tests.today')::date - 1)::text, true);
-- Day 1: three views (two sources, one with UTM), two link clicks, one WhatsApp click. The last
-- view is one minute before local midnight; the first event of day 2 is one minute after it.
select pg_temp.store(tests.id('page'), private.analytics_day_start(current_setting('tests.d1')::date) + interval '9 hours', 'page_view', null, 'instagram', 'instagram');
select pg_temp.store(tests.id('page'), private.analytics_day_start(current_setting('tests.d1')::date) + interval '10 hours', 'page_view', null, 'instagram');
select pg_temp.store(tests.id('page'), private.analytics_day_start(current_setting('tests.d2')::date) - interval '1 minute', 'page_view', null, 'google');
select pg_temp.store(tests.id('page'), private.analytics_day_start(current_setting('tests.d1')::date) + interval '9 hours', 'link_click', current_setting('tests.link')) from generate_series(1, 2);
select pg_temp.store(tests.id('page'), private.analytics_day_start(current_setting('tests.d1')::date) + interval '9 hours', 'whatsapp_click', current_setting('tests.whatsapp'));
-- Day 2: one view and one Pix copy.
select pg_temp.store(tests.id('page'), private.analytics_day_start(current_setting('tests.d2')::date) + interval '1 minute', 'page_view', null, 'direct');
select pg_temp.store(tests.id('page'), private.analytics_day_start(current_setting('tests.d2')::date) + interval '2 minutes', 'pix_copy', current_setting('tests.pix'));
-- Another page of the same workspace, day 1.
select pg_temp.store(tests.id('other_page'), private.analytics_day_start(current_setting('tests.d1')::date) + interval '9 hours', 'page_view', null, 'tiktok');

select tests.authenticate_as(tests.id('owner'));
select throws_ok('select public.run_analytics_maintenance()', '42501', null, 'a member cannot run the job');
select tests.clear_authentication();
select tests.authenticate_anon();
select throws_ok('select public.run_analytics_maintenance()', '42501', null, 'anon cannot run the job');
select tests.clear_authentication();

select tests.authenticate_service();
select is(
  public.run_analytics_maintenance() - 'aggregate_rows',
  jsonb_build_object('status', 'ok', 'aggregated_days', 3, 'purged_events', 0, 'purged_aggregate_rows', 0, 'pending_days', 0, 'last_final_day', current_setting('tests.d2')::date),
  'the job aggregates from the first day with events up to today and closes the days that are over');
select tests.clear_authentication();

select results_eq(
  format($f$select day, dimension::text, key, event_type::text, count from public.analytics_daily d where profile_id = %L order by d.day, d.dimension, d.key, d.event_type$f$, tests.id('page')),
  format($f$values
    (%1$L::date, 'total', '', 'page_view', 3),
    (%1$L::date, 'total', '', 'link_click', 2),
    (%1$L::date, 'total', '', 'whatsapp_click', 1),
    (%1$L::date, 'block', %3$L, 'link_click', 2),
    (%1$L::date, 'block', %4$L, 'whatsapp_click', 1),
    (%1$L::date, 'source', 'google', 'page_view', 1),
    (%1$L::date, 'source', 'instagram', 'page_view', 2),
    (%1$L::date, 'utm', 'instagram|bio|primavera', 'page_view', 1),
    (%1$L::date, 'device', 'mobile', 'page_view', 3),
    (%1$L::date, 'country', 'BR', 'page_view', 3),
    (%2$L::date, 'total', '', 'page_view', 1),
    (%2$L::date, 'total', '', 'pix_copy', 1),
    (%2$L::date, 'block', %5$L, 'pix_copy', 1),
    (%2$L::date, 'source', 'direct', 'page_view', 1),
    (%2$L::date, 'device', 'mobile', 'page_view', 1),
    (%2$L::date, 'country', 'BR', 'page_view', 1)$f$,
    current_setting('tests.d1'), current_setting('tests.d2'), current_setting('tests.link'), current_setting('tests.whatsapp'), current_setting('tests.pix')),
  'the aggregate has one count per day, dimension, key and type; 23:59 and 00:01 local time fall on different days');
select is(
  (select workspace_id from public.analytics_daily where profile_id = tests.id('other_page') limit 1),
  tests.id('ws'), 'aggregate rows carry their tenant');
select results_eq(
  $$select day, finalized_at is not null, event_count from public.analytics_day_status order by day$$,
  format($f$values (%L::date, true, 7), (%L::date, true, 2), (current_setting('tests.today')::date, false, 0)$f$, current_setting('tests.d1'), current_setting('tests.d2')),
  'the watermark records each day; today is aggregated but not final');

-- Idempotency.
select set_config('tests.fingerprint', pg_temp.daily_fingerprint(), true);
select tests.authenticate_service();
select is(public.run_analytics_maintenance() ->> 'aggregated_days', '1', 'a second run only re-aggregates today');
select is((public.run_analytics_maintenance(current_setting('tests.d1')::date)) ->> 'status', 'ok', 'a day that still has raw events can be re-aggregated by hand');
select tests.clear_authentication();
select is(pg_temp.daily_fingerprint(), current_setting('tests.fingerprint'), 'running the aggregation again gives identical rows');

-- An event that arrives after an aggregation of the current day.
select is(
  pg_temp.ingest('studio-dados', repeat('1', 32), jsonb_build_array(pg_temp.ev(3000, 'page_view'), pg_temp.ev(3001, 'whatsapp_click', current_setting('tests.whatsapp')))) ->> 'accepted',
  '2', 'events keep arriving after today was aggregated');
select tests.authenticate_service();
select public.run_analytics_maintenance();
select tests.clear_authentication();
select is(
  (select sum(count)::int from public.analytics_daily where profile_id = tests.id('page') and day = current_setting('tests.today')::date and dimension = 'total'),
  2, 'and the next run includes them');
select is(pg_temp.daily_fingerprint() <> current_setting('tests.fingerprint'), true, 'only today changed');

-- ---- Reading a report ------------------------------------------------------------------------------
select tests.authenticate_as(tests.id('owner'));
select set_config('tests.report', public.get_profile_analytics(tests.id('page'), current_setting('tests.today')::date - 6, current_setting('tests.today')::date)::text, true);
select is(
  (select jsonb_agg(jsonb_build_array(d ->> 'day', d ->> 'event_type', d -> 'count') order by d ->> 'day', d ->> 'event_type') from jsonb_array_elements(current_setting('tests.report')::jsonb -> 'days') d),
  jsonb_build_array(
    jsonb_build_array(current_setting('tests.d1'), 'link_click', 2), jsonb_build_array(current_setting('tests.d1'), 'page_view', 3), jsonb_build_array(current_setting('tests.d1'), 'whatsapp_click', 1),
    jsonb_build_array(current_setting('tests.d2'), 'page_view', 1), jsonb_build_array(current_setting('tests.d2'), 'pix_copy', 1),
    jsonb_build_array(current_setting('tests.today')::date::text, 'page_view', 1), jsonb_build_array(current_setting('tests.today')::date::text, 'whatsapp_click', 1)),
  'the owner reads daily totals: closed days from the aggregate, today from raw events');
select is(
  (select sum((d ->> 'count')::int) from jsonb_array_elements(current_setting('tests.report')::jsonb -> 'days') d where d ->> 'event_type' = 'page_view'),
  (select sum((s ->> 'count')::int) from jsonb_array_elements(current_setting('tests.report')::jsonb -> 'sources') s),
  'period totals equal the sum of the days: visits by day add up to visits by source');
select is(
  (select jsonb_object_agg(b ->> 'block_id' || ':' || (b ->> 'event_type'), b -> 'count') from jsonb_array_elements(current_setting('tests.report')::jsonb -> 'blocks') b),
  jsonb_build_object(current_setting('tests.link') || ':link_click', 2, current_setting('tests.whatsapp') || ':whatsapp_click', 2, current_setting('tests.pix') || ':pix_copy', 1),
  'block counts are summed over the period');
select is(
  current_setting('tests.report')::jsonb - 'days' - 'blocks' - 'sources' - 'devices' - 'countries' - 'utms',
  jsonb_build_object('timezone', 'America/Sao_Paulo', 'today', current_setting('tests.today')::date, 'from', current_setting('tests.today')::date - 6, 'to', current_setting('tests.today')::date,
    'history_days', 90, 'configured', true, 'collecting_since', current_setting('tests.today')::date, 'first_event_day', current_setting('tests.d1')::date, 'last_final_day', current_setting('tests.d2')::date),
  'the report states its timezone, window, history depth, first day with data and the watermark');
select is(
  current_setting('tests.report')::jsonb -> 'utms', '[{"key": "instagram|bio|primavera", "count": 1}]'::jsonb, 'UTM triples are listed with their counts');
select is(
  (public.get_profile_analytics(tests.id('page'), current_setting('tests.today')::date - 500, current_setting('tests.today')::date + 30)) -> 'from',
  to_jsonb(current_setting('tests.today')::date - 89), 'the window is clamped to the history depth of the plan and to today');
select throws_ok(format('select public.get_profile_analytics(%L, current_date, current_date - 1)', tests.id('page')), '22023', null, 'an inverted window is refused');
select lives_ok(format('select public.record_analytics_export(%L, current_date - 6, current_date, 7)', tests.id('page')), 'the owner records an export');
select throws_ok('select 1 from public.analytics_daily limit 1', '42501', null, 'a member cannot read aggregates directly, only through the report');
select throws_ok('select 1 from public.analytics_events limit 1', '42501', null, 'a member cannot read raw events');
select tests.clear_authentication();

select tests.authenticate_as(tests.id('editor'));
select is(
  (public.get_profile_analytics(tests.id('page'), current_setting('tests.today')::date, current_setting('tests.today')::date)) -> 'days' -> 0 ->> 'day',
  current_setting('tests.today')::date::text, 'an editor of the workspace reads the report (analytics.view)');
select lives_ok(format('select public.record_analytics_export(%L, current_date, current_date, 1)', tests.id('page')), 'and records an export (analytics.export)');
select tests.clear_authentication();

select tests.authenticate_as(tests.id('outsider'));
select throws_ok(format('select public.get_profile_analytics(%L, current_date, current_date)', tests.id('page')), 'P0002', null, 'a member of another workspace cannot read the report');
select throws_ok(format('select public.record_analytics_export(%L, current_date, current_date, 1)', tests.id('page')), 'P0002', null, 'nor record an export');
select tests.clear_authentication();

select tests.authenticate_anon();
select throws_ok(format('select public.get_profile_analytics(%L, current_date, current_date)', tests.id('page')), '42501', null, 'anon cannot read the report');
select tests.clear_authentication();

select is(
  (select count(*)::int from public.audit_events where target_id = tests.id('page') and action = 'analytics.exported' and metadata ? 'from' and metadata ? 'to' and metadata ? 'rows'),
  2, 'exports are audited with the window and the row count');

-- The Free plan sees 7 days.
update public.workspaces set plan_id = 'free' where id = tests.id('ws');
select tests.authenticate_as(tests.id('owner'));
select is(
  (public.get_profile_analytics(tests.id('page'), current_setting('tests.today')::date - 29, current_setting('tests.today')::date)) - 'days' - 'blocks' - 'sources' - 'devices' - 'countries' - 'utms' -> 'from',
  to_jsonb(current_setting('tests.today')::date - 6), 'history depth comes from the analytics_days entitlement of the plan');
select tests.clear_authentication();
update public.workspaces set plan_id = 'agency' where id = tests.id('ws');

-- ---- Purge -----------------------------------------------------------------------------------------
delete from public.analytics_events;
delete from public.analytics_daily;
delete from public.analytics_day_status;
select pg_temp.store(tests.id('page'), private.analytics_day_start(current_setting('tests.today')::date - 10) + interval '12 hours', 'page_view') from generate_series(1, 3);
select pg_temp.store(tests.id('page'), private.analytics_day_start(current_setting('tests.today')::date - 8) + interval '12 hours', 'page_view') from generate_series(1, 2);
select pg_temp.store(tests.id('page'), private.analytics_day_start(current_setting('tests.today')::date - 7) + interval '12 hours', 'page_view');
select pg_temp.store(tests.id('page'), private.analytics_day_start(current_setting('tests.today')::date) + interval '1 minute', 'page_view');

select tests.authenticate_service();
select is(
  public.run_analytics_maintenance() - 'aggregate_rows',
  jsonb_build_object('status', 'ok', 'aggregated_days', 10, 'purged_events', 5, 'purged_aggregate_rows', 0, 'pending_days', 1, 'last_final_day', current_setting('tests.today')::date - 1),
  'a run is bounded to 10 days; raw events older than 7 full days are purged once their day is final');
select tests.clear_authentication();
select results_eq(
  format('select day, count(*)::int from public.analytics_events where profile_id = %L group by day order by day', tests.id('page')),
  $$values (current_setting('tests.today')::date - 7, 1), (current_setting('tests.today')::date, 1)$$,
  'the purge removes only rows older than the window');
select is(
  (select sum(count)::int from public.analytics_daily where profile_id = tests.id('page') and dimension = 'total'),
  6, 'and never touches the aggregates: the purged days keep their totals');
select tests.authenticate_service();
select is(
  public.run_analytics_maintenance() - 'aggregate_rows',
  jsonb_build_object('status', 'ok', 'aggregated_days', 1, 'purged_events', 0, 'purged_aggregate_rows', 0, 'pending_days', 0, 'last_final_day', current_setting('tests.today')::date - 1),
  'the next run catches up with today');
select is(
  public.run_analytics_maintenance(current_setting('tests.today')::date - 10) ->> 'status',
  'out_of_range', 'a day whose raw events were purged cannot be re-aggregated (its totals would be lost)');
select is(public.run_analytics_maintenance(current_setting('tests.today')::date + 1) ->> 'status', 'out_of_range', 'nor can a day in the future');
select tests.clear_authentication();
select is(
  (select sum(count)::int from public.analytics_daily where profile_id = tests.id('page') and dimension = 'total'),
  7, 'the totals are complete after the catch-up');

-- A job that was down: old raw events of a day that is not final are kept.
delete from public.analytics_day_status;
delete from public.analytics_daily;
select pg_temp.store(tests.id('page'), private.analytics_day_start(current_setting('tests.today')::date - 20) + interval '12 hours', 'page_view');
select tests.authenticate_service();
select is((public.run_analytics_maintenance()) ->> 'pending_days', '11', 'after a long outage the job works through the backlog 10 days at a time');
select tests.clear_authentication();
select is(
  (select count(*)::int from public.analytics_events where day = current_setting('tests.today')::date - 7),
  1, 'and events of days it has not closed yet are not purged');

-- Aggregates past their own retention.
insert into public.analytics_daily (profile_id, workspace_id, day, dimension, event_type, count, key)
values (tests.id('page'), tests.id('ws'), current_setting('tests.today')::date - 101, 'total', 'page_view', 9, '');
insert into public.analytics_rate_hits (client_hash, window_start, count) values (repeat('1', 32), now() - interval '3 days', 4), (repeat('1', 32), now() - interval '1 hour', 4);
select tests.authenticate_service();
select is((public.run_analytics_maintenance()) ->> 'purged_aggregate_rows', '1', 'aggregates older than 100 days are purged');
select tests.clear_authentication();
select is((select array_agg(count) from public.analytics_rate_hits where client_hash = repeat('1', 32)), array[4], 'and so are rate-limit counters older than two days');

-- ---- Off the air, suspended, deleted ---------------------------------------------------------------
select tests.authenticate_as(tests.id('owner'));
select public.unpublish_profile(tests.id('page'));
select tests.clear_authentication();
select is(pg_temp.ingest('studio-dados', null, jsonb_build_array(pg_temp.ev(4000, 'page_view'))) ->> 'status', 'unavailable', 'a page off the air stores no event');
select tests.authenticate_as(tests.id('owner'));
select public.publish_profile(tests.id('page'));
select tests.clear_authentication();
select is(
  pg_temp.ingest('studio-dados', repeat('2', 32), jsonb_build_array(pg_temp.ev(4001, 'link_click', 'a6000000-0000-4000-8000-000000000009'))) ->> 'accepted',
  '1', 'a block counts once the publication that contains it is on the air');

update public.workspaces set status = 'suspended' where id = tests.id('ws');
select is(pg_temp.ingest('studio-dados', null, jsonb_build_array(pg_temp.ev(4002, 'page_view'))) ->> 'status', 'unavailable', 'a suspended workspace stores no event');
update public.workspaces set status = 'active' where id = tests.id('ws');

select tests.authenticate_as(tests.id('owner'));
select public.soft_delete_profile(tests.id('page'));
select throws_ok(format('select public.get_profile_analytics(%L, current_date, current_date)', tests.id('page')), 'P0002', null, 'the report of a deleted page is not found');
select tests.clear_authentication();
select is(pg_temp.ingest('studio-dados', null, jsonb_build_array(pg_temp.ev(4003, 'page_view'))) ->> 'status', 'unavailable', 'a deleted page stores no event');
select cmp_ok(pg_temp.events_of(tests.id('page')), '>', 0::bigint, 'its data stays until the page is purged');
delete from public.form_leads where profile_id = tests.id('page');
delete from public.profiles where id = tests.id('page');
select is(
  (select count(*)::int from public.analytics_events where profile_id = tests.id('page'))
    + (select count(*)::int from public.analytics_daily where profile_id = tests.id('page')),
  0, 'purging the page removes its events and aggregates');

-- ---- Without the secret, nothing is stored ---------------------------------------------------------
delete from vault.secrets where name = 'analytics_signing_secret';
select is(
  public.ingest_analytics_events(current_setting('tests.vector'), current_setting('tests.vector_signature')) ->> 'status',
  'not_configured', 'ingestion fails closed when the signing secret is not configured');
select tests.authenticate_as(tests.id('owner'));
select is(
  (public.get_profile_analytics(tests.id('other_page'), current_setting('tests.today')::date, current_setting('tests.today')::date)) -> 'configured',
  'false'::jsonb, 'and the report says that collection is not configured');
select tests.clear_authentication();

select * from finish();
rollback;
