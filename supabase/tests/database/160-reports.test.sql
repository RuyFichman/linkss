-- Sprint 7, part 2 (ADR 0013): the consolidated read of a workspace and read-only report links.
-- Totals are compared with the per-page read (one definition of every number); the anonymous read
-- is checked field by field, for every way a link stops working, and across pages and workspaces.
-- Mirrors apps/web/src/modules/analytics/workspace.ts and apps/web/src/modules/reports.
begin;
select plan(131);

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
delete from public.report_lookup_failures;

-- A raw event stored directly, as the ingestion would have stored it at `p_at`.
create function pg_temp.store(p_profile uuid, p_at timestamptz, p_type public.analytics_event_type, p_count integer default 1, p_block text default null, p_source public.analytics_source default null, p_utm text default null)
returns void
language sql
security definer
as $$
  insert into public.analytics_events (profile_id, event_id, workspace_id, occurred_at, day, event_type, source, device, country, block_id, utm_source, utm_medium, utm_campaign)
  select p.id, gen_random_uuid(), p.workspace_id, p_at, private.analytics_local_day(p_at), p_type,
    case when p_type = 'page_view' then coalesce(p_source, 'direct') end,
    case when p_type = 'page_view' then 'mobile'::public.analytics_device end,
    case when p_type = 'page_view' then 'BR' end,
    p_block, p_utm, case when p_utm is not null then 'bio' end, case when p_utm is not null then 'segredo-da-agencia' end
  from public.profiles p, generate_series(1, p_count) where p.id = p_profile
$$;

create function pg_temp.hash(p_token text)
returns text
language sql
immutable
as $$ select encode(extensions.digest(p_token, 'sha256'), 'hex') $$;

-- Sum of one event type (or of everything) in the "days" array of a report.
create function pg_temp.total(p_report jsonb, p_type text default null)
returns bigint
language sql
immutable
as $$
  select coalesce(sum((d ->> 'count')::bigint), 0)::bigint from jsonb_array_elements(p_report -> 'days') d
  where p_type is null or d ->> 'event_type' = p_type
$$;

-- The "days" arrays of several reports added up, in the shape and order of a single report.
create function pg_temp.sum_days(variadic p_reports jsonb[])
returns jsonb
language sql
immutable
as $$
  select coalesce(jsonb_agg(jsonb_build_object('day', t.day, 'event_type', t.event_type, 'count', t.total) order by t.day, t.event_type), '[]'::jsonb)
  from (
    select d ->> 'day' as day, (d ->> 'event_type')::public.analytics_event_type as event_type, sum((d ->> 'count')::integer)::integer as total
    from unnest(p_reports) r, jsonb_array_elements(r -> 'days') d
    group by 1, 2
  ) t
$$;

create function pg_temp.sum_sources(variadic p_reports jsonb[])
returns jsonb
language sql
immutable
as $$
  select coalesce(jsonb_agg(jsonb_build_object('key', t.key, 'count', t.total) order by t.total desc, t.key), '[]'::jsonb)
  from (
    select s ->> 'key' as key, sum((s ->> 'count')::integer)::integer as total
    from unnest(p_reports) r, jsonb_array_elements(r -> 'sources') s
    group by 1
  ) t
$$;

create function pg_temp.keys(p_object jsonb)
returns text[]
language sql
immutable
as $$ select array(select jsonb_object_keys(p_object) order by 1) $$;

select tests.remember('owner', tests.create_user('owner9@example.test', 'Olga'));
select tests.remember('admin', tests.create_user('admin9@example.test', 'Ari'));
select tests.remember('editor', tests.create_user('editor9@example.test', 'Edu'));
select tests.remember('outsider', tests.create_user('outsider9@example.test', 'Oto'));

select tests.authenticate_as(tests.id('owner'));
select public.ensure_personal_workspace();
select tests.remember('ws', public.create_agency_workspace('Agência Relatos'));
select tests.clear_authentication();
update public.workspaces set plan_id = 'agency' where id = tests.id('ws');
insert into public.workspace_memberships (workspace_id, user_id, role, invited_by, accepted_at)
values (tests.id('ws'), tests.id('admin'), 'admin', tests.id('owner'), now()),
  (tests.id('ws'), tests.id('editor'), 'editor', tests.id('owner'), now());

select tests.authenticate_as(tests.id('outsider'));
select public.ensure_personal_workspace();
select tests.remember('other_ws', public.create_agency_workspace('Agência Vizinha'));
select tests.clear_authentication();
update public.workspaces set plan_id = 'agency' where id = tests.id('other_ws');

select tests.authenticate_as(tests.id('owner'));
insert into public.profiles (workspace_id, title, slug) values
  (tests.id('ws'), 'Café Relato', 'cafe-relato'),
  (tests.id('ws'), 'Estúdio Relato', 'estudio-relato'),
  (tests.id('ws'), 'Rascunho Relato', 'rascunho-relato'),
  (tests.id('ws'), 'Arquivada Relato', 'arquivada-relato'),
  (tests.id('ws'), 'Excluída Relato', 'excluida-relato');
