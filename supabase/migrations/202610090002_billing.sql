-- Sprint 8, part 1: plans, subscriptions and billing. Design: docs/adr/0014-payments-subscriptions-and-webhooks.md.
-- Forward-only and additive, so the Sprint 7 application keeps working against this schema. The one
-- existing function it replaces is soft_delete_workspace, which gains a refusal for a workspace
-- that is still being charged; for every other workspace it behaves as before.
--
-- What this migration guarantees, whatever the application does:
--   * workspaces.plan_id still has no grant: it changes only inside private.billing_sync_plan,
--     reached from private.apply_billing_snapshot and public.run_billing_maintenance;
--   * a snapshot is accepted only with an HMAC made by the application server (secret mirrored in
--     Supabase Vault as `billing_signing_secret`), exactly like uploads (ADR 0009) and analytics
--     events (ADR 0011). No client role can write a customer, a subscription, an event or an invoice;
--   * the plan granted is the plan whose catalogue price is actually charged (plan_prices), never a
--     plan named by the caller;
--   * processing the same event twice changes nothing the second time, and a snapshot older than
--     the stored one changes nothing;
--   * no path here deletes a page, a member, a lead, a report link, a media asset or an aggregate.
--
-- Stable SQLSTATEs added: LK100 a subscription already exists, LK101 too many checkouts,
-- LK102 the workspace is still being charged, LK103 the change does not fit the subscription.

-- ---------------------------------------------------------------------------------------------
-- Types and the price catalogue
-- ---------------------------------------------------------------------------------------------

create type public.billing_interval as enum ('month', 'year');
create type public.billing_subscription_status as enum ('incomplete', 'active', 'past_due', 'ended');

create table public.plan_prices (
  plan_id text not null references public.plans (id) on delete cascade,
  billing_interval public.billing_interval not null,
  amount_cents integer not null check (amount_cents > 0),
  currency text not null check (currency = 'BRL'),
  created_at timestamptz not null default now(),
  primary key (plan_id, billing_interval),
  -- A charge identifies one plan: the plan granted is looked up by what is charged.
  constraint plan_prices_charge_key unique (billing_interval, amount_cents, currency)
);

comment on table public.plan_prices is
  'Price catalogue in integer cents. Mirrors apps/web/src/lib/product.ts (a Vitest drift test compares them). A subscription grants the plan whose row matches the amount, currency and interval the provider actually charges.';

-- Format read by the drift test: ('<plan>', '<interval>', <cents>, '<currency>').
insert into public.plan_prices (plan_id, billing_interval, amount_cents, currency) values
  ('pro', 'month', 1490, 'BRL'),
  ('pro', 'year', 14900, 'BRL'),
  ('agency', 'month', 5790, 'BRL'),
  ('agency', 'year', 57900, 'BRL');

-- The plan of a workspace that pays nothing: the column default of workspaces.plan_id.
create function private.default_plan_id()
returns text
language sql
immutable
set search_path = ''
as $$ select 'free'::text $$;

-- Orders plans by their monthly price (the free plan is 0), to tell an upgrade from a downgrade
-- without comparing plan names.
create function private.plan_rank(p_plan_id text)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select pp.amount_cents from public.plan_prices pp where pp.plan_id = p_plan_id and pp.billing_interval = 'month'), 0);
$$;

-- Days a failed payment keeps the paid plan (ADR 0014; mirrors GRACE_PERIOD_DAYS in the application).
create function private.billing_grace_period()
returns interval
language sql
immutable
set search_path = ''
as $$ select interval '7 days' $$;

-- ---------------------------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------------------------

-- Which provider customer pays for a workspace. One per workspace; a provider customer belongs to
-- one workspace, which is what stops an event for workspace A from changing workspace B.
create table public.billing_customers (
  workspace_id uuid primary key references public.workspaces (id) on delete cascade,
  provider text not null check (provider = 'stripe'),
  provider_customer_id text not null check (provider_customer_id ~ '^[A-Za-z0-9_]{3,255}$'),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint billing_customers_provider_key unique (provider, provider_customer_id)
);

create index billing_customers_created_by_idx on public.billing_customers (created_by) where created_by is not null;

comment on table public.billing_customers is
  'Provider customer of a workspace. Written only by register_billing_customer with a server signature. Holds identifiers only: no card data, no tax id, no address.';

-- A copy of what the provider says about a subscription. The provider is the source of truth.
create table public.billing_subscriptions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  provider text not null check (provider = 'stripe'),
  provider_subscription_id text not null check (provider_subscription_id ~ '^[A-Za-z0-9_]{3,255}$'),
  provider_customer_id text not null check (provider_customer_id ~ '^[A-Za-z0-9_]{3,255}$'),
  plan_id text not null references public.plans (id),
  billing_interval public.billing_interval not null,
  amount_cents integer not null check (amount_cents > 0),
  currency text not null check (currency = 'BRL'),
  status public.billing_subscription_status not null,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  -- While past_due: the paid plan is kept until this instant. Set once, when the failure is first seen.
  grace_until timestamptz,
  -- Set by the maintenance job when it takes the plan away at the end of the grace period.
  grace_expired_at timestamptz,
  -- After a paid-to-paid downgrade the plan already paid for holds until the paid period ends.
  held_plan_id text references public.plans (id),
  held_until timestamptz,
  -- What this subscription last wrote to workspaces.plan_id (null: nothing). A subscription that
  -- never granted a plan never takes one away, so a plan set by hand is left alone.
  granted_plan_id text references public.plans (id),
  -- When the server read the provider. An older snapshot never overwrites a newer one.
  observed_at timestamptz not null,
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint billing_subscriptions_provider_key unique (provider, provider_subscription_id),
  constraint billing_subscriptions_grace_pair check ((status = 'past_due') = (grace_until is not null)),
  constraint billing_subscriptions_held_pair check ((held_plan_id is null) = (held_until is null)),
  constraint billing_subscriptions_ended_pair check ((status = 'ended') = (ended_at is not null))
);

