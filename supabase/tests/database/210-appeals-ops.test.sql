-- Sprint 9 (ADR 0019): suspension notice and appeal, job heartbeat and operational status.
begin;
select plan(51);

select tests.remember('own', tests.create_user('own-ap@example.test', 'Dona'));
select tests.remember('edi', tests.create_user('edi-ap@example.test', 'Editora'));
select tests.remember('oth', tests.create_user('oth-ap@example.test', 'Outra'));
select tests.remember('adm', tests.create_user('adm-ap@example.test', 'Adm'));

select tests.authenticate_as(tests.id('edi'));
select public.ensure_personal_workspace();
select tests.authenticate_as(tests.id('own'));
select public.ensure_personal_workspace();
select tests.remember('ws', public.create_agency_workspace('Agência Apelo'));
select tests.authenticate_as(tests.id('oth'));
select tests.remember('ws_oth', public.ensure_personal_workspace());
select tests.authenticate_as(tests.id('adm'));
select public.ensure_personal_workspace();
select tests.clear_authentication();

update public.workspaces set plan_id = 'agency' where id = tests.id('ws');
insert into public.platform_admins (user_id) values (tests.id('adm'));
insert into public.workspace_memberships (workspace_id, user_id, role, status, accepted_at)
values (tests.id('ws'), tests.id('edi'), 'editor', 'active', now());
insert into public.profiles (workspace_id, title, slug) values
  (tests.id('ws'), 'Página A', 'qa-ap-a'), (tests.id('ws'), 'Página B', 'qa-ap-b'), (tests.id('ws_oth'), 'Outra', 'qa-ap-outra');
select tests.remember('pa', (select id from public.profiles where slug = 'qa-ap-a'));
select tests.remember('pb', (select id from public.profiles where slug = 'qa-ap-b'));
select tests.remember('po', (select id from public.profiles where slug = 'qa-ap-outra'));
select tests.remember('report', gen_random_uuid());
insert into public.moderation_reports (id, profile_id, workspace_id, slug, reason, reporter_hash)
values (tests.id('report'), tests.id('pa'), tests.id('ws'), 'qa-ap-a', 'impersonation', md5('rep'));

-- Privileges and direct access.
select ok(not has_table_privilege('authenticated', 'public.moderation_suspensions', 'select')
  and not has_table_privilege('authenticated', 'public.moderation_appeals', 'select')
  and not has_table_privilege('anon', 'public.moderation_appeals', 'select')
  and not has_table_privilege('service_role', 'public.moderation_appeals', 'select')
  and not has_table_privilege('authenticated', 'public.job_runs', 'select')
  and not has_table_privilege('service_role', 'public.job_runs', 'select'),
  'no client role reads suspensions, appeals or the job heartbeat directly');
select ok((select bool_and(relrowsecurity) from pg_class where oid in
  ('public.moderation_suspensions'::regclass, 'public.moderation_appeals'::regclass, 'public.job_runs'::regclass)),
  'row level security is on for the three new tables');
select ok(not has_function_privilege('anon', 'public.get_page_moderation(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.submit_moderation_appeal(uuid, text)', 'execute')
  and not has_function_privilege('anon', 'public.decide_moderation_appeal(uuid, boolean, text)', 'execute')
  and not has_function_privilege('anon', 'public.list_moderation_appeals()', 'execute'),
  'anon cannot call the appeal functions');
select ok(not has_function_privilege('authenticated', 'public.get_ops_status()', 'execute')
  and not has_function_privilege('anon', 'public.get_ops_status()', 'execute')
  and not has_function_privilege('authenticated', 'public.record_job_run(text, text)', 'execute')
  and has_function_privilege('service_role', 'public.get_ops_status()', 'execute')
  and has_function_privilege('service_role', 'public.record_job_run(text, text)', 'execute'),
  'only the service role reads the status and writes the heartbeat');

-- Before any suspension.
select tests.authenticate_as(tests.id('own'));
select is(public.get_page_moderation(tests.id('pa')) - 'title' - 'slug',
  '{"status":"active","category":null,"suspendedAt":null,"canAppeal":true,"appealsLeft":3,"appeals":[]}'::jsonb,
  'a page that was never suspended reports active and no appeal');
select throws_ok(format('select public.submit_moderation_appeal(%L, %L)', tests.id('pa'), 'Esta página não tem nada de errado, podem conferir.'),
  'LK126', null, 'a page that is not suspended cannot be appealed');

-- Suspension from a report carries the report's category.
select tests.authenticate_as(tests.id('adm'));
select public.set_profile_moderation(tests.id('pa'), true, 'Imita uma marca conhecida, conforme denúncia.', tests.id('report'));
select public.set_profile_moderation(tests.id('pb'), true, 'Suspensão sem denúncia vinculada.');
select public.set_profile_moderation(tests.id('pb'), true, 'Repetida, não deve criar outra linha.');
select tests.clear_authentication();
select is((select category from public.moderation_suspensions where profile_id = tests.id('pa') and lifted_at is null), 'impersonation',
  'the suspension records the category of the report');