update public.profiles set blocks = '[
  {"id":"a9000000-0000-4000-8000-000000000001","type":"link","visible":true,"title":"Cardápio","url":"https://exemplo.com.br/"},
  {"id":"a9000000-0000-4000-8000-000000000002","type":"whatsapp","visible":true,"label":"Fazer pedido","phone":"5511912345678","message":""},
  {"id":"a9000000-0000-4000-8000-000000000003","type":"pix","visible":true,"label":"Pagar","keyType":"random","key":"123e4567-e89b-42d3-a456-426614174000","paymentUrl":"https://pag.exemplo.com.br/x"}
]' where slug = 'cafe-relato';
update public.profiles set blocks = '[{"id":"a9000000-0000-4000-8000-00000000000b","type":"whatsapp","visible":true,"label":"Agendar","phone":"5511912345678","message":""}]' where slug = 'estudio-relato';
update public.profiles set blocks = '[{"id":"a9000000-0000-4000-8000-00000000000d","type":"link","visible":true,"title":"Antigo","url":"https://exemplo.com.br/"}]' where slug = 'arquivada-relato';
update public.profiles set blocks = '[{"id":"a9000000-0000-4000-8000-00000000000e","type":"link","visible":true,"title":"Fim","url":"https://exemplo.com.br/"}]' where slug = 'excluida-relato';
select tests.remember('a', (select id from public.profiles where slug = 'cafe-relato'));
select tests.remember('b', (select id from public.profiles where slug = 'estudio-relato'));
select tests.remember('c', (select id from public.profiles where slug = 'rascunho-relato'));
select tests.remember('d', (select id from public.profiles where slug = 'arquivada-relato'));
select tests.remember('e', (select id from public.profiles where slug = 'excluida-relato'));
select public.publish_profile(tests.id('a'));
select public.publish_profile(tests.id('b'));
select public.publish_profile(tests.id('d'));
select public.publish_profile(tests.id('e'));
-- Draft-only changes after publishing: none of this is public.
update public.profiles set title = 'Nome só do rascunho',
  blocks = jsonb_set(blocks, '{0,title}', '"Título só do rascunho"') where id = tests.id('a');
select tests.clear_authentication();

select tests.authenticate_as(tests.id('outsider'));
insert into public.profiles (workspace_id, title, slug) values (tests.id('other_ws'), 'Página Vizinha', 'pagina-vizinha');
update public.profiles set blocks = '[{"id":"a9000000-0000-4000-8000-0000000000f1","type":"link","visible":true,"title":"Vizinho","url":"https://exemplo.com.br/"}]' where slug = 'pagina-vizinha';
select tests.remember('x', (select id from public.profiles where slug = 'pagina-vizinha'));
select public.publish_profile(tests.id('x'));
select tests.clear_authentication();

select set_config('tests.today', private.analytics_today()::text, true);
-- First instant of today and last second of yesterday, in the reporting timezone.
select set_config('tests.t_today', private.analytics_day_start(private.analytics_today())::text, true);
select set_config('tests.t_yesterday', (private.analytics_day_start(private.analytics_today()) - interval '1 second')::text, true);
select set_config('tests.t_old', (private.analytics_day_start(private.analytics_today()) - interval '60 hours')::text, true);

-- Page A: today 3 visits from Instagram, a WhatsApp click and a link click; yesterday 2 visits (one
-- with UTM values) and a Pix copy; three days ago 4 visits from Instagram and 2 WhatsApp clicks.
select pg_temp.store(tests.id('a'), current_setting('tests.t_today')::timestamptz, 'page_view', 3, null, 'instagram');
select pg_temp.store(tests.id('a'), current_setting('tests.t_today')::timestamptz, 'whatsapp_click', 1, 'a9000000-0000-4000-8000-000000000002');
select pg_temp.store(tests.id('a'), current_setting('tests.t_today')::timestamptz, 'link_click', 1, 'a9000000-0000-4000-8000-000000000001');
select pg_temp.store(tests.id('a'), current_setting('tests.t_yesterday')::timestamptz, 'page_view', 1);
select pg_temp.store(tests.id('a'), current_setting('tests.t_yesterday')::timestamptz, 'page_view', 1, null, 'other', 'boletim');
select pg_temp.store(tests.id('a'), current_setting('tests.t_yesterday')::timestamptz, 'pix_copy', 1, 'a9000000-0000-4000-8000-000000000003');
select pg_temp.store(tests.id('a'), current_setting('tests.t_old')::timestamptz, 'page_view', 4, null, 'instagram');
select pg_temp.store(tests.id('a'), current_setting('tests.t_old')::timestamptz, 'whatsapp_click', 2, 'a9000000-0000-4000-8000-000000000002');
-- A block that is no longer in any snapshot.
select pg_temp.store(tests.id('a'), current_setting('tests.t_old')::timestamptz, 'link_click', 1, 'a9000000-0000-4000-8000-0000000000aa');
select pg_temp.store(tests.id('b'), current_setting('tests.t_yesterday')::timestamptz, 'page_view', 5);
select pg_temp.store(tests.id('b'), current_setting('tests.t_yesterday')::timestamptz, 'whatsapp_click', 1, 'a9000000-0000-4000-8000-00000000000b');
select pg_temp.store(tests.id('d'), current_setting('tests.t_old')::timestamptz, 'page_view', 2);
select pg_temp.store(tests.id('e'), current_setting('tests.t_yesterday')::timestamptz, 'page_view', 7);
select pg_temp.store(tests.id('x'), current_setting('tests.t_yesterday')::timestamptz, 'page_view', 9);

select tests.authenticate_as(tests.id('owner'));
select public.archive_profile(tests.id('d'));
select public.soft_delete_profile(tests.id('e'));
select tests.clear_authentication();

