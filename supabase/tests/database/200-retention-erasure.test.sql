-- Sprint 9 (ADR 0018): scheduled retention purges and the two-step account erasure.
begin;
select plan(56);

-- ---------------------------------------------------------------------------------------------
-- Fixture: Ana (to be erased) owns her personal workspace and an agency of her own; Bia is another
-- tenant whose agency Ana also works in; Adm is a platform administrator; Eve is nobody special.
-- ---------------------------------------------------------------------------------------------
select tests.remember('ana', tests.create_user('ana-ret@example.test', 'Ana'));
select tests.remember('bia', tests.create_user('bia-ret@example.test', 'Bia'));
select tests.remember('adm', tests.create_user('adm-ret@example.test', 'Adm'));
select tests.remember('eve', tests.create_user('eve-ret@example.test', 'Eve'));

select tests.authenticate_as(tests.id('ana'));
select tests.remember('wa', public.ensure_personal_workspace());
select tests.remember('wag', public.create_agency_workspace('Agência da Ana'));
select tests.authenticate_as(tests.id('bia'));
select tests.remember('wb', public.ensure_personal_workspace());
select tests.remember('wbg', public.create_agency_workspace('Agência da Bia'));
select tests.authenticate_as(tests.id('adm'));
select public.ensure_personal_workspace();
select tests.authenticate_as(tests.id('eve'));
select public.ensure_personal_workspace();
select tests.clear_authentication();

update public.workspaces set plan_id = 'agency' where id in (tests.id('wag'), tests.id('wbg'), tests.id('wb'));
insert into public.platform_admins (user_id) values (tests.id('adm'));
insert into public.workspace_memberships (workspace_id, user_id, role, status, accepted_at)
values (tests.id('wbg'), tests.id('ana'), 'editor', 'active', now());

insert into public.profiles (workspace_id, title, slug) values
  (tests.id('wa'), 'Ana', 'qa-ret-ana'), (tests.id('wag'), 'Cliente', 'qa-ret-cliente'),
  (tests.id('wb'), 'Bia', 'qa-ret-bia'), (tests.id('wb'), 'Bia antiga', 'qa-ret-bia-old'),
  (tests.id('wb'), 'Bia com imagem', 'qa-ret-bia-img');
select tests.remember('pa', (select id from public.profiles where slug = 'qa-ret-ana'));
select tests.remember('pc', (select id from public.profiles where slug = 'qa-ret-cliente'));
select tests.remember('pb', (select id from public.profiles where slug = 'qa-ret-bia'));
select tests.remember('pb_old', (select id from public.profiles where slug = 'qa-ret-bia-old'));
select tests.remember('pb_img', (select id from public.profiles where slug = 'qa-ret-bia-img'));

select tests.remember('ma', gen_random_uuid());
select tests.remember('mb', gen_random_uuid());
insert into public.media_assets (id, workspace_id, profile_id, kind, status, width, height, bytes, variants, activated_at) values
  (tests.id('ma'), tests.id('wa'), tests.id('pa'), 'image', 'ready', 448, 336, 1111, '[{"w": 448, "h": 336, "bytes": 1111}]', now()),
  (tests.id('mb'), tests.id('wb'), tests.id('pb_img'), 'image', 'ready', 448, 336, 1111, '[{"w": 448, "h": 336, "bytes": 1111}]', now());

-- Two of Bia's pages were deleted long ago; one still has an image file in the bucket.
update public.profiles set deleted_at = now() - interval '40 days', purge_after = now() - interval '10 days'
where id in (tests.id('pb_old'), tests.id('pb_img'));

