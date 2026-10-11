-- Sprint 9: scheduled retention purges and the account erasure (ADR 0018).
--
-- Forward-only and additive: two functions for the daily job and for the platform administrator,
-- retention periods as functions, and one trigger function relaxed for the job. No table changes.
-- An application one version behind never calls any of it.
--
-- Until now every retention period was enforced "on the next write" (a lead was purged when the
-- same page received another one, an invitation when the same workspace invited again), so a page
-- or a workspace that went quiet kept its expired rows forever, and nothing ever removed a page or
-- a workspace whose 30 days after deletion had passed.

-- ---------------------------------------------------------------------------------------------
-- Retention periods that had no definition yet (provisional, pending the legal review)
-- ---------------------------------------------------------------------------------------------

create function private.moderation_report_retention()
returns interval language sql immutable set search_path = ''
as $$ select interval '180 days' $$;

create function private.privacy_request_retention()
returns interval language sql immutable set search_path = ''
as $$ select interval '5 years' $$;

create function private.audit_retention()
returns interval language sql immutable set search_path = ''
as $$ select interval '1 year' $$;

create function private.slug_history_retention()
returns interval language sql immutable set search_path = ''
as $$ select interval '1 year' $$;

-- The history of a privacy request stays append-only for every client role. Like the audit trail
-- (private.prevent_audit_mutation), only the retention job, which runs as the owner role, deletes.
create or replace function private.prevent_privacy_event_mutation()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and current_user in ('postgres', 'supabase_admin') then
    return old;
  end if;
  raise exception 'privacy request history is append-only' using errcode = '42501';
end $$;

-- ---------------------------------------------------------------------------------------------
-- Daily retention job (service role only)
-- ---------------------------------------------------------------------------------------------

-- Every statement is bounded by p_limit, so one run cannot hold locks for long; what is left waits
-- for the next day and is reported in the `pending*` counters. Safe to call repeatedly.
--
-- A page or a workspace past `purge_after` is only removed once the media job has removed its
-- image files (media_assets -> profiles/workspaces is ON DELETE RESTRICT): deleting the rows first
-- would leave files in the bucket that nothing points to.
create function public.run_retention_maintenance(p_limit integer default 1000)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 1000), 5000));
  v_leads integer;
  v_lead_hits integer;
  v_invitations integer;
  v_report_links integer;
  v_report_failures integer;
  v_moderation integer;
  v_privacy integer;
  v_audit integer;
  v_slugs integer;
  v_profiles integer;
  v_workspaces integer;
  v_pending_profiles integer;
  v_pending_workspaces integer;
  v_requests uuid[];
