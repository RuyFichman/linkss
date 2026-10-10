-- Sprint 9: legal versions, account export/request isolation and public moderation.
begin;
select plan(40);

do $$
begin
  if exists (select 1 from vault.secrets where name = 'moderation_signing_secret') then
    perform vault.update_secret((select id from vault.secrets where name = 'moderation_signing_secret'),
      'test-moderation-secret-0123456789-abcdef');
  else
    perform vault.create_secret('test-moderation-secret-0123456789-abcdef', 'moderation_signing_secret');
  end if;
end;
$$;
create function pg_temp.sign_report(p_text text) returns text language sql
as $$ select encode(extensions.hmac(convert_to(p_text, 'UTF8'),
  convert_to('test-moderation-secret-0123456789-abcdef', 'UTF8'), 'sha256'), 'hex') $$;
create function pg_temp.payload(p_slug text, p_hash text, p_reason text default 'phishing') returns text language sql
as $$ select jsonb_build_object('v', 1, 'slug', p_slug, 'reason', p_reason,
  'detail', 'Relato de teste com detalhes suficientes', 'hash', p_hash,
  'at', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))::text $$;

select tests.remember('ana9', tests.create_user('ana-sprint9@example.test', 'Ana'));
select tests.remember('bia9', tests.create_user('bia-sprint9@example.test', 'Bia'));
select tests.remember('carlos9', tests.create_user('carlos-sprint9@example.test', 'Carlos'));
select tests.remember('editor9', tests.create_user('editor-sprint9@example.test', 'Editor'));
select tests.remember('admin9', tests.create_user('admin-sprint9@example.test', 'Moderador'));
select tests.authenticate_as(tests.id('ana9'));
select public.ensure_personal_workspace();
select tests.remember('w9a', public.create_agency_workspace('Conta Ana'));
select tests.authenticate_as(tests.id('bia9'));
select public.ensure_personal_workspace();
select tests.remember('w9b', public.create_agency_workspace('Conta Bia'));
select tests.authenticate_as(tests.id('carlos9'));
select public.ensure_personal_workspace();
select tests.remember('w9c', (select id from public.workspaces
  where created_by = tests.id('carlos9') and kind = 'personal'));
select tests.clear_authentication();
update public.workspaces set plan_id = 'agency' where id = tests.id('w9a');
insert into public.workspace_memberships (workspace_id, user_id, role, status, accepted_at)
values (tests.id('w9a'), tests.id('editor9'), 'editor', 'active', now());
insert into public.platform_admins (user_id) values (tests.id('admin9'));
insert into public.billing_subscriptions
  (workspace_id, provider, provider_subscription_id, provider_customer_id,
   plan_id, billing_interval, amount_cents, currency, status, observed_at)
values (tests.id('w9c'), 'stripe', 'sub_sprint9', 'cus_sprint9',
        'pro', 'month', 1490, 'BRL', 'active', now());
insert into public.profiles (workspace_id, title, slug, bio, blocks)
values (tests.id('w9a'), 'Página Ana', 'qa-sprint9-ana', 'Bio', '[]'::jsonb),
       (tests.id('w9b'), 'Página Bia', 'qa-sprint9-bia', 'Bio', '[]'::jsonb);
select tests.remember('p9a', (select id from public.profiles where slug = 'qa-sprint9-ana'));
select tests.remember('p9b', (select id from public.profiles where slug = 'qa-sprint9-bia'));

insert into public.legal_documents (kind, version, body, status, activated_at)
values ('terms', '2026-10-09-test', repeat('T', 120), 'active', now()),
       ('privacy', '2026-10-09-test', repeat('P', 120), 'active', now());
select tests.remember('terms9', (select id from public.legal_documents where kind = 'terms' and status = 'active'));
select tests.remember('privacy9', (select id from public.legal_documents where kind = 'privacy' and status = 'active'));

select ok((select bool_and(relrowsecurity) from pg_class where oid in (
  'public.legal_documents'::regclass, 'public.legal_acceptances'::regclass,
  'public.privacy_requests'::regclass, 'public.privacy_request_events'::regclass,
  'public.platform_admins'::regclass, 'public.moderation_reports'::regclass)),
  'every new exposed table has RLS');
