-- Pilot readiness: what was still missing in code before inviting people (docs/SPRINT_9_REPORT.md,
-- addendum of 2026-10-13; ADR 0014 addendum; ADR 0020).
--
-- Forward-only and additive. An application one version behind keeps working: it calls none of the
-- new functions, and the three functions replaced here keep their signatures and their answers
-- while the catalogue has no retired price (which is the case until a price is changed).
--
--   1. plan_prices keeps retired prices, so a subscription charged an amount that was valid when
--      it was bought keeps its plan after a price change (until now it became `price_mismatch`).
--   2. A monthly subscription can move to yearly (public.begin_billing_interval_change).
--   3. The reason of a cancellation, when the owner gives one (billing_cancellation_feedback).
--   4. The account erasure can list the subscriptions it has to end at the provider first.
--   5. The workspace export gains the cancellation feedback.
--   6. Product funnel and activation cohorts for platform administrators, computed from records
--      that already exist (public.get_product_metrics). Nothing new is collected for it.
--
-- Stable SQLSTATE reused: LK103 with the new detail `interval` (the interval change is not offered).

-- ---------------------------------------------------------------------------------------------
-- 1. Price catalogue with retired prices
-- ---------------------------------------------------------------------------------------------

alter table public.plan_prices
  add column id uuid not null default gen_random_uuid(),
  add column retired_at timestamptz;

alter table public.plan_prices drop constraint plan_prices_pkey;
alter table public.plan_prices add constraint plan_prices_pkey primary key (id);

-- One price on sale per plan and interval. plan_prices_charge_key stays as it was, over every row:
-- an amount, retired or not, still names exactly one plan, which is what the snapshot looks up.
create unique index plan_prices_one_current_idx on public.plan_prices (plan_id, billing_interval) where retired_at is null;

comment on table public.plan_prices is
  'Price catalogue in integer cents. Rows with retired_at null are on sale and mirror apps/web/src/lib/product.ts; retired rows mirror RETIRED_PRICES in modules/billing/catalog.ts and keep granting their plan to the subscriptions still charged that amount (a Vitest drift test compares both). A price is changed by a migration that retires the row and inserts the new one: docs/runbooks/PRICE_CHANGE.md.';
comment on column public.plan_prices.retired_at is
  'When this amount stopped being sold. Null: the price a new checkout or a plan change uses.';

-- Ranks by the price on sale: a retired price never decides what is an upgrade.
create or replace function private.plan_rank(p_plan_id text)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select pp.amount_cents from public.plan_prices pp
    where pp.plan_id = p_plan_id and pp.billing_interval = 'month' and pp.retired_at is null), 0);
$$;

-- Same function as in 202610090002; the plan must have a price on sale.
create or replace function public.begin_billing_checkout(p_workspace_id uuid, p_plan_id text, p_interval public.billing_interval)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_recent integer;
begin
  perform private.require_billing_owner(p_workspace_id, true);
  if p_interval is null or not exists (
    select 1 from public.plan_prices pp where pp.plan_id = p_plan_id and pp.billing_interval = p_interval and pp.retired_at is null
  ) then
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

-- Same function as in 202610090002; a plan change is charged the price on sale.
create or replace function public.begin_billing_change(p_workspace_id uuid, p_kind text, p_plan_id text default null)
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
    where pp.plan_id = p_plan_id and pp.billing_interval = v_sub.billing_interval and pp.retired_at is null;
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

-- ---------------------------------------------------------------------------------------------
-- 2. Monthly to yearly on a running subscription
-- ---------------------------------------------------------------------------------------------