-- ---- Structure and privileges ---------------------------------------------------------------------
select ok(has_function_privilege('anon', 'public.get_shared_report(text, text)', 'execute'), 'anon may open a report');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('get_workspace_analytics', 'record_workspace_analytics_export', 'create_report_link', 'revoke_report_link')
     and has_function_privilege('anon', p.oid, 'execute')),
  0, 'anon cannot read the consolidated results or manage links');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'private' and p.proname in ('profile_analytics', 'analytics_workspace_counts', 'resolve_report_link')
     and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))),
  0, 'the private cores are not callable by client roles');
select is(
  (select count(*)::int from information_schema.role_table_grants
   where grantee in ('anon', 'authenticated') and table_schema = 'public' and table_name = 'report_lookup_failures'),
  0, 'no client role holds any privilege on the failed-lookup counters');
select is(
  (select array_agg(column_name::text order by ordinal_position) from information_schema.columns where table_schema = 'public' and table_name = 'report_lookup_failures'),
  array['id', 'client_hash', 'created_at'], 'the failed-lookup counters hold no token, page or address');
select is(
  (select array_agg(column_name::text order by column_name) from information_schema.columns
   where table_schema = 'public' and table_name = 'report_links' and column_name ~* '(opened|ip|address|user_agent|referrer|count)'),
  null, 'a link keeps no record of who opened it or how often');

-- ---- Consolidated read: before any aggregation everything comes from raw events ----------------------
select tests.authenticate_as(tests.id('owner'));
select set_config('tests.raw', public.get_workspace_analytics(tests.id('ws'), current_setting('tests.today')::date - 6, current_setting('tests.today')::date)::text, true);
select tests.clear_authentication();
select is(pg_temp.total(current_setting('tests.raw')::jsonb, 'page_view'), 16::bigint, 'before the job runs, the consolidated read counts the raw events of the workspace');

select public.run_analytics_maintenance();

select tests.authenticate_as(tests.id('owner'));
select set_config('tests.w', public.get_workspace_analytics(tests.id('ws'), current_setting('tests.today')::date - 6, current_setting('tests.today')::date)::text, true);
select set_config('tests.pa', public.get_profile_analytics(tests.id('a'), current_setting('tests.today')::date - 6, current_setting('tests.today')::date)::text, true);
select set_config('tests.pb', public.get_profile_analytics(tests.id('b'), current_setting('tests.today')::date - 6, current_setting('tests.today')::date)::text, true);
select set_config('tests.pc', public.get_profile_analytics(tests.id('c'), current_setting('tests.today')::date - 6, current_setting('tests.today')::date)::text, true);
select set_config('tests.pd', public.get_profile_analytics(tests.id('d'), current_setting('tests.today')::date - 6, current_setting('tests.today')::date)::text, true);
select tests.clear_authentication();

select is(current_setting('tests.w')::jsonb -> 'days', current_setting('tests.raw')::jsonb -> 'days', 'aggregated days and raw days give the same series (the job changes nothing in the numbers)');
select is(
  pg_temp.keys(current_setting('tests.w')::jsonb),
  array['collecting_since', 'configured', 'days', 'first_event_day', 'from', 'history_days', 'last_final_day', 'page_count', 'pages', 'pages_omitted', 'pages_truncated', 'sources', 'timezone', 'to', 'today'],
  'the consolidated read returns its documented fields and nothing else');
select is(
  current_setting('tests.w')::jsonb -> 'days',
  pg_temp.sum_days(current_setting('tests.pa')::jsonb, current_setting('tests.pb')::jsonb, current_setting('tests.pc')::jsonb, current_setting('tests.pd')::jsonb),
  'consolidated totals per day and type equal the sum of the per-page reads');
select is(
  current_setting('tests.w')::jsonb -> 'sources',
  pg_temp.sum_sources(current_setting('tests.pa')::jsonb, current_setting('tests.pb')::jsonb, current_setting('tests.pc')::jsonb, current_setting('tests.pd')::jsonb),
  'consolidated sources equal the sum of the per-page sources');
select is(pg_temp.total(current_setting('tests.w')::jsonb, 'page_view'), 16::bigint, 'visits: 9 + 5 + 2; the deleted page (7) and the other workspace (9) are not counted');
select is(pg_temp.total(current_setting('tests.w')::jsonb, 'whatsapp_click'), 4::bigint, 'results are summed across pages');
select is(
  (select jsonb_agg(p ->> 'title') from jsonb_array_elements(current_setting('tests.w')::jsonb -> 'pages') p),
  '["Nome só do rascunho", "Estúdio Relato", "Arquivada Relato"]'::jsonb,
  'pages are listed by visits; the draft without data and the deleted page are not listed');
select is(
  (select p ->> 'status' from jsonb_array_elements(current_setting('tests.w')::jsonb -> 'pages') p where p ->> 'slug' = 'arquivada-relato'),
  'archived', 'an archived page with results in the period is listed and labeled');
select is(
  (select p -> 'counts' from jsonb_array_elements(current_setting('tests.w')::jsonb -> 'pages') p where p ->> 'slug' = 'cafe-relato'),
  '{"page_view": 9, "link_click": 2, "whatsapp_click": 3, "pix_copy": 1}'::jsonb, 'each page row carries that page''s counts');