begin
  with doomed as (select l.id from public.form_leads l where l.purge_after < now() order by l.purge_after limit v_limit)
  delete from public.form_leads l using doomed d where l.id = d.id;
  get diagnostics v_leads = row_count;

  with doomed as (select h.ctid from public.form_submission_hits h where h.created_at < now() - interval '1 day' limit v_limit)
  delete from public.form_submission_hits h using doomed d where h.ctid = d.ctid;
  get diagnostics v_lead_hits = row_count;

  with doomed as (
    select i.id from public.workspace_invitations i
    where least(coalesce(i.accepted_at, i.revoked_at), i.expires_at) < now() - private.invitation_retention()
    limit v_limit)
  delete from public.workspace_invitations i using doomed d where i.id = d.id;
  get diagnostics v_invitations = row_count;

  with doomed as (
    select l.id from public.report_links l
    where least(coalesce(l.revoked_at, l.expires_at), l.expires_at) < now() - private.report_link_retention()
    limit v_limit)
  delete from public.report_links l using doomed d where l.id = d.id;
  get diagnostics v_report_links = row_count;

  with doomed as (select f.ctid from public.report_lookup_failures f where f.created_at < now() - interval '24 hours' limit v_limit)
  delete from public.report_lookup_failures f using doomed d where f.ctid = d.ctid;
  get diagnostics v_report_failures = row_count;

  -- A decided report leaves after the retention period; one that was never decided leaves too
  -- once its page no longer exists. An open report about an existing page is never purged.
  with doomed as (
    select r.id from public.moderation_reports r
    where coalesce(r.reviewed_at, r.created_at) < now() - private.moderation_report_retention()
      and (r.status in ('dismissed', 'actioned')
        or not exists (select 1 from public.profiles p where p.id = r.profile_id))
    limit v_limit)
  delete from public.moderation_reports r using doomed d where r.id = d.id;
  get diagnostics v_moderation = row_count;

  -- Closed privacy requests, with their history (the history has ON DELETE RESTRICT, so it goes first).
  select coalesce(array_agg(x.id), '{}'::uuid[]) into v_requests from (
    select r.id from public.privacy_requests r
    where r.status in ('completed', 'rejected') and r.updated_at < now() - private.privacy_request_retention()
    limit v_limit) x;
  delete from public.privacy_request_events e where e.request_id = any (v_requests);
  delete from public.privacy_requests r where r.id = any (v_requests);
  get diagnostics v_privacy = row_count;

  with doomed as (select e.id from public.audit_events e where e.created_at < now() - private.audit_retention() order by e.created_at limit v_limit)
  delete from public.audit_events e using doomed d where e.id = d.id;
  get diagnostics v_audit = row_count;

  with doomed as (select s.id from public.slug_history s where s.hold_until < now() - private.slug_history_retention() limit v_limit)
  delete from public.slug_history s using doomed d where s.id = d.id;
  get diagnostics v_slugs = row_count;

  -- Pages deleted more than 30 days ago whose image files are already gone.
  with doomed as (
    select p.id from public.profiles p
    where p.purge_after < now()
      and not exists (select 1 from public.media_assets m where m.profile_id = p.id)
    order by p.purge_after limit v_limit)
  delete from public.profiles p using doomed d where p.id = d.id;
  get diagnostics v_profiles = row_count;

  -- Workspaces deleted more than 30 days ago: no image file left and no subscription still running.
  with doomed as (
    select w.id from public.workspaces w
    where w.purge_after < now()
      and not exists (select 1 from public.media_assets m where m.workspace_id = w.id)
      and not exists (select 1 from public.billing_subscriptions s where s.workspace_id = w.id and s.status <> 'ended')
    order by w.purge_after limit v_limit)
  delete from public.workspaces w using doomed d where w.id = d.id;
  get diagnostics v_workspaces = row_count;

  select count(*) into v_pending_profiles from public.profiles p where p.purge_after < now();
  select count(*) into v_pending_workspaces from public.workspaces w where w.purge_after < now();

  return jsonb_build_object(
    'leads', v_leads, 'leadHits', v_lead_hits, 'invitations', v_invitations,
    'reportLinks', v_report_links, 'reportFailures', v_report_failures,
    'moderationReports', v_moderation, 'privacyRequests', v_privacy,
    'auditEvents', v_audit, 'slugHistory', v_slugs,
    'profiles', v_profiles, 'workspaces', v_workspaces,
    'pendingProfiles', v_pending_profiles, 'pendingWorkspaces', v_pending_workspaces);
end;
$$;

revoke all on function public.run_retention_maintenance(integer) from public, anon, authenticated, service_role;
grant execute on function public.run_retention_maintenance(integer) to service_role;

-- ---------------------------------------------------------------------------------------------
-- Account erasure (platform administrator only), in two steps
-- ---------------------------------------------------------------------------------------------
--
-- Between the two steps the application server removes what the database cannot: the cached
-- public pages, the hostnames attached at the hosting provider and the image files in the bucket.
-- Both steps are idempotent and re-check everything, so an interrupted erasure is simply run again.