select is((select array_agg(category) from public.moderation_suspensions where profile_id = tests.id('pb')), array['other'],
  'a suspension with no report is recorded once, as other');

-- What the workspace sees.
select tests.authenticate_as(tests.id('own'));
select is(public.get_page_moderation(tests.id('pa')) ->> 'status', 'suspended', 'the owner sees the page is suspended');
select is(public.get_page_moderation(tests.id('pa')) ->> 'category', 'impersonation', 'and the category');
select ok(public.get_page_moderation(tests.id('pa'))::text not like '%Imita uma marca%', 'never the administrator''s justification');
select tests.authenticate_as(tests.id('edi'));
select is((public.get_page_moderation(tests.id('pa')) ->> 'canAppeal')::boolean, false, 'an editor sees the notice but cannot appeal');
select throws_ok(format('select public.submit_moderation_appeal(%L, %L)', tests.id('pa'), 'Sou editora e gostaria de contestar a suspensão.'),
  '42501', null, 'an editor''s appeal is refused');
select tests.authenticate_as(tests.id('oth'));
select throws_ok(format('select public.get_page_moderation(%L)', tests.id('pa')), 'P0002', null, 'another tenant gets not found');
select throws_ok(format('select public.submit_moderation_appeal(%L, %L)', tests.id('pa'), 'Não sou desta conta, mas quero contestar mesmo assim.'),
  'P0002', null, 'another tenant cannot appeal');
select throws_ok(format('select public.list_moderation_appeals()'), '42501', null, 'an ordinary person cannot list appeals');
select tests.authenticate_anon();
select throws_ok(format('select public.get_page_moderation(%L)', tests.id('pa')), '42501', null, 'anon is refused');

-- Appeal.
select tests.authenticate_as(tests.id('own'));
select throws_ok(format('select public.submit_moderation_appeal(%L, %L)', tests.id('pa'), 'curto'), '22023', null, 'a message that is too short is refused');
select throws_ok(format('select public.submit_moderation_appeal(%L, %L)', tests.id('pa'), repeat('x', 1001)), '22023', null, 'a message that is too long is refused');
select throws_ok(format('select public.submit_moderation_appeal(%L, %L)', tests.id('pa'), 'Mensagem com controle ' || chr(7) || ' no meio dela.'), '22023', null, 'control characters are refused');
select is(public.submit_moderation_appeal(tests.id('pa'), E'  Somos a própria marca.\nSegue o registro para conferência.  ') ->> 'status', 'open', 'the owner files an appeal');
select is(public.get_page_moderation(tests.id('pa')) -> 'appeals' -> 0 ->> 'message', E'Somos a própria marca.\nSegue o registro para conferência.',
  'the message is trimmed and keeps its line break');
select throws_ok(format('select public.submit_moderation_appeal(%L, %L)', tests.id('pa'), 'Segunda contestação enquanto a primeira espera.'), 'LK127', null,
  'a second appeal is refused while one waits');
select is(jsonb_array_length(public.get_page_moderation(tests.id('pa')) -> 'appeals'), 1, 'the owner sees the appeal');
select is(public.get_page_moderation(tests.id('pa')) -> 'appeals' -> 0 ->> 'status', 'open', 'as waiting');
select tests.authenticate_as(tests.id('edi'));
select is(public.get_page_moderation(tests.id('pa')) -> 'appeals' -> 0 -> 'message', 'null'::jsonb, 'an editor sees that an appeal exists, not its text');
select tests.clear_authentication();
select is((select count(*)::int from public.audit_events where action = 'moderation.appealed' and target_id = tests.id('pa')), 1, 'the appeal is in the audit trail');
select tests.remember('appeal', (select id from public.moderation_appeals where profile_id = tests.id('pa')));

-- Decision.
select tests.authenticate_as(tests.id('own'));
select throws_ok(format('select public.decide_moderation_appeal(%L, true, %L)', tests.id('appeal'), 'Aceito pela própria dona.'),
  '42501', null, 'the owner cannot decide the appeal');
