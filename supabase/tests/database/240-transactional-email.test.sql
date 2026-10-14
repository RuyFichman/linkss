-- Transactional e-mail outbox (migration 202610140001, ADR 0021): what enqueues a message, for
-- whom, never with what a visitor typed, never failing the original write; claim, lease, retry,
-- expiry and purge; privileges, other tenants and anon.
begin;
select plan(52);

delete from public.mail_outbox;

create function pg_temp.outbox(p_kind text, p_workspace uuid)
returns integer language sql
as $$ select count(*)::integer from public.mail_outbox where kind = p_kind and workspace_id = p_workspace $$;

create function pg_temp.lead(p_workspace uuid, p_profile uuid, p_key text, p_at timestamptz default now())
returns void language sql
as $$
  insert into public.form_leads (workspace_id, profile_id, block_id, publication_version, name, email, message, consent_given, consent_required, consent_text, consent_version, dedupe_key, created_at, purge_after)
  values (p_workspace, p_profile, 'b', 1, 'Visitante Secreto', 'visitante-secreto@example.test', 'mensagem secreta', false, false, 'x', md5('x'), md5(p_key), p_at, p_at + interval '90 days');
$$;

-- Fixtures ---------------------------------------------------------------------------------

select tests.remember('adm', tests.create_user('adm-mail@example.test', 'Adm'));
select tests.remember('ana', tests.create_user('ana-mail@example.test', 'Ana'));
select tests.remember('bia', tests.create_user('bia-mail@example.test', 'Bia'));
select tests.remember('caio', tests.create_user('caio-mail@example.test', 'Caio'));
select tests.remember('dani', tests.create_user('dani-mail@example.test', 'Dani'));
select tests.remember('edu', tests.create_user('edu-mail@example.test', 'Edu', false));
insert into public.platform_admins (user_id) values (tests.id('adm'));

select tests.authenticate_as(tests.id('ana'));
select public.ensure_personal_workspace();
select tests.remember('w1', public.create_agency_workspace('Agência Correio'));
select tests.authenticate_as(tests.id('dani'));
select tests.remember('w2', public.ensure_personal_workspace());
select tests.authenticate_as(tests.id('bia'));
select public.ensure_personal_workspace();
select tests.authenticate_as(tests.id('caio'));
select public.ensure_personal_workspace();
select tests.clear_authentication();

-- W1: Ana owner, Bia admin, Caio editor, Edu admin with an unconfirmed address.
update public.workspaces set plan_id = 'agency' where id = tests.id('w1');
insert into public.workspace_memberships (workspace_id, user_id, role, status, accepted_at) values
  (tests.id('w1'), tests.id('bia'), 'admin', 'active', now()),
  (tests.id('w1'), tests.id('caio'), 'editor', 'active', now()),
  (tests.id('w1'), tests.id('edu'), 'admin', 'active', now());
insert into public.user_accounts (id, display_name) values (tests.id('edu'), 'Edu') on conflict (id) do nothing;

select tests.authenticate_as(tests.id('ana'));
insert into public.profiles (workspace_id, title, slug) values (tests.id('w1'), 'Café do Correio', 'cafe-do-correio');
select tests.remember('p1', (select id from public.profiles where slug = 'cafe-do-correio'));
select tests.authenticate_as(tests.id('dani'));
insert into public.profiles (workspace_id, title, slug) values (tests.id('w2'), 'Estúdio Vizinho', 'estudio-vizinho-mail');
select tests.remember('p2', (select id from public.profiles where slug = 'estudio-vizinho-mail'));
select tests.clear_authentication();

-- Structure and privileges -------------------------------------------------------------------

select is((select relrowsecurity from pg_class where oid = 'public.mail_outbox'::regclass), true, 'row level security is on for the outbox');
select is((select count(*)::int from information_schema.role_table_grants where grantee in ('anon', 'authenticated') and table_schema = 'public' and table_name = 'mail_outbox'), 0, 'no client role reads or writes the outbox');
select ok(not has_function_privilege('authenticated', 'public.claim_mail_outbox(integer)', 'execute')
  and not has_function_privilege('anon', 'public.claim_mail_outbox(integer)', 'execute')
  and has_function_privilege('service_role', 'public.claim_mail_outbox(integer)', 'execute'), 'only the service role claims messages');
select ok(not has_function_privilege('authenticated', 'public.complete_mail_outbox(uuid, text, text, text)', 'execute')
  and has_function_privilege('service_role', 'public.complete_mail_outbox(uuid, text, text, text)', 'execute'), 'only the service role completes messages');
