-- Sprint 5: form leads. Anonymous submission through one security definer RPC validated against
-- the LIVE publication, consent, honeypot, rate limits, retry safety, retention, RLS and audited
-- owner commands. Mirrors apps/web/src/modules/leads (ADR 0010).
begin;
select plan(68);

select tests.remember('owner', tests.create_user('owner7@example.test', 'Olívia'));
select tests.remember('editor', tests.create_user('editor7@example.test', 'Enzo'));
select tests.remember('outsider', tests.create_user('outsider7@example.test', 'Otávio'));

select tests.authenticate_as(tests.id('owner'));
select public.ensure_personal_workspace();
select tests.remember('ws', public.create_agency_workspace('Agência Leads'));
select tests.clear_authentication();

update public.workspaces set plan_id = 'agency' where id = tests.id('ws');
insert into public.workspace_memberships (workspace_id, user_id, role, invited_by, accepted_at)
values (tests.id('ws'), tests.id('editor'), 'editor', tests.id('owner'), now());

select tests.authenticate_as(tests.id('owner'));
insert into public.profiles (workspace_id, title, slug) values (tests.id('ws'), 'Studio Leads', 'studio-leads');
select tests.remember('page', (select id from public.profiles where slug = 'studio-leads'));
insert into public.profiles (workspace_id, title, slug) values (tests.id('ws'), 'Rascunho Leads', 'rascunho-leads');
select tests.remember('draft_page', (select id from public.profiles where slug = 'rascunho-leads'));
-- Published: a form with required consent, a form with optional consent, a hidden form and a link.
update public.profiles set blocks = '[
  {"id":"7e000000-0000-4000-8000-000000000001","type":"form","visible":true,"title":"Orçamento","fields":["name","email","phone","message"],"buttonLabel":"Enviar","consentText":"Aceito ser contatado sobre o orçamento.","consentRequired":true},
  {"id":"7e000000-0000-4000-8000-000000000002","type":"form","visible":true,"title":"Novidades","fields":["email"],"buttonLabel":"Quero receber","consentText":"Aceito receber novidades.","consentRequired":false},
  {"id":"7e000000-0000-4000-8000-000000000003","type":"form","visible":false,"title":"Oculto","fields":["email"],"buttonLabel":"Enviar","consentText":"Aceito.","consentRequired":true},
  {"id":"7e000000-0000-4000-8000-000000000004","type":"link","visible":true,"title":"Site","url":"https://exemplo.com.br/"}
]' where id = tests.id('page');
select public.publish_profile(tests.id('page'));
-- Added to the draft after publishing: not on the air.
update public.profiles set blocks = blocks || '[{"id":"7e000000-0000-4000-8000-000000000005","type":"form","visible":true,"title":"Só no rascunho","fields":["email"],"buttonLabel":"Enviar","consentText":"Aceito.","consentRequired":false}]'::jsonb where id = tests.id('page');
update public.profiles set blocks = '[{"id":"7e000000-0000-4000-8000-000000000006","type":"form","visible":true,"title":"Nunca publicado","fields":["email"],"buttonLabel":"Enviar","consentText":"Aceito.","consentRequired":false}]' where id = tests.id('draft_page');
select tests.clear_authentication();

select tests.authenticate_as(tests.id('outsider'));
select public.ensure_personal_workspace();
select tests.clear_authentication();

select set_config('tests.form', '7e000000-0000-4000-8000-000000000001', true);
select set_config('tests.optional', '7e000000-0000-4000-8000-000000000002', true);
select set_config('tests.hash_a', repeat('a', 32), true);
select set_config('tests.hash_b', repeat('b', 32), true);