-- Workspaces that end with this person: the ones they own. A workspace they only work in keeps
-- its content; their membership leaves with the auth.users row.
create function private.erasure_owned_workspaces(p_user_id uuid)
returns uuid[] language sql stable security definer set search_path = ''
as $$
  select coalesce(array_agg(m.workspace_id), '{}'::uuid[])
  from public.workspace_memberships m
  where m.user_id = p_user_id and m.role = 'owner' and m.status = 'active';
$$;

-- What stops an erasure, raised with its own code so the operator knows what to resolve first.
create function private.erasure_check(p_request_id uuid)
returns public.privacy_requests language plpgsql security definer set search_path = ''
as $$
declare
  v_request public.privacy_requests;
  v_owned uuid[];
begin
  if not private.is_platform_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into v_request from public.privacy_requests where id = p_request_id for update;
  if not found then raise exception 'not found' using errcode = 'P0002'; end if;
  -- "processing" is the operator's statement that identity and scope were checked.
  if v_request.kind <> 'account_deletion' or v_request.status <> 'processing' then
    raise exception 'request is not an account deletion in processing' using errcode = 'LK122';
  end if;
  v_owned := private.erasure_owned_workspaces(v_request.user_id);
  if exists (select 1 from public.billing_subscriptions s where s.workspace_id = any (v_owned) and s.status <> 'ended') then
    raise exception 'a subscription is still running' using errcode = 'LK123';
  end if;
  if exists (
    select 1 from public.workspace_memberships m
    where m.workspace_id = any (v_owned) and m.user_id <> v_request.user_id and m.status = 'active'
  ) then
    raise exception 'an owned workspace has other members' using errcode = 'LK124';
  end if;
  return v_request;
end;
$$;