select ok(not has_function_privilege('authenticated', 'public.run_mail_maintenance(timestamptz)', 'execute')
  and has_function_privilege('service_role', 'public.run_mail_maintenance(timestamptz)', 'execute'), 'only the service role runs the mail maintenance');
select ok(not has_function_privilege('service_role', 'private.enqueue_mail(text, uuid, uuid[], text, jsonb, timestamptz)', 'execute')
  and not has_function_privilege('authenticated', 'private.enqueue_mail(text, uuid, uuid[], text, jsonb, timestamptz)', 'execute'), 'nobody enqueues a message directly');
select is((select count(*)::int from public.job_runs where job = 'mail'), 1, 'the mail job has a heartbeat row');

-- New contact ----------------------------------------------------------------------------------

select pg_temp.lead(tests.id('w1'), tests.id('p1'), 'l1');
select is(pg_temp.outbox('new_lead', tests.id('w1')), 3, 'a contact notifies the owner and the admins');
select is((select count(*)::int from public.mail_outbox where kind = 'new_lead' and recipient_user_id = tests.id('caio')), 0, 'an editor is not notified');
select is((select payload from public.mail_outbox where kind = 'new_lead' and recipient_user_id = tests.id('ana')),
  jsonb_build_object('profileId', tests.id('p1'), 'title', 'Café do Correio', 'slug', 'cafe-do-correio'), 'the message names the page and nothing else');
select ok((select string_agg(payload::text, '') from public.mail_outbox) !~ 'Secreto|secreta|visitante-secreto', 'nothing the visitor typed is in any message');
select pg_temp.lead(tests.id('w1'), tests.id('p1'), 'l2');
select is(pg_temp.outbox('new_lead', tests.id('w1')), 3, 'a second contact in the same hour adds no message');
select pg_temp.lead(tests.id('w1'), tests.id('p1'), 'l3', now() + interval '1 hour');
select is(pg_temp.outbox('new_lead', tests.id('w1')), 6, 'a contact in the next hour is a new message');
select pg_temp.lead(tests.id('w2'), tests.id('p2'), 'l4');
select is((select string_agg(recipient_user_id::text, ',') from public.mail_outbox where workspace_id = tests.id('w2')), tests.id('dani')::text, 'another workspace notifies only its own owner');

-- The preference: the person changes it for themselves only.
select tests.authenticate_as(tests.id('bia'));
update public.user_accounts set notify_new_leads = false where id = tests.id('bia');
update public.user_accounts set notify_new_leads = false where id = tests.id('ana');
select tests.clear_authentication();
select is((select string_agg(notify_new_leads::text, ',' order by display_name) from public.user_accounts where id in (tests.id('ana'), tests.id('bia'))), 'true,false', 'a person turns off their own contact e-mails and cannot turn off somebody else''s');
select pg_temp.lead(tests.id('w1'), tests.id('p1'), 'l5', now() + interval '2 hours');
select is((select count(*)::int from public.mail_outbox where kind = 'new_lead' and recipient_user_id = tests.id('bia')), 2, 'who turned it off gets no new message');
select is((select count(*)::int from public.mail_outbox where kind = 'new_lead' and recipient_user_id = tests.id('ana')), 3, 'the others still do');

-- A broken outbox never loses a contact.
alter table public.mail_outbox add constraint mail_outbox_test_refuse check (kind = 'nothing') not valid;
select lives_ok($$select pg_temp.lead(tests.id('w1'), tests.id('p1'), 'l6', now() + interval '3 hours')$$, 'a contact is stored even when its message cannot be');
select is((select count(*)::int from public.form_leads where dedupe_key = md5('l6')), 1, 'and it is there');
alter table public.mail_outbox drop constraint mail_outbox_test_refuse;

-- Suspension and appeal -----------------------------------------------------------------------

select tests.authenticate_as(tests.id('adm'));
select public.set_profile_moderation(tests.id('p1'), true, 'Imita uma marca conhecida, conforme denúncia.', null);
select tests.clear_authentication();
select is(pg_temp.outbox('page_suspended', tests.id('w1')), 3, 'a suspension notifies the owner and the admins');
select is((select payload ->> 'category' from public.mail_outbox where kind = 'page_suspended' and recipient_user_id = tests.id('ana')), 'other', 'with the category, and not the administrator''s justification');
select ok((select string_agg(payload::text, '') from public.mail_outbox where kind = 'page_suspended') !~ 'marca conhecida', 'the justification is in no message');