-- ---- Visitor: happy path ------------------------------------------------------------------------
select tests.authenticate_anon();
select ok(has_function_privilege('anon', 'public.submit_form_lead(text, text, jsonb, boolean, text, text)', 'execute'), 'anon may submit a form');
select is(
  public.submit_form_lead('studio-leads', current_setting('tests.form'),
    '{"name": "  Ana   Lima ", "email": " Ana@Exemplo.COM.br ", "phone": "(11) 91234-5678", "message": "Quero um\r\norçamento", "admin": true, "workspace_id": "x"}',
    true, '', current_setting('tests.hash_a')),
  'ok', 'a valid submission to a published form is accepted');
select throws_ok('select 1 from public.form_leads limit 1', '42501', null, 'anon cannot read leads');
select throws_ok('select 1 from public.form_submission_hits limit 1', '42501', null, 'anon cannot read the rate-limit counters');
select throws_ok(
  format($f$insert into public.form_leads (workspace_id, profile_id, block_id, publication_version, email, consent_given, consent_required, consent_text, consent_version, dedupe_key, purge_after)
    values (%L, %L, 'x', 1, 'spam@evil.example', false, false, 'x', md5('x'), md5('x'), now() + interval '1 day')$f$, tests.id('ws'), tests.id('page')),
  '42501', null, 'anon cannot insert leads directly');
select tests.clear_authentication();

select results_eq(
  format('select name, email, phone, message, consent_given, consent_required, consent_text, consent_version, publication_version, block_id from public.form_leads where profile_id = %L', tests.id('page')),
  $$values ('Ana Lima', 'ana@exemplo.com.br', '11912345678', E'Quero um\norçamento', true, true, 'Aceito ser contatado sobre o orçamento.', md5('Aceito ser contatado sobre o orçamento.'), 1, '7e000000-0000-4000-8000-000000000001')$$,
  'the lead stores normalized values, the consent text and its version, and the publication it came from');
select ok(
  (select consented_at is not null and purge_after between now() + interval '89 days' and now() + interval '91 days' and workspace_id = tests.id('ws')
   from public.form_leads where profile_id = tests.id('page')),
  'the lead records when consent was given, its tenant and a 90-day retention date');
select is(
  (select array_agg(column_name::text order by column_name) from information_schema.columns
   where table_schema = 'public' and table_name in ('form_leads', 'form_submission_hits') and column_name ~* '(^|_)(ip|address|user_agent)($|_)'),
  null, 'no column stores an IP address or user agent');
select is((select client_hash from public.form_submission_hits where profile_id = tests.id('page')), repeat('a', 32), 'the rate-limit counter keeps only the salted hash');

-- ---- Consent -------------------------------------------------------------------------------------
select tests.authenticate_anon();
select is(
  public.submit_form_lead('studio-leads', current_setting('tests.form'), '{"name": "Bia", "email": "bia@exemplo.com.br", "phone": "11912345679"}', false, '', current_setting('tests.hash_b')),
  'consent_required', 'a submission without required consent is rejected by the database');
select is(
  public.submit_form_lead('studio-leads', current_setting('tests.form'), '{"name": "Bia", "email": "bia@exemplo.com.br", "phone": "11912345679"}', null, '', current_setting('tests.hash_b')),
  'consent_required', 'a missing consent value counts as not given');
select is(
  public.submit_form_lead('studio-leads', current_setting('tests.optional'), '{"email": "caio@exemplo.com.br", "name": "ignored"}', false, '', current_setting('tests.hash_b')),
  'ok', 'when consent is optional a submission without it is accepted');
select tests.clear_authentication();
select is((select count(*)::int from public.form_leads where email = 'bia@exemplo.com.br'), 0, 'nothing is stored without required consent');
select results_eq(
  $$select name, consent_given, consent_required, consented_at, consent_text from public.form_leads where email = 'caio@exemplo.com.br'$$,
  $$values (null::text, false, false, null::timestamptz, 'Aceito receber novidades.')$$,
  'optional consent not given is recorded as such, and fields the form does not have are ignored');

