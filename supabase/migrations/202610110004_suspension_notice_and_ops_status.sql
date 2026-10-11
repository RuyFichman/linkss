-- Sprint 9: notice and appeal for a suspended page, and the operational status read by the
-- external monitor (ADR 0019).
--
-- Forward-only and additive: three tables no client role reads, functions, and one function
-- replaced (`set_profile_moderation` now also records the suspension). An application one version
-- behind keeps working: it calls the same function with the same arguments.

-- ---------------------------------------------------------------------------------------------
-- Part 1: what the owner of a suspended page is told, and how they contest it
-- ---------------------------------------------------------------------------------------------

-- One row per suspension. It carries the only thing the owner is told about the cause: the
-- category. The administrator's justification stays in the audit trail (it may describe the
-- person who reported the page) and is never shown to the workspace.
create table public.moderation_suspensions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  category text not null check (category in ('phishing', 'impersonation', 'illegal', 'spam', 'privacy', 'other')),
  suspended_at timestamptz not null default now(),
  lifted_at timestamptz,
  constraint moderation_suspensions_lifted_after check (lifted_at is null or lifted_at >= suspended_at)
);
create unique index moderation_suspensions_one_open on public.moderation_suspensions (profile_id) where lifted_at is null;
create index moderation_suspensions_workspace_idx on public.moderation_suspensions (workspace_id);

comment on table public.moderation_suspensions is
  'One row per suspension of a page by moderation (ADR 0019). Holds the category shown to the workspace; the administrator''s justification is only in audit_events. Removed with the page.';