insert into public.form_leads (workspace_id, profile_id, block_id, publication_version, name, email, consent_given, consent_required, consent_text, consent_version, dedupe_key, purge_after) values
  (tests.id('wb'), tests.id('pb'), 'b', 1, 'vencido', 'v@example.test', false, false, 'x', md5('x'), md5('old'), now() - interval '1 minute'),
  (tests.id('wb'), tests.id('pb'), 'b', 1, 'vigente', 'v@example.test', false, false, 'x', md5('x'), md5('new'), now() + interval '89 days'),
  (tests.id('wa'), tests.id('pa'), 'b', 1, 'da ana', 'v@example.test', false, false, 'x', md5('x'), md5('ana'), now() + interval '89 days');
insert into public.form_submission_hits (profile_id, client_hash, created_at) values
  (tests.id('pb'), md5('h1'), now() - interval '2 days'), (tests.id('pb'), md5('h2'), now());
insert into public.report_lookup_failures (client_hash, created_at) values (md5('f1'), now() - interval '2 days'), (md5('f2'), now());

insert into public.workspace_invitations (workspace_id, email, role, token_hash, created_at, expires_at, revoked_at) values
  (tests.id('wbg'), 'antigo@example.test', 'editor', repeat('a', 64), now() - interval '50 days', now() - interval '43 days', null),
  (tests.id('wbg'), 'recente@example.test', 'editor', repeat('b', 64), now() - interval '10 days', now() - interval '3 days', null),
  (tests.id('wbg'), 'ana-ret@example.test', 'admin', repeat('c', 64), now(), now() + interval '7 days', null),
  (tests.id('wag'), 'convidado@example.test', 'editor', repeat('d', 64), now(), now() + interval '7 days', null);
insert into public.report_links (workspace_id, profile_id, token_hash, period_days, created_at, expires_at) values
  (tests.id('wb'), tests.id('pb'), repeat('1', 64), 30, now() - interval '200 days', now() - interval '120 days'),
  (tests.id('wb'), tests.id('pb'), repeat('2', 64), 30, now() - interval '100 days', now() - interval '30 days'),
  (tests.id('wag'), tests.id('pc'), repeat('3', 64), 30, now(), now() + interval '30 days');

insert into public.moderation_reports (profile_id, workspace_id, slug, reason, reporter_hash, status, created_at, reviewed_at, reported_day) values
  (tests.id('pb'), tests.id('wb'), 'qa-ret-bia', 'spam', md5('r1'), 'dismissed', now() - interval '300 days', now() - interval '200 days', current_date - 300),
  (tests.id('pb'), tests.id('wb'), 'qa-ret-bia', 'spam', md5('r2'), 'dismissed', now() - interval '30 days', now() - interval '20 days', current_date - 30),
  (tests.id('pb'), tests.id('wb'), 'qa-ret-bia', 'spam', md5('r3'), 'new', now() - interval '300 days', null, current_date - 301),
  (gen_random_uuid(), tests.id('wb'), 'qa-ret-gone', 'spam', md5('r4'), 'new', now() - interval '300 days', null, current_date - 302);

select tests.remember('old_request', gen_random_uuid());
select tests.remember('recent_request', gen_random_uuid());
insert into public.privacy_requests (id, user_id, kind, status, reason_code, evidence_reference) values
  (tests.id('old_request'), gen_random_uuid(), 'data_access', 'completed', 'fulfilled', 'DOSSIE-0001'),
  (tests.id('recent_request'), gen_random_uuid(), 'data_access', 'completed', 'fulfilled', 'DOSSIE-0002');
insert into public.privacy_request_events (request_id, to_status) values (tests.id('old_request'), 'completed'), (tests.id('recent_request'), 'completed');
-- The updated_at trigger stamps now(): age the old request behind its back.
alter table public.privacy_requests disable trigger privacy_requests_set_updated_at;
update public.privacy_requests set updated_at = now() - interval '6 years' where id = tests.id('old_request');
alter table public.privacy_requests enable trigger privacy_requests_set_updated_at;

insert into public.audit_events (action, created_at, metadata) values
  ('auth.sign_in', now() - interval '2 years', '{"marker":"qa-ret-old"}'), ('auth.sign_in', now() - interval '2 days', '{"marker":"qa-ret-new"}');