-- ---- Honeypot -------------------------------------------------------------------------------------
select tests.authenticate_anon();
select is(
  public.submit_form_lead('studio-leads', current_setting('tests.form'), '{"name": "Bot", "email": "bot@spam.example", "phone": "11900000000"}', true, 'https://spam.example', current_setting('tests.hash_b')),
  'ok', 'a filled honeypot gets the same answer as a real submission');
select is(
  public.submit_form_lead('nao-existe-aqui', 'x', '{}', true, 'spam', null),
  'ok', 'a filled honeypot reveals nothing, not even whether the form exists');
select tests.clear_authentication();
select is((select count(*)::int from public.form_leads where email = 'bot@spam.example'), 0, 'a honeypot submission stores nothing');

-- ---- Invalid fields --------------------------------------------------------------------------------
select tests.authenticate_anon();
select is(
  public.submit_form_lead('studio-leads', current_setting('tests.form'), v.fields::jsonb, true, '', current_setting('tests.hash_b')),
  'invalid', 'invalid submission is rejected: ' || v.label)
from (values
  ('missing required name', '{"email": "dani@exemplo.com.br", "phone": "11912345670"}'),
  ('malformed e-mail', '{"name": "Dani", "email": "dani@", "phone": "11912345670"}'),
  ('e-mail with a space', '{"name": "Dani", "email": "dani lima@exemplo.com.br", "phone": "11912345670"}'),
  ('phone with letters', '{"name": "Dani", "email": "dani@exemplo.com.br", "phone": "ligue 11912345670"}'),
  ('phone too short', '{"name": "Dani", "email": "dani@exemplo.com.br", "phone": "1234"}'),
  ('name too long', format('{"name": "%s", "email": "dani@exemplo.com.br", "phone": "11912345670"}', repeat('x', 101))),
  ('message too long', format('{"name": "Dani", "email": "dani@exemplo.com.br", "phone": "11912345670", "message": "%s"}', repeat('x', 1001))),
  ('control character', '{"name": "Dani\u0007", "email": "dani@exemplo.com.br", "phone": "11912345670"}'),
  ('non-string value', '{"name": {"x": 1}, "email": "dani@exemplo.com.br", "phone": "11912345670"}'),
  ('not an object', '["dani@exemplo.com.br"]'),
  ('oversized payload', format('{"name": "Dani", "email": "dani@exemplo.com.br", "phone": "11912345670", "junk": "%s"}', repeat('x', 5000)))
) v(label, fields);
select is(public.submit_form_lead('studio-leads', current_setting('tests.form'), null, true, '', null), 'invalid', 'a null payload is invalid');

-- ---- Only published forms accept submissions -------------------------------------------------
select is(
  public.submit_form_lead(v.slug, v.block, '{"email": "eva@exemplo.com.br"}', true, '', current_setting('tests.hash_b')),
  'unavailable', 'no submission is accepted: ' || v.label)
from (values
  ('unknown block id', 'studio-leads', '7e000000-0000-4000-8000-0000000000ff'),
  ('a block that is not a form', 'studio-leads', '7e000000-0000-4000-8000-000000000004'),
  ('a hidden form (not in the snapshot)', 'studio-leads', '7e000000-0000-4000-8000-000000000003'),
  ('a form that exists only in the draft', 'studio-leads', '7e000000-0000-4000-8000-000000000005'),
  ('a page that was never published', 'rascunho-leads', '7e000000-0000-4000-8000-000000000006'),
  ('an unknown address', 'nao-existe-aqui', '7e000000-0000-4000-8000-000000000001'),
  ('a malformed address', '../etc/passwd', '7e000000-0000-4000-8000-000000000001'),
  ('a reserved address', 'entrar', '7e000000-0000-4000-8000-000000000001')
) v(label, slug, block);
select is(public.submit_form_lead('studio-leads', null, '{"email": "eva@exemplo.com.br"}', true, '', null), 'unavailable', 'a null block id is unavailable');