-- Checked before the server asks the provider to change the interval. Only monthly to yearly: the
-- provider starts the yearly period at once and discounts what was paid for the rest of the month.
-- Yearly to monthly in the middle of a paid year is not offered (detail `interval`): the owner
-- cancels the renewal and subscribes monthly when the year ends. Returns the plan the subscription
-- is charged for, the interval asked for and its price on sale.
create function public.begin_billing_interval_change(p_workspace_id uuid, p_interval public.billing_interval)
returns table (provider_subscription_id text, provider_customer_id text, plan_id text, billing_interval public.billing_interval, amount_cents integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sub public.billing_subscriptions;
  v_amount integer;
begin
  perform private.require_billing_owner(p_workspace_id, true);
  if p_interval is null then
    raise exception 'unknown interval' using errcode = '22023', detail = 'interval';
  end if;

  select s.* into v_sub
  from public.billing_subscriptions s
  where s.workspace_id = p_workspace_id and s.status in ('active', 'past_due')
  for update;
  if not found then
    raise exception 'no subscription to change' using errcode = 'LK103', detail = 'none';
  end if;
  if v_sub.billing_interval = p_interval then
    raise exception 'already on this interval' using errcode = 'LK103', detail = 'same';
  end if;
  if p_interval <> 'year' then
    raise exception 'this interval change is not offered' using errcode = 'LK103', detail = 'interval';
  end if;
  -- Not while a payment is failing, a cancellation is scheduled or a cheaper plan is waiting for the
  -- period to end: each of those has its own way out first.
  if v_sub.status <> 'active' or v_sub.cancel_at_period_end or (v_sub.held_plan_id is not null and v_sub.held_until > now()) then
    raise exception 'the subscription cannot change interval now' using errcode = 'LK103', detail = 'state';
  end if;

  select pp.amount_cents into v_amount from public.plan_prices pp
  where pp.plan_id = v_sub.plan_id and pp.billing_interval = p_interval and pp.retired_at is null;
  if v_amount is null then
    raise exception 'plan is not for sale' using errcode = '22023', detail = 'plan';
  end if;

  perform private.write_audit_event(p_workspace_id, 'billing.change_requested', 'subscription', v_sub.id,
    jsonb_build_object('kind', 'change_interval', 'interval', p_interval));

  return query select v_sub.provider_subscription_id, v_sub.provider_customer_id, v_sub.plan_id, p_interval, v_amount;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- 3. Why a subscription was cancelled
-- ---------------------------------------------------------------------------------------------

-- Optional: a cancellation never waits for, or depends on, an answer. One row per subscription
-- (cancel, resume, cancel again keeps the last answer).
create table public.billing_cancellation_feedback (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  subscription_id uuid not null references public.billing_subscriptions (id) on delete cascade,
  reason text not null check (reason in ('too_expensive', 'missing_feature', 'not_using', 'switching_tool', 'technical_problems', 'temporary', 'other')),
  comment text check (comment is null or char_length(comment) between 1 and 500),
  plan_id text not null references public.plans (id),
  billing_interval public.billing_interval not null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint billing_cancellation_feedback_subscription_key unique (subscription_id)
);

create index billing_cancellation_feedback_workspace_idx on public.billing_cancellation_feedback (workspace_id);
create index billing_cancellation_feedback_plan_id_idx on public.billing_cancellation_feedback (plan_id);
create index billing_cancellation_feedback_created_by_idx on public.billing_cancellation_feedback (created_by) where created_by is not null;

create trigger billing_cancellation_feedback_set_updated_at
before update on public.billing_cancellation_feedback
for each row execute function private.set_updated_at();

comment on table public.billing_cancellation_feedback is
  'Reason an owner gave when cancelling, with an optional comment (free text the owner wrote: may contain personal data). Written only by record_cancellation_feedback. No client role reads it; platform administrators read counts and comments through get_product_metrics. Retention: life of the workspace (cascade).';

alter table public.billing_cancellation_feedback enable row level security;
revoke all on public.billing_cancellation_feedback from public, anon, authenticated, service_role;
grant select on public.billing_cancellation_feedback to service_role;

-- Called by the server, with the owner's session, after the provider accepted the cancellation.
-- The reasons are mirrored by CANCELLATION_REASONS in modules/billing/cancellation.ts.
create function public.record_cancellation_feedback(p_workspace_id uuid, p_reason text, p_comment text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sub public.billing_subscriptions;
  v_comment text := nullif(btrim(coalesce(p_comment, '')), '');
begin
  -- Like the cancellation itself, never blocked by a suspension.
  perform private.require_billing_owner(p_workspace_id, false);
  if p_reason is null or p_reason not in ('too_expensive', 'missing_feature', 'not_using', 'switching_tool', 'technical_problems', 'temporary', 'other') then
    raise exception 'unknown reason' using errcode = '22023', detail = 'reason';
  end if;
  if char_length(v_comment) > 500 then
    raise exception 'comment too long' using errcode = '22023', detail = 'comment';
  end if;

  select s.* into v_sub
  from public.billing_subscriptions s
  where s.workspace_id = p_workspace_id and s.status in ('active', 'past_due');
  if not found then
    raise exception 'no subscription' using errcode = 'LK103', detail = 'none';
  end if;

  insert into public.billing_cancellation_feedback (workspace_id, subscription_id, reason, comment, plan_id, billing_interval, created_by)
  values (p_workspace_id, v_sub.id, p_reason, v_comment, v_sub.plan_id, v_sub.billing_interval, (select auth.uid()))
  on conflict (subscription_id) do update
    set reason = excluded.reason, comment = excluded.comment, plan_id = excluded.plan_id,
        billing_interval = excluded.billing_interval, created_by = excluded.created_by;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- 4. Account erasure: the subscriptions to end at the provider first
-- ---------------------------------------------------------------------------------------------

-- begin_account_erasure refuses while a subscription of the person's workspaces is not over
-- (LK123). The server ends them at the provider and applies the snapshot before that step; this is
-- its work list. Platform administrators only, and only for a deletion request in processing whose
-- workspaces have no other member (LK124, as in the erasure itself).
create function public.list_erasure_subscriptions(p_request_id uuid)
returns table (provider_subscription_id text, provider_customer_id text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_request public.privacy_requests;
  v_owned uuid[];
begin
  if not private.is_platform_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into v_request from public.privacy_requests where id = p_request_id;
  if not found then raise exception 'not found' using errcode = 'P0002'; end if;
  if v_request.kind <> 'account_deletion' or v_request.status <> 'processing' then
    raise exception 'request is not an account deletion in processing' using errcode = 'LK122';
  end if;
  v_owned := private.erasure_owned_workspaces(v_request.user_id);
  -- The other thing that stops an erasure is checked here too: a subscription is never ended at the
  -- provider for an erasure that the next step would then refuse.
  if exists (
    select 1 from public.workspace_memberships m
    where m.workspace_id = any (v_owned) and m.user_id <> v_request.user_id and m.status = 'active'
  ) then
    raise exception 'an owned workspace has other members' using errcode = 'LK124';
  end if;
  return query
    select s.provider_subscription_id, s.provider_customer_id
    from public.billing_subscriptions s
    where s.workspace_id = any (v_owned) and s.status <> 'ended'
    order by s.created_at;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- 5. Workspace export: plus the cancellation feedback
-- ---------------------------------------------------------------------------------------------

-- Same function as in 202610110005 plus one key. The billing tables were already in it since
-- 202610090004. The format version stays 1: a key was only added.
create or replace function public.export_workspace_data(p_workspace_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_workspace public.workspaces;
  v_result jsonb;
begin
  if v_uid is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if private.workspace_role(p_workspace_id) is null then
    raise exception 'workspace not found' using errcode = 'P0002';
  end if;
  if private.workspace_role(p_workspace_id) <> 'owner' then
    raise exception 'owner required' using errcode = '42501';
  end if;
  select * into v_workspace from public.workspaces where id = p_workspace_id and deleted_at is null;
  if not found then raise exception 'workspace not found' using errcode = 'P0002'; end if;

  select jsonb_build_object(
    'schemaVersion', 1, 'exportedAt', now(), 'scope', 'workspace',
    'workspace', to_jsonb(v_workspace),
    'memberships', coalesce((select jsonb_agg(to_jsonb(m) order by m.created_at)
      from public.workspace_memberships m where m.workspace_id = p_workspace_id), '[]'::jsonb),
    'invitations', coalesce((select jsonb_agg(jsonb_build_object(
      'id', i.id, 'workspaceId', i.workspace_id, 'email', i.email, 'role', i.role,
      'invitedBy', i.invited_by, 'acceptedBy', i.accepted_by, 'revokedBy', i.revoked_by,
      'createdAt', i.created_at, 'expiresAt', i.expires_at, 'acceptedAt', i.accepted_at,
      'revokedAt', i.revoked_at) order by i.created_at)
      from public.workspace_invitations i where i.workspace_id = p_workspace_id), '[]'::jsonb),
    'profiles', coalesce((select jsonb_agg(to_jsonb(p) order by p.created_at)
      from public.profiles p where p.workspace_id = p_workspace_id), '[]'::jsonb),
    'publications', coalesce((select jsonb_agg(to_jsonb(p) order by p.created_at)
      from public.profile_publications p where p.workspace_id = p_workspace_id), '[]'::jsonb),
    'slugHistory', coalesce((select jsonb_agg(to_jsonb(h) order by h.released_at)
      from public.slug_history h where h.workspace_id = p_workspace_id), '[]'::jsonb),
    'mediaAssets', coalesce((select jsonb_agg(to_jsonb(a) order by a.created_at)
      from public.media_assets a where a.workspace_id = p_workspace_id), '[]'::jsonb),
    'mediaShares', coalesce((select jsonb_agg(to_jsonb(s) order by s.created_at)
      from public.media_asset_shares s where s.workspace_id = p_workspace_id), '[]'::jsonb),
    'leads', coalesce((select jsonb_agg(to_jsonb(l) order by l.created_at)
      from public.form_leads l where l.workspace_id = p_workspace_id), '[]'::jsonb),
    'analyticsDaily', coalesce((select jsonb_agg(to_jsonb(d) order by d.day)
      from public.analytics_daily d where d.workspace_id = p_workspace_id), '[]'::jsonb),
    'reportLinks', coalesce((select jsonb_agg(jsonb_build_object(
      'id', r.id, 'profileId', r.profile_id, 'label', r.label, 'periodDays', r.period_days,
      'createdBy', r.created_by, 'revokedBy', r.revoked_by, 'createdAt', r.created_at,
      'expiresAt', r.expires_at, 'revokedAt', r.revoked_at) order by r.created_at)
      from public.report_links r where r.workspace_id = p_workspace_id), '[]'::jsonb),
    'billingCustomers', coalesce((select jsonb_agg(to_jsonb(c) order by c.created_at)
      from public.billing_customers c where c.workspace_id = p_workspace_id), '[]'::jsonb),
    'billingSubscriptions', coalesce((select jsonb_agg(to_jsonb(s) order by s.created_at)
      from public.billing_subscriptions s where s.workspace_id = p_workspace_id), '[]'::jsonb),
    'billingInvoices', coalesce((select jsonb_agg(to_jsonb(i) order by i.issued_at)
      from public.billing_invoices i where i.workspace_id = p_workspace_id), '[]'::jsonb),
    'billingEvents', coalesce((select jsonb_agg(to_jsonb(e) order by e.received_at)
      from public.billing_events e where e.workspace_id = p_workspace_id), '[]'::jsonb),
    'billingCancellationFeedback', coalesce((select jsonb_agg(jsonb_build_object(
      'subscriptionId', f.subscription_id, 'reason', f.reason, 'comment', f.comment, 'planId', f.plan_id,
      'interval', f.billing_interval, 'createdBy', f.created_by, 'createdAt', f.created_at) order by f.created_at)
      from public.billing_cancellation_feedback f where f.workspace_id = p_workspace_id), '[]'::jsonb),
    'domains', coalesce((select jsonb_agg(jsonb_build_object(
      'id', d.id, 'profileId', d.profile_id, 'hostname', d.hostname, 'status', d.status, 'routing', d.routing,
      'createdBy', d.created_by, 'createdAt', d.created_at, 'verifiedAt', d.verified_at,
      'lapsedAt', d.lapsed_at, 'lastCheckedAt', d.last_checked_at) order by d.created_at)
      from public.profile_domains d where d.workspace_id = p_workspace_id), '[]'::jsonb),
    'pixels', coalesce((select jsonb_agg(to_jsonb(x) order by x.profile_id)
      from public.profile_pixels x where x.workspace_id = p_workspace_id), '[]'::jsonb),
    'moderationSuspensions', coalesce((select jsonb_agg(to_jsonb(s) order by s.suspended_at)
      from public.moderation_suspensions s where s.workspace_id = p_workspace_id), '[]'::jsonb),
    'moderationAppeals', coalesce((select jsonb_agg(jsonb_build_object(
      'id', a.id, 'profileId', a.profile_id, 'message', a.message, 'status', a.status, 'response', a.response,
      'createdBy', a.created_by, 'createdAt', a.created_at, 'decidedAt', a.decided_at) order by a.created_at)
      from public.moderation_appeals a where a.workspace_id = p_workspace_id), '[]'::jsonb),
    'audit', coalesce((select jsonb_agg(jsonb_build_object(
      'action', e.action, 'actorUserId', e.actor_user_id, 'targetType', e.target_type,
      'targetId', e.target_id, 'metadata', e.metadata, 'createdAt', e.created_at)
      order by e.created_at) from public.audit_events e where e.workspace_id = p_workspace_id), '[]'::jsonb)
  ) into v_result;
  perform private.write_audit_event(p_workspace_id, 'privacy.workspace_exported', 'workspace', p_workspace_id,
    jsonb_build_object('format', 'json', 'schemaVersion', 1));
  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- 6. Product funnel and activation cohorts (ADR 0020)
-- ---------------------------------------------------------------------------------------------

-- Product analytics for the pilot, read by platform administrators only. Computed from what the
-- product already records: no event, cookie or identifier is added for it. An account is counted in
-- the week it was created (weeks start on Monday, São Paulo time); each later step is something
-- that account did at any time since:
--   confirmed      the e-mail was confirmed
--   createdPage    it created at least one page (deleted and archived pages count)
--   published      it published at least once; published24h: within 24 hours of signing up
--   visited        a page it created got at least one counted visit
--   valueAction    a page it created got a WhatsApp click, a Pix copy or payment click, or a form
--                  submission (the value actions of ADR 0011)
--   paid           a workspace it owns has a paid invoice (in sandbox these are test payments)
-- Known limits, stated on the screen: accounts already erased are not counted; visits and actions
-- come from analytics_daily, kept for 100 days, which is why at most 12 weeks are returned; an
-- account that works only in somebody else's workspace is attributed what it created itself.
-- Platform administrators are left out. The answer has counts only, never a name or an address.
create function public.get_product_metrics(p_weeks integer default 12)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_weeks integer := least(greatest(coalesce(p_weeks, 12), 1), 12);
  v_tz constant text := 'America/Sao_Paulo';
  v_this_week timestamp := date_trunc('week', now() at time zone v_tz);
  v_first_week timestamp := v_this_week - make_interval(weeks => v_weeks - 1);
  v_cohorts jsonb;
  v_totals jsonb;
  v_reasons jsonb;
  v_comments jsonb;
begin
  if not private.is_platform_admin() then raise exception 'forbidden' using errcode = '42501'; end if;

  with accounts as (
    select u.id, u.created_at, u.email_confirmed_at,
      date_trunc('week', u.created_at at time zone v_tz) as week_start
    from auth.users u
    where u.created_at >= v_first_week at time zone v_tz
      and not exists (select 1 from public.platform_admins a where a.user_id = u.id)
  ), facts as (
    select a.week_start, a.created_at,
      a.email_confirmed_at is not null as confirmed,
      exists (select 1 from public.profiles p where p.created_by = a.id) as created_page,
      (select min(pp.created_at) from public.profile_publications pp where pp.published_by = a.id) as first_published_at,
      exists (
        select 1 from public.analytics_daily d join public.profiles p on p.id = d.profile_id
        where p.created_by = a.id and d.dimension = 'total' and d.event_type = 'page_view' and d.count > 0) as visited,
      exists (
        select 1 from public.analytics_daily d join public.profiles p on p.id = d.profile_id
        where p.created_by = a.id and d.dimension = 'total'
          and d.event_type in ('whatsapp_click', 'pix_copy', 'pix_pay_click', 'form_submit') and d.count > 0) as value_action,
      exists (
        select 1 from public.billing_invoices i join public.workspace_memberships m on m.workspace_id = i.workspace_id
        where m.user_id = a.id and m.role = 'owner' and m.status = 'active' and i.status = 'paid' and i.amount_cents > 0) as paid
    from accounts a
  ), rolled as (
    select f.week_start,
      count(*)::integer as signed_up,
      count(*) filter (where f.confirmed)::integer as confirmed,
      count(*) filter (where f.created_page)::integer as created_page,
      count(*) filter (where f.first_published_at is not null)::integer as published,
      count(*) filter (where f.first_published_at < f.created_at + interval '24 hours')::integer as published_24h,
      count(*) filter (where f.visited)::integer as visited,
      count(*) filter (where f.value_action)::integer as value_action,
      count(*) filter (where f.paid)::integer as paid,
      round((percentile_cont(0.5) within group (order by extract(epoch from f.first_published_at - f.created_at) / 60.0)
        filter (where f.first_published_at is not null))::numeric, 1) as median_minutes
    from facts f
    group by grouping sets ((f.week_start), ())
  ), shaped as (
    select r.week_start, jsonb_build_object(
      'signedUp', r.signed_up, 'confirmed', r.confirmed, 'createdPage', r.created_page, 'published', r.published,
      'published24h', r.published_24h, 'visited', r.visited, 'valueAction', r.value_action, 'paid', r.paid,
      'medianMinutesToPublish', r.median_minutes) as row
    from rolled r
  )
  select
    (select jsonb_agg(
        jsonb_build_object('weekStart', to_char(w.week_start, 'YYYY-MM-DD')) || coalesce(s.row, jsonb_build_object(
          'signedUp', 0, 'confirmed', 0, 'createdPage', 0, 'published', 0, 'published24h', 0, 'visited', 0,
          'valueAction', 0, 'paid', 0, 'medianMinutesToPublish', null))
        order by w.week_start desc)
      from generate_series(v_first_week, v_this_week, interval '1 week') as w (week_start)
      left join shaped s on s.week_start = w.week_start),
    coalesce((select s.row from shaped s where s.week_start is null), jsonb_build_object(
      'signedUp', 0, 'confirmed', 0, 'createdPage', 0, 'published', 0, 'published24h', 0, 'visited', 0,
      'valueAction', 0, 'paid', 0, 'medianMinutesToPublish', null))
  into v_cohorts, v_totals;

  -- Only answers attached to a subscription that was in fact cancelled or is over.
  select coalesce(jsonb_agg(jsonb_build_object('reason', t.reason, 'count', t.total) order by t.total desc, t.reason), '[]'::jsonb)
  into v_reasons
  from (
    select f.reason, count(*)::integer as total
    from public.billing_cancellation_feedback f
    join public.billing_subscriptions s on s.id = f.subscription_id
    where s.cancel_at_period_end or s.status = 'ended'
    group by f.reason
  ) t;

  select coalesce(jsonb_agg(jsonb_build_object('reason', t.reason, 'comment', t.comment, 'planId', t.plan_id, 'createdAt', t.updated_at)
    order by t.updated_at desc), '[]'::jsonb)
  into v_comments
  from (
    select f.reason, f.comment, f.plan_id, f.updated_at
    from public.billing_cancellation_feedback f
    join public.billing_subscriptions s on s.id = f.subscription_id
    where f.comment is not null and (s.cancel_at_period_end or s.status = 'ended')
    order by f.updated_at desc
    limit 50
  ) t;

  return jsonb_build_object(
    'generatedAt', now(), 'timezone', v_tz, 'weeks', v_weeks,
    'totals', v_totals, 'cohorts', coalesce(v_cohorts, '[]'::jsonb),
    'cancellationReasons', v_reasons, 'cancellationComments', v_comments);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------------------------

-- The functions replaced above keep the privileges they had; no private function was created.
revoke all on function
  public.begin_billing_interval_change(uuid, public.billing_interval),
  public.record_cancellation_feedback(uuid, text, text),
  public.list_erasure_subscriptions(uuid),
  public.get_product_metrics(integer)
from public, anon, authenticated, service_role;

grant execute on function
  public.begin_billing_interval_change(uuid, public.billing_interval),
  public.record_cancellation_feedback(uuid, text, text),
  public.list_erasure_subscriptions(uuid),
  public.get_product_metrics(integer)
to authenticated;