select tests.authenticate_as(tests.id('caio'));
select throws_ok(format('select public.submit_moderation_appeal(%L, %L)', tests.id('p1'), 'Esta página é nossa e não imita ninguém.'), '42501', null, 'an editor still cannot appeal');
select tests.authenticate_as(tests.id('bia'));
select public.submit_moderation_appeal(tests.id('p1'), 'Esta página é nossa e não imita ninguém.');
select tests.clear_authentication();
select tests.remember('appeal', (select id from public.moderation_appeals where profile_id = tests.id('p1')));
select tests.authenticate_as(tests.id('adm'));
select public.decide_moderation_appeal(tests.id('appeal'), false, 'A página continua usando o logotipo de outra empresa.');
select tests.clear_authentication();
select is(pg_temp.outbox('appeal_decided', tests.id('w1')), 3, 'an answered appeal notifies the owner and the admins, the sender only once');
select is((select (payload ->> 'accepted') || ' / ' || (payload ->> 'response') from public.mail_outbox where kind = 'appeal_decided' and recipient_user_id = tests.id('bia')),
  'false / A página continua usando o logotipo de outra empresa.', 'with the decision and the answer written for the workspace');
update public.moderation_appeals set response = response where profile_id = tests.id('p1');
select is(pg_temp.outbox('appeal_decided', tests.id('w1')), 3, 'touching the appeal again adds nothing');

-- Billing ------------------------------------------------------------------------------------

insert into public.billing_customers (workspace_id, provider, provider_customer_id) values (tests.id('w1'), 'stripe', 'cus_mail_w1'), (tests.id('w2'), 'stripe', 'cus_mail_w2');
insert into public.billing_subscriptions (id, workspace_id, provider, provider_subscription_id, provider_customer_id, plan_id, billing_interval, amount_cents, currency, status, current_period_end, observed_at)
values ('a9400000-0000-4000-8000-000000000001', tests.id('w1'), 'stripe', 'sub_mail_w1', 'cus_mail_w1', 'agency', 'month', 5790, 'BRL', 'active', now() + interval '20 days', now());
select is(pg_temp.outbox('payment_failed', tests.id('w1')), 0, 'a subscription in good standing sends nothing');
update public.billing_subscriptions set status = 'past_due', grace_until = now() + interval '7 days' where id = 'a9400000-0000-4000-8000-000000000001';
select is((select string_agg(recipient_user_id::text, ',') from public.mail_outbox where kind = 'payment_failed'), tests.id('ana')::text, 'a failed payment notifies the owner only');
select is((select (payload ->> 'planId') || '/' || (expires_at = (payload ->> 'graceUntil')::timestamptz)::text from public.mail_outbox where kind = 'payment_failed'), 'agency/true', 'with the plan and the end of the grace period, until which it is worth sending');
update public.billing_subscriptions set observed_at = now() where id = 'a9400000-0000-4000-8000-000000000001';
update public.billing_subscriptions set status = 'past_due' where id = 'a9400000-0000-4000-8000-000000000001';
select is(pg_temp.outbox('payment_failed', tests.id('w1')), 1, 'staying past due adds nothing');

insert into public.billing_subscriptions (workspace_id, provider, provider_subscription_id, provider_customer_id, plan_id, billing_interval, amount_cents, currency, status, current_period_end, observed_at, cancel_at_period_end) values
  (tests.id('w2'), 'stripe', 'sub_mail_w2_year', 'cus_mail_w2', 'pro', 'year', 14900, 'BRL', 'active', now() + interval '3 days', now(), false);
select tests.authenticate_as(tests.id('ana'));
select throws_ok('select public.run_mail_maintenance()', '42501', null, 'a signed-in person cannot run the mail maintenance');
select tests.clear_authentication();
select is((public.run_mail_maintenance() ->> 'reminders')::int, 1, 'a yearly renewal within seven days gets one reminder');
select is((select string_agg((payload ->> 'amountCents') || '/' || recipient_user_id::text, ',') from public.mail_outbox where kind = 'renewal_upcoming'), '14900/' || tests.id('dani')::text, 'to the owner, with the amount');
select is((public.run_mail_maintenance() ->> 'reminders')::int, 0, 'running again adds no second reminder for the same period');
update public.billing_subscriptions set cancel_at_period_end = true, current_period_end = now() + interval '4 days' where provider_subscription_id = 'sub_mail_w2_year';
select is((public.run_mail_maintenance() ->> 'reminders')::int, 0, 'a cancelled renewal gets no reminder');
update public.billing_subscriptions set cancel_at_period_end = false, billing_interval = 'month', amount_cents = 1490 where provider_subscription_id = 'sub_mail_w2_year';
select is((public.run_mail_maintenance() ->> 'reminders')::int, 0, 'a monthly renewal gets no reminder');