-- ---- Retry safety ---------------------------------------------------------------------------------
select is(
  public.submit_form_lead('studio-leads', current_setting('tests.form'),
    '{"name": "Ana Lima", "email": "ana@exemplo.com.br", "phone": "11 91234-5678", "message": "Quero um\norçamento"}', true, '', current_setting('tests.hash_a')),
  'ok', 'sending the same submission again answers ok');
select tests.clear_authentication();
select is((select count(*)::int from public.form_leads where email = 'ana@exemplo.com.br'), 1, 'and the retry is stored only once');

-- ---- Rate limits ------------------------------------------------------------------------------------
select tests.authenticate_anon();
select is(
  (select array_agg(public.submit_form_lead('studio-leads', current_setting('tests.optional'), jsonb_build_object('email', 'pessoa' || n || '@exemplo.com.br'), false, '', current_setting('tests.hash_a')) order by n)
   from generate_series(1, 5) n),
  array['ok', 'ok', 'ok', 'ok', 'rate_limited'],
  'the sixth accepted submission from the same visitor within 10 minutes is rate limited');
select is(
  public.submit_form_lead('studio-leads', current_setting('tests.optional'), '{"email": "outra@exemplo.com.br"}', false, '', repeat('c', 32)),
  'ok', 'another visitor is not affected');
select is(
  (select array_agg(public.submit_form_lead('studio-leads', current_setting('tests.optional'), jsonb_build_object('email', 'direto' || n || '@exemplo.com.br'), false, '', v.hash) order by n)
   from generate_series(1, 6) n, lateral (select case when n % 2 = 0 then null else 'forged-hash' end as hash) v),
  array['ok', 'ok', 'ok', 'ok', 'ok', 'rate_limited'],
  'direct calls without a valid hash share one bucket');
select tests.clear_authentication();
insert into public.form_submission_hits (profile_id, client_hash) select tests.id('page'), md5(n::text) from generate_series(1, 60) n;
select tests.authenticate_anon();
select is(
  public.submit_form_lead('studio-leads', current_setting('tests.optional'), '{"email": "lotado@exemplo.com.br"}', false, '', repeat('d', 32)),
  'rate_limited', 'a page accepts at most 60 submissions per hour');
select tests.clear_authentication();
select is((select count(*)::int from public.form_leads where email in ('lotado@exemplo.com.br', 'pessoa5@exemplo.com.br', 'direto6@exemplo.com.br')), 0, 'rate-limited submissions store nothing');
delete from public.form_submission_hits where profile_id = tests.id('page');

-- ---- Members read; owners and admins delete and export -----------------------------------------
select tests.authenticate_as(tests.id('editor'));
select cmp_ok((select count(*)::int from public.form_leads where profile_id = tests.id('page')), '>=', 2, 'an editor of the workspace reads the leads');
select tests.remember('lead', (select id from public.form_leads where email = 'ana@exemplo.com.br'));
select throws_ok(format('select public.delete_form_lead(%L)', tests.id('lead')), '42501', null, 'an editor cannot delete a lead');
select throws_ok(format('select public.record_lead_export(%L, 3)', tests.id('page')), '42501', null, 'an editor cannot export leads');
select throws_ok(format('delete from public.form_leads where id = %L', tests.id('lead')), '42501', null, 'leads cannot be deleted directly');
select throws_ok(format($f$update public.form_leads set email = 'x@evil.example' where id = %L$f$, tests.id('lead')), '42501', null, 'leads cannot be changed');
select tests.clear_authentication();

select tests.authenticate_as(tests.id('outsider'));
select is((select count(*)::int from public.form_leads), 0, 'another workspace reads no leads');
select throws_ok(format('select public.delete_form_lead(%L)', tests.id('lead')), 'P0002', null, 'another workspace cannot delete a lead');
select throws_ok(format('select public.record_lead_export(%L, 3)', tests.id('page')), 'P0002', null, 'another workspace cannot export leads');
select tests.clear_authentication();

select tests.authenticate_anon();
select throws_ok(format('select public.delete_form_lead(%L)', tests.id('lead')), '42501', null, 'anon cannot delete a lead');
select tests.clear_authentication();