-- At most one paying subscription per workspace, whatever the application or the provider does.
create unique index billing_subscriptions_one_live_per_workspace
  on public.billing_subscriptions (workspace_id) where status in ('active', 'past_due');
create index billing_subscriptions_workspace_created_idx on public.billing_subscriptions (workspace_id, created_at desc);
-- Reconciliation and the grace clock scan subscriptions that are not over.
create index billing_subscriptions_open_observed_idx on public.billing_subscriptions (observed_at) where status <> 'ended';
create index billing_subscriptions_plan_id_idx on public.billing_subscriptions (plan_id);
create index billing_subscriptions_held_plan_id_idx on public.billing_subscriptions (held_plan_id) where held_plan_id is not null;
create index billing_subscriptions_granted_plan_id_idx on public.billing_subscriptions (granted_plan_id) where granted_plan_id is not null;

create trigger billing_subscriptions_set_updated_at
before update on public.billing_subscriptions
for each row execute function private.set_updated_at();

comment on table public.billing_subscriptions is
  'Copy of the provider''s subscription state. Written only by private.apply_billing_snapshot and the maintenance job. Retention: life of the workspace (fiscal retention is an open question for the accounting review, docs/DATA_MAP.md).';

-- Processed-event ledger: what makes a repeated delivery change nothing.
create table public.billing_events (
  provider text not null check (provider = 'stripe'),
  provider_event_id text not null check (char_length(provider_event_id) between 1 and 255),
  -- No foreign key: the ledger must not block, or vanish with, a workspace purge.
  workspace_id uuid,
  reason text not null check (reason in ('webhook', 'checkout_return', 'owner_action', 'reconciliation', 'dispute')),
  outcome text not null check (outcome in (
    'processing', 'applied', 'unchanged', 'ignored', 'stale', 'unknown_customer', 'customer_mismatch', 'price_mismatch', 'conflict'
  )),
  observed_at timestamptz not null,
  received_at timestamptz not null default now(),
  primary key (provider, provider_event_id)
);

create index billing_events_received_at_idx on public.billing_events (received_at);
create index billing_events_workspace_received_idx on public.billing_events (workspace_id, received_at desc) where workspace_id is not null;

comment on table public.billing_events is
  'Idempotency ledger of billing snapshots: one row per provider event (or per server-made read). Never holds a payload. Retention: 90 days, purged by run_billing_maintenance (the provider redelivers for at most 30).';