select is(
  (select (p ->> 'first_event_day')::date from jsonb_array_elements(current_setting('tests.w')::jsonb -> 'pages') p where p ->> 'slug' = 'estudio-relato'),
  current_setting('tests.today')::date - 1, 'each page row says when its first event was');
select is(
  (select bool_and((p ->> 'ever_published')::boolean) from jsonb_array_elements(current_setting('tests.w')::jsonb -> 'pages') p),
  true, 'and whether the page has ever been published');
select is((current_setting('tests.w')::jsonb ->> 'page_count')::int, 4, 'four pages are alive in the workspace');
select is((current_setting('tests.w')::jsonb ->> 'pages_omitted')::int, 1, 'one of them is left out of the table for lack of data');
select is((current_setting('tests.w')::jsonb ->> 'pages_truncated')::boolean, false, 'nothing was cut by the page bound');
select ok(current_setting('tests.w') !~ tests.id('e')::text and current_setting('tests.w') !~ tests.id('x')::text, 'neither the deleted page nor the other workspace''s page appears anywhere');

-- The day boundary is the reporting timezone's midnight.
select is(
  (select (d ->> 'count')::int from jsonb_array_elements(current_setting('tests.w')::jsonb -> 'days') d where d ->> 'day' = current_setting('tests.today') and d ->> 'event_type' = 'page_view'),
  3, 'an event at local midnight belongs to today');
select is(
  (select (d ->> 'count')::int from jsonb_array_elements(current_setting('tests.w')::jsonb -> 'days') d where (d ->> 'day')::date = current_setting('tests.today')::date - 1 and d ->> 'event_type' = 'page_view'),
  7, 'an event one second earlier belongs to yesterday');

-- The window: today, and the plan's history depth.
select tests.authenticate_as(tests.id('editor'));
select is(
  public.get_workspace_analytics(tests.id('ws'), current_setting('tests.today')::date - 60, current_setting('tests.today')::date + 5) ->> 'to',
  current_setting('tests.today'), 'an editor reads it too, and a window in the future ends today');
select is(
  public.get_workspace_analytics(tests.id('ws'), current_setting('tests.today')::date - 60, current_setting('tests.today')::date) ->> 'from',
  (current_setting('tests.today')::date - 60)::text, 'the Agency plan covers a 61-day window');
select throws_ok(
  format('select public.get_workspace_analytics(%L, %L, %L)', tests.id('ws'), current_setting('tests.today')::date, current_setting('tests.today')::date - 1),
  '22023', null, 'an inverted window is refused');
select tests.clear_authentication();
update public.workspaces set plan_id = 'free' where id = tests.id('ws');
select tests.authenticate_as(tests.id('editor'));
select is(
  public.get_workspace_analytics(tests.id('ws'), current_setting('tests.today')::date - 60, current_setting('tests.today')::date) ->> 'from',
  (current_setting('tests.today')::date - 6)::text, 'the Free plan clamps the same window to 7 days');
select tests.clear_authentication();
update public.workspaces set plan_id = 'agency' where id = tests.id('ws');

-- Tenant isolation of the consolidated read.
select tests.authenticate_as(tests.id('outsider'));
select throws_ok(
  format('select public.get_workspace_analytics(%L, current_date - 6, current_date)', tests.id('ws')),
  'P0002', null, 'a member of another workspace gets nothing from the consolidated read');
select throws_ok('select public.get_workspace_analytics(null, current_date - 6, current_date)', 'P0002', null, 'a null workspace is not found');
select throws_ok(
  format('select public.record_workspace_analytics_export(%L, current_date - 6, current_date, 3)', tests.id('ws')),
  'P0002', null, 'and cannot record an export for it');
select is(
  pg_temp.total(public.get_workspace_analytics(tests.id('other_ws'), current_setting('tests.today')::date - 6, current_setting('tests.today')::date), 'page_view'),
  9::bigint, 'their own workspace shows only their own page');
select tests.clear_authentication();
select tests.authenticate_anon();
select throws_ok(
  format('select public.get_workspace_analytics(%L, current_date - 6, current_date)', tests.id('ws')),
  '42501', null, 'anon cannot call the consolidated read');
select tests.clear_authentication();

select tests.authenticate_as(tests.id('editor'));
select lives_ok(
  format('select public.record_workspace_analytics_export(%L, current_date - 6, current_date, 3)', tests.id('ws')),
  'an editor records a consolidated export');
select tests.clear_authentication();
select is(
  (select metadata ->> 'scope' from public.audit_events where workspace_id = tests.id('ws') and action = 'analytics.exported' and target_type = 'workspace'),
  'workspace', 'the consolidated export is in the audit trail');

-- ---- Report links: creation --------------------------------------------------------------------------
select set_config('tests.token_a', repeat('A', 43), true);
select set_config('tests.token_b', repeat('B', 43), true);
select set_config('tests.token_d', repeat('D', 43), true);
select set_config('tests.token_admin', repeat('M', 43), true);

select tests.authenticate_as(tests.id('owner'));
select tests.remember('link_a', (select link_id from public.create_report_link(tests.id('a'), pg_temp.hash(current_setting('tests.token_a')), 30, 30, '  Relatório   de setembro ')));
select tests.remember('link_b', (select link_id from public.create_report_link(tests.id('b'), pg_temp.hash(current_setting('tests.token_b')), 7, 7)));
select tests.remember('link_d', (select link_id from public.create_report_link(tests.id('d'), pg_temp.hash(current_setting('tests.token_d')), 7, 1)));
select tests.clear_authentication();
select tests.authenticate_as(tests.id('admin'));
select tests.remember('link_admin', (select link_id from public.create_report_link(tests.id('a'), pg_temp.hash(current_setting('tests.token_admin')), 90, 90)));
select tests.clear_authentication();

