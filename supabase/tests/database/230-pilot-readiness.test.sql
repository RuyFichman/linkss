-- Pilot readiness (migration 202610130001; ADR 0014 addendum, ADR 0020): retired prices keep
-- granting their plan, the monthly-to-yearly change, the cancellation reason, the erasure work list,
-- the export key and the product funnel. Positive and negative cases, other tenants and anon.
begin;
select plan(75);

-- Hermetic: whatever the local database already holds must not change the counts below.
delete from public.billing_cancellation_feedback;
delete from public.billing_invoices;
delete from public.billing_subscriptions;
delete from public.billing_events;
delete from public.billing_customers;

create function pg_temp.ts(p_at timestamptz)
returns text language sql
as $$ select to_char(p_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') $$;

-- A snapshot as the server serializes it (modules/billing/attestation.ts).
create function pg_temp.snap(p_event text, p_at timestamptz, p_customer text, p_sub text, p_workspace uuid, p_amount integer, p_interval text)
returns jsonb language sql
as $$
  select jsonb_build_object(
    'v', 1, 'provider', 'stripe', 'event_id', p_event, 'reason', 'webhook', 'observed_at', pg_temp.ts(p_at), 'customer_id', p_customer,
    'subscription', jsonb_build_object(
      'id', p_sub, 'customer_id', p_customer, 'workspace_id', p_workspace, 'status', 'active', 'amount_cents', p_amount,
      'currency', 'BRL', 'interval', p_interval, 'current_period_end', pg_temp.ts(p_at + interval '30 days'), 'cancel_at_period_end', false),
    'invoices', '[]'::jsonb);
$$;

create function pg_temp.metric(p_setting text, p_key text)
returns integer language sql
as $$ select (current_setting('tests.' || p_setting)::jsonb -> 'totals' ->> p_key)::integer $$;

create function pg_temp.cohort(p_setting text, p_week text, p_key text)
returns integer language sql
as $$
  select (c ->> p_key)::integer
  from jsonb_array_elements(current_setting('tests.' || p_setting)::jsonb -> 'cohorts') c
  where c ->> 'weekStart' = p_week;
$$;

-- Fixtures ---------------------------------------------------------------------------------

select tests.remember('adm', tests.create_user('adm-pilot@example.test', 'Adm'));
select tests.remember('ana', tests.create_user('ana-pilot@example.test', 'Ana'));
select tests.remember('bia', tests.create_user('bia-pilot@example.test', 'Bia'));
select tests.remember('caio', tests.create_user('caio-pilot@example.test', 'Caio'));
select tests.remember('dani', tests.create_user('dani-pilot@example.test', 'Dani'));
select tests.remember('eli', tests.create_user('eli-pilot@example.test', 'Eli'));
insert into public.platform_admins (user_id) values (tests.id('adm'));

select tests.authenticate_as(tests.id('bia'));
select public.ensure_personal_workspace();
select tests.authenticate_as(tests.id('ana'));
select public.ensure_personal_workspace();
select tests.remember('w1', public.create_agency_workspace('Agência Piloto Um'));
select tests.authenticate_as(tests.id('dani'));
select public.ensure_personal_workspace();
select tests.remember('w2', public.create_agency_workspace('Agência Piloto Dois'));
select tests.authenticate_as(tests.id('caio'));
select public.ensure_personal_workspace();
select tests.remember('w3', public.create_agency_workspace('Agência Piloto Três'));
select tests.remember('w4', public.create_agency_workspace('Agência Piloto Quatro'));
select tests.authenticate_as(tests.id('eli'));
select tests.remember('weli', public.ensure_personal_workspace());
select tests.clear_authentication();

-- Bia is an admin of W1 and of W2: a role that sees the plan and cannot change it.
update public.workspaces set plan_id = 'agency' where id in (tests.id('w1'), tests.id('w2'));
insert into public.workspace_memberships (workspace_id, user_id, role, status, accepted_at) values
  (tests.id('w1'), tests.id('bia'), 'admin', 'active', now()),
  (tests.id('w2'), tests.id('bia'), 'admin', 'active', now());
update public.workspaces set plan_id = 'free' where id in (tests.id('w1'), tests.id('w2'));

insert into public.billing_customers (workspace_id, provider, provider_customer_id) values
  (tests.id('w1'), 'stripe', 'cus_pilot_w1'), (tests.id('w2'), 'stripe', 'cus_pilot_w2'),
  (tests.id('w3'), 'stripe', 'cus_pilot_w3'), (tests.id('weli'), 'stripe', 'cus_pilot_eli');

-- 1. Retired prices ----------------------------------------------------------------------------

select has_column('public', 'plan_prices', 'retired_at', 'plan_prices records when a price stopped being sold');
select is((select count(*)::int from public.plan_prices where retired_at is null), 4, 'every seeded price is on sale');

-- The price change of docs/runbooks/PRICE_CHANGE.md: retire the row, insert the new amount.
update public.plan_prices set retired_at = now() where plan_id = 'pro' and billing_interval = 'month' and retired_at is null;
insert into public.plan_prices (plan_id, billing_interval, amount_cents, currency) values ('pro', 'month', 1990, 'BRL');

select throws_ok($$insert into public.plan_prices (plan_id, billing_interval, amount_cents, currency) values ('pro', 'month', 2490, 'BRL')$$,
  '23505', null, 'a plan has one price on sale per interval');
select throws_ok($$insert into public.plan_prices (plan_id, billing_interval, amount_cents, currency, retired_at) values ('agency', 'month', 1490, 'BRL', now())$$,
  '23505', null, 'an amount, retired or not, names one plan only');
select is(private.plan_rank('pro'), 1990, 'plans are ranked by the price on sale');

select is(private.apply_billing_snapshot(pg_temp.snap('evt_pilot_1', now(), 'cus_pilot_w1', 'sub_pilot_w1', tests.id('w1'), 1490, 'month'), now()) ->> 'status',
  'applied', 'a subscription charged a retired amount is accepted');
select is((select plan_id from public.workspaces where id = tests.id('w1')), 'pro', 'and keeps granting the plan it was sold for');
select is(private.apply_billing_snapshot(pg_temp.snap('evt_pilot_2', now(), 'cus_pilot_w2', 'sub_pilot_w2', tests.id('w2'), 5790, 'month'), now()) ->> 'status',
  'applied', 'a subscription at a price on sale is accepted as before');
select is(private.apply_billing_snapshot(pg_temp.snap('evt_pilot_3', now(), 'cus_pilot_w3', 'sub_pilot_bad', tests.id('w3'), 1234, 'month'), now()) ->> 'status',
  'price_mismatch', 'an amount that was never in the catalogue still grants nothing');

select tests.authenticate_as(tests.id('dani'));
select is((select amount_cents from public.begin_billing_change(tests.id('w2'), 'change_plan', 'pro')), 1990, 'a plan change is charged the price on sale, not the retired one');
select tests.authenticate_as(tests.id('caio'));
select lives_ok(format('select public.begin_billing_checkout(%L, %L, %L)', tests.id('w4'), 'pro', 'month'), 'a checkout opens for a plan with a price on sale');
select tests.clear_authentication();
update public.plan_prices set retired_at = now() where plan_id = 'pro' and billing_interval = 'year' and retired_at is null;
select tests.authenticate_as(tests.id('caio'));
select throws_ok(format('select public.begin_billing_checkout(%L, %L, %L)', tests.id('w4'), 'pro', 'year'), '22023', null, 'a plan with only a retired price for the interval is not for sale');
select tests.clear_authentication();
update public.plan_prices set retired_at = null where plan_id = 'pro' and billing_interval = 'year';

-- 2. Monthly to yearly -------------------------------------------------------------------------

select ok(not has_function_privilege('anon', 'public.begin_billing_interval_change(uuid, public.billing_interval)', 'execute')
  and not has_function_privilege('service_role', 'public.begin_billing_interval_change(uuid, public.billing_interval)', 'execute')
  and has_function_privilege('authenticated', 'public.begin_billing_interval_change(uuid, public.billing_interval)', 'execute'),
  'only a signed-in person can ask for an interval change');

select tests.authenticate_as(tests.id('bia'));
select throws_ok(format('select * from public.begin_billing_interval_change(%L, %L)', tests.id('w2'), 'year'), '42501', null, 'an admin cannot change the interval');
select tests.authenticate_as(tests.id('caio'));
select throws_ok(format('select * from public.begin_billing_interval_change(%L, %L)', tests.id('w2'), 'year'), 'P0002', null, 'a member of another workspace gets not found');
select throws_ok(format('select * from public.begin_billing_interval_change(%L, %L)', tests.id('w4'), 'year'), 'LK103', 'no subscription to change', 'there is nothing to change without a subscription');

select tests.authenticate_as(tests.id('dani'));
select is((select billing_interval || ':' || amount_cents || ':' || plan_id || ':' || provider_subscription_id from public.begin_billing_interval_change(tests.id('w2'), 'year')),
  'year:57900:agency:sub_pilot_w2', 'the owner gets the yearly price on sale of the plan they pay for');
select throws_ok(format('select * from public.begin_billing_interval_change(%L, %L)', tests.id('w2'), 'month'), 'LK103', 'already on this interval', 'the same interval is refused');
select tests.authenticate_as(tests.id('ana'));
select is((select billing_interval || ':' || amount_cents || ':' || plan_id from public.begin_billing_interval_change(tests.id('w1'), 'year')),
  'year:14900:pro', 'a subscription at a retired monthly price moves to the yearly price on sale');
select tests.clear_authentication();
select is((select count(*)::int from public.audit_events where workspace_id = tests.id('w2') and action = 'billing.change_requested' and metadata ->> 'kind' = 'change_interval' and metadata ->> 'interval' = 'year'),
  1, 'the request is in the audit trail');

update public.billing_subscriptions set cancel_at_period_end = true where workspace_id = tests.id('w2');
select tests.authenticate_as(tests.id('dani'));
select throws_ok(format('select * from public.begin_billing_interval_change(%L, %L)', tests.id('w2'), 'year'), 'LK103', 'the subscription cannot change interval now', 'not while a cancellation is scheduled');
select tests.clear_authentication();
update public.billing_subscriptions set cancel_at_period_end = false, status = 'past_due', grace_until = now() + interval '7 days' where workspace_id = tests.id('w2');
select tests.authenticate_as(tests.id('dani'));
select throws_ok(format('select * from public.begin_billing_interval_change(%L, %L)', tests.id('w2'), 'year'), 'LK103', 'the subscription cannot change interval now', 'not while a payment is failing');
select tests.clear_authentication();
update public.billing_subscriptions set status = 'active', grace_until = null, held_plan_id = 'agency', held_until = now() + interval '10 days', plan_id = 'pro', amount_cents = 1990 where workspace_id = tests.id('w2');
select tests.authenticate_as(tests.id('dani'));
select throws_ok(format('select * from public.begin_billing_interval_change(%L, %L)', tests.id('w2'), 'year'), 'LK103', 'the subscription cannot change interval now', 'not while a cheaper plan waits for the period to end');
select tests.clear_authentication();
update public.billing_subscriptions set held_plan_id = null, held_until = null, plan_id = 'agency', amount_cents = 57900, billing_interval = 'year' where workspace_id = tests.id('w2');
select tests.authenticate_as(tests.id('dani'));
select throws_ok(format('select * from public.begin_billing_interval_change(%L, %L)', tests.id('w2'), 'month'), 'LK103', 'this interval change is not offered', 'yearly to monthly is not offered in the middle of a paid year');
select throws_ok(format('select * from public.begin_billing_interval_change(%L, null)', tests.id('w2')), '22023', null, 'an interval is required');

-- 3. Cancellation reason -----------------------------------------------------------------------

select tests.clear_authentication();
select is((select relrowsecurity from pg_class where oid = 'public.billing_cancellation_feedback'::regclass), true, 'row level security is on for the cancellation feedback');
select is(
  (select count(*)::int from information_schema.role_table_grants
   where grantee in ('authenticated', 'anon') and table_schema = 'public' and table_name = 'billing_cancellation_feedback'),
  0, 'no client role reads or writes the cancellation feedback');
select ok(not has_function_privilege('anon', 'public.record_cancellation_feedback(uuid, text, text)', 'execute')
  and not has_function_privilege('service_role', 'public.record_cancellation_feedback(uuid, text, text)', 'execute'),
  'only a signed-in person can record a cancellation reason');

select tests.authenticate_as(tests.id('bia'));
select throws_ok(format('select public.record_cancellation_feedback(%L, %L)', tests.id('w1'), 'too_expensive'), '42501', null, 'an admin cannot record a reason');
select tests.authenticate_as(tests.id('caio'));
select throws_ok(format('select public.record_cancellation_feedback(%L, %L)', tests.id('w1'), 'too_expensive'), 'P0002', null, 'a member of another workspace gets not found');
select throws_ok(format('select public.record_cancellation_feedback(%L, %L)', tests.id('w4'), 'too_expensive'), 'LK103', null, 'a workspace without a subscription has nothing to explain');

select tests.authenticate_as(tests.id('ana'));
select throws_ok(format('select public.record_cancellation_feedback(%L, %L)', tests.id('w1'), 'because'), '22023', null, 'an unknown reason is refused');
select throws_ok(format('select public.record_cancellation_feedback(%L, %L, %L)', tests.id('w1'), 'other', repeat('x', 501)), '22023', null, 'a comment over 500 characters is refused');
select lives_ok(format('select public.record_cancellation_feedback(%L, %L, %L)', tests.id('w1'), 'too_expensive', '  caro para o meu momento  '), 'the owner records a reason with a comment');
select throws_ok('select * from public.billing_cancellation_feedback', '42501', null, 'the owner cannot read the table directly');
select tests.clear_authentication();
select is((select reason || '/' || comment || '/' || plan_id || '/' || billing_interval || '/' || (created_by = tests.id('ana'))::text from public.billing_cancellation_feedback where workspace_id = tests.id('w1')),
  'too_expensive/caro para o meu momento/pro/month/true', 'the row holds the reason, the trimmed comment, the plan and who answered');
select tests.authenticate_as(tests.id('ana'));
select lives_ok(format('select public.record_cancellation_feedback(%L, %L, %L)', tests.id('w1'), 'not_using', '   '), 'answering again is accepted');
select tests.clear_authentication();
select is((select count(*)::int || '/' || min(reason) || '/' || coalesce(min(comment), 'none') from public.billing_cancellation_feedback where workspace_id = tests.id('w1')),
  '1/not_using/none', 'a subscription keeps one answer, the last one, and a blank comment is stored as none');

-- 5. Export ------------------------------------------------------------------------------------

select tests.authenticate_as(tests.id('ana'));
select set_config('tests.export', public.export_workspace_data(tests.id('w1'))::text, true);
select is(jsonb_array_length(current_setting('tests.export')::jsonb -> 'billingCancellationFeedback'), 1, 'the workspace export has the cancellation feedback');
select is(current_setting('tests.export')::jsonb -> 'billingCancellationFeedback' -> 0 ->> 'reason', 'not_using', 'with the reason given');
select is(jsonb_array_length(current_setting('tests.export')::jsonb -> 'billingSubscriptions') || '/' || jsonb_array_length(current_setting('tests.export')::jsonb -> 'billingCustomers')
  || '/' || jsonb_typeof(current_setting('tests.export')::jsonb -> 'billingInvoices') || '/' || jsonb_typeof(current_setting('tests.export')::jsonb -> 'billingEvents'),
  '1/1/array/array', 'and still has the subscription, the customer, the invoices and the events');
select is((current_setting('tests.export')::jsonb ->> 'schemaVersion'), '1', 'the export format version did not change');
select tests.authenticate_as(tests.id('bia'));
select throws_ok(format('select public.export_workspace_data(%L)', tests.id('w1')), '42501', null, 'an admin still cannot export the workspace');
select tests.authenticate_as(tests.id('caio'));
select throws_ok(format('select public.export_workspace_data(%L)', tests.id('w1')), 'P0002', null, 'another tenant still cannot export it');

-- 4. Erasure work list -------------------------------------------------------------------------

select tests.clear_authentication();
insert into public.billing_subscriptions (workspace_id, provider, provider_subscription_id, provider_customer_id, plan_id, billing_interval, amount_cents, currency, status, observed_at, ended_at) values
  (tests.id('weli'), 'stripe', 'sub_pilot_eli_old', 'cus_pilot_eli', 'pro', 'month', 1490, 'BRL', 'ended', now(), now()),
  (tests.id('weli'), 'stripe', 'sub_pilot_eli', 'cus_pilot_eli', 'pro', 'year', 14900, 'BRL', 'active', now(), null);
select ok(not has_function_privilege('anon', 'public.list_erasure_subscriptions(uuid)', 'execute')
  and not has_function_privilege('service_role', 'public.list_erasure_subscriptions(uuid)', 'execute'),
  'the erasure work list is not executable by anon or by the service role');
select tests.authenticate_as(tests.id('eli'));
select public.request_account_deletion();
select tests.remember('req', (select id from public.privacy_requests where user_id = tests.id('eli')));
select throws_ok(format('select * from public.list_erasure_subscriptions(%L)', tests.id('req')), '42501', null, 'the person cannot list it for their own request');
select tests.authenticate_as(tests.id('adm'));
select throws_ok(format('select * from public.list_erasure_subscriptions(%L)', gen_random_uuid()), 'P0002', null, 'an unknown request is not found');
select throws_ok(format('select * from public.list_erasure_subscriptions(%L)', tests.id('req')), 'LK122', null, 'a request that is not in processing is refused');
select public.review_privacy_request(tests.id('req'), 'processing', 'manual_review');
select is((select string_agg(provider_subscription_id || ':' || provider_customer_id, ',') from public.list_erasure_subscriptions(tests.id('req'))),
  'sub_pilot_eli:cus_pilot_eli', 'the administrator gets the subscriptions that are not over, and only those');
select throws_ok(format('select public.begin_account_erasure(%L)', tests.id('req')), 'LK123', null, 'which is what still blocks the erasure');
select tests.clear_authentication();
-- Seats need a larger plan for a moment, as in the billing fixtures.
update public.workspaces set plan_id = 'agency' where id = tests.id('weli');
insert into public.workspace_memberships (workspace_id, user_id, role, status, accepted_at) values (tests.id('weli'), tests.id('bia'), 'editor', 'active', now());
select tests.authenticate_as(tests.id('adm'));
select throws_ok(format('select * from public.list_erasure_subscriptions(%L)', tests.id('req')), 'LK124', null, 'no subscription is listed for ending while the erasure would be refused for another member');
select tests.clear_authentication();
delete from public.workspace_memberships where workspace_id = tests.id('weli') and user_id = tests.id('bia');
update public.workspaces set plan_id = 'free' where id = tests.id('weli');
select tests.authenticate_as(tests.id('adm'));
select tests.clear_authentication();
update public.billing_subscriptions set status = 'ended', ended_at = now() where provider_subscription_id = 'sub_pilot_eli';
select tests.authenticate_as(tests.id('adm'));
select is((select count(*)::int from public.list_erasure_subscriptions(tests.id('req'))), 0, 'once they are over the list is empty');
select lives_ok(format('select public.begin_account_erasure(%L)', tests.id('req')), 'and the erasure can begin');

-- 6. Product funnel ----------------------------------------------------------------------------

select ok(not has_function_privilege('anon', 'public.get_product_metrics(integer)', 'execute')
  and not has_function_privilege('service_role', 'public.get_product_metrics(integer)', 'execute'),
  'the product metrics are not executable by anon or by the service role');
select tests.authenticate_as(tests.id('ana'));
select throws_ok('select public.get_product_metrics()', '42501', null, 'a customer cannot read the product metrics');

select tests.authenticate_as(tests.id('adm'));
select set_config('tests.base', public.get_product_metrics()::text, true);
select is(jsonb_array_length(current_setting('tests.base')::jsonb -> 'cohorts'), 12, 'twelve weekly cohorts by default');
select is(jsonb_array_length(public.get_product_metrics(1) -> 'cohorts') || '/' || jsonb_array_length(public.get_product_metrics(99) -> 'cohorts'), '1/12', 'the number of weeks is bounded');
select is(jsonb_array_length(current_setting('tests.base')::jsonb -> 'cancellationReasons'), 0, 'an answer on a subscription that was not cancelled is not a cancellation reason');

-- Four new accounts: one goes all the way, one stops at the page, one never confirms, one signed
-- up fifteen days ago and published only now.
select tests.clear_authentication();
select tests.remember('f1', tests.create_user('f1-pilot@example.test', 'F1'));
select tests.remember('f2', tests.create_user('f2-pilot@example.test', 'F2'));
select tests.remember('f3', tests.create_user('f3-pilot@example.test', 'F3', false));
select tests.remember('f4', tests.create_user('f4-pilot@example.test', 'F4'));
update auth.users set created_at = now() - interval '15 days' where id = tests.id('f4');
select set_config('tests.week_now', to_char(date_trunc('week', now() at time zone 'America/Sao_Paulo'), 'YYYY-MM-DD'), true);
select set_config('tests.week_f4', to_char(date_trunc('week', (now() - interval '15 days') at time zone 'America/Sao_Paulo'), 'YYYY-MM-DD'), true);

select tests.authenticate_as(tests.id('f1'));
select tests.remember('wf1', public.ensure_personal_workspace());
insert into public.profiles (workspace_id, title, slug) values (tests.id('wf1'), 'Funil Um', 'funil-piloto-um');
select tests.remember('pf1', (select id from public.profiles where slug = 'funil-piloto-um'));
update public.profiles set blocks = '[{"id":"a9300000-0000-4000-8000-000000000001","type":"link","visible":true,"title":"Site","url":"https://exemplo.com.br/"}]' where id = tests.id('pf1');
select public.publish_profile(tests.id('pf1'));
select tests.authenticate_as(tests.id('f2'));
select tests.remember('wf2', public.ensure_personal_workspace());
insert into public.profiles (workspace_id, title, slug) values (tests.id('wf2'), 'Funil Dois', 'funil-piloto-dois');
select tests.authenticate_as(tests.id('f4'));
select tests.remember('wf4', public.ensure_personal_workspace());
insert into public.profiles (workspace_id, title, slug) values (tests.id('wf4'), 'Funil Quatro', 'funil-piloto-quatro');
select tests.remember('pf4', (select id from public.profiles where slug = 'funil-piloto-quatro'));
update public.profiles set blocks = '[{"id":"a9300000-0000-4000-8000-000000000004","type":"link","visible":true,"title":"Site","url":"https://exemplo.com.br/"}]' where id = tests.id('pf4');
select public.publish_profile(tests.id('pf4'));
select tests.clear_authentication();

insert into public.analytics_daily (profile_id, workspace_id, day, dimension, event_type, count) values
  (tests.id('pf1'), tests.id('wf1'), current_date, 'total', 'page_view', 3),
  (tests.id('pf1'), tests.id('wf1'), current_date, 'total', 'whatsapp_click', 1),
  -- A link click is not a value action.
  (tests.id('pf4'), tests.id('wf4'), current_date, 'total', 'link_click', 2);
insert into public.billing_customers (workspace_id, provider, provider_customer_id) values (tests.id('wf1'), 'stripe', 'cus_pilot_f1');
insert into public.billing_subscriptions (id, workspace_id, provider, provider_subscription_id, provider_customer_id, plan_id, billing_interval, amount_cents, currency, status, observed_at)
values ('a9300000-0000-4000-8000-0000000000f1', tests.id('wf1'), 'stripe', 'sub_pilot_f1', 'cus_pilot_f1', 'pro', 'month', 1990, 'BRL', 'active', now());
insert into public.billing_invoices (workspace_id, subscription_id, provider, provider_invoice_id, amount_cents, currency, status, issued_at, paid_at)
values (tests.id('wf1'), 'a9300000-0000-4000-8000-0000000000f1', 'stripe', 'in_pilot_f1', 1990, 'BRL', 'paid', now(), now());

select tests.authenticate_as(tests.id('adm'));
select set_config('tests.after', public.get_product_metrics()::text, true);
select is(pg_temp.metric('after', 'signedUp') - pg_temp.metric('base', 'signedUp'), 4, 'four accounts signed up');
select is(pg_temp.metric('after', 'confirmed') - pg_temp.metric('base', 'confirmed'), 3, 'three confirmed the e-mail');
select is(pg_temp.metric('after', 'createdPage') - pg_temp.metric('base', 'createdPage'), 3, 'three created a page');
select is(pg_temp.metric('after', 'published') - pg_temp.metric('base', 'published'), 2, 'two published');
select is(pg_temp.metric('after', 'published24h') - pg_temp.metric('base', 'published24h'), 1, 'one of them within 24 hours of signing up');
select is(pg_temp.metric('after', 'visited') - pg_temp.metric('base', 'visited'), 1, 'one got a visit');
select is(pg_temp.metric('after', 'valueAction') - pg_temp.metric('base', 'valueAction'), 1, 'one got a value action, and a link click is not one');
select is(pg_temp.metric('after', 'paid') - pg_temp.metric('base', 'paid'), 1, 'one paid');
select is(pg_temp.cohort('after', current_setting('tests.week_now'), 'signedUp') - pg_temp.cohort('base', current_setting('tests.week_now'), 'signedUp'), 3, 'three of them are in this week''s cohort');
select is((pg_temp.cohort('after', current_setting('tests.week_f4'), 'signedUp') - pg_temp.cohort('base', current_setting('tests.week_f4'), 'signedUp'))
  || '/' || (pg_temp.cohort('after', current_setting('tests.week_f4'), 'published') - pg_temp.cohort('base', current_setting('tests.week_f4'), 'published'))
  || '/' || (pg_temp.cohort('after', current_setting('tests.week_f4'), 'published24h') - pg_temp.cohort('base', current_setting('tests.week_f4'), 'published24h')),
  '1/1/0', 'the fourth is in the cohort of the week it signed up, published, but not within 24 hours');
select is(jsonb_typeof(current_setting('tests.after')::jsonb -> 'totals' -> 'medianMinutesToPublish'), 'number', 'the median time to the first publication is a number');
select ok(current_setting('tests.after') !~ 'example\.test' and current_setting('tests.after') !~ 'funil-piloto' and current_setting('tests.after') !~ tests.id('f1')::text,
  'the answer names no account, no page and no identifier');

select tests.clear_authentication();
insert into public.platform_admins (user_id) values (tests.id('f3'));
update public.billing_subscriptions set cancel_at_period_end = true where workspace_id = tests.id('w1');
select tests.authenticate_as(tests.id('ana'));
select public.record_cancellation_feedback(tests.id('w1'), 'missing_feature', 'faltou agenda');
select tests.authenticate_as(tests.id('adm'));
select set_config('tests.last', public.get_product_metrics()::text, true);
select is(pg_temp.metric('last', 'signedUp') - pg_temp.metric('after', 'signedUp'), -1, 'a platform administrator is left out of the funnel');
select is((current_setting('tests.last')::jsonb -> 'cancellationReasons')::text, '[{"count": 1, "reason": "missing_feature"}]', 'the reason of a cancelled subscription is counted');
select is(current_setting('tests.last')::jsonb -> 'cancellationComments' -> 0 ->> 'comment', 'faltou agenda', 'and its comment is listed');
select is((select count(*)::int from jsonb_object_keys(current_setting('tests.last')::jsonb -> 'cancellationComments' -> 0)), 4, 'a comment comes with the reason, the plan and the date, and nothing about who wrote it');

-- Erasing the workspace removes the answer with it.
select tests.clear_authentication();
delete from public.billing_cancellation_feedback where workspace_id <> tests.id('w1');
update public.billing_subscriptions set status = 'ended', ended_at = now(), cancel_at_period_end = false where workspace_id = tests.id('w1');
delete from public.workspaces where id = tests.id('w1');
select is((select count(*)::int from public.billing_cancellation_feedback), 0, 'the cancellation feedback is deleted with the workspace');

select * from finish();
rollback;