select tests.authenticate_as(tests.id('adm'));
select is(jsonb_array_length(public.list_moderation_appeals()), 1, 'the administrator sees the appeal in the queue');
select is(public.list_moderation_appeals() -> 0 ->> 'category', 'impersonation', 'with the category of the suspension');
select tests.clear_authentication();
select tests.authenticate_as(tests.id('adm'));
select throws_ok(format('select public.decide_moderation_appeal(%L, false, %L)', tests.id('appeal'), 'curta'), '22023', null, 'a decision needs an answer for the workspace');
select throws_ok(format('select public.decide_moderation_appeal(%L, false, %L)', gen_random_uuid(), 'Resposta para um apelo inexistente.'), 'P0002', null, 'an unknown appeal is not found');
select is(public.decide_moderation_appeal(tests.id('appeal'), false, 'O registro enviado é de outra empresa.') ->> 'status', 'denied', 'the administrator denies the appeal');
select is(public.decide_moderation_appeal(tests.id('appeal'), false, 'O registro enviado é de outra empresa.') ->> 'status', 'denied', 'deciding the same way twice is harmless');
select throws_ok(format('select public.decide_moderation_appeal(%L, true, %L)', tests.id('appeal'), 'Mudando de ideia depois de decidir.'), 'LK129', null, 'a decided appeal cannot be reversed');
select tests.authenticate_as(tests.id('own'));
select is(public.get_page_moderation(tests.id('pa')) -> 'appeals' -> 0 ->> 'response', 'O registro enviado é de outra empresa.', 'the owner reads the answer');
select is(public.get_page_moderation(tests.id('pa')) ->> 'status', 'suspended', 'a denied appeal leaves the page suspended');

-- A second appeal is accepted; the third is the last.
select public.submit_moderation_appeal(tests.id('pa'), 'Agora com o registro correto da nossa marca em anexo.');
select tests.clear_authentication();
select tests.remember('appeal2', (select id from public.moderation_appeals where profile_id = tests.id('pa') and status = 'open'));
select tests.authenticate_as(tests.id('adm'));
select is(public.decide_moderation_appeal(tests.id('appeal2'), true, 'Registro conferido. A página volta ao ar.') ->> 'status', 'accepted', 'the administrator accepts the second appeal');
select tests.clear_authentication();
select is((select moderation_status from public.profiles where id = tests.id('pa')), 'active', 'an accepted appeal reactivates the page');
select ok((select lifted_at is not null from public.moderation_suspensions where profile_id = tests.id('pa')), 'and closes the suspension');
select is((select count(*)::int from public.audit_events where target_id = tests.id('pa') and action in ('moderation.reactivated', 'moderation.appeal_decided')), 3,
  'both decisions and the reactivation are in the audit trail');
select tests.authenticate_as(tests.id('own'));
select is(public.get_page_moderation(tests.id('pa')) - 'title' - 'slug',
  '{"status":"active","category":null,"suspendedAt":null,"canAppeal":true,"appealsLeft":3,"appeals":[]}'::jsonb,
  'once reactivated the notice is gone');

-- Reactivating from the reports queue answers a waiting appeal; the limit is per suspension.
select public.submit_moderation_appeal(tests.id('pb'), 'Primeira contestação da página B, com detalhes.');
select tests.authenticate_as(tests.id('adm'));
select public.set_profile_moderation(tests.id('pb'), false, 'Reativada depois de revisão interna.');
select tests.clear_authentication();
select is((select status from public.moderation_appeals where profile_id = tests.id('pb')), 'accepted', 'lifting a suspension answers the waiting appeal');
select tests.authenticate_as(tests.id('adm'));
select public.set_profile_moderation(tests.id('pb'), true, 'Suspensa de novo por reincidência.');
select tests.clear_authentication();
insert into public.moderation_appeals (suspension_id, profile_id, workspace_id, message, status, response, decided_at)
select s.id, s.profile_id, s.workspace_id, 'Contestação antiga número ' || n || ' da página B.', 'denied', 'Negada no teste de limite.', now()
from public.moderation_suspensions s, generate_series(1, 3) n where s.profile_id = tests.id('pb') and s.lifted_at is null;
select tests.authenticate_as(tests.id('own'));
select is((public.get_page_moderation(tests.id('pb')) ->> 'appealsLeft')::int, 0, 'three appeals per suspension');
select throws_ok(format('select public.submit_moderation_appeal(%L, %L)', tests.id('pb'), 'Quarta contestação para a mesma suspensão.'), 'LK128', null,
  'the fourth is refused');

-- Heartbeat and status.
select tests.authenticate_as(tests.id('own'));
select throws_ok('select public.get_ops_status()', '42501', null, 'a signed-in person cannot read the status');
select throws_ok($$select public.record_job_run('billing', 'ok')$$, '42501', null, 'nor write the heartbeat');
select tests.authenticate_service();
select is(jsonb_array_length(public.get_ops_status() -> 'jobs'), 4, 'the status lists the four jobs from the baseline');
select public.record_job_run('retention', 'unavailable');
select ok((select (j ->> 'lastOutcome') = 'unavailable' and (j ->> 'lastOkAt') is not null
  from jsonb_array_elements(public.get_ops_status() -> 'jobs') j where j ->> 'job' = 'retention'),
  'a failed run is recorded and keeps the last good time');
select throws_ok($$select public.record_job_run('unknown-job', 'ok')$$, '23514', null, 'an unknown job is refused');
select ok(public.get_ops_status() ? 'billing' and public.get_ops_status() ? 'queues' and public.get_ops_status() ? 'purge'
  and public.get_ops_status()::text !~ '@' and public.get_ops_status()::text not like '%qa-ap-%',
  'the status has counts only: no address, no page');

select * from finish();
rollback;