select is((select label from public.report_links where id = tests.id('link_a')), 'Relatório de setembro', 'the label is trimmed and its spaces collapsed');
select is((select label from public.report_links where id = tests.id('link_b')), null, 'the label is optional');
select is((select token_hash from public.report_links where id = tests.id('link_a')), pg_temp.hash(repeat('A', 43)), 'only the hash of the token is stored');
select ok(
  (select expires_at between now() + interval '30 days' - interval '1 minute' and now() + interval '30 days' + interval '1 minute' from public.report_links where id = tests.id('link_a')),
  'the expiry is the requested number of days from now');
select is((select created_by from public.report_links where id = tests.id('link_admin')), tests.id('admin'), 'an admin creates links too');
select is(
  (select count(*)::int from public.audit_events where workspace_id = tests.id('ws') and action = 'report_link.created' and target_type = 'report_link'),
  4, 'each creation is audited');
select ok(
  not exists (select 1 from public.audit_events where workspace_id = tests.id('ws') and action = 'report_link.created'
    and (metadata::text ~ pg_temp.hash(repeat('A', 43)) or metadata::text ~ 'setembro' or metadata::text ~ repeat('A', 43))),
  'the audit trail holds neither the token, its hash nor the label');

select tests.authenticate_as(tests.id('editor'));
select throws_ok(
  format('select public.create_report_link(%L, %L, 30, 30)', tests.id('a'), pg_temp.hash('editor')),
  '42501', null, 'an editor cannot create a report link');
select is((select count(*)::int from public.report_links), 0, 'an editor sees no report link');
select tests.clear_authentication();

select tests.authenticate_as(tests.id('outsider'));
select throws_ok(
  format('select public.create_report_link(%L, %L, 30, 30)', tests.id('a'), pg_temp.hash('outsider')),
  'P0002', null, 'a member of another workspace cannot create a link for this page');
select is((select count(*)::int from public.report_links), 0, 'and sees none of this workspace''s links');
select tests.clear_authentication();

select tests.authenticate_anon();
select throws_ok(
  format('select public.create_report_link(%L, %L, 30, 30)', tests.id('a'), pg_temp.hash('anon')),
  '42501', null, 'anon cannot create a link');
select throws_ok('select 1 from public.report_links limit 1', '42501', null, 'anon cannot read the links table');
select tests.clear_authentication();

select tests.authenticate_as(tests.id('owner'));
select is((select count(*)::int from public.report_links where workspace_id = tests.id('ws')), 4, 'an owner lists the workspace''s links');
select throws_ok('select token_hash from public.report_links limit 1', '42501', null, 'not even an owner can read a token hash');
select throws_ok(
  format($f$insert into public.report_links (workspace_id, profile_id, token_hash, period_days, expires_at) values (%L, %L, %L, 30, now() + interval '1 day')$f$, tests.id('ws'), tests.id('a'), pg_temp.hash('direct')),
  '42501', null, 'a link cannot be inserted directly');
select throws_ok(format('update public.report_links set revoked_at = null where id = %L', tests.id('link_a')), '42501', null, 'nor updated directly');
select throws_ok(format('delete from public.report_links where id = %L', tests.id('link_a')), '42501', null, 'nor deleted directly');
select throws_ok(
  format('select public.create_report_link(%L, %L, 30, 30)', tests.id('x'), pg_temp.hash('x')),
  'P0002', null, 'a link for a page in another workspace is refused as not found');
select throws_ok(
  format('select public.create_report_link(%L, %L, 30, 30)', tests.id('e'), pg_temp.hash('e')),
  'P0002', null, 'a link for a deleted page is refused');
select throws_ok(format('select public.create_report_link(%L, %L, 15, 30)', tests.id('b'), pg_temp.hash('p15')), '22023', null, 'a period that is not offered is refused');
select throws_ok(format('select public.create_report_link(%L, %L, null, 30)', tests.id('b'), pg_temp.hash('pnull')), '22023', null, 'a missing period is refused');
select throws_ok(format('select public.create_report_link(%L, %L, 30, null)', tests.id('b'), pg_temp.hash('enull')), '22023', null, 'a missing expiry is refused');
select throws_ok(format('select public.create_report_link(%L, %L, 30, 0)', tests.id('b'), pg_temp.hash('e0')), '22023', null, 'an expiry that is not in the future is refused');
select throws_ok(format('select public.create_report_link(%L, %L, 30, -3)', tests.id('b'), pg_temp.hash('eneg')), '22023', null, 'an expiry in the past is refused');
select throws_ok(format('select public.create_report_link(%L, %L, 30, 91)', tests.id('b'), pg_temp.hash('e91')), '22023', null, 'an expiry beyond the maximum is refused');
select throws_ok(format('select public.create_report_link(%L, %L, 30, 30, %L)', tests.id('b'), pg_temp.hash('long'), repeat('x', 81)), '22023', null, 'a label over 80 characters is refused');
select throws_ok(format('select public.create_report_link(%L, %L, 30, 30)', tests.id('b'), repeat('B', 43)), '22023', null, 'a token in place of its hash is refused');
select tests.clear_authentication();