select tests.authenticate_as(tests.id('owner'));
select lives_ok(format('select public.record_lead_export(%L, 7)', tests.id('page')), 'the owner records an export');
select lives_ok(format('select public.delete_form_lead(%L)', tests.id('lead')), 'the owner deletes a lead');
select throws_ok(format('select public.delete_form_lead(%L)', tests.id('lead')), 'P0002', null, 'deleting it again reports not found');
select tests.clear_authentication();
select is((select count(*)::int from public.form_leads where id = tests.id('lead')), 0, 'the lead is gone');
select results_eq(
  format('select action::text, target_type, target_id, metadata, actor_user_id from public.audit_events where target_id = %L and action::text like %L order by action::text', tests.id('page'), 'lead.%'),
  format($f$values ('lead.deleted', 'profile', %1$L::uuid, '{"count": 1}'::jsonb, %2$L::uuid), ('lead.exported', 'profile', %1$L::uuid, '{"count": 7}'::jsonb, %2$L::uuid)$f$, tests.id('page'), tests.id('owner')),
  'deletion and export are audited with a count and no lead content');

-- ---- Retention -------------------------------------------------------------------------------------
update public.form_leads set purge_after = now() - interval '1 minute' where email = 'caio@exemplo.com.br';
select tests.authenticate_as(tests.id('owner'));
select is((select count(*)::int from public.form_leads where email = 'caio@exemplo.com.br'), 0, 'a lead past its retention date is no longer visible');
select tests.clear_authentication();
select tests.authenticate_anon();
select is(
  public.submit_form_lead('studio-leads', current_setting('tests.optional'), '{"email": "nova@exemplo.com.br"}', false, '', repeat('e', 32)),
  'ok', 'a new submission is accepted');
select tests.clear_authentication();
select is((select count(*)::int from public.form_leads where email = 'caio@exemplo.com.br'), 0, 'and it deletes the page''s expired leads');

-- ---- Off the air, suspended, deleted -----------------------------------------------------------
select tests.authenticate_as(tests.id('owner'));
select public.unpublish_profile(tests.id('page'));
select tests.clear_authentication();
select tests.authenticate_anon();
select is(public.submit_form_lead('studio-leads', current_setting('tests.optional'), '{"email": "fora@exemplo.com.br"}', false, '', null), 'unavailable', 'a page off the air accepts no submission');
select tests.clear_authentication();
select tests.authenticate_as(tests.id('owner'));
select public.publish_profile(tests.id('page'));
select tests.clear_authentication();
select tests.authenticate_anon();
select is(public.submit_form_lead('studio-leads', '7e000000-0000-4000-8000-000000000005', '{"email": "agora@exemplo.com.br"}', false, '', repeat('f', 32)), 'ok', 'a form accepts submissions once it is published');
select tests.clear_authentication();
select is((select publication_version from public.form_leads where email = 'agora@exemplo.com.br'), 2, 'the lead records the publication version the visitor saw');

update public.workspaces set status = 'suspended' where id = tests.id('ws');
select tests.authenticate_anon();
select is(public.submit_form_lead('studio-leads', current_setting('tests.optional'), '{"email": "suspensa@exemplo.com.br"}', false, '', null), 'unavailable', 'a suspended workspace accepts no submission');
select tests.clear_authentication();
select tests.authenticate_as(tests.id('owner'));
select throws_ok(format('select public.delete_form_lead(%L)', (select id from public.form_leads where email = 'agora@exemplo.com.br')), '42501', null, 'a suspended workspace cannot delete leads');
select tests.clear_authentication();
update public.workspaces set status = 'active' where id = tests.id('ws');

select tests.authenticate_as(tests.id('owner'));
select public.soft_delete_profile(tests.id('page'));
select is((select count(*)::int from public.form_leads), 0, 'leads of a deleted page are no longer visible');
select tests.clear_authentication();

select * from finish();
rollback;