insert into public.slug_history (slug, workspace_id, reason, released_at, hold_until) values
  ('qa-ret-antigo', tests.id('wb'), 'deleted', now() - interval '3 years', now() - interval '2 years'),
  ('qa-ret-seguro', tests.id('wb'), 'deleted', now() - interval '100 days', now() - interval '10 days');
insert into public.waitlist_signups (name, email, segment, managed_profiles, willingness_to_pay, consent_at, variant)
select 'Ana', 'Ana-Ret@example.test', w.segment, w.managed_profiles, w.willingness_to_pay, now(), w.variant
from (values ('agency', '2-5', 'up_to_49', 'agencies')) as w(segment, managed_profiles, willingness_to_pay, variant);
insert into public.profile_domains (workspace_id, profile_id, hostname, challenge, status)
values (tests.id('wag'), tests.id('pc'), 'links.qa-ret-cliente.example', 'linkfav-verify=' || md5('c'), 'pending');

-- ---------------------------------------------------------------------------------------------
-- Who may run what
-- ---------------------------------------------------------------------------------------------
select ok(not has_function_privilege('anon', 'public.run_retention_maintenance(integer)', 'execute')
  and not has_function_privilege('authenticated', 'public.run_retention_maintenance(integer)', 'execute')
  and has_function_privilege('service_role', 'public.run_retention_maintenance(integer)', 'execute'),
  'only the service role runs the retention job');
select ok(not has_function_privilege('anon', 'public.begin_account_erasure(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.finish_account_erasure(uuid, text)', 'execute')
  and not has_function_privilege('service_role', 'public.begin_account_erasure(uuid)', 'execute')
  and not has_function_privilege('service_role', 'public.finish_account_erasure(uuid, text)', 'execute'),
  'anon and the service role cannot run an erasure');