select throws_ok(
  format($f$insert into public.report_links (workspace_id, profile_id, token_hash, period_days, created_at, expires_at) values (%L, %L, %L, 30, now(), now() - interval '1 day')$f$, tests.id('ws'), tests.id('b'), pg_temp.hash('past')),
  '23514', null, 'the table itself refuses an expiry before the creation');
select throws_ok(
  format($f$insert into public.report_links (workspace_id, profile_id, token_hash, period_days, created_at, expires_at) values (%L, %L, %L, 30, now(), now() + interval '91 days')$f$, tests.id('ws'), tests.id('b'), pg_temp.hash('far')),
  '23514', null, 'and an expiry more than 90 days after it');

-- Without the entitlement.
update public.workspaces set plan_id = 'pro' where id = tests.id('ws');
select tests.authenticate_as(tests.id('owner'));
select throws_ok(
  format('select public.create_report_link(%L, %L, 30, 30)', tests.id('b'), pg_temp.hash('pro')),
  'LK010', null, 'a workspace without shareable_reports cannot create a link');
select tests.clear_authentication();
select tests.authenticate_anon();
select is(public.get_shared_report(repeat('A', 43)), '{"status": "unavailable"}'::jsonb, 'and its existing links stop resolving');
select tests.clear_authentication();
select is((select count(*)::int from public.report_links where workspace_id = tests.id('ws')), 4, 'but they are kept');
update public.workspaces set plan_id = 'agency' where id = tests.id('ws');
delete from public.report_lookup_failures;

-- ---- The anonymous read: content ---------------------------------------------------------------------
select tests.authenticate_anon();
select set_config('tests.r', public.get_shared_report(current_setting('tests.token_a'))::text, true);
select set_config('tests.rb', public.get_shared_report(current_setting('tests.token_b'))::text, true);
select set_config('tests.rd', public.get_shared_report(current_setting('tests.token_d'))::text, true);
select tests.clear_authentication();
select tests.authenticate_as(tests.id('owner'));
select set_config('tests.pa30', public.get_profile_analytics(tests.id('a'), current_setting('tests.today')::date - 30, current_setting('tests.today')::date - 1)::text, true);
select tests.clear_authentication();

select is(current_setting('tests.r')::jsonb ->> 'status', 'ok', 'when the entitlement returns, the same link works again');
select is(
  pg_temp.keys(current_setting('tests.r')::jsonb),
  array['blocks', 'collecting_since', 'configured', 'days', 'ever_published', 'expires_at', 'first_event_day', 'from', 'last_final_day', 'page_slug', 'page_title', 'show_badge', 'sources', 'status', 'timezone', 'to', 'today', 'workspace_name'],
  'the report has exactly the fields of ADR 0013');
select is(
  (select array_agg(distinct k order by k) from jsonb_array_elements(current_setting('tests.r')::jsonb -> 'days') d, jsonb_object_keys(d) k),
  array['count', 'day', 'event_type'], 'each day row has exactly day, event_type and count');
select is(
  (select array_agg(distinct k order by k) from jsonb_array_elements(current_setting('tests.r')::jsonb -> 'sources') d, jsonb_object_keys(d) k),
  array['count', 'key'], 'each source row has exactly key and count');
select is(
  (select array_agg(distinct k order by k) from jsonb_array_elements(current_setting('tests.r')::jsonb -> 'blocks') d, jsonb_object_keys(d) k),
  array['block_type', 'count', 'event_type', 'position', 'ref', 'title'], 'each block row has exactly its six fields');
select ok(current_setting('tests.r') !~ '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', 'the report holds no identifier of a workspace, page, block or person');
select ok(current_setting('tests.r') !~ 'segredo-da-agencia' and current_setting('tests.r') !~ 'boletim', 'UTM values are not in the report');
select ok(current_setting('tests.pa30') ~ 'segredo-da-agencia', '(the members'' dashboard does show them)');
select ok(current_setting('tests.r') !~ 'rascunho' and current_setting('tests.r') !~ 'setembro', 'nothing from the draft and no internal label is in the report');
select is(current_setting('tests.r')::jsonb ->> 'workspace_name', 'Agência Relatos', 'it names the agency');
select is(current_setting('tests.r')::jsonb ->> 'page_title', 'Café Relato', 'the page name is the published one');
select is(current_setting('tests.r')::jsonb ->> 'page_slug', 'cafe-relato', 'with the public address of a page that is on the air');
select is(current_setting('tests.r')::jsonb ->> 'to', (current_setting('tests.today')::date - 1)::text, 'the period ends on the last completed day');
select is(current_setting('tests.r')::jsonb ->> 'from', (current_setting('tests.today')::date - 30)::text, 'and covers the link''s 30 days');
select is(current_setting('tests.r')::jsonb -> 'days', current_setting('tests.pa30')::jsonb -> 'days', 'report totals per day and type equal the page dashboard''s for the same window');
select is(current_setting('tests.r')::jsonb -> 'sources', current_setting('tests.pa30')::jsonb -> 'sources', 'and so do the sources');
select is(pg_temp.total(current_setting('tests.r')::jsonb, 'page_view'), 6::bigint, 'today''s three visits are not in a report of completed days');
select is(
  (select sum((b ->> 'count')::int)::int from jsonb_array_elements(current_setting('tests.r')::jsonb -> 'blocks') b),
  (select sum((b ->> 'count')::int)::int from jsonb_array_elements(current_setting('tests.pa30')::jsonb -> 'blocks') b),
  'block clicks add up to the dashboard''s');
