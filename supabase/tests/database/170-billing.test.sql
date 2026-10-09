-- Sprint 8, part 1: billing (ADR 0014). The single attested path from a provider snapshot to
-- workspaces.plan_id: idempotency, ordering, tenant isolation, the grace period with an injected
-- clock, the held plan after a paid-to-paid downgrade, data preservation, the owner-only actions and
-- the absence of any client write. Mirrors apps/web/src/modules/billing (subscription.ts,
-- attestation.ts); the signing secret and the signature vector below are the ones
-- billing.test.ts computes (drift guard).
begin;
select plan(158);

do $$
begin
  if exists (select 1 from vault.secrets where name = 'billing_signing_secret') then
    perform vault.update_secret((select id from vault.secrets where name = 'billing_signing_secret'), 'test-billing-signing-secret-0123456789');
  else
    perform vault.create_secret('test-billing-signing-secret-0123456789', 'billing_signing_secret');
  end if;
end;
$$;

-- Hermetic: whatever the local database already holds must not change the counts below.
delete from public.billing_invoices;
delete from public.billing_subscriptions;
delete from public.billing_events;
delete from public.billing_customers;

-- What the application server does with BILLING_SIGNING_SECRET.
create function pg_temp.sign(p_message text)
returns text
language sql
as $$ select encode(extensions.hmac(convert_to(p_message, 'UTF8'), convert_to('test-billing-signing-secret-0123456789', 'UTF8'), 'sha256'), 'hex') $$;