select ok(not has_function_privilege('authenticated', 'private.erasure_check(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'private.erasure_owned_workspaces(uuid)', 'execute'),
  'the erasure helpers are not callable by a session');

select tests.authenticate_as(tests.id('eve'));
select throws_ok('select public.run_retention_maintenance(10)', '42501', null, 'a signed-in person cannot run the retention job');
select tests.authenticate_anon();
select throws_ok('select public.run_retention_maintenance(10)', '42501', null, 'anon cannot run the retention job');

-- ---------------------------------------------------------------------------------------------
-- Retention job
-- ---------------------------------------------------------------------------------------------
select tests.authenticate_service();
select set_config('tests.run1', (public.run_retention_maintenance(1000))::text, true);
select tests.clear_authentication();

select is((current_setting('tests.run1')::jsonb ->> 'leads')::int, 1, 'one expired lead is purged');
select is((select array_agg(name order by name) from public.form_leads where dedupe_key in (md5('old'), md5('new'), md5('ana'))), array['da ana', 'vigente'], 'leads inside their 90 days stay');
select is((select count(*)::int from public.form_submission_hits where profile_id = tests.id('pb')), 1, 'submission counters older than a day are purged');
select is((select count(*)::int from public.report_lookup_failures where client_hash in (md5('f1'), md5('f2'))), 1, 'report lookup failures older than a day are purged');
select is((select array_agg(email order by email) from public.workspace_invitations where workspace_id = tests.id('wbg')),
  array['ana-ret@example.test', 'recente@example.test'], 'only the invitation finished more than 30 days ago is purged');
select is((select array_agg(token_hash order by token_hash) from public.report_links where workspace_id = tests.id('wb')),
  array[repeat('2', 64)], 'only the report link finished more than 90 days ago is purged');
select is((select array_agg(reporter_hash order by reporter_hash) from public.moderation_reports where workspace_id = tests.id('wb')),
  (select array_agg(h order by h) from unnest(array[md5('r2'), md5('r3')]) h),
  'decided reports past retention and undecided reports about a page that is gone are purged; an open report about a live page stays');
select is((select count(*)::int from public.privacy_requests where id = tests.id('old_request')), 0, 'a privacy request closed more than five years ago is purged');
select is((select count(*)::int from public.privacy_request_events where request_id = tests.id('old_request')), 0, 'with its history');
select is((select count(*)::int from public.privacy_requests where id = tests.id('recent_request')), 1, 'a recently closed request stays');
select is((select count(*)::int from public.privacy_request_events where request_id = tests.id('recent_request')), 1, 'with its history');
select is((select array_agg(metadata ->> 'marker') from public.audit_events where metadata ? 'marker'), array['qa-ret-new'], 'audit events older than a year are purged');
select is((select array_agg(slug) from public.slug_history where slug like 'qa-ret-%'), array['qa-ret-seguro'], 'address holds are purged a year after the hold ended');
select is((select count(*)::int from public.profiles where id = tests.id('pb_old')), 0, 'a page past its 30 days is removed');
select is((select count(*)::int from public.profiles where id = tests.id('pb_img')), 1, 'a page that still has an image file waits for the media job');
select is((current_setting('tests.run1')::jsonb ->> 'pendingProfiles')::int, 1, 'and is reported as pending');
select is((select count(*)::int from public.profiles where id in (tests.id('pb'), tests.id('pa'), tests.id('pc'))), 3, 'live pages are untouched');
select is((select count(*)::int from public.workspaces where id in (tests.id('wa'), tests.id('wag'), tests.id('wb'), tests.id('wbg'))), 4, 'live workspaces are untouched');

-- History stays append-only for everyone else.
select tests.authenticate_service();
select throws_ok(format('delete from public.privacy_request_events where request_id = %L', tests.id('recent_request')), '42501', null,
  'the service role cannot delete privacy request history directly');
select tests.clear_authentication();

-- The media job removes the file; the next run removes the page. Running twice changes nothing more.
update public.media_assets set status = 'deleting' where id = tests.id('mb');
delete from public.media_assets where id = tests.id('mb');
select tests.authenticate_service();
select set_config('tests.run2', (public.run_retention_maintenance(1000))::text, true);
select set_config('tests.run3', (public.run_retention_maintenance(1000))::text, true);
select tests.clear_authentication();
select is((current_setting('tests.run2')::jsonb ->> 'profiles')::int, 1, 'once the file is gone the page is removed');
select is(current_setting('tests.run3')::jsonb - 'pendingProfiles' - 'pendingWorkspaces',
  '{"leads":0,"leadHits":0,"invitations":0,"reportLinks":0,"reportFailures":0,"moderationReports":0,"privacyRequests":0,"auditEvents":0,"slugHistory":0,"profiles":0,"workspaces":0}'::jsonb,
  'a second run finds nothing to do');

-- A workspace past its 30 days: kept while a subscription runs, removed when it has ended.
select tests.authenticate_as(tests.id('bia'));
select tests.remember('wold', public.create_agency_workspace('Agência antiga'));
select tests.clear_authentication();
update public.workspaces set deleted_at = now() - interval '40 days', purge_after = now() - interval '10 days' where id = tests.id('wold');
insert into public.billing_subscriptions (workspace_id, provider, provider_subscription_id, provider_customer_id, plan_id, billing_interval, amount_cents, currency, status, observed_at)
values (tests.id('wold'), 'stripe', 'sub_qa_ret', 'cus_qa_ret', 'pro', 'month', 1490, 'BRL', 'active', now());
select tests.authenticate_service();
select public.run_retention_maintenance(1000);
select tests.clear_authentication();
select is((select count(*)::int from public.workspaces where id = tests.id('wold')), 1, 'a deleted workspace with a running subscription is not purged');
update public.billing_subscriptions set status = 'ended', ended_at = now() where workspace_id = tests.id('wold');
select tests.authenticate_service();
select public.run_retention_maintenance(1000);
select tests.clear_authentication();
select is((select count(*)::int from public.workspaces where id = tests.id('wold')), 0, 'and is purged, with its memberships, once the subscription ended');
select is((select count(*)::int from auth.users where id = tests.id('bia')), 1, 'purging a workspace never removes a person');

-- ---------------------------------------------------------------------------------------------
-- Account erasure
-- ---------------------------------------------------------------------------------------------
select tests.authenticate_as(tests.id('ana'));
select public.request_account_deletion();
select tests.remember('req', (select id from public.privacy_requests where user_id = tests.id('ana')));
select throws_ok(format('select public.begin_account_erasure(%L)', tests.id('req')), '42501', null, 'the person cannot run their own erasure');
select tests.authenticate_as(tests.id('eve'));
select throws_ok(format('select public.begin_account_erasure(%L)', tests.id('req')), '42501', null, 'another person cannot run it');
select throws_ok(format('select public.finish_account_erasure(%L, %L)', tests.id('req'), 'DOSSIE-0003'), '42501', null, 'nor finish it');

select tests.authenticate_as(tests.id('adm'));
select throws_ok(format('select public.begin_account_erasure(%L)', gen_random_uuid()), 'P0002', null, 'an unknown request is not found');
select throws_ok(format('select public.begin_account_erasure(%L)', tests.id('req')), 'LK122', null, 'a request that is not in processing is refused');
select throws_ok(format('select public.begin_account_erasure(%L)', tests.id('recent_request')), 'LK122', null, 'a data access request is refused');
select public.review_privacy_request(tests.id('req'), 'processing', 'manual_review');

-- Blockers.
select tests.clear_authentication();
insert into public.billing_subscriptions (workspace_id, provider, provider_subscription_id, provider_customer_id, plan_id, billing_interval, amount_cents, currency, status, observed_at)
values (tests.id('wag'), 'stripe', 'sub_qa_ret_ana', 'cus_qa_ret_ana', 'agency', 'month', 5790, 'BRL', 'active', now());
select tests.authenticate_as(tests.id('adm'));
select throws_ok(format('select public.begin_account_erasure(%L)', tests.id('req')), 'LK123', null, 'a running subscription blocks the erasure');
select tests.clear_authentication();
update public.billing_subscriptions set status = 'ended', ended_at = now() where workspace_id = tests.id('wag');
insert into public.workspace_memberships (workspace_id, user_id, role, status, accepted_at) values (tests.id('wag'), tests.id('eve'), 'editor', 'active', now());
select tests.authenticate_as(tests.id('adm'));
select throws_ok(format('select public.begin_account_erasure(%L)', tests.id('req')), 'LK124', null, 'another member in an owned workspace blocks the erasure');
select tests.clear_authentication();
update public.workspace_memberships set status = 'revoked', revoked_at = now() where workspace_id = tests.id('wag') and user_id = tests.id('eve');
select is((select count(*)::int from public.profiles where workspace_id in (tests.id('wa'), tests.id('wag')) and deleted_at is null), 2, 'a refused erasure changed nothing');

-- Finishing before beginning is refused.
select tests.authenticate_as(tests.id('adm'));
select throws_ok(format('select public.finish_account_erasure(%L, %L)', tests.id('req'), 'DOSSIE-0003'), 'LK125', null, 'finishing is refused while an image file remains');

-- Step 1.
select set_config('tests.begin1', (public.begin_account_erasure(tests.id('req')))::text, true);
select set_config('tests.begin2', (public.begin_account_erasure(tests.id('req')))::text, true);
select tests.clear_authentication();
select is((select array_agg(s order by s) from jsonb_array_elements_text(current_setting('tests.begin1')::jsonb -> 'slugs') s), array['qa-ret-ana', 'qa-ret-cliente'], 'step 1 returns the addresses to drop from the cache');
select is(current_setting('tests.begin1')::jsonb -> 'hostnames', '["links.qa-ret-cliente.example"]'::jsonb, 'and the hostnames to detach at the provider');
select is((current_setting('tests.begin2')::jsonb ->> 'mediaPending')::int, 1, 'step 1 can be run again and reports the image files still waiting');
select is((select count(*)::int from public.profiles where workspace_id in (tests.id('wa'), tests.id('wag')) and purge_after < now()), 2, 'the person''s pages are due for purge at once');
select is((select state from public.get_public_page('qa-ret-ana')), 'not_found', 'and off the air');
select is((select count(*)::int from public.slug_history where slug in ('qa-ret-ana', 'qa-ret-cliente')), 2, 'their addresses are put on hold once');
select is((select count(*)::int from public.profiles where workspace_id in (tests.id('wb'), tests.id('wbg')) and deleted_at is not null), 0, 'pages of a workspace the person only works in are untouched');
select tests.authenticate_service();
select is((select count(*)::int from public.claim_media_cleanup(50) c where c.media_id = tests.id('ma')), 1, 'the media job claims the person''s image files');
select tests.authenticate_as(tests.id('adm'));
select throws_ok(format('select public.finish_account_erasure(%L, %L)', tests.id('req'), 'DOSSIE-0003'), 'LK125', null, 'finishing still waits for the files');
select tests.authenticate_service();
select public.finish_media_cleanup(array[tests.id('ma')]);

-- Step 2.
select tests.authenticate_as(tests.id('adm'));
select throws_ok(format('select public.finish_account_erasure(%L, %L)', tests.id('req'), 'x'), '22023', null, 'finishing needs an evidence reference');
select set_config('tests.finish', (public.finish_account_erasure(tests.id('req'), 'DOSSIE-0003'))::text, true);
select tests.clear_authentication();

select is(current_setting('tests.finish')::jsonb, '{"workspaces":2,"invitations":1,"waitlist":1,"account":1}'::jsonb, 'step 2 reports what it removed');
select is((select count(*)::int from auth.users where id = tests.id('ana')), 0, 'the account is gone');
select is((select count(*)::int from public.workspaces where id in (tests.id('wa'), tests.id('wag')))
  + (select count(*)::int from public.profiles where id in (tests.id('pa'), tests.id('pc')))
  + (select count(*)::int from public.form_leads where name = 'da ana')
  + (select count(*)::int from public.report_links where token_hash = repeat('3', 64))
  + (select count(*)::int from public.profile_domains where hostname = 'links.qa-ret-cliente.example')
  + (select count(*)::int from public.workspace_invitations where token_hash in (repeat('c', 64), repeat('d', 64)))
  + (select count(*)::int from public.workspace_memberships where user_id = tests.id('ana'))
  + (select count(*)::int from public.user_accounts where id = tests.id('ana'))
  + (select count(*)::int from public.waitlist_signups where lower(email) = 'ana-ret@example.test'), 0,
  'workspaces, pages, leads, links, domains, invitations, memberships, the account row and the waitlist entry are gone');
select is((select status || '/' || reason_code || '/' || evidence_reference from public.privacy_requests where id = tests.id('req')),
  'completed/fulfilled/DOSSIE-0003', 'the request is closed with its evidence and stays as proof');
select is((select count(*)::int from public.audit_events where action in ('privacy.erasure_started', 'privacy.account_erased') and target_id = tests.id('ana')), 3,
  'both steps are in the audit trail');
select is((select count(*)::int from public.workspaces where id in (tests.id('wb'), tests.id('wbg')))
  + (select count(*)::int from public.profiles where id = tests.id('pb'))
  + (select count(*)::int from auth.users where id in (tests.id('bia'), tests.id('adm'), tests.id('eve'))), 6,
  'nobody else lost anything');
select tests.authenticate_as(tests.id('adm'));
select throws_ok(format('select public.finish_account_erasure(%L, %L)', tests.id('req'), 'DOSSIE-0003'), 'LK122', null, 'a closed request cannot be run again');

select * from finish();
rollback;