select is(
  (select jsonb_agg(jsonb_build_array(b -> 'position', b ->> 'block_type', b ->> 'title', b ->> 'event_type', b -> 'count') order by (b ->> 'position')::int nulls last, b ->> 'event_type')
   from jsonb_array_elements(current_setting('tests.r')::jsonb -> 'blocks') b),
  '[[2, "whatsapp", "Fazer pedido", "whatsapp_click", 2], [3, "pix", "Pagar", "pix_copy", 1], [null, null, null, "link_click", 1]]'::jsonb,
  'blocks carry the published title and position; a block that is in no snapshot has neither');

-- One page per link.
select is(current_setting('tests.rb')::jsonb ->> 'page_title', 'Estúdio Relato', 'another link opens its own page');
select is(pg_temp.total(current_setting('tests.rb')::jsonb, 'page_view'), 5::bigint, 'with only that page''s visits');
select ok(current_setting('tests.r') !~ 'Estúdio' and current_setting('tests.rb') !~ 'Café', 'a link for page A never returns anything of page B, and vice versa');
select is(current_setting('tests.rd')::jsonb ->> 'status', 'ok', 'a link for an archived page works');
select is(current_setting('tests.rd')::jsonb -> 'page_slug', 'null'::jsonb, 'without a public address, because the page is off the air');
select is((current_setting('tests.rd')::jsonb ->> 'ever_published')::boolean, true, 'and says the page was published once');

-- ---- The anonymous read: every way a token fails looks the same ---------------------------------------
select tests.authenticate_anon();
select is(public.get_shared_report(repeat('Z', 43)), '{"status": "unavailable"}'::jsonb, 'an unknown token is unavailable');
select is(public.get_shared_report('abc'), '{"status": "unavailable"}'::jsonb, 'a malformed token is unavailable');
select is(public.get_shared_report(null), '{"status": "unavailable"}'::jsonb, 'a null token is unavailable');
select is(public.get_shared_report(''), '{"status": "unavailable"}'::jsonb, 'an empty token is unavailable');
select is(public.get_shared_report(pg_temp.hash(repeat('A', 43))), '{"status": "unavailable"}'::jsonb, 'the stored hash does not open the report');
select is(public.get_shared_report(repeat('A', 43) || '%'), '{"status": "unavailable"}'::jsonb, 'a token with a suffix is unavailable');
select tests.clear_authentication();

-- Expired: the same row, with its window moved to the past.
update public.report_links set created_at = now() - interval '10 days', expires_at = now() - interval '1 second' where id = tests.id('link_d');
select tests.authenticate_anon();
select is(public.get_shared_report(repeat('D', 43)), '{"status": "unavailable"}'::jsonb, 'an expired link is unavailable');
select tests.clear_authentication();

-- Revocation.
select tests.authenticate_as(tests.id('editor'));
select throws_ok(format('select public.revoke_report_link(%L)', tests.id('link_b')), '42501', null, 'an editor cannot revoke a link');
select tests.clear_authentication();
select tests.authenticate_as(tests.id('outsider'));
select throws_ok(format('select public.revoke_report_link(%L)', tests.id('link_b')), 'P0002', null, 'a member of another workspace cannot revoke it either, and learns nothing');
select throws_ok(format('select public.revoke_report_link(%L)', gen_random_uuid()), 'P0002', null, 'the same answer as for a link that does not exist');
select tests.clear_authentication();
select tests.authenticate_anon();
select throws_ok(format('select public.revoke_report_link(%L)', tests.id('link_b')), '42501', null, 'anon cannot revoke');
select is(public.get_shared_report(repeat('B', 43)) ->> 'status', 'ok', 'after the refused attempts the link still works');
select tests.clear_authentication();
select tests.authenticate_as(tests.id('admin'));
select lives_ok(format('select public.revoke_report_link(%L)', tests.id('link_b')), 'an admin revokes it');
select lives_ok(format('select public.revoke_report_link(%L)', tests.id('link_b')), 'revoking twice is accepted');
select tests.clear_authentication();
select is(
  (select count(*)::int from public.audit_events where action = 'report_link.revoked' and target_id = tests.id('link_b')),
  1, 'and audited once');
select is((select revoked_by from public.report_links where id = tests.id('link_b')), tests.id('admin'), 'the row records who revoked');
select tests.authenticate_anon();
select is(public.get_shared_report(repeat('B', 43)), '{"status": "unavailable"}'::jsonb, 'a revoked link is unavailable on the very next read');
select tests.clear_authentication();