-- The owner's side of the story, and the answer written for them.
create table public.moderation_appeals (
  id uuid primary key default gen_random_uuid(),
  suspension_id uuid not null references public.moderation_suspensions (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  message text not null check (char_length(message) between 20 and 1000 and message !~ '[\x00-\x08\x0B\x0C\x0E-\x1F]'),
  status text not null default 'open' check (status in ('open', 'accepted', 'denied')),
  response text check (response is null or char_length(response) between 10 and 500),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  decided_by uuid references auth.users (id) on delete set null,
  decided_at timestamptz,
  constraint moderation_appeals_decided_pair check ((status = 'open') = (decided_at is null))
);
create unique index moderation_appeals_one_open on public.moderation_appeals (suspension_id) where status = 'open';
create index moderation_appeals_status_created_idx on public.moderation_appeals (status, created_at);
create index moderation_appeals_profile_idx on public.moderation_appeals (profile_id, created_at desc);
create index moderation_appeals_workspace_idx on public.moderation_appeals (workspace_id);

comment on table public.moderation_appeals is
  'Appeals against a suspension, written by an owner or admin of the workspace, and the answer written for them by a platform administrator (ADR 0019). Free text: may contain personal data. Removed with the page.';

alter table public.moderation_suspensions enable row level security;
alter table public.moderation_appeals enable row level security;
revoke all on public.moderation_suspensions, public.moderation_appeals from public, anon, authenticated, service_role;
-- No client role reads these tables: the workspace is served by get_page_moderation() and the
-- platform queue by list_moderation_appeals().

-- Pages suspended before this migration get their row, with the neutral category.
insert into public.moderation_suspensions (profile_id, workspace_id, category)
select p.id, p.workspace_id, 'other' from public.profiles p where p.moderation_status = 'suspended';

create function private.moderation_appeal_limit()
returns integer language sql immutable set search_path = ''
as $$ select 3 $$;

-- Same contract as before; it now opens and closes the suspension row too. Lifting a suspension
-- from the reports queue answers an appeal that was waiting.
create or replace function public.set_profile_moderation(
  p_profile_id uuid, p_suspend boolean, p_reason text, p_report_id uuid default null
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_profile public.profiles;
  v_target text := case when p_suspend then 'suspended' else 'active' end;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_category text;
begin
  if not private.is_platform_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_suspend is null or char_length(v_reason) not between 10 and 500 then
    raise exception 'reason required' using errcode = '22023';
  end if;
  select * into v_profile from public.profiles where id = p_profile_id and deleted_at is null for update;
  if not found then raise exception 'profile not found' using errcode = 'P0002'; end if;
  if p_report_id is not null then
    select r.reason into v_category from public.moderation_reports r where r.id = p_report_id and r.profile_id = p_profile_id;
    if not found then raise exception 'report mismatch' using errcode = 'P0002'; end if;
  end if;
  if v_profile.moderation_status = v_target then return jsonb_build_object('status', v_target, 'slug', v_profile.slug); end if;
  update public.profiles set moderation_status = v_target where id = p_profile_id;
  if p_suspend then
    insert into public.moderation_suspensions (profile_id, workspace_id, category)
    values (p_profile_id, v_profile.workspace_id, coalesce(v_category, 'other'));
  else
    update public.moderation_appeals a set status = 'accepted', decided_at = now(), decided_by = (select auth.uid())
    where a.status = 'open' and a.suspension_id in
      (select s.id from public.moderation_suspensions s where s.profile_id = p_profile_id and s.lifted_at is null);
    update public.moderation_suspensions set lifted_at = now() where profile_id = p_profile_id and lifted_at is null;
  end if;
  perform private.write_audit_event(v_profile.workspace_id,
    case when p_suspend then 'moderation.suspended'::public.audit_action
         else 'moderation.reactivated'::public.audit_action end,
    'profile', p_profile_id, jsonb_build_object('reason', v_reason, 'reportId', p_report_id));
  return jsonb_build_object('status', v_target, 'slug', v_profile.slug);
end;
$$;

-- What a member of the workspace sees about one page. Another tenant gets "not found".
create function public.get_page_moderation(p_profile_id uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  v_profile public.profiles;
  v_role public.workspace_role;
  v_suspension public.moderation_suspensions;
  v_appeals jsonb := '[]'::jsonb;
  v_count integer := 0;
begin
  if (select auth.uid()) is null then raise exception 'authentication required' using errcode = '42501'; end if;
  select p.* into v_profile from public.profiles p where p.id = p_profile_id and p.deleted_at is null;
  if not found then raise exception 'profile not found' using errcode = 'P0002'; end if;
  v_role := private.workspace_role(v_profile.workspace_id);
  if v_role is null then raise exception 'profile not found' using errcode = 'P0002'; end if;
  select s.* into v_suspension from public.moderation_suspensions s
    where s.profile_id = p_profile_id and s.lifted_at is null;
  if v_suspension.id is not null then
    select count(*) into v_count from public.moderation_appeals a where a.suspension_id = v_suspension.id;
    -- The appeal text is shown back only to who may write one.
    select coalesce(jsonb_agg(jsonb_build_object(
      'status', a.status, 'createdAt', a.created_at, 'decidedAt', a.decided_at, 'response', a.response,
      'message', case when v_role in ('owner', 'admin') then a.message end) order by a.created_at desc), '[]'::jsonb)
    into v_appeals from public.moderation_appeals a where a.suspension_id = v_suspension.id;
  end if;
  return jsonb_build_object(
    'status', v_profile.moderation_status, 'title', v_profile.title, 'slug', v_profile.slug,
    'category', v_suspension.category, 'suspendedAt', v_suspension.suspended_at,
    'canAppeal', v_role in ('owner', 'admin'),
    'appealsLeft', greatest(private.moderation_appeal_limit() - v_count, 0),
    'appeals', v_appeals);
end;
$$;

-- Owners and admins only: the appeal speaks for the workspace.
create function public.submit_moderation_appeal(p_profile_id uuid, p_message text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_profile public.profiles;
  v_role public.workspace_role;
  v_suspension public.moderation_suspensions;
  v_message text := btrim(coalesce(p_message, ''));
  v_id uuid;
begin
  if (select auth.uid()) is null then raise exception 'authentication required' using errcode = '42501'; end if;
  select p.* into v_profile from public.profiles p where p.id = p_profile_id and p.deleted_at is null for update;
  if not found then raise exception 'profile not found' using errcode = 'P0002'; end if;
  v_role := private.workspace_role(v_profile.workspace_id);
  if v_role is null then raise exception 'profile not found' using errcode = 'P0002'; end if;
  if v_role not in ('owner', 'admin') then raise exception 'only owners and admins can appeal' using errcode = '42501'; end if;
  if char_length(v_message) not between 20 and 1000 or v_message ~ '[\x00-\x08\x0B\x0C\x0E-\x1F]' then
    raise exception 'invalid message' using errcode = '22023';
  end if;
  select s.* into v_suspension from public.moderation_suspensions s
    where s.profile_id = p_profile_id and s.lifted_at is null;
  if v_profile.moderation_status <> 'suspended' or v_suspension.id is null then
    raise exception 'page is not suspended' using errcode = 'LK126';
  end if;
  if exists (select 1 from public.moderation_appeals a where a.suspension_id = v_suspension.id and a.status = 'open') then
    raise exception 'an appeal is already waiting' using errcode = 'LK127';
  end if;
  if (select count(*) from public.moderation_appeals a where a.suspension_id = v_suspension.id) >= private.moderation_appeal_limit() then
    raise exception 'appeal limit reached' using errcode = 'LK128';
  end if;
  insert into public.moderation_appeals (suspension_id, profile_id, workspace_id, message, created_by)
    values (v_suspension.id, p_profile_id, v_profile.workspace_id, v_message, (select auth.uid()))
    returning id into v_id;
  perform private.write_audit_event(v_profile.workspace_id, 'moderation.appealed', 'profile', p_profile_id,
    jsonb_build_object('appealId', v_id));
  return jsonb_build_object('id', v_id, 'status', 'open');
end;
$$;

-- Platform administrator answers. Accepting puts the page back; either way the answer is shown
-- to the workspace, so it is written for them.
create function public.decide_moderation_appeal(p_appeal_id uuid, p_accept boolean, p_response text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_appeal public.moderation_appeals;
  v_profile public.profiles;
  v_response text := btrim(coalesce(p_response, ''));
  v_target text := case when p_accept then 'accepted' else 'denied' end;
begin
  if not private.is_platform_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_accept is null or char_length(v_response) not between 10 and 500 then
    raise exception 'response required' using errcode = '22023';
  end if;
  select * into v_appeal from public.moderation_appeals where id = p_appeal_id for update;
  if not found then raise exception 'appeal not found' using errcode = 'P0002'; end if;
  select * into v_profile from public.profiles where id = v_appeal.profile_id for update;
  if v_appeal.status <> 'open' then
    if v_appeal.status = v_target then return jsonb_build_object('status', v_target, 'slug', v_profile.slug); end if;
    raise exception 'appeal already decided' using errcode = 'LK129';
  end if;
  update public.moderation_appeals set status = v_target, response = v_response,
    decided_at = now(), decided_by = (select auth.uid()) where id = p_appeal_id;
  if p_accept then
    update public.profiles set moderation_status = 'active' where id = v_appeal.profile_id;
    update public.moderation_suspensions set lifted_at = now() where id = v_appeal.suspension_id and lifted_at is null;
    perform private.write_audit_event(v_appeal.workspace_id, 'moderation.reactivated', 'profile', v_appeal.profile_id,
      jsonb_build_object('reason', 'appeal accepted', 'appealId', p_appeal_id));
  end if;
  perform private.write_audit_event(v_appeal.workspace_id, 'moderation.appeal_decided', 'profile', v_appeal.profile_id,
    jsonb_build_object('appealId', p_appeal_id, 'to', v_target));
  return jsonb_build_object('status', v_target, 'slug', v_profile.slug);
end;
$$;

create function public.list_moderation_appeals()
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
begin
  if not private.is_platform_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
    'id', a.id, 'profileId', a.profile_id, 'slug', p.slug, 'title', p.title,
    'category', s.category, 'suspendedAt', s.suspended_at, 'message', a.message,
    'status', a.status, 'response', a.response, 'createdAt', a.created_at, 'decidedAt', a.decided_at)
    order by (a.status = 'open') desc, a.created_at desc)
    from (select * from public.moderation_appeals order by (status = 'open') desc, created_at desc limit 100) a
    join public.moderation_suspensions s on s.id = a.suspension_id
    join public.profiles p on p.id = a.profile_id), '[]'::jsonb);
end;
$$;

revoke all on function private.moderation_appeal_limit() from public, anon, authenticated, service_role;
revoke all on function
  public.get_page_moderation(uuid),
  public.submit_moderation_appeal(uuid, text),
  public.decide_moderation_appeal(uuid, boolean, text),
  public.list_moderation_appeals()
from public, anon, authenticated, service_role;
grant execute on function
  public.get_page_moderation(uuid),
  public.submit_moderation_appeal(uuid, text),
  public.decide_moderation_appeal(uuid, boolean, text),
  public.list_moderation_appeals()
to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Part 2: operational status for the external monitor (service role only)
-- ---------------------------------------------------------------------------------------------

-- Heartbeat of the scheduled jobs: one row per job, written by the job's own route.
create table public.job_runs (
  job text primary key check (job in ('media-cleanup', 'analytics', 'billing', 'retention')),
  last_run_at timestamptz not null,
  last_outcome text not null check (char_length(last_outcome) between 1 and 40),
  last_ok_at timestamptz
);
comment on table public.job_runs is
  'Last execution of each scheduled job (ADR 0019). No personal data. Read only by get_ops_status().';
alter table public.job_runs enable row level security;
revoke all on public.job_runs from public, anon, authenticated, service_role;

-- A baseline, so "no successful run for 36 hours" is measured from this deploy and not from never.
insert into public.job_runs (job, last_run_at, last_outcome, last_ok_at)
select j, now(), 'baseline', now() from unnest(array['media-cleanup', 'analytics', 'billing', 'retention']) j;

create function public.record_job_run(p_job text, p_outcome text)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_ok boolean := p_outcome in ('ok', 'partial');
begin
  insert into public.job_runs (job, last_run_at, last_outcome, last_ok_at)
  values (p_job, now(), left(coalesce(p_outcome, 'unknown'), 40), case when v_ok then now() end)
  on conflict (job) do update set
    last_run_at = excluded.last_run_at,
    last_outcome = excluded.last_outcome,
    last_ok_at = coalesce(excluded.last_ok_at, public.job_runs.last_ok_at);
end;
$$;

-- Counts and timestamps only: nothing here names a person, a page or a workspace. The thresholds
-- live in the application (modules/ops/status.ts), so they change without a migration.
create function public.get_ops_status()
returns jsonb language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'now', now(),
    'jobs', (select coalesce(jsonb_agg(jsonb_build_object(
        'job', j.job, 'lastRunAt', j.last_run_at, 'lastOkAt', j.last_ok_at, 'lastOutcome', j.last_outcome) order by j.job), '[]'::jsonb)
      from public.job_runs j),
    'billing', jsonb_build_object(
      'stuckProcessing', (select count(*) from public.billing_events e where e.outcome = 'processing' and e.received_at < now() - interval '1 hour'),
      'mismatches24h', (select count(*) from public.billing_events e
        where e.outcome in ('unknown_customer', 'customer_mismatch', 'price_mismatch', 'conflict') and e.received_at > now() - interval '24 hours')),
    'queues', jsonb_build_object(
      'reportsWaiting', (select count(*) from public.moderation_reports r
        where r.status = 'new' and r.created_at < now() - interval '72 hours'
          and exists (select 1 from public.profiles p where p.id = r.profile_id and p.deleted_at is null)),
      'appealsWaiting', (select count(*) from public.moderation_appeals a where a.status = 'open' and a.created_at < now() - interval '72 hours'),
      'privacyWaiting', (select count(*) from public.privacy_requests q
        where q.status in ('received', 'needs_action', 'processing') and q.created_at < now() - interval '10 days')),
    'purge', jsonb_build_object(
      'profilesOverdue', (select count(*) from public.profiles p where p.purge_after < now() - interval '3 days'),
      'workspacesOverdue', (select count(*) from public.workspaces w where w.purge_after < now() - interval '3 days')));
$$;

revoke all on function public.record_job_run(text, text), public.get_ops_status() from public, anon, authenticated, service_role;
grant execute on function public.record_job_run(text, text), public.get_ops_status() to service_role;