select ok(not has_table_privilege('anon', 'public.moderation_reports', 'select')
  and not has_table_privilege('authenticated', 'public.platform_admins', 'select'),
  'reports and platform administrators are not directly exposed');
select ok(not has_function_privilege('anon', 'public.export_my_data()', 'execute')
  and not has_function_privilege('anon', 'public.export_workspace_data(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.request_account_deletion()', 'execute'),
  'anonymous callers cannot use account data functions');

select tests.authenticate_anon();
select is(jsonb_array_length(public.get_legal_status() -> 'documents'), 2, 'anonymous visitors read only active legal text');
select ok(not has_table_privilege('anon', 'public.legal_acceptances', 'select'), 'anonymous visitors read no acceptance');
select tests.authenticate_as(tests.id('ana9'));
select is(public.accept_current_legal(tests.id('terms9'),
  (select body_sha256 from public.legal_documents where id = tests.id('terms9')),
  tests.id('privacy9'), (select body_sha256 from public.legal_documents where id = tests.id('privacy9'))),
  true, 'the signed-in person accepts exact current hashes');
select is(public.accept_current_legal(tests.id('terms9'),
  (select body_sha256 from public.legal_documents where id = tests.id('terms9')),
  tests.id('privacy9'), (select body_sha256 from public.legal_documents where id = tests.id('privacy9'))),
  false, 'repeating the same acceptance makes no new record');
select is((select count(*)::int from public.legal_acceptances), 2, 'the user sees two recorded acceptances');
select throws_ok(format('select public.accept_current_legal(%L, %L, %L, %L)',
  tests.id('terms9'), 'wrong-hash', tests.id('privacy9'), 'wrong-hash'),
  'LK110', null, 'changed text or hash cannot be accepted');
select tests.clear_authentication();
update public.legal_documents set status = 'retired' where id = tests.id('terms9');
insert into public.legal_documents (kind, version, body, status, activated_at)
values ('terms', '2026-10-10-test', repeat('N', 120), 'active', now());
select throws_ok(format('update public.legal_documents set body=%L where id=%L',
  repeat('X', 120), tests.id('terms9')), 'LK115', null,
  'activated legal text cannot be silently rewritten, even by an operator');
select tests.authenticate_as(tests.id('ana9'));
select is((public.get_legal_status() -> 'documents' -> 1 ->> 'accepted')::boolean, false,
  'a material new version requires another acceptance');
select is(jsonb_array_length(public.get_my_legal_history()), 2,
  'the user can inspect historical acceptances after a version is retired');
select tests.authenticate_as(tests.id('bia9'));
select is((select count(*)::int from public.legal_acceptances), 0,
  'another account cannot read Ana acceptance history');
select tests.authenticate_as(tests.id('ana9'));
select is(public.export_my_data() -> 'auth' ->> 'email', 'ana-sprint9@example.test',
  'self export returns only the authenticated Auth identity');
select is(public.export_workspace_data(tests.id('w9a')) -> 'profiles' -> 0 ->> 'slug',
  'qa-sprint9-ana', 'owner export includes its page');
select throws_ok(format('select public.export_workspace_data(%L)', tests.id('w9b')),
  'P0002', null, 'owner cannot export another workspace');
select tests.authenticate_as(tests.id('editor9'));
select throws_ok(format('select public.export_workspace_data(%L)', tests.id('w9a')),
  '42501', null, 'editor cannot export the workspace');
select tests.authenticate_as(tests.id('ana9'));
select is(public.request_account_deletion() ->> 'reason', 'shared_workspace',
  'shared workspace makes deletion a review request');
select is((select count(*)::int from public.privacy_requests where user_id = tests.id('ana9')), 1,
  'repeated deletion requests are deduplicated');
select public.request_account_deletion();
select is((select count(*)::int from public.privacy_requests where user_id = tests.id('ana9')), 1,
  'same request stays idempotent');
select tests.authenticate_as(tests.id('bia9'));
select is(public.request_data_access() = public.request_data_access(), true,
  'repeated data access requests keep the same id');