-- Lifecycle of the page and of the workspace.
select tests.authenticate_as(tests.id('owner'));
select public.unpublish_profile(tests.id('a'));
select tests.clear_authentication();
select tests.authenticate_anon();
select is(public.get_shared_report(repeat('A', 43)) -> 'page_slug', 'null'::jsonb, 'an unpublished page keeps its report, without the address');
select tests.clear_authentication();
update public.profiles set deleted_at = now(), purge_after = now() + interval '30 days' where id = tests.id('a');
select tests.authenticate_anon();
select is(public.get_shared_report(repeat('A', 43)), '{"status": "unavailable"}'::jsonb, 'a deleted page takes its links down');
select tests.clear_authentication();
update public.profiles set deleted_at = null, purge_after = null where id = tests.id('a');
update public.workspaces set status = 'suspended' where id = tests.id('ws');
select tests.authenticate_anon();
select is(public.get_shared_report(repeat('A', 43)), '{"status": "unavailable"}'::jsonb, 'a suspended workspace takes its links down');
select tests.clear_authentication();
select tests.authenticate_as(tests.id('owner'));
select throws_ok(format('select public.create_report_link(%L, %L, 30, 30)', tests.id('a'), pg_temp.hash('suspended')), '42501', null, 'a suspended workspace creates no link');
select lives_ok(format('select public.revoke_report_link(%L)', tests.id('link_d')), 'but a link can still be revoked there');
select tests.clear_authentication();
update public.workspaces set status = 'active' where id = tests.id('ws');
update public.workspaces set deleted_at = now(), purge_after = now() + interval '30 days' where id = tests.id('ws');
select tests.authenticate_anon();
select is(public.get_shared_report(repeat('A', 43)), '{"status": "unavailable"}'::jsonb, 'a deleted workspace takes its links down');
select tests.clear_authentication();
update public.workspaces set deleted_at = null, purge_after = null where id = tests.id('ws');

-- The link belongs to the workspace: it survives its creator.
update public.workspace_memberships set status = 'revoked', revoked_at = now() where workspace_id = tests.id('ws') and user_id = tests.id('admin');
select tests.authenticate_as(tests.id('outsider'));
select is(public.get_shared_report(repeat('M', 43)) ->> 'status', 'ok', 'the link works after its creator left, and for a signed-in stranger exactly as for anon');
select tests.clear_authentication();
update public.workspace_memberships set status = 'active', revoked_at = null where workspace_id = tests.id('ws') and user_id = tests.id('admin');

-- ---- Failed lookups --------------------------------------------------------------------------------
delete from public.report_lookup_failures;
insert into public.report_lookup_failures (client_hash, created_at) values (repeat('9', 32), now() - interval '25 hours');
select tests.authenticate_anon();
select is(
  (select count(*)::int from generate_series(1, 20) n where public.get_shared_report(repeat('Y', 43), repeat('c', 32)) = '{"status": "unavailable"}'::jsonb),
  20, 'twenty failed lookups from one client are answered normally');
select is(public.get_shared_report(repeat('A', 43), repeat('c', 32)), '{"status": "unavailable"}'::jsonb, 'after them, that client gets nothing even with a valid token');
select is(public.get_shared_report(repeat('A', 43), repeat('d', 32)) ->> 'status', 'ok', 'another client is not affected');
select is(public.get_shared_report(repeat('A', 43)) ->> 'status', 'ok', 'nor is a caller without a client hash');
select is(public.get_shared_report(repeat('Y', 43), 'not-a-hash'), '{"status": "unavailable"}'::jsonb, 'a malformed client hash falls in the shared bucket');
select tests.clear_authentication();
select is((select count(*)::int from public.report_lookup_failures where client_hash = repeat('c', 32)), 20, 'lookups refused by the limit are not recorded again');
select is((select count(*)::int from public.report_lookup_failures where client_hash = 'direct'), 1, 'failures without a client hash are counted together');
select is((select count(*)::int from public.report_lookup_failures where created_at < now() - interval '24 hours'), 0, 'counters older than 24 hours are deleted on the next failure');

-- ---- Limits and retention ---------------------------------------------------------------------------
-- A link that ended more than 90 days ago is deleted on the next creation in the workspace.
insert into public.report_links (workspace_id, profile_id, token_hash, period_days, created_at, expires_at)
values (tests.id('ws'), tests.id('b'), pg_temp.hash('ancient'), 30, now() - interval '130 days', now() - interval '100 days');
select tests.authenticate_as(tests.id('owner'));
select lives_ok(format('select public.create_report_link(%L, %L, 30, 30)', tests.id('c'), pg_temp.hash('c1')), 'a link can be created for a page that was never published');
select tests.clear_authentication();
select is((select count(*)::int from public.report_links where token_hash = pg_temp.hash('ancient')), 0, 'finished links are purged after the retention period');
select tests.authenticate_anon();
select is((public.get_shared_report(repeat('A', 43)) ->> 'ever_published')::boolean, true, 'ever_published is true for a page that has a snapshot');
select tests.clear_authentication();

-- Five active links per page (page B has one revoked link, which does not count).
select tests.authenticate_as(tests.id('owner'));
select lives_ok(
  format('select public.create_report_link(%L, md5(n::text) || md5(n::text), 30, 30) from generate_series(1, 5) n', tests.id('b')),
  'five active links fit on one page');
select throws_ok(format('select public.create_report_link(%L, %L, 30, 30)', tests.id('b'), pg_temp.hash('sixth')), 'LK091', null, 'the sixth active link of a page is refused');
select tests.clear_authentication();

-- Thirty creations per workspace in 24 hours.
insert into public.report_links (workspace_id, profile_id, token_hash, period_days, created_at, expires_at, revoked_at)
select tests.id('ws'), tests.id('c'), md5('r' || n::text) || md5('s' || n::text), 30, now(), now() + interval '1 day', now()
from generate_series(1, 30) n;
select tests.authenticate_as(tests.id('owner'));
select throws_ok(format('select public.create_report_link(%L, %L, 30, 30)', tests.id('c'), pg_temp.hash('flood')), 'LK092', null, 'too many links created in 24 hours are refused');
select tests.clear_authentication();

select * from finish();
rollback;