create function pg_temp.ts(p_at timestamptz)
returns text
language sql
as $$ select to_char(p_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') $$;

-- A snapshot as the server serializes it (modules/billing/attestation.ts).
create function pg_temp.snap(
  p_event text, p_at timestamptz, p_customer text, p_sub text, p_workspace uuid, p_status text,
  p_amount integer, p_interval text, p_period_end timestamptz, p_cancel boolean default false,
  p_invoices jsonb default '[]'::jsonb, p_reason text default 'webhook'
)
returns jsonb
language sql
as $$
  select jsonb_build_object(
    'v', 1, 'provider', 'stripe', 'event_id', p_event, 'reason', p_reason, 'observed_at', pg_temp.ts(p_at), 'customer_id', p_customer,
    'subscription', case when p_sub is null then 'null'::jsonb else jsonb_build_object(
      'id', p_sub, 'customer_id', p_customer, 'workspace_id', p_workspace, 'status', p_status, 'amount_cents', p_amount,
      'currency', 'BRL', 'interval', p_interval, 'current_period_end', pg_temp.ts(p_period_end), 'cancel_at_period_end', p_cancel) end,
    'invoices', p_invoices);
$$;

create function pg_temp.plan_of(p_workspace uuid)
returns text
language sql
as $$ select w.plan_id from public.workspaces w where w.id = p_workspace $$;

-- Fixtures ---------------------------------------------------------------------------------

select tests.remember('ana', tests.create_user('ana-billing@example.test', 'Ana'));
select tests.remember('bia', tests.create_user('bia-billing@example.test', 'Bia'));
select tests.remember('caio', tests.create_user('caio-billing@example.test', 'Caio'));
select tests.remember('dani', tests.create_user('dani-billing@example.test', 'Dani'));

select tests.authenticate_as(tests.id('bia'));
select public.ensure_personal_workspace();
select tests.authenticate_as(tests.id('caio'));
select public.ensure_personal_workspace();
select tests.authenticate_as(tests.id('ana'));
select public.ensure_personal_workspace();
select tests.remember('w1', public.create_agency_workspace('Agência Um'));
select tests.authenticate_as(tests.id('dani'));
select public.ensure_personal_workspace();
select tests.remember('w2', public.create_agency_workspace('Agência Dois'));
select tests.clear_authentication();

-- Bia (admin) and Caio (editor) join W1. Seats need a larger plan for a moment; W1 is then put
-- back on the free plan, which is how a real workspace starts.
update public.workspaces set plan_id = 'agency' where id = tests.id('w1');
insert into public.workspace_memberships (workspace_id, user_id, role, status, accepted_at) values
  (tests.id('w1'), tests.id('bia'), 'admin', 'active', now()),
  (tests.id('w1'), tests.id('caio'), 'editor', 'active', now());
update public.workspaces set plan_id = 'free' where id = tests.id('w1');

-- Milliseconds: the precision of the timestamps the server serializes.
select set_config('tests.t0', date_trunc('milliseconds', now())::text, true);
create function pg_temp.t0() returns timestamptz language sql as $$ select current_setting('tests.t0')::timestamptz $$;

-- Structure and privileges -------------------------------------------------------------------

select is((select count(*)::int from public.plan_prices), 4, 'the price catalogue has monthly and yearly prices for two paid plans');
select is(
  (select array_agg(pp.plan_id || ':' || pp.billing_interval || ':' || pp.amount_cents || ':' || pp.currency order by pp.amount_cents) from public.plan_prices pp),
  array['pro:month:1490:BRL', 'agency:month:5790:BRL', 'pro:year:14900:BRL', 'agency:year:57900:BRL'],
  'prices are R$ 14,90 and R$ 149 for Pro, R$ 57,90 and R$ 579 for Agency, in integer cents');
select is(
  (select count(*)::int from information_schema.role_table_grants
   where grantee in ('authenticated', 'anon') and table_schema = 'public'
     and table_name in ('plan_prices', 'billing_customers', 'billing_subscriptions', 'billing_events', 'billing_invoices')
     and privilege_type <> 'SELECT'),
  0, 'no client role can insert, update or delete in any billing table');
select is(
  (select count(*)::int from information_schema.role_table_grants
   where grantee in ('authenticated', 'anon') and table_schema = 'public' and table_name = 'billing_events'),
  0, 'no client role reads the event ledger');
select is(
  (select count(*)::int from information_schema.role_column_grants
   where grantee in ('authenticated', 'anon') and table_schema = 'public' and table_name = 'workspaces' and column_name = 'plan_id' and privilege_type <> 'SELECT'),
  0, 'workspaces.plan_id still has no write grant');
select ok(not has_function_privilege('authenticated', 'public.run_billing_maintenance(timestamptz, integer)', 'execute')
  and not has_function_privilege('anon', 'public.run_billing_maintenance(timestamptz, integer)', 'execute')
  and has_function_privilege('service_role', 'public.run_billing_maintenance(timestamptz, integer)', 'execute'),
  'the maintenance job is executable by the service role only');
select ok(not has_function_privilege('anon', 'public.begin_billing_checkout(uuid, text, public.billing_interval)', 'execute')
  and not has_function_privilege('anon', 'public.register_billing_customer(uuid, text, text)', 'execute')
  and not has_function_privilege('anon', 'public.begin_billing_change(uuid, text, text)', 'execute'),
  'anon cannot execute any owner action');

-- Signature vector shared with the application (billing.test.ts).
select is(pg_temp.sign('lnk-billing-customer:v1:00000000-0000-4000-8000-000000000001:stripe:cus_vector'),
  'ac15564a4a10b6497050816d307b51ba7775c0856e7564f1c7845d33b46baa4a', 'signature vector matches the application');

-- Owner actions: roles -------------------------------------------------------------------------

select tests.authenticate_as(tests.id('caio'));
select throws_ok(format('select public.begin_billing_checkout(%L, %L, %L)', tests.id('w1'), 'pro', 'month'), '42501', null, 'an editor cannot start a checkout');
select throws_ok(format('select public.register_billing_customer(%L, %L, %L)', tests.id('w1'), 'cus_w1',
  pg_temp.sign('lnk-billing-customer:v1:' || tests.id('w1') || ':stripe:cus_w1')), '42501', null, 'an editor cannot bind a provider customer, even with a valid signature');
select tests.authenticate_as(tests.id('bia'));
select throws_ok(format('select public.begin_billing_checkout(%L, %L, %L)', tests.id('w1'), 'pro', 'month'), '42501', null, 'an admin cannot start a checkout');
select throws_ok(format('select * from public.begin_billing_change(%L, %L)', tests.id('w1'), 'cancel'), '42501', null, 'an admin cannot cancel');
select tests.authenticate_as(tests.id('dani'));
select throws_ok(format('select public.begin_billing_checkout(%L, %L, %L)', tests.id('w1'), 'pro', 'month'), 'P0002', null, 'a member of another workspace gets not found for a checkout');
select throws_ok(format('select public.register_billing_customer(%L, %L, %L)', tests.id('w1'), 'cus_w1',
  pg_temp.sign('lnk-billing-customer:v1:' || tests.id('w1') || ':stripe:cus_w1')), 'P0002', null, 'a member of another workspace cannot bind a customer to it');
select throws_ok(format('select * from public.begin_billing_change(%L, %L)', tests.id('w1'), 'cancel'), 'P0002', null, 'a member of another workspace gets not found for a change');
select tests.authenticate_anon();
select throws_ok(format('select public.begin_billing_checkout(%L, %L, %L)', tests.id('w1'), 'pro', 'month'), '42501', null, 'anon cannot start a checkout');

select tests.authenticate_as(tests.id('ana'));
select throws_ok(format('select public.begin_billing_checkout(%L, %L, %L)', tests.id('w1'), 'free', 'month'), '22023', null, 'a plan without a price cannot be bought');
select throws_ok(format('select public.begin_billing_checkout(%L, %L, %L)', tests.id('w1'), 'enterprise', 'year'), '22023', null, 'an unknown plan cannot be bought');
select lives_ok(format('select public.begin_billing_checkout(%L, %L, %L)', tests.id('w1'), 'pro', 'month'), 'the owner starts a checkout');
select throws_ok(format('select public.register_billing_customer(%L, %L, %L)', tests.id('w1'), 'cus_w1', repeat('0', 64)), 'LK060', null, 'a forged signature does not bind a customer');
select throws_ok(format('select public.register_billing_customer(%L, %L, %L)', tests.id('w1'), 'cus_w1',
  pg_temp.sign('lnk-billing-customer:v1:' || tests.id('w2') || ':stripe:cus_w1')), 'LK060', null, 'a signature made for another workspace does not bind a customer');
select is(public.register_billing_customer(tests.id('w1'), 'cus_w1', pg_temp.sign('lnk-billing-customer:v1:' || tests.id('w1') || ':stripe:cus_w1')),
  'cus_w1', 'the owner binds the customer the server signed');
select is(public.register_billing_customer(tests.id('w1'), 'cus_other', pg_temp.sign('lnk-billing-customer:v1:' || tests.id('w1') || ':stripe:cus_other')),
  'cus_w1', 'binding again keeps the first customer (idempotent)');
select throws_ok(format('insert into public.billing_customers (workspace_id, provider, provider_customer_id) values (%L, %L, %L)', tests.id('w1'), 'stripe', 'cus_forged'),
  '42501', null, 'an owner cannot insert a customer row directly');
select throws_ok(format('insert into public.billing_subscriptions (workspace_id, provider, provider_subscription_id, provider_customer_id, plan_id, billing_interval, amount_cents, currency, status, observed_at) values (%L, %L, %L, %L, %L, %L, 5790, %L, %L, now())',
  tests.id('w1'), 'stripe', 'sub_forged', 'cus_w1', 'agency', 'month', 'BRL', 'active'), '42501', null, 'an owner cannot insert a subscription directly');
select throws_ok(format('update public.workspaces set plan_id = %L where id = %L', 'agency', tests.id('w1')), '42501', null, 'an owner still cannot change the plan directly');
select throws_ok(format('select * from public.begin_billing_change(%L, %L)', tests.id('w1'), 'cancel'), 'LK103', null, 'there is nothing to cancel before a subscription exists');
select tests.clear_authentication();

insert into public.billing_customers (workspace_id, provider, provider_customer_id) values (tests.id('w2'), 'stripe', 'cus_w2');

-- Signed door ------------------------------------------------------------------------------------

select tests.authenticate_anon();
select is(public.apply_billing_snapshot('{"v":1}', repeat('a', 64)) ->> 'status', 'forbidden', 'a snapshot with a wrong signature is refused');
select is(public.apply_billing_snapshot('{"v":1}', null) ->> 'status', 'forbidden', 'an unsigned snapshot is refused');
select is(public.apply_billing_snapshot('{"v":1}', pg_temp.sign('{"v":1}')) ->> 'status', 'invalid', 'a signed but malformed snapshot is invalid');
select is(public.apply_billing_snapshot('not json', pg_temp.sign('not json')) ->> 'status', 'invalid', 'signed text that is not JSON is invalid');
select tests.clear_authentication();
select is((select count(*)::int from public.billing_events), 0, 'refused and invalid snapshots leave no trace in the ledger');

-- AC2: idempotency, ordering, isolation ---------------------------------------------------------

select is(
  (select public.apply_billing_snapshot(s.t, pg_temp.sign(s.t))
   from (select pg_temp.snap('evt_1', now(), 'cus_w1', 'sub_w1', tests.id('w1'), 'active', 1490, 'month', now() + interval '30 days')::text as t) s),
  jsonb_build_object('status', 'applied', 'plan_changed', true, 'slugs', '[]'::jsonb),
  'a signed snapshot of an active subscription is applied through the public door');
select is(pg_temp.plan_of(tests.id('w1')), 'pro', 'the workspace gets the plan whose price is charged');
select is(private.entitlement_int(tests.id('w1'), 'analytics_days'), 90, 'the entitlement helpers return the new plan at once');
select is(private.entitlement_bool(tests.id('w1'), 'remove_badge'), true, 'the badge entitlement follows the plan at once');

select is(
  (select public.apply_billing_snapshot(s.t, pg_temp.sign(s.t)) ->> 'status'
   from (select pg_temp.snap('evt_1', now(), 'cus_w1', 'sub_w1', tests.id('w1'), 'active', 1490, 'month', now() + interval '30 days')::text as t) s),
  'duplicate', 'the same event delivered again is a duplicate');
select is(private.apply_billing_snapshot(pg_temp.snap('evt_1', pg_temp.t0() + interval '1 minute', 'cus_w1', 'sub_w1', tests.id('w1'), 'ended', 1490, 'month', null), pg_temp.t0() + interval '1 minute') ->> 'status',
  'duplicate', 'a replay of the event id with a different body is still a duplicate');
select is((select count(*)::int from public.billing_subscriptions where workspace_id = tests.id('w1')), 1, 'one subscription row');
select is((select count(*)::int from public.audit_events where workspace_id = tests.id('w1') and action = 'billing.plan_changed'), 1, 'one plan change in the audit trail');
select is((select count(*)::int from public.audit_events where workspace_id = tests.id('w1') and action = 'billing.subscription_changed'), 1, 'one subscription change in the audit trail');
select is((select actor_user_id from public.audit_events where workspace_id = tests.id('w1') and action = 'billing.plan_changed'), null, 'the plan change has no person as actor');
select is((select metadata from public.audit_events where workspace_id = tests.id('w1') and action = 'billing.plan_changed'),
  '{"from":"free","to":"pro","reason":"webhook"}'::jsonb, 'the audit entry says from, to and why, and nothing else');

-- Out of order: the newer observation arrives first.
select is(private.apply_billing_snapshot(pg_temp.snap('evt_3', pg_temp.t0() + interval '3 minutes', 'cus_w1', 'sub_w1', tests.id('w1'), 'active', 1490, 'month', pg_temp.t0() + interval '30 days', true), pg_temp.t0() + interval '3 minutes') ->> 'status',
  'applied', 'a newer observation (cancellation scheduled) is applied');
select is(private.apply_billing_snapshot(pg_temp.snap('evt_2', pg_temp.t0() + interval '2 minutes', 'cus_w1', 'sub_w1', tests.id('w1'), 'active', 1490, 'month', pg_temp.t0() + interval '30 days', false), pg_temp.t0() + interval '3 minutes') ->> 'status',
  'stale', 'an older observation arriving later is stale');
select is((select cancel_at_period_end from public.billing_subscriptions where provider_subscription_id = 'sub_w1'), true, 'the older observation did not roll the state back');
select is(private.apply_billing_snapshot(pg_temp.snap('evt_2', pg_temp.t0() + interval '4 minutes', 'cus_w1', 'sub_w1', tests.id('w1'), 'active', 1490, 'month', pg_temp.t0() + interval '30 days', false), pg_temp.t0() + interval '4 minutes') ->> 'status',
  'duplicate', 'the stale event stays recorded: a retry of it is a duplicate');
select is(private.apply_billing_snapshot(pg_temp.snap('evt_4', pg_temp.t0() + interval '5 minutes', 'cus_w1', 'sub_w1', tests.id('w1'), 'active', 1490, 'month', pg_temp.t0() + interval '30 days', true), pg_temp.t0() + interval '5 minutes') ->> 'status',
  'unchanged', 'the same state observed again changes nothing');
select is((select count(*)::int from public.audit_events where workspace_id = tests.id('w1') and action = 'billing.subscription_changed'), 2, 'an unchanged observation writes no audit entry');

-- Not about now.
select is(private.apply_billing_snapshot(pg_temp.snap('evt_old', pg_temp.t0() - interval '1 hour', 'cus_w1', 'sub_w1', tests.id('w1'), 'ended', 1490, 'month', null), pg_temp.t0() + interval '6 minutes') ->> 'status',
  'expired', 'a snapshot observed long ago is not processed');
select is(private.apply_billing_snapshot(pg_temp.snap('evt_future', pg_temp.t0() + interval '2 hours', 'cus_w1', 'sub_w1', tests.id('w1'), 'ended', 1490, 'month', null), pg_temp.t0() + interval '6 minutes') ->> 'status',
  'expired', 'a snapshot from the future is not processed');
select is((select count(*)::int from public.billing_events where provider_event_id in ('evt_old', 'evt_future')), 0, 'an expired snapshot is not recorded, so a fresh retry can be');

-- Unknown, mismatched, wrong price.
select is(private.apply_billing_snapshot(pg_temp.snap('evt_u', pg_temp.t0() + interval '6 minutes', 'cus_nobody', 'sub_x', tests.id('w1'), 'active', 5790, 'month', pg_temp.t0() + interval '30 days'), pg_temp.t0() + interval '6 minutes') ->> 'status',
  'unknown_customer', 'a customer nobody registered changes nothing');
select is(private.apply_billing_snapshot(pg_temp.snap('evt_m', pg_temp.t0() + interval '6 minutes', 'cus_w2', 'sub_m', tests.id('w1'), 'active', 5790, 'month', pg_temp.t0() + interval '30 days'), pg_temp.t0() + interval '6 minutes') ->> 'status',
  'customer_mismatch', 'a workspace id that is not the customer''s workspace changes nothing');
select is(private.apply_billing_snapshot(pg_temp.snap('evt_m2', pg_temp.t0() + interval '6 minutes', 'cus_w2', 'sub_w1', tests.id('w2'), 'ended', 1490, 'month', null), pg_temp.t0() + interval '6 minutes') ->> 'status',
  'customer_mismatch', 'another customer cannot end a subscription that belongs to a different workspace');
select is(private.apply_billing_snapshot(pg_temp.snap('evt_p', pg_temp.t0() + interval '6 minutes', 'cus_w2', 'sub_p', tests.id('w2'), 'active', 100, 'month', pg_temp.t0() + interval '30 days'), pg_temp.t0() + interval '6 minutes') ->> 'status',
  'price_mismatch', 'an amount that is not in the catalogue grants nothing');
select is(private.apply_billing_snapshot(pg_temp.snap('evt_p2', pg_temp.t0() + interval '6 minutes', 'cus_w2', 'sub_p', tests.id('w2'), 'active', 1490, 'year', pg_temp.t0() + interval '30 days'), pg_temp.t0() + interval '6 minutes') ->> 'status',
  'price_mismatch', 'the monthly amount charged yearly is not a catalogue price');
select is(pg_temp.plan_of(tests.id('w2')), 'free', 'the other workspace is still on the free plan');
select is(pg_temp.plan_of(tests.id('w1')), 'pro', 'the first workspace kept its plan');
select is((select count(*)::int from public.billing_subscriptions), 1, 'none of the refused snapshots created a subscription');
select is((select status::text from public.billing_subscriptions where provider_subscription_id = 'sub_w1'), 'active', 'the subscription was not ended by somebody else''s event');
select is(private.apply_billing_snapshot(pg_temp.snap('evt_n', pg_temp.t0() + interval '6 minutes', 'cus_w2', null, null, null, null, null, null), pg_temp.t0() + interval '6 minutes') ->> 'status',
  'ignored', 'an event with no subscription is recorded and ignored');

-- Malformed (as the definer would receive them after a valid signature).
select is(private.apply_billing_snapshot(pg_temp.snap('evt_i1', pg_temp.t0(), 'cus_w2', 'sub_i', tests.id('w2'), 'trialing', 5790, 'month', pg_temp.t0()), pg_temp.t0()) ->> 'status', 'invalid', 'an unknown status is invalid');
select is(private.apply_billing_snapshot(pg_temp.snap('evt_i2', pg_temp.t0(), 'cus_w2', 'sub_i', tests.id('w2'), 'active', -5, 'month', pg_temp.t0()), pg_temp.t0()) ->> 'status', 'invalid', 'a negative amount is invalid');
select is(private.apply_billing_snapshot(pg_temp.snap('evt_i3', pg_temp.t0(), 'cus_w2', 'sub_i', tests.id('w2'), 'active', 5790, 'week', pg_temp.t0()), pg_temp.t0()) ->> 'status', 'invalid', 'an unknown interval is invalid');
select is(private.apply_billing_snapshot(pg_temp.snap('evt_i4', pg_temp.t0(), 'cus_w2', 'sub_i', tests.id('w2'), 'active', 5790, 'month', pg_temp.t0()) || '{"v":2}', pg_temp.t0()) ->> 'status', 'invalid', 'an unknown version is invalid');
select is(private.apply_billing_snapshot(pg_temp.snap('evt_i5', pg_temp.t0(), 'cus_w2', 'sub_i', tests.id('w2'), 'active', 5790, 'month', pg_temp.t0(), false,
  (select jsonb_agg(jsonb_build_object('id', 'in_' || n, 'amount_cents', 1, 'currency', 'BRL', 'status', 'paid', 'created_at', pg_temp.ts(pg_temp.t0()), 'paid_at', null, 'receipt_url', null)) from generate_series(1, 13) n)), pg_temp.t0()) ->> 'status',
  'invalid', 'more invoices than the bound is invalid');
select is(private.apply_billing_snapshot(pg_temp.snap('evt_i6', pg_temp.t0(), 'cus_w2', 'sub_i', tests.id('w2'), 'active', 5790, 'month', pg_temp.t0(), false,
  jsonb_build_array(jsonb_build_object('id', 'in_x', 'amount_cents', 5790, 'currency', 'BRL', 'status', 'paid', 'created_at', pg_temp.ts(pg_temp.t0()), 'paid_at', null, 'receipt_url', 'javascript:alert(1)'))), pg_temp.t0()) ->> 'status',
  'invalid', 'a receipt link that is not https is invalid');
select is((select count(*)::int from public.billing_events where provider_event_id like 'evt_i%'), 0, 'invalid snapshots are not recorded');

-- A second paying subscription for the same workspace.
select is(private.apply_billing_snapshot(pg_temp.snap('evt_c', pg_temp.t0() + interval '7 minutes', 'cus_w1', 'sub_w1_second', tests.id('w1'), 'active', 5790, 'month', pg_temp.t0() + interval '30 days'), pg_temp.t0() + interval '7 minutes') ->> 'status',
  'conflict', 'a second paying subscription for the workspace is refused');
select is((select count(*)::int from public.billing_subscriptions where workspace_id = tests.id('w1') and status in ('active', 'past_due')), 1, 'the workspace still has one live subscription');
select is(pg_temp.plan_of(tests.id('w1')), 'pro', 'the refused subscription did not change the plan');
select throws_ok(format('insert into public.billing_subscriptions (workspace_id, provider, provider_subscription_id, provider_customer_id, plan_id, billing_interval, amount_cents, currency, status, observed_at) values (%L, %L, %L, %L, %L, %L, 5790, %L, %L, now())',
  tests.id('w1'), 'stripe', 'sub_w1_dup', 'cus_w1', 'agency', 'month', 'BRL', 'active'), '23505', null, 'the database itself refuses two live subscriptions per workspace');

select tests.authenticate_as(tests.id('ana'));
select throws_ok(format('select public.begin_billing_checkout(%L, %L, %L)', tests.id('w1'), 'agency', 'month'), 'LK100', null, 'a checkout cannot start while the workspace has a subscription');
select throws_ok(format('select * from public.begin_billing_change(%L, %L)', tests.id('w1'), 'cancel'), 'LK103', null, 'a cancellation already scheduled cannot be scheduled again');
select throws_ok(format('select * from public.begin_billing_change(%L, %L, %L)', tests.id('w1'), 'change_plan', 'agency'), 'LK103', null, 'the plan cannot change while a cancellation is scheduled');
select is((select provider_subscription_id from public.begin_billing_change(tests.id('w1'), 'resume')), 'sub_w1', 'the owner may resume, and the provider id comes from the database');
select is((select count(*)::int from public.billing_subscriptions), 1, 'the owner sees the subscription');
select is((select count(*)::int from public.billing_customers), 1, 'the owner sees only their own provider customer');
select lives_ok(format('select public.soft_delete_workspace(%L)', tests.id('w1')), 'the owner deletes a workspace whose subscription is already set to end');
select tests.clear_authentication();
select is((select deleted_at is not null from public.workspaces where id = tests.id('w1')), true, 'a workspace whose subscription is already set to end can be deleted');
update public.workspaces set deleted_at = null, purge_after = null where id = tests.id('w1');

select tests.authenticate_as(tests.id('bia'));
select is((select count(*)::int from public.billing_subscriptions), 1, 'an admin sees the plan state');
select is((select count(*)::int from public.billing_invoices), 0, 'an admin does not see the payment history');
select is((select count(*)::int from public.billing_customers), 0, 'an admin does not see the provider customer');
select tests.authenticate_as(tests.id('caio'));
select is((select count(*)::int from public.billing_subscriptions), 0, 'an editor sees nothing about payment');
select tests.authenticate_as(tests.id('dani'));
select is((select count(*)::int from public.billing_subscriptions), 0, 'a member of another workspace sees no subscription');
select tests.authenticate_anon();
select throws_ok('select * from public.billing_subscriptions', '42501', null, 'anon cannot read subscriptions');
select throws_ok('select * from public.plan_prices', '42501', null, 'anon cannot read the price catalogue');
select tests.clear_authentication();

-- AC3 fixtures: W2 on the Agency plan, with pages, a member, an invitation, a report link, media,
-- a lead and aggregates. ----------------------------------------------------------------------

select is(private.apply_billing_snapshot(pg_temp.snap('w2_start', pg_temp.t0(), 'cus_w2', 'sub_w2', tests.id('w2'), 'active', 5790, 'month', pg_temp.t0() + interval '30 days', false,
  jsonb_build_array(jsonb_build_object('id', 'in_w2_1', 'amount_cents', 5790, 'currency', 'BRL', 'status', 'paid', 'created_at', pg_temp.ts(pg_temp.t0()), 'paid_at', pg_temp.ts(pg_temp.t0()), 'receipt_url', 'https://pay.example.test/in_w2_1'))), pg_temp.t0()) ->> 'status',
  'applied', 'W2 subscribes to the Agency plan');
select is(pg_temp.plan_of(tests.id('w2')), 'agency', 'W2 is on the Agency plan');
select is((select count(*)::int from public.billing_invoices where workspace_id = tests.id('w2')), 1, 'the invoice is stored');
select is((select count(*)::int from public.billing_invoices where workspace_id = tests.id('w1')), 0, 'and only for its own workspace');

select tests.authenticate_as(tests.id('dani'));
insert into public.profiles (workspace_id, title, slug) select tests.id('w2'), 'Cliente ' || n, 'billing-cliente-' || n from generate_series(1, 3) n;
select is((select count(*)::int from public.billing_invoices), 1, 'the owner reads the payment history');
select throws_ok('update public.billing_invoices set amount_cents = 0', '42501', null, 'the owner cannot change an invoice');
select throws_ok('delete from public.billing_subscriptions', '42501', null, 'the owner cannot delete a subscription');
select public.publish_profile((select id from public.profiles where slug = 'billing-cliente-1'));
select tests.clear_authentication();
select tests.remember('page', (select id from public.profiles where slug = 'billing-cliente-1'));

-- AC5: the badge of a page that is ALREADY published follows the plan, read at request time.
select tests.authenticate_anon();
select is((select show_badge from public.get_public_page('billing-cliente-1')), false, 'a page published on a plan that removes the badge has no badge');
select tests.clear_authentication();

insert into public.workspace_memberships (workspace_id, user_id, role, status, accepted_at) values (tests.id('w2'), tests.id('bia'), 'editor', 'active', now());
insert into public.workspace_invitations (workspace_id, email, role, token_hash, invited_by, expires_at)
  values (tests.id('w2'), 'convidada-billing@example.test', 'editor', repeat('b', 64), tests.id('dani'), now() + interval '7 days');
insert into public.report_links (workspace_id, profile_id, token_hash, period_days, created_by, expires_at)
  values (tests.id('w2'), tests.id('page'), repeat('c', 64), 30, tests.id('dani'), now() + interval '30 days');
insert into public.analytics_daily (profile_id, workspace_id, day, dimension, event_type, count)
  values (tests.id('page'), tests.id('w2'), current_date - 60, 'total', 'page_view', 12);
insert into public.media_assets (id, workspace_id, profile_id, kind, status, width, height, bytes, variants, created_by, activated_at)
  values (gen_random_uuid(), tests.id('w2'), tests.id('page'), 'image', 'ready', 448, 448, 1000, '[{"w":448,"h":448,"bytes":1000}]'::jsonb, tests.id('dani'), now());
insert into public.form_leads (workspace_id, profile_id, block_id, publication_version, name, email, consent_given, consent_required, consent_text, consent_version, dedupe_key, purge_after)
  values (tests.id('w2'), tests.id('page'), 'form-1', 1, 'Visitante', 'visitante-billing@example.test', false, false, 'Texto', repeat('d', 32), repeat('e', 32), now() + interval '90 days');

create function pg_temp.w2_content()
returns text
language sql
as $$
  select concat_ws(',',
    (select count(*) from public.profiles where workspace_id = tests.id('w2') and deleted_at is null),
    (select count(*) from public.workspace_memberships where workspace_id = tests.id('w2') and status = 'active'),
    (select count(*) from public.workspace_invitations where workspace_id = tests.id('w2')),
    (select count(*) from public.report_links where workspace_id = tests.id('w2') and revoked_at is null),
    (select count(*) from public.analytics_daily where workspace_id = tests.id('w2')),
    (select count(*) from public.media_assets where workspace_id = tests.id('w2')),
    (select count(*) from public.form_leads where workspace_id = tests.id('w2')));
$$;
select is(pg_temp.w2_content(), '3,2,1,1,1,1,1', 'W2 holds three pages, two members, an invitation, a report link, aggregates, media and a lead');

-- AC4: the grace period, with the clock injected ----------------------------------------------

select is(private.apply_billing_snapshot(pg_temp.snap('w2_fail', pg_temp.t0() + interval '1 day', 'cus_w2', 'sub_w2', tests.id('w2'), 'past_due', 5790, 'month', pg_temp.t0() + interval '30 days'), pg_temp.t0() + interval '1 day') ->> 'status',
  'applied', 'a failed payment is applied');
select is((select grace_until from public.billing_subscriptions where provider_subscription_id = 'sub_w2'), pg_temp.t0() + interval '8 days', 'the grace period is seven days from when the failure was first seen');
select is(pg_temp.plan_of(tests.id('w2')), 'agency', 'the plan is held during the grace period');
select is(private.apply_billing_snapshot(pg_temp.snap('w2_fail_again', pg_temp.t0() + interval '3 days', 'cus_w2', 'sub_w2', tests.id('w2'), 'past_due', 5790, 'month', pg_temp.t0() + interval '30 days'), pg_temp.t0() + interval '3 days') ->> 'status',
  'unchanged', 'a later failed attempt changes nothing');
select is((select grace_until from public.billing_subscriptions where provider_subscription_id = 'sub_w2'), pg_temp.t0() + interval '8 days', 'a later failed attempt does not restart the grace period');

select tests.authenticate_service();
select is(public.run_billing_maintenance(pg_temp.t0() + interval '7 days') -> 'grace_expired', '0'::jsonb, 'the job does nothing before the deadline');
select tests.clear_authentication();
select is(pg_temp.plan_of(tests.id('w2')), 'agency', 'the plan is still held one day before the deadline');

-- Recovered inside the period.
select is(private.apply_billing_snapshot(pg_temp.snap('w2_recover', pg_temp.t0() + interval '7 days', 'cus_w2', 'sub_w2', tests.id('w2'), 'active', 5790, 'month', pg_temp.t0() + interval '60 days'), pg_temp.t0() + interval '7 days') ->> 'status',
  'applied', 'a payment recovered inside the period is applied');
select is((select grace_until from public.billing_subscriptions where provider_subscription_id = 'sub_w2'), null, 'recovery clears the grace deadline');
select is(pg_temp.plan_of(tests.id('w2')), 'agency', 'the plan never changed');
select is((select count(*)::int from public.audit_events where workspace_id = tests.id('w2') and action = 'billing.plan_changed'), 1, 'and the audit trail has only the original plan change');

-- Fails again and the grace period ends.
select is(private.apply_billing_snapshot(pg_temp.snap('w2_fail_2', pg_temp.t0() + interval '40 days', 'cus_w2', 'sub_w2', tests.id('w2'), 'past_due', 5790, 'month', pg_temp.t0() + interval '60 days'), pg_temp.t0() + interval '40 days') ->> 'status',
  'applied', 'a second failure starts a new grace period');
select is((select grace_until from public.billing_subscriptions where provider_subscription_id = 'sub_w2'), pg_temp.t0() + interval '47 days', 'the new period counts from the new failure');
select tests.authenticate_service();
select is(public.run_billing_maintenance(pg_temp.t0() + interval '47 days' + interval '1 second') ->> 'grace_expired', '1', 'the job ends the grace period after the deadline');
select tests.clear_authentication();
select is(pg_temp.plan_of(tests.id('w2')), 'free', 'the plan is lost at the end of the grace period');
select is((select metadata ->> 'reason' from public.audit_events where workspace_id = tests.id('w2') and action = 'billing.plan_changed' order by id desc limit 1),
  'grace_expired', 'the audit trail says why');
select tests.authenticate_anon();
select is((select show_badge from public.get_public_page('billing-cliente-1')), true, 'the badge is back on the already-published page as soon as the plan is lost');
select is((select state from public.get_public_page('billing-cliente-1')), 'published', 'and the page itself stays on the air');
select tests.clear_authentication();
select is((select status::text from public.billing_subscriptions where provider_subscription_id = 'sub_w2'), 'past_due', 'the subscription is still past due: the provider decides when it ends');
select is(pg_temp.w2_content(), '3,2,1,1,1,1,1', 'AC3: losing the plan deleted no page, member, invitation, report link, aggregate, media or lead');
select is(private.entitlement_int(tests.id('w2'), 'max_profiles'), 1, 'the limits are the free plan''s at once');
select is((select count(*)::int from public.profiles where workspace_id = tests.id('w2') and deleted_at is null), 3, 'the three pages stay, above the limit');
select tests.authenticate_as(tests.id('dani'));
select throws_ok(format('insert into public.profiles (workspace_id, title, slug) values (%L, %L, %L)', tests.id('w2'), 'Quarta', 'billing-cliente-4'), 'LK010', null, 'only new pages are refused above the limit');
select tests.clear_authentication();
select tests.authenticate_service();
select is(public.run_billing_maintenance(pg_temp.t0() + interval '48 days') ->> 'grace_expired', '0', 'running the job again changes nothing');
select tests.clear_authentication();
select is((select count(*)::int from public.audit_events where workspace_id = tests.id('w2') and action = 'billing.plan_changed'), 2, 'one audit entry for the loss, not one per run');

-- Recovered after the period.
select is(private.apply_billing_snapshot(pg_temp.snap('w2_recover_late', pg_temp.t0() + interval '50 days', 'cus_w2', 'sub_w2', tests.id('w2'), 'active', 5790, 'month', pg_temp.t0() + interval '90 days'), pg_temp.t0() + interval '50 days') -> 'plan_changed',
  'true'::jsonb, 'a payment recovered after the period restores the plan');
select is(pg_temp.plan_of(tests.id('w2')), 'agency', 'the plan is back');
select tests.authenticate_anon();
select is((select show_badge from public.get_public_page('billing-cliente-1')), false, 'the badge is gone again when the plan returns');
select tests.clear_authentication();
select is((select grace_expired_at from public.billing_subscriptions where provider_subscription_id = 'sub_w2'), null, 'the expiry mark is cleared');

-- Paid-to-paid downgrade: the plan already paid for holds until the period ends.
select tests.authenticate_as(tests.id('dani'));
select is((select amount_cents from public.begin_billing_change(tests.id('w2'), 'change_plan', 'pro')), 1490, 'the owner asks for a cheaper plan; the amount comes from the catalogue');
select throws_ok(format('select * from public.begin_billing_change(%L, %L, %L)', tests.id('w2'), 'change_plan', 'agency'), 'LK103', null, 'changing to the same plan is refused');
select throws_ok(format('select * from public.begin_billing_change(%L, %L, %L)', tests.id('w2'), 'change_plan', 'free'), '22023', null, 'changing to a plan without a price is refused: that is a cancellation');
select tests.clear_authentication();
select is(private.apply_billing_snapshot(pg_temp.snap('w2_down', pg_temp.t0() + interval '51 days', 'cus_w2', 'sub_w2', tests.id('w2'), 'active', 1490, 'month', pg_temp.t0() + interval '90 days'), pg_temp.t0() + interval '51 days') -> 'plan_changed',
  'false'::jsonb, 'a cheaper price mid-period does not change the plan yet');
select is(pg_temp.plan_of(tests.id('w2')), 'agency', 'the plan already paid for is kept');
select is((select held_until from public.billing_subscriptions where provider_subscription_id = 'sub_w2'), pg_temp.t0() + interval '90 days', 'until the end of the paid period');
select tests.authenticate_service();
select is(public.run_billing_maintenance(pg_temp.t0() + interval '90 days' + interval '1 second') ->> 'holds_released', '1', 'the job applies the cheaper plan when the period ends');
select tests.clear_authentication();
select is(pg_temp.plan_of(tests.id('w2')), 'pro', 'the workspace is on the cheaper plan');
select is(pg_temp.w2_content(), '3,2,1,1,1,1,1', 'AC3: the downgrade deleted nothing');

-- Upgrade: immediate.
select is(private.apply_billing_snapshot(pg_temp.snap('w2_up', pg_temp.t0() + interval '92 days', 'cus_w2', 'sub_w2', tests.id('w2'), 'active', 5790, 'month', pg_temp.t0() + interval '120 days'), pg_temp.t0() + interval '92 days') -> 'plan_changed',
  'true'::jsonb, 'a more expensive price changes the plan at once');
select is(pg_temp.plan_of(tests.id('w2')), 'agency', 'the workspace is back on the larger plan');

-- A yearly renewal: only the period moves.
select is(private.apply_billing_snapshot(pg_temp.snap('w2_renew', pg_temp.t0() + interval '120 days', 'cus_w2', 'sub_w2', tests.id('w2'), 'active', 5790, 'month', pg_temp.t0() + interval '150 days'), pg_temp.t0() + interval '120 days') -> 'plan_changed',
  'false'::jsonb, 'a renewal does not change the plan');
select is((select current_period_end from public.billing_subscriptions where provider_subscription_id = 'sub_w2'), pg_temp.t0() + interval '150 days', 'a renewal moves the end of the period');

-- Cancellation: access holds, then ends. Ended is terminal.
select is(private.apply_billing_snapshot(pg_temp.snap('w2_cancel', pg_temp.t0() + interval '121 days', 'cus_w2', 'sub_w2', tests.id('w2'), 'active', 5790, 'month', pg_temp.t0() + interval '150 days', true), pg_temp.t0() + interval '121 days') -> 'plan_changed',
  'false'::jsonb, 'a scheduled cancellation keeps the plan until the period ends');
select is(private.apply_billing_snapshot(pg_temp.snap('w2_end', pg_temp.t0() + interval '150 days', 'cus_w2', 'sub_w2', tests.id('w2'), 'ended', 5790, 'month', pg_temp.t0() + interval '150 days', true), pg_temp.t0() + interval '150 days') -> 'plan_changed',
  'true'::jsonb, 'the end of the subscription changes the plan');
select is(pg_temp.plan_of(tests.id('w2')), 'free', 'the workspace is on the free plan');
select is(private.apply_billing_snapshot(pg_temp.snap('w2_zombie', pg_temp.t0() + interval '151 days', 'cus_w2', 'sub_w2', tests.id('w2'), 'active', 5790, 'month', pg_temp.t0() + interval '180 days'), pg_temp.t0() + interval '151 days') ->> 'status',
  'unchanged', 'an ended subscription never comes back');
select is(pg_temp.plan_of(tests.id('w2')), 'free', 'and grants nothing');
select is(pg_temp.w2_content(), '3,2,1,1,1,1,1', 'AC3: the cancellation deleted nothing');
select is((select count(*)::int from public.billing_invoices where workspace_id = tests.id('w2')), 1, 'the payment history is kept after the end');

-- Subscribing again creates another subscription.
select is(private.apply_billing_snapshot(pg_temp.snap('w2_again', pg_temp.t0() + interval '152 days', 'cus_w2', 'sub_w2_b', tests.id('w2'), 'active', 57900, 'year', pg_temp.t0() + interval '517 days'), pg_temp.t0() + interval '152 days') -> 'plan_changed',
  'true'::jsonb, 'subscribing again, yearly, grants the plan');
select is((select billing_interval::text from public.billing_subscriptions where provider_subscription_id = 'sub_w2_b'), 'year', 'the yearly interval is stored');

-- A plan set by hand is left alone ---------------------------------------------------------------

select tests.authenticate_as(tests.id('bia'));
select tests.remember('w3', public.create_agency_workspace('Agência Manual'));
select tests.clear_authentication();
update public.workspaces set plan_id = 'agency' where id = tests.id('w3');
insert into public.billing_customers (workspace_id, provider, provider_customer_id) values (tests.id('w3'), 'stripe', 'cus_w3');
select is(private.apply_billing_snapshot(pg_temp.snap('w3_incomplete', pg_temp.t0(), 'cus_w3', 'sub_w3', tests.id('w3'), 'incomplete', 1490, 'month', pg_temp.t0() + interval '30 days'), pg_temp.t0()) ->> 'status',
  'applied', 'an unpaid first checkout is recorded');
select is(pg_temp.plan_of(tests.id('w3')), 'agency', 'a subscription that never granted a plan does not take a hand-set plan away');
select is(private.apply_billing_snapshot(pg_temp.snap('w3_expired', pg_temp.t0() + interval '1 day', 'cus_w3', 'sub_w3', tests.id('w3'), 'ended', 1490, 'month', null), pg_temp.t0() + interval '1 day') -> 'plan_changed',
  'false'::jsonb, 'nor does its end');
select is(pg_temp.plan_of(tests.id('w3')), 'agency', 'the hand-set plan is intact');
select tests.authenticate_service();
select is((public.run_billing_maintenance(pg_temp.t0() + interval '400 days') ->> 'plan_changes'), '0', 'a maintenance run never touches a workspace without a paying subscription');
select tests.clear_authentication();
select is(pg_temp.plan_of(tests.id('w3')), 'agency', 'still intact after the job');

-- Still being charged: cannot be deleted --------------------------------------------------------

select tests.authenticate_as(tests.id('dani'));
select throws_ok(format('select public.soft_delete_workspace(%L)', tests.id('w2')), 'LK102', null, 'a workspace with a running subscription cannot be deleted');
select tests.clear_authentication();

-- Reconciliation list and ledger purge ----------------------------------------------------------

select tests.authenticate_service();
select is(public.run_billing_maintenance(pg_temp.t0() + interval '152 days' + interval '1 hour') -> 'candidates',
  jsonb_build_array(jsonb_build_object('subscription_id', 'sub_w1', 'customer_id', 'cus_w1')), 'a subscription read recently is not on the repair list; one not read for a day is');
select is(public.run_billing_maintenance(pg_temp.t0() + interval '153 days' + interval '1 hour') -> 'candidates',
  jsonb_build_array(jsonb_build_object('subscription_id', 'sub_w1', 'customer_id', 'cus_w1'), jsonb_build_object('subscription_id', 'sub_w2_b', 'customer_id', 'cus_w2')),
  'the repair list is every subscription that is not over, oldest read first; ended ones are never on it');
select tests.clear_authentication();
delete from public.billing_events;
insert into public.billing_events (provider, provider_event_id, reason, outcome, observed_at, received_at) values
  ('stripe', 'evt_ancient', 'webhook', 'ignored', now() - interval '91 days', now() - interval '91 days'),
  ('stripe', 'evt_recent', 'webhook', 'ignored', now() - interval '89 days', now() - interval '89 days');
select tests.authenticate_service();
select is(public.run_billing_maintenance() ->> 'purged_events', '1', 'the ledger is purged after 90 days');
select tests.clear_authentication();

select * from finish();
rollback;