-- Claim, lease, retry, expiry, purge ------------------------------------------------------------

delete from public.mail_outbox where kind <> 'payment_failed';
select pg_temp.lead(tests.id('w1'), tests.id('p1'), 'l7', now() + interval '5 hours');
select tests.authenticate_service();
select set_config('tests.claimed', (select jsonb_agg(to_jsonb(c)) from public.claim_mail_outbox(10) c)::text, true);
select is(jsonb_array_length(current_setting('tests.claimed')::jsonb), 3, 'the due messages are claimed');
select is((select string_agg(coalesce(c ->> 'email', 'none'), ',' order by c ->> 'email') from jsonb_array_elements(current_setting('tests.claimed')::jsonb) c),
  'ana-mail@example.test,ana-mail@example.test,none', 'the address comes only when it is confirmed; an unconfirmed one comes empty');
select is((select count(*)::int from public.claim_mail_outbox(10)), 0, 'a claimed message is not claimed again while its lease lasts');
select tests.clear_authentication();
select is((select string_agg(distinct status || ':' || attempts, ',') from public.mail_outbox), 'sending:1', 'claiming marks the message as being sent, first attempt');

select tests.authenticate_service();
select is(public.complete_mail_outbox((select id from public.mail_outbox where kind = 'payment_failed'), 'sent', null, 're_123'), 'sent', 'a sent message is recorded with the provider id');
select is(public.complete_mail_outbox((select id from public.mail_outbox where kind = 'payment_failed'), 'sent'), 'not_sending', 'a message can be completed only once');
select throws_ok(format('select public.complete_mail_outbox(%L, %L)', gen_random_uuid(), 'maybe'), '22023', null, 'an unknown outcome is refused');
select set_config('tests.retry', (select id::text from public.mail_outbox where kind = 'new_lead' and recipient_user_id = tests.id('caio') limit 1), true);
select tests.clear_authentication();
select set_config('tests.retry', (select id::text from public.mail_outbox where kind = 'new_lead' and status = 'sending' limit 1), true);
select tests.authenticate_service();
select is(public.complete_mail_outbox(current_setting('tests.retry')::uuid, 'retry', 'provider_unavailable'), 'pending', 'a failure to send is tried again later');
select tests.clear_authentication();
select ok((select next_attempt_at > now() + interval '4 minutes' from public.mail_outbox where id = current_setting('tests.retry')::uuid), 'after a pause');
update public.mail_outbox set status = 'sending', attempts = 5 where id = current_setting('tests.retry')::uuid;
select tests.authenticate_service();
select is(public.complete_mail_outbox(current_setting('tests.retry')::uuid, 'retry', 'provider_unavailable'), 'failed', 'after five attempts it gives up');
select tests.clear_authentication();
select is((select count(*)::int from public.mail_outbox where status = 'failed') , 1, 'and the monitor can count it');
select is((public.get_ops_status() -> 'mail' ->> 'failed24h')::int, 1, 'the operational status reports messages that gave up');

update public.mail_outbox set status = 'pending', expires_at = now() - interval '1 minute' where status = 'sending';
select is((public.run_mail_maintenance() ->> 'expired')::int, 1, 'a message that waited past its expiry is skipped, not sent late');
update public.mail_outbox set finished_at = now() - interval '31 days' where status in ('sent', 'failed');
select is((public.run_mail_maintenance() ->> 'purged')::int, 2, 'finished messages are purged after 30 days');

-- An erased account takes its messages with it.
select pg_temp.lead(tests.id('w1'), tests.id('p1'), 'l8', now() + interval '6 hours');
select is((select count(*)::int from public.mail_outbox where recipient_user_id = tests.id('edu') and status = 'pending'), 1, 'an admin has a message waiting');
delete from auth.users where id = tests.id('edu');
select is((select count(*)::int from public.mail_outbox where recipient_user_id = tests.id('edu')), 0, 'messages for an erased account are deleted with it');

select * from finish();
rollback;