select is((select count(*)::int from public.privacy_requests), 1,
  'another user sees only their own privacy request');

select tests.authenticate_as(tests.id('ana9'));
select throws_ok('select public.list_privacy_requests()', '42501', null,
  'workspace owner cannot inspect the platform privacy queue');
-- The platform administrator has no direct table access: ids come from the queue RPC in the app.
select tests.clear_authentication();
select tests.remember('req9a', (select id from public.privacy_requests where user_id = tests.id('ana9')));
select tests.remember('req9b', (select id from public.privacy_requests where user_id = tests.id('bia9')));
select tests.authenticate_as(tests.id('admin9'));
select is(jsonb_array_length(public.list_privacy_requests()), 2,
  'platform administrator sees the two privacy requests');
select throws_ok(format('select public.review_privacy_request(%L, %L, %L, %L)',
  tests.id('req9a'), 'completed', 'fulfilled', 'case-001'),
  'LK114', null, 'deletion cannot be marked complete while Auth user still exists');
select is(public.review_privacy_request(tests.id('req9b'),
  'processing', 'manual_review', null), 'processing',
  'administrator records a privacy review transition');
select tests.authenticate_as(tests.id('carlos9'));
select is(public.request_account_deletion() ->> 'reason', 'active_subscription',
  'an active paid subscription requires action before account deletion');
select tests.authenticate_anon();
select is(public.submit_moderation_report(pg_temp.payload('qa-sprint9-ana','aaaa', 'phishing'), 'bad'),
  'invalid', 'unsigned reports are rejected');
select is(public.submit_moderation_report(pg_temp.payload('missing-sprint9','0123456789abcdef0123456789abcdef'),
  pg_temp.sign_report(pg_temp.payload('missing-sprint9','0123456789abcdef0123456789abcdef'))),
  'received', 'unknown page gets a neutral response');
select is(public.submit_moderation_report(pg_temp.payload('qa-sprint9-ana','0123456789abcdef0123456789abcdef'),
  pg_temp.sign_report(pg_temp.payload('qa-sprint9-ana','0123456789abcdef0123456789abcdef'))),
  'received', 'anonymous signed report is accepted');
select is(public.submit_moderation_report(pg_temp.payload('qa-sprint9-ana','0123456789abcdef0123456789abcdef'),
  pg_temp.sign_report(pg_temp.payload('qa-sprint9-ana','0123456789abcdef0123456789abcdef'))),
  'received', 'repeated report gets the same neutral response');
select ok(not has_table_privilege('anon', 'public.moderation_reports', 'select'),
  'anonymous client cannot enumerate stored reports through RLS');
select tests.clear_authentication();
select is((select count(*)::int from public.moderation_reports where profile_id = tests.id('p9a')), 1,
  'duplicate reports create one queue item');
select tests.remember('r9', (select id from public.moderation_reports where profile_id = tests.id('p9a')));

select tests.authenticate_as(tests.id('ana9'));
select throws_ok(format('select public.set_profile_moderation(%L, true, %L, %L)',
  tests.id('p9a'), 'Motivo formal de teste', tests.id('r9')),
  '42501', null, 'workspace owner is not a platform moderator');
select tests.authenticate_as(tests.id('admin9'));
select is(jsonb_array_length(public.list_moderation_reports()), 1,
  'platform moderator sees the queue');
select is(public.review_moderation_report(tests.id('r9'), 'in_review', 'Investigação iniciada'),
  'in_review', 'moderator can record investigation state');
select is(public.set_profile_moderation(tests.id('p9a'), true, 'Golpe confirmado em revisão', tests.id('r9')) ->> 'status',
  'suspended', 'moderator suspends the reported page');
select is((select state from public.get_public_page('qa-sprint9-ana')), 'suspended',
  'the suspended page resolves to the public suspended state');
select is(public.set_profile_moderation(tests.id('p9a'), false, 'Conteúdo corrigido e reavaliado', tests.id('r9')) ->> 'status',
  'active', 'moderator reactivates the page');
select is((select state from public.get_public_page('qa-sprint9-ana')), 'unpublished',
  'reactivation returns the page to its previous non-public state');
select * from finish();
rollback;