-- The minimum of invoice data for the history screen.
create table public.billing_invoices (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  subscription_id uuid not null references public.billing_subscriptions (id) on delete cascade,
  provider text not null check (provider = 'stripe'),
  provider_invoice_id text not null check (provider_invoice_id ~ '^[A-Za-z0-9_]{3,255}$'),
  amount_cents integer not null check (amount_cents >= 0),
  currency text not null check (currency = 'BRL'),
  status text not null check (status in ('open', 'paid', 'void', 'uncollectible')),
  issued_at timestamptz not null,
  paid_at timestamptz,
  -- The provider's hosted receipt page. Never a file and never card data.
  receipt_url text check (receipt_url is null or (receipt_url ~ '^https://[^[:space:]]+$' and char_length(receipt_url) <= 2048)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint billing_invoices_provider_key unique (provider, provider_invoice_id)
);

create index billing_invoices_workspace_issued_idx on public.billing_invoices (workspace_id, issued_at desc);
create index billing_invoices_subscription_id_idx on public.billing_invoices (subscription_id);

create trigger billing_invoices_set_updated_at
before update on public.billing_invoices
for each row execute function private.set_updated_at();

comment on table public.billing_invoices is
  'Invoice id, amount in cents, currency, status, dates and the provider''s receipt link. Nothing else is stored. Retention: life of the workspace; see docs/DATA_MAP.md for the fiscal retention question.';

alter table public.audit_events drop constraint audit_events_target_type_check;
alter table public.audit_events add constraint audit_events_target_type_check
  check (target_type in ('user', 'workspace', 'membership', 'profile', 'invitation', 'report_link', 'subscription'));

-- ---------------------------------------------------------------------------------------------
-- Attestation
-- ---------------------------------------------------------------------------------------------

create function private.billing_signing_secret()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select s.decrypted_secret from vault.decrypted_secrets s where s.name = 'billing_signing_secret' limit 1;
$$;

-- null: not configured (no secret). false: wrong or missing signature. true: made by the server.
create function private.billing_signature_is_valid(p_message text, p_signature text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_secret text := private.billing_signing_secret();
  v_expected text;
begin
  if v_secret is null or char_length(v_secret) < 32 then
    return null;
  end if;
  if p_message is null or p_signature is null or p_signature !~ '^[0-9a-f]{64}$' then
    return false;
  end if;
  v_expected := encode(extensions.hmac(convert_to(p_message, 'UTF8'), convert_to(v_secret, 'UTF8'), 'sha256'), 'hex');
  -- Compare digests so the time taken does not depend on where the two strings differ.
  return extensions.digest(v_expected, 'sha256') = extensions.digest(p_signature, 'sha256');
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- The single path to workspaces.plan_id
-- ---------------------------------------------------------------------------------------------

-- Recomputes what one subscription grants at p_now and writes it to the workspace. Returns true
-- when the workspace's plan changed. Rules (mirror of grantedPlan in modules/billing/subscription.ts):
--   active                      -> the plan charged (or the held plan while its period lasts)
--   past_due, inside the grace  -> the same
--   anything else               -> nothing
-- A subscription that grants nothing only moves the workspace back to the default plan if it was
-- this subscription that had granted a plan; a plan set by hand is never touched.
create function private.billing_sync_plan(p_subscription_id uuid, p_now timestamptz, p_reason text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sub public.billing_subscriptions;
  v_held_valid boolean;
  v_grant text;
  v_target text;
  v_current text;
begin
  select s.* into v_sub from public.billing_subscriptions s where s.id = p_subscription_id for update;
  if not found then
    return false;
  end if;

  v_held_valid := v_sub.held_plan_id is not null and v_sub.held_until > p_now;
  v_grant := case
    when v_sub.status = 'active' or (v_sub.status = 'past_due' and v_sub.grace_until > p_now)
      then case when v_held_valid then v_sub.held_plan_id else v_sub.plan_id end
    else null
  end;

  v_target := case
    when v_grant is not null then v_grant
    when v_sub.granted_plan_id is not null then private.default_plan_id()
    else null
  end;

  update public.billing_subscriptions s
  set granted_plan_id = v_grant,
      held_plan_id = case when v_held_valid then s.held_plan_id end,
      held_until = case when v_held_valid then s.held_until end,
      grace_expired_at = case
        when s.status = 'past_due' and s.grace_until <= p_now then coalesce(s.grace_expired_at, p_now)
        else null
      end
  where s.id = v_sub.id
    and (s.granted_plan_id is distinct from v_grant
      or (not v_held_valid and s.held_plan_id is not null)
      or (s.status = 'past_due' and s.grace_until <= p_now and s.grace_expired_at is null)
      or (not (s.status = 'past_due' and s.grace_until <= p_now) and s.grace_expired_at is not null));

  if v_target is null then
    return false;
  end if;

  select w.plan_id into v_current from public.workspaces w where w.id = v_sub.workspace_id for update;
  if not found or v_current = v_target then
    return false;
  end if;

  update public.workspaces set plan_id = v_target where id = v_sub.workspace_id;
  perform private.write_audit_event(v_sub.workspace_id, 'billing.plan_changed', 'subscription', v_sub.id,
    jsonb_build_object('from', v_current, 'to', v_target, 'reason', p_reason));
  return true;
end;
$$;

-- Addresses of the workspace's pages that are on the air: the caller drops their cached copies so
-- the badge follows the plan at once (the fallback is the 60-second ISR window).
create function private.billing_live_slugs(p_workspace_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(t.slug), '[]'::jsonb)
  from (
    select p.slug from public.profiles p
    where p.workspace_id = p_workspace_id and p.deleted_at is null and p.live_publication_id is not null
    order by p.created_at
    limit 200
  ) t;
$$;

create function private.billing_text_is_timestamp(p_value text)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_value is null or p_value !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$' then
    return false;
  end if;
  perform p_value::timestamptz;
  return true;
exception when others then
  return false;
end;
$$;

-- Applies one snapshot of the provider's state. p_now is the clock (the public wrapper passes
-- now(); tests pass their own). Never raises for bad input: it answers a status.
create function private.apply_billing_snapshot(p jsonb, p_now timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_provider text := p ->> 'provider';
  v_event_id text := p ->> 'event_id';
  v_reason text := p ->> 'reason';
  v_customer text := p ->> 'customer_id';
  v_sub jsonb := p -> 'subscription';
  v_invoices jsonb := p -> 'invoices';
  v_invoice jsonb;
  v_observed timestamptz;
  v_workspace uuid;
  v_outcome text := 'ignored';
  v_plan text;
  v_status public.billing_subscription_status;
  v_interval public.billing_interval;
  v_period_end timestamptz;
  v_cancel boolean;
  v_row public.billing_subscriptions;
  v_row_found boolean := false;
  v_subscription_id uuid;
  v_grace timestamptz;
  v_held_plan text;
  v_held_until timestamptz;
  v_changed boolean := false;
  v_plan_changed boolean := false;
  v_invalid constant jsonb := jsonb_build_object('status', 'invalid', 'plan_changed', false, 'slugs', '[]'::jsonb);
begin
  -- Shape. Everything is checked before anything is written.
  if jsonb_typeof(p) is distinct from 'object' or (p ->> 'v') is distinct from '1'
    or v_provider is distinct from 'stripe'
    or v_event_id is null or char_length(v_event_id) not between 1 and 255
    or v_reason is null or v_reason not in ('webhook', 'checkout_return', 'owner_action', 'reconciliation', 'dispute')
    or v_customer is null or v_customer !~ '^[A-Za-z0-9_]{3,255}$'
    or not private.billing_text_is_timestamp(p ->> 'observed_at')
    or jsonb_typeof(v_invoices) is distinct from 'array' or jsonb_array_length(v_invoices) > 12
    or jsonb_typeof(v_sub) is null or jsonb_typeof(v_sub) not in ('object', 'null')
  then
    return v_invalid;
  end if;
  v_observed := (p ->> 'observed_at')::timestamptz;

  if jsonb_typeof(v_sub) = 'object' then
    if (v_sub ->> 'id') is null or (v_sub ->> 'id') !~ '^[A-Za-z0-9_]{3,255}$'
      or (v_sub ->> 'customer_id') is distinct from v_customer
      or (v_sub ->> 'status') is null or (v_sub ->> 'status') not in ('incomplete', 'active', 'past_due', 'ended')
      or (v_sub ->> 'interval') is null or (v_sub ->> 'interval') not in ('month', 'year')
      or jsonb_typeof(v_sub -> 'amount_cents') is distinct from 'number' or (v_sub ->> 'amount_cents') !~ '^[0-9]{1,9}$'
      or (v_sub ->> 'currency') is null or (v_sub ->> 'currency') !~ '^[A-Z]{3}$'
      or jsonb_typeof(v_sub -> 'cancel_at_period_end') is distinct from 'boolean'
      or (jsonb_typeof(v_sub -> 'current_period_end') is distinct from 'null' and not private.billing_text_is_timestamp(v_sub ->> 'current_period_end'))
      or (jsonb_typeof(v_sub -> 'workspace_id') is distinct from 'null'
        and (v_sub ->> 'workspace_id') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
    then
      return v_invalid;
    end if;
  end if;

  for v_invoice in select value from jsonb_array_elements(v_invoices) loop
    if jsonb_typeof(v_invoice) is distinct from 'object'
      or (v_invoice ->> 'id') is null or (v_invoice ->> 'id') !~ '^[A-Za-z0-9_]{3,255}$'
      or jsonb_typeof(v_invoice -> 'amount_cents') is distinct from 'number' or (v_invoice ->> 'amount_cents') !~ '^[0-9]{1,9}$'
      or (v_invoice ->> 'currency') is distinct from 'BRL'
      or (v_invoice ->> 'status') is null or (v_invoice ->> 'status') not in ('open', 'paid', 'void', 'uncollectible')
      or not private.billing_text_is_timestamp(v_invoice ->> 'created_at')
      or (jsonb_typeof(v_invoice -> 'paid_at') is distinct from 'null' and not private.billing_text_is_timestamp(v_invoice ->> 'paid_at'))
      or (jsonb_typeof(v_invoice -> 'receipt_url') is distinct from 'null'
        and ((v_invoice ->> 'receipt_url') !~ '^https://[^[:space:]]+$' or char_length(v_invoice ->> 'receipt_url') > 2048))
    then
      return v_invalid;
    end if;
  end loop;

  -- A snapshot is a statement about "now". One that is not about now is not processed and not
  -- recorded: a legitimate retry reads the provider again and carries a fresh time.
  if v_observed > p_now + interval '5 minutes' or v_observed < p_now - interval '15 minutes' then
    return jsonb_build_object('status', 'expired', 'plan_changed', false, 'slugs', '[]'::jsonb);
  end if;

  select c.workspace_id into v_workspace
  from public.billing_customers c
  where c.provider = v_provider and c.provider_customer_id = v_customer;

  -- Idempotency. A concurrent delivery of the same event waits here for the first one to commit
  -- and then finds the row.
  insert into public.billing_events (provider, provider_event_id, workspace_id, reason, outcome, observed_at)
  values (v_provider, v_event_id, v_workspace, v_reason, 'processing', v_observed)
  on conflict (provider, provider_event_id) do nothing;
  if not found then
    return jsonb_build_object('status', 'duplicate', 'plan_changed', false, 'slugs', '[]'::jsonb);
  end if;

  <<work>>
  begin
    if v_workspace is null then
      v_outcome := 'unknown_customer';
      exit work;
    end if;
    if jsonb_typeof(v_sub) = 'null' then
      v_outcome := 'ignored';
      exit work;
    end if;
    -- The provider stored the workspace at checkout; it must be the workspace this customer pays for.
    if (v_sub ->> 'workspace_id') is distinct from v_workspace::text then
      v_outcome := 'customer_mismatch';
      exit work;
    end if;

    -- One snapshot at a time per workspace.
    perform 1 from public.workspaces w where w.id = v_workspace for update;

    v_status := (v_sub ->> 'status')::public.billing_subscription_status;
    v_interval := (v_sub ->> 'interval')::public.billing_interval;
    v_period_end := (v_sub ->> 'current_period_end')::timestamptz;
    v_cancel := (v_sub ->> 'cancel_at_period_end')::boolean;

    select pp.plan_id into v_plan
    from public.plan_prices pp
    where pp.billing_interval = v_interval
      and pp.amount_cents = (v_sub ->> 'amount_cents')::integer
      and pp.currency = v_sub ->> 'currency';
    if v_plan is null then
      -- Charged an amount that is not in the catalogue: grant nothing and say so.
      v_outcome := 'price_mismatch';
      exit work;
    end if;

    select s.* into v_row
    from public.billing_subscriptions s
    where s.provider = v_provider and s.provider_subscription_id = v_sub ->> 'id'
    for update;
    v_row_found := found;

    if v_row_found then
      v_subscription_id := v_row.id;
      if v_row.workspace_id <> v_workspace then
        v_subscription_id := null;
        v_outcome := 'customer_mismatch';
        exit work;
      end if;
      -- Strictly older only: two reads in the same instant saw the same state, and dropping the
      -- second could leave the copy behind until the daily reconciliation.
      if v_observed < v_row.observed_at then
        v_outcome := 'stale';
        exit work;
      end if;
      if v_row.status = 'ended' then
        -- Terminal for this provider subscription. Invoices may still change (a refund).
        v_outcome := 'unchanged';
        exit work;
      end if;
    elsif v_status in ('active', 'past_due') and exists (
      select 1 from public.billing_subscriptions s
      where s.workspace_id = v_workspace and s.status in ('active', 'past_due')
    ) then
      -- A second paying subscription for the same workspace: never stored. The caller cancels it
      -- at the provider and the refund is a manual step (docs/runbooks/BILLING.md).
      v_outcome := 'conflict';
      exit work;
    end if;

    -- Grace starts once, when the failure is first seen.
    v_grace := case
      when v_status = 'past_due' then
        case when v_row_found and v_row.status = 'past_due' then v_row.grace_until else p_now + private.billing_grace_period() end
    end;

    -- A cheaper paid plan mid-period: keep the plan already paid for until the period ends.
    if v_row_found and v_status in ('active', 'past_due') and v_row.status in ('active', 'past_due') then
      if v_row.held_plan_id is not null and v_row.held_until > p_now then
        if private.plan_rank(v_plan) < private.plan_rank(v_row.held_plan_id) then
          v_held_plan := v_row.held_plan_id;
          v_held_until := v_row.held_until;
        end if;
      elsif private.plan_rank(v_plan) < private.plan_rank(v_row.plan_id) and v_row.current_period_end > p_now then
        v_held_plan := v_row.plan_id;
        v_held_until := v_row.current_period_end;
      end if;
    end if;

    if v_row_found then
      v_changed := (v_row.status, v_row.plan_id, v_row.billing_interval, v_row.cancel_at_period_end, v_row.current_period_end)
        is distinct from (v_status, v_plan, v_interval, v_cancel, v_period_end);
      update public.billing_subscriptions s
      set plan_id = v_plan, billing_interval = v_interval, amount_cents = (v_sub ->> 'amount_cents')::integer,
          currency = v_sub ->> 'currency', status = v_status, current_period_end = v_period_end,
          cancel_at_period_end = v_cancel, grace_until = v_grace, held_plan_id = v_held_plan, held_until = v_held_until,
          observed_at = v_observed, ended_at = case when v_status = 'ended' then p_now end
      where s.id = v_row.id;
    else
      v_changed := true;
      insert into public.billing_subscriptions (
        workspace_id, provider, provider_subscription_id, provider_customer_id, plan_id, billing_interval, amount_cents,
        currency, status, current_period_end, cancel_at_period_end, grace_until, observed_at, ended_at
      ) values (
        v_workspace, v_provider, v_sub ->> 'id', v_customer, v_plan, v_interval, (v_sub ->> 'amount_cents')::integer,
        v_sub ->> 'currency', v_status, v_period_end, v_cancel, v_grace, v_observed, case when v_status = 'ended' then p_now end
      )
      returning id into v_subscription_id;
    end if;

    if v_changed then
      perform private.write_audit_event(v_workspace, 'billing.subscription_changed', 'subscription', v_subscription_id,
        jsonb_strip_nulls(jsonb_build_object(
          'from_status', case when v_row_found then v_row.status end, 'to_status', v_status,
          'from_plan', case when v_row_found then v_row.plan_id end, 'to_plan', v_plan,
          'interval', v_interval, 'cancel_at_period_end', v_cancel, 'reason', v_reason)));
    end if;

    v_plan_changed := private.billing_sync_plan(v_subscription_id, p_now, v_reason);
    v_outcome := case when v_changed or v_plan_changed then 'applied' else 'unchanged' end;
  end work;

  -- Invoice history: only for a subscription this workspace owns.
  if v_subscription_id is not null and v_outcome in ('applied', 'unchanged') then
    insert into public.billing_invoices (workspace_id, subscription_id, provider, provider_invoice_id, amount_cents, currency, status, issued_at, paid_at, receipt_url)
    select v_workspace, v_subscription_id, v_provider, i.value ->> 'id', (i.value ->> 'amount_cents')::integer, i.value ->> 'currency',
      i.value ->> 'status', (i.value ->> 'created_at')::timestamptz, (i.value ->> 'paid_at')::timestamptz, i.value ->> 'receipt_url'
    from jsonb_array_elements(v_invoices) i
    on conflict (provider, provider_invoice_id) do update
      set amount_cents = excluded.amount_cents, status = excluded.status, paid_at = excluded.paid_at, receipt_url = excluded.receipt_url
      where public.billing_invoices.workspace_id = excluded.workspace_id
        and (public.billing_invoices.amount_cents, public.billing_invoices.status, public.billing_invoices.paid_at, public.billing_invoices.receipt_url)
          is distinct from (excluded.amount_cents, excluded.status, excluded.paid_at, excluded.receipt_url);
  end if;

  update public.billing_events e set outcome = v_outcome
  where e.provider = v_provider and e.provider_event_id = v_event_id;

  return jsonb_build_object(
    'status', v_outcome,
    'plan_changed', v_plan_changed,
    'slugs', case when v_plan_changed then private.billing_live_slugs(v_workspace) else '[]'::jsonb end);
end;
$$;

-- The only door from outside. The signature is checked before anything else, so an unsigned
-- caller learns nothing about customers, subscriptions or events.
create function public.apply_billing_snapshot(p_payload text, p_signature text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_valid boolean := private.billing_signature_is_valid(p_payload, p_signature);
  v_json jsonb;
begin
  if v_valid is null then
    return jsonb_build_object('status', 'not_configured', 'plan_changed', false, 'slugs', '[]'::jsonb);
  end if;
  if not v_valid then
    return jsonb_build_object('status', 'forbidden', 'plan_changed', false, 'slugs', '[]'::jsonb);
  end if;
  if octet_length(p_payload) > 16384 then
    return jsonb_build_object('status', 'invalid', 'plan_changed', false, 'slugs', '[]'::jsonb);
  end if;
  begin
    v_json := p_payload::jsonb;
  exception when others then
    return jsonb_build_object('status', 'invalid', 'plan_changed', false, 'slugs', '[]'::jsonb);
  end;
  return private.apply_billing_snapshot(v_json, now());
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Maintenance: the clock and the repair list
-- ---------------------------------------------------------------------------------------------

-- Time passes without an event: a grace period ends, a held plan's period ends. This function
-- applies those, purges the ledger and returns the subscriptions the job should read again at the
-- provider (the repair for a lost webhook). Bounded per run.
create function public.run_billing_maintenance(p_now timestamptz default now(), p_limit integer default 50)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_row record;
  v_grace_expired integer := 0;
  v_holds_released integer := 0;
  v_plan_changes integer := 0;
  v_slugs jsonb := '[]'::jsonb;
  v_purged integer;
  v_candidates jsonb;
  v_pending integer;
begin
  for v_row in
    select s.id, s.workspace_id, (s.status = 'past_due' and s.grace_until <= p_now and s.grace_expired_at is null) as grace_due
    from public.billing_subscriptions s
    where s.status <> 'ended'
      and ((s.status = 'past_due' and s.grace_until <= p_now and s.grace_expired_at is null)
        or (s.held_until is not null and s.held_until <= p_now))
    order by s.id
    limit v_limit
  loop
    perform 1 from public.workspaces w where w.id = v_row.workspace_id for update;
    if private.billing_sync_plan(v_row.id, p_now, case when v_row.grace_due then 'grace_expired' else 'held_period_ended' end) then
      v_plan_changes := v_plan_changes + 1;
      v_slugs := v_slugs || private.billing_live_slugs(v_row.workspace_id);
    end if;
    if v_row.grace_due then
      v_grace_expired := v_grace_expired + 1;
    else
      v_holds_released := v_holds_released + 1;
    end if;
  end loop;

  with doomed as (
    select e.provider, e.provider_event_id from public.billing_events e
    where e.received_at < p_now - interval '90 days'
    order by e.received_at
    limit 5000
  )
  delete from public.billing_events e using doomed d
  where e.provider = d.provider and e.provider_event_id = d.provider_event_id;
  get diagnostics v_purged = row_count;

  -- Every subscription that is not over is read again about once a day.
  select coalesce(jsonb_agg(jsonb_build_object('subscription_id', t.provider_subscription_id, 'customer_id', t.provider_customer_id)), '[]'::jsonb)
  into v_candidates
  from (
    select s.provider_subscription_id, s.provider_customer_id
    from public.billing_subscriptions s
    where s.status <> 'ended' and s.observed_at < p_now - interval '20 hours'
    order by s.observed_at
    limit v_limit
  ) t;

  select count(*)::integer into v_pending
  from public.billing_subscriptions s
  where s.status <> 'ended' and s.observed_at < p_now - interval '20 hours';

  return jsonb_build_object(
    'grace_expired', v_grace_expired,
    'holds_released', v_holds_released,
    'plan_changes', v_plan_changes,
    'purged_events', v_purged,
    'candidates', v_candidates,
    'pending', greatest(v_pending - jsonb_array_length(v_candidates), 0),
    'slugs', v_slugs);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Owner actions (called with the owner's session; the server calls the provider in between)
-- ---------------------------------------------------------------------------------------------

-- Only the owner pays, changes the plan and cancels (ADR 0014). Same answers as the other RPCs:
-- not a member -> P0002, a member without the role -> 42501.
create function private.require_billing_owner(p_workspace_id uuid, p_needs_writable boolean)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role public.workspace_role;
begin
  if (select auth.uid()) is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  v_role := private.workspace_role(p_workspace_id);
  if v_role is null then
    raise exception 'workspace not found' using errcode = 'P0002';
  end if;
  if v_role <> 'owner' then
    raise exception 'only owners manage billing' using errcode = '42501';
  end if;
  if p_needs_writable and not private.workspace_is_writable(p_workspace_id) then
    raise exception 'workspace does not accept changes' using errcode = '42501';
  end if;
end;
$$;

-- Checked before a checkout is opened at the provider. Refuses a second subscription and a plan
-- that is not for sale; the amount itself comes from the server's catalogue and is matched against
-- plan_prices when the provider reports the charge. Returns how many subscriptions the workspace has
-- had: the server puts it in the checkout's idempotency key, so a retry reuses the open checkout and
-- a new attempt after a subscription (paid, pending or ended) opens a new one.
create function public.begin_billing_checkout(p_workspace_id uuid, p_plan_id text, p_interval public.billing_interval)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_recent integer;
begin
  perform private.require_billing_owner(p_workspace_id, true);
  if p_interval is null or not exists (select 1 from public.plan_prices pp where pp.plan_id = p_plan_id and pp.billing_interval = p_interval) then
    raise exception 'plan is not for sale' using errcode = '22023', detail = 'plan';
  end if;

  perform 1 from public.workspaces w where w.id = p_workspace_id for update;
  if exists (select 1 from public.billing_subscriptions s where s.workspace_id = p_workspace_id and s.status in ('active', 'past_due')) then
    raise exception 'the workspace already has a subscription' using errcode = 'LK100';
  end if;

  select count(*)::integer into v_recent
  from public.audit_events a
  where a.workspace_id = p_workspace_id and a.action = 'billing.checkout_started' and a.created_at > now() - interval '1 hour';
  if v_recent >= 10 then
    raise exception 'too many checkouts' using errcode = 'LK101';
  end if;

  perform private.write_audit_event(p_workspace_id, 'billing.checkout_started', 'workspace', p_workspace_id,
    jsonb_build_object('plan', p_plan_id, 'interval', p_interval));
  return (select count(*)::integer from public.billing_subscriptions s where s.workspace_id = p_workspace_id);
end;
$$;

-- Binds the provider customer the server just created to the workspace. The signature proves the
-- id came from the server's call to the provider; an owner cannot bind somebody else's customer.
-- Idempotent: the first binding wins and is what is returned.
create function public.register_billing_customer(p_workspace_id uuid, p_customer_id text, p_signature text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_valid boolean;
  v_stored text;
begin
  perform private.require_billing_owner(p_workspace_id, true);
  v_valid := private.billing_signature_is_valid(
    'lnk-billing-customer:v1:' || p_workspace_id::text || ':stripe:' || coalesce(p_customer_id, ''), p_signature);
  if v_valid is null then
    raise exception 'billing is not configured' using errcode = 'LK060', detail = 'not_configured';
  end if;
  if not v_valid then
    raise exception 'invalid signature' using errcode = 'LK060';
  end if;
  if p_customer_id !~ '^[A-Za-z0-9_]{3,255}$' then
    raise exception 'invalid customer' using errcode = '22023', detail = 'customer';
  end if;

  insert into public.billing_customers (workspace_id, provider, provider_customer_id, created_by)
  values (p_workspace_id, 'stripe', p_customer_id, (select auth.uid()))
  on conflict (workspace_id) do nothing;

  select c.provider_customer_id into v_stored from public.billing_customers c where c.workspace_id = p_workspace_id;
  return v_stored;
end;
$$;

-- Checked before the server asks the provider to cancel, resume or change the plan. Returns the
-- provider identifiers from the database, so they never come from the browser.
create function public.begin_billing_change(p_workspace_id uuid, p_kind text, p_plan_id text default null)
returns table (provider_subscription_id text, provider_customer_id text, plan_id text, billing_interval public.billing_interval, amount_cents integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sub public.billing_subscriptions;
  v_amount integer;
begin
  if p_kind is null or p_kind not in ('cancel', 'resume', 'change_plan') then
    raise exception 'unknown change' using errcode = '22023', detail = 'kind';
  end if;
  -- Stopping a charge is never blocked by a suspension.
  perform private.require_billing_owner(p_workspace_id, p_kind <> 'cancel');

  select s.* into v_sub
  from public.billing_subscriptions s
  where s.workspace_id = p_workspace_id and s.status in ('active', 'past_due')
  for update;
  if not found then
    raise exception 'no subscription to change' using errcode = 'LK103', detail = 'none';
  end if;

  if p_kind = 'cancel' and v_sub.cancel_at_period_end then
    raise exception 'already cancelled' using errcode = 'LK103', detail = 'already';
  elsif p_kind = 'resume' and not (v_sub.status = 'active' and v_sub.cancel_at_period_end) then
    raise exception 'nothing to resume' using errcode = 'LK103', detail = 'state';
  elsif p_kind = 'change_plan' then
    if v_sub.status <> 'active' or v_sub.cancel_at_period_end then
      raise exception 'the subscription cannot change plan now' using errcode = 'LK103', detail = 'state';
    end if;
    select pp.amount_cents into v_amount from public.plan_prices pp
    where pp.plan_id = p_plan_id and pp.billing_interval = v_sub.billing_interval;
    if v_amount is null then
      raise exception 'plan is not for sale' using errcode = '22023', detail = 'plan';
    end if;
    if p_plan_id = v_sub.plan_id then
      raise exception 'already on this plan' using errcode = 'LK103', detail = 'same';
    end if;
  end if;

  perform private.write_audit_event(p_workspace_id, 'billing.change_requested', 'subscription', v_sub.id,
    jsonb_strip_nulls(jsonb_build_object('kind', p_kind, 'plan', p_plan_id)));

  return query select v_sub.provider_subscription_id, v_sub.provider_customer_id, v_sub.plan_id, v_sub.billing_interval,
    coalesce(v_amount, v_sub.amount_cents);
end;
$$;

-- A workspace that is still being charged cannot be deleted: its subscription would outlive it.
-- Everything else is the Sprint 2 function.
create or replace function public.soft_delete_workspace(p_workspace_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role public.workspace_role := private.workspace_role(p_workspace_id);
  v_kind public.workspace_kind;
begin
  if (select auth.uid()) is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if v_role is null then
    raise exception 'workspace not found' using errcode = 'P0002';
  end if;
  if v_role <> 'owner' then
    raise exception 'only owners can delete a workspace' using errcode = '42501';
  end if;

  select w.kind into v_kind from public.workspaces w where w.id = p_workspace_id for update;
  if v_kind = 'personal' then
    raise exception 'personal workspaces end with the account' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.billing_subscriptions s
    where s.workspace_id = p_workspace_id and s.status in ('active', 'past_due') and not s.cancel_at_period_end
  ) then
    raise exception 'cancel the subscription first' using errcode = 'LK102';
  end if;

  update public.workspaces
  set deleted_at = now(), purge_after = now() + private.soft_delete_retention()
  where id = p_workspace_id;

  perform private.write_audit_event(p_workspace_id, 'workspace.deleted', 'workspace', p_workspace_id);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Row Level Security and privileges
-- ---------------------------------------------------------------------------------------------

alter table public.plan_prices enable row level security;
alter table public.billing_customers enable row level security;
alter table public.billing_subscriptions enable row level security;
alter table public.billing_events enable row level security;
alter table public.billing_invoices enable row level security;

revoke all on public.plan_prices, public.billing_customers, public.billing_subscriptions, public.billing_events, public.billing_invoices
  from public, anon, authenticated, service_role;

-- The catalogue is public to signed-in people, like plans and plan_entitlements.
grant select on public.plan_prices to authenticated;
create policy plan_prices_select_authenticated on public.plan_prices
for select to authenticated using (true);

-- Owners and admins see the plan's state; editors see nothing about payment.
grant select on public.billing_subscriptions to authenticated;
create policy billing_subscriptions_select_owner_admin on public.billing_subscriptions
for select to authenticated
using (workspace_id in (select private.workspace_ids_with_role(array['owner', 'admin']::public.workspace_role[])));

-- Payment history and the provider customer are the owner's.
grant select on public.billing_invoices, public.billing_customers to authenticated;
create policy billing_invoices_select_owner on public.billing_invoices
for select to authenticated
using (workspace_id in (select private.workspace_ids_with_role(array['owner']::public.workspace_role[])));
create policy billing_customers_select_owner on public.billing_customers
for select to authenticated
using (workspace_id in (select private.workspace_ids_with_role(array['owner']::public.workspace_role[])));

-- billing_events has no policy: no client role reads the ledger.
grant select on public.plan_prices, public.billing_customers, public.billing_subscriptions, public.billing_events, public.billing_invoices to service_role;

revoke all on all functions in schema private from public, anon, authenticated;
grant execute on function
  private.member_workspace_ids(),
  private.writable_workspace_ids(public.workspace_role[]),
  private.workspace_ids_with_role(public.workspace_role[])
to authenticated;

revoke all on function
  public.apply_billing_snapshot(text, text),
  public.run_billing_maintenance(timestamptz, integer),
  public.begin_billing_checkout(uuid, text, public.billing_interval),
  public.register_billing_customer(uuid, text, text),
  public.begin_billing_change(uuid, text, text)
from public, anon, authenticated, service_role;

-- Snapshots arrive from the application server acting as anon (webhook route, no session). The
-- signature, not the role, is what authorizes them.
grant execute on function public.apply_billing_snapshot(text, text) to anon, authenticated, service_role;

grant execute on function
  public.begin_billing_checkout(uuid, text, public.billing_interval),
  public.register_billing_customer(uuid, text, text),
  public.begin_billing_change(uuid, text, text)
to authenticated;

-- The job is administrative, never a user action.
grant execute on function public.run_billing_maintenance(timestamptz, integer) to service_role;