-- Step 1: everything the person owns goes off the air and is marked for immediate purge, which
-- is what makes the media job claim its image files. Returns what the server must clean outside
-- the database. Nothing is removed yet.
create function public.begin_account_erasure(p_request_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_request public.privacy_requests := private.erasure_check(p_request_id);
  v_owned uuid[] := private.erasure_owned_workspaces(v_request.user_id);
  v_slugs text[];
  v_hostnames text[];
  v_due timestamptz := now() - interval '1 second';
begin
  select coalesce(array_agg(p.slug), '{}'::text[]) into v_slugs
  from public.profiles p where p.workspace_id = any (v_owned) and p.deleted_at is null;
  select coalesce(array_agg(distinct d.hostname), '{}'::text[]) into v_hostnames
  from public.profile_domains d where d.workspace_id = any (v_owned);

  -- The addresses stay on hold like any deleted page's, so nobody can take them over at once.
  insert into public.slug_history (slug, profile_id, workspace_id, reason, released_by, hold_until)
  select p.slug, p.id, p.workspace_id, 'deleted', (select auth.uid()), now() + private.slug_hold_period()
  from public.profiles p where p.workspace_id = any (v_owned) and p.deleted_at is null;

  update public.profiles p set deleted_at = coalesce(p.deleted_at, v_due), purge_after = v_due
  where p.workspace_id = any (v_owned) and (p.purge_after is null or p.purge_after > v_due);
  -- A personal workspace is never soft-deleted (workspaces_personal_not_deleted): it has no other
  -- member to hide it from, and its pages are already off the air. It is removed in step 2.
  update public.workspaces w set deleted_at = coalesce(w.deleted_at, v_due), purge_after = v_due
  where w.id = any (v_owned) and w.kind <> 'personal' and (w.purge_after is null or w.purge_after > v_due);

  perform private.write_audit_event(null, 'privacy.erasure_started', 'user', v_request.user_id,
    jsonb_build_object('requestId', p_request_id, 'workspaces', cardinality(v_owned)));
  return jsonb_build_object('userId', v_request.user_id, 'workspaces', cardinality(v_owned),
    'slugs', to_jsonb(v_slugs), 'hostnames', to_jsonb(v_hostnames),
    'mediaPending', (select count(*) from public.media_assets m where m.workspace_id = any (v_owned)));
end;
$$;

-- Step 2: removes the rows and the account, and closes the request, in one transaction. Refuses
-- while an image file of the person's workspaces is still in the bucket.
--
-- What stays, on purpose (docs/DATA_MAP.md): the privacy request itself and its history (proof
-- that it was fulfilled, no e-mail in them), the audit trail and the address holds, where the
-- person is only an identifier that no longer resolves to anyone, for their retention periods.
create function public.finish_account_erasure(p_request_id uuid, p_evidence_reference text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_request public.privacy_requests := private.erasure_check(p_request_id);
  v_owned uuid[] := private.erasure_owned_workspaces(v_request.user_id);
  v_email text;
  v_workspaces integer;
  v_invitations integer := 0;
  v_waitlist integer := 0;
  v_account integer;
begin
  if char_length(coalesce(p_evidence_reference, '')) not between 4 and 120 then
    raise exception 'completion needs evidence' using errcode = '22023';
  end if;
  if exists (select 1 from public.media_assets m where m.workspace_id = any (v_owned)) then
    raise exception 'image files are still being removed' using errcode = 'LK125';
  end if;
  -- Step 1 must have run, and nothing was created since: a page that is still live is never removed here.
  if exists (select 1 from public.profiles p where p.workspace_id = any (v_owned) and (p.purge_after is null or p.purge_after > now())) then
    raise exception 'request is not an account deletion in processing' using errcode = 'LK122';
  end if;

  select lower(u.email) into v_email from auth.users u where u.id = v_request.user_id;

  -- Cascades: memberships, pages, publications, leads, results, report links, invitations sent,
  -- domains, pixels and the billing rows of each workspace.
  delete from public.workspaces w where w.id = any (v_owned);
  get diagnostics v_workspaces = row_count;

  if v_email is not null then
    delete from public.workspace_invitations i where i.email = v_email;
    get diagnostics v_invitations = row_count;
    delete from public.waitlist_signups s where lower(s.email) = v_email;
    get diagnostics v_waitlist = row_count;
  end if;

  -- Cascades: user_accounts, memberships in other people's workspaces, legal acceptances, the
  -- platform administrator row, and the sessions and identities kept by Auth.
  delete from auth.users u where u.id = v_request.user_id;
  get diagnostics v_account = row_count;

  update public.privacy_requests set status = 'completed', reason_code = 'fulfilled',
    evidence_reference = p_evidence_reference, reviewed_by = (select auth.uid()), reviewed_at = now()
    where id = p_request_id;
  insert into public.privacy_request_events (request_id, actor_user_id, from_status, to_status, reason_code)
    values (p_request_id, (select auth.uid()), v_request.status, 'completed', 'fulfilled');
  perform private.write_audit_event(null, 'privacy.account_erased', 'user', v_request.user_id,
    jsonb_build_object('requestId', p_request_id, 'workspaces', v_workspaces,
                       'invitations', v_invitations, 'waitlist', v_waitlist, 'account', v_account));
  return jsonb_build_object('workspaces', v_workspaces, 'invitations', v_invitations,
    'waitlist', v_waitlist, 'account', v_account);
end;
$$;

revoke all on function
  private.moderation_report_retention(),
  private.privacy_request_retention(),
  private.audit_retention(),
  private.slug_history_retention(),
  private.erasure_owned_workspaces(uuid),
  private.erasure_check(uuid)
from public, anon, authenticated, service_role;
revoke all on function
  public.begin_account_erasure(uuid),
  public.finish_account_erasure(uuid, text)
from public, anon, authenticated, service_role;
-- Like the rest of the privacy queue: reachable with a session, and the function itself refuses
-- everyone who is not a platform administrator.
grant execute on function
  public.begin_account_erasure(uuid),
  public.finish_account_erasure(uuid, text)
to authenticated;
