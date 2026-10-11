-- Sprints 8 and 9 gaps: the workspace export reaches custom domains, pixels, suspensions and
-- appeals, and active custom domains are verified again every day.
--
-- Forward-only. Part 1 replaces one function with the same contract plus four keys. Part 2 adds
-- two columns with defaults, functions and a trigger; an application one version behind neither
-- reads the columns nor calls the functions.

-- ---------------------------------------------------------------------------------------------
-- Part 1: owner-only workspace export, with the stores added after it was written
-- ---------------------------------------------------------------------------------------------
--
-- Same function as in 202610090004 plus: domains (without the challenge, which is only useful to
-- prove control), pixels, moderationSuspensions and moderationAppeals (the owner's own text and the
-- answer written for them; never the administrator's internal justification, which is not stored
-- in these tables). The format version stays 1: keys were only added.
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
-- Part 2: scheduled re-verification of active custom domains (ADR 0016, addendum)
-- ---------------------------------------------------------------------------------------------
--
-- Until now an active domain was never looked at again: a page kept answering on a hostname whose
-- owner had removed the proof, sold the domain or let it expire, until somebody else proved it.
-- The daily job reads the proof again; after seven consecutive days without it the domain lapses.
-- A day on which DNS could not be asked counts for nothing, in either direction.

alter table public.profile_domains
  add column recheck_misses smallint not null default 0 check (recheck_misses between 0 and 1000),
  add column lapse_reason text check (lapse_reason is null or lapse_reason = 'recheck');

comment on column public.profile_domains.recheck_misses is
  'Consecutive daily re-verifications that did not find the challenge in DNS. Reset when it is found and when the domain becomes active again.';
comment on column public.profile_domains.lapse_reason is
  'recheck: the proof was absent for private.domain_recheck_limit() consecutive days. Null for a domain that lapsed because another page proved the hostname.';

create function private.domain_recheck_limit()
returns integer language sql immutable set search_path = ''
as $$ select 7 $$;

-- A domain that becomes active again starts clean, whichever function activated it.
create function private.reset_domain_recheck()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if new.status = 'active' and old.status is distinct from 'active' then
    new.recheck_misses := 0;
    new.lapse_reason := null;
  end if;
  return new;
end;
$$;
create trigger profile_domains_reset_recheck before update on public.profile_domains
for each row execute function private.reset_domain_recheck();

-- Work list of the job (service role only): active domains not looked at for most of a day.
create function public.list_domains_for_recheck(p_limit integer default 200)
returns table (domain_id uuid, hostname text, challenge text)
language sql stable security definer set search_path = ''
as $$
  select d.id, d.hostname, d.challenge
  from public.profile_domains d
  where d.status = 'active' and (d.last_checked_at is null or d.last_checked_at < now() - interval '20 hours')
  order by d.last_checked_at nulls first
  limit greatest(1, least(coalesce(p_limit, 200), 500));
$$;

-- Records one re-verification. Like the confirmation, the database only believes a DNS fact the
-- application server signed (same secret). The payload has a key set of its own (`kind`), so a
-- confirmation can never be replayed here, nor a re-verification as a confirmation.
create function public.record_domain_recheck(p_text text, p_signature text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_valid boolean := private.domains_signature_is_valid(p_text, p_signature);
  v_data jsonb;
  v_at numeric;
  v_domain public.profile_domains;
  v_misses integer;
  v_slug text;
begin
  if v_valid is null then return jsonb_build_object('status', 'not_configured'); end if;
  if not v_valid then return jsonb_build_object('status', 'invalid'); end if;
  begin
    v_data := p_text::jsonb;
  exception when others then
    return jsonb_build_object('status', 'invalid');
  end;
  if jsonb_typeof(v_data) <> 'object'
    or (select array_agg(k order by k) from jsonb_object_keys(v_data) k) <> array['at', 'domainId', 'found', 'hostname', 'kind', 'v']::text[]
    or v_data ->> 'v' <> '1' or v_data ->> 'kind' <> 'recheck'
    or jsonb_typeof(v_data -> 'at') <> 'number' or jsonb_typeof(v_data -> 'found') <> 'boolean'
    or (v_data ->> 'domainId') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return jsonb_build_object('status', 'invalid');
  end if;
  v_at := (v_data ->> 'at')::numeric;
  if v_at < extract(epoch from now()) - 300 or v_at > extract(epoch from now()) + 60 then
    return jsonb_build_object('status', 'invalid');
  end if;

  select d.* into v_domain from public.profile_domains d where d.id = (v_data ->> 'domainId')::uuid for update;
  if not found or v_domain.hostname <> (v_data ->> 'hostname') then return jsonb_build_object('status', 'not_found'); end if;
  -- Removed, lapsed or verified again by its owner since the job listed it: nothing to record.
  if v_domain.status <> 'active' then return jsonb_build_object('status', 'skipped'); end if;

  if (v_data ->> 'found')::boolean then
    update public.profile_domains set recheck_misses = 0, last_checked_at = now() where id = v_domain.id;
    return jsonb_build_object('status', 'ok');
  end if;

  v_misses := v_domain.recheck_misses + 1;
  if v_misses < private.domain_recheck_limit() then
    update public.profile_domains set recheck_misses = v_misses, last_checked_at = now() where id = v_domain.id;
    return jsonb_build_object('status', 'missing', 'misses', v_misses);
  end if;

  update public.profile_domains
  set status = 'lapsed', lapsed_at = now(), routing = 'unknown', recheck_misses = v_misses, lapse_reason = 'recheck', last_checked_at = now()
  where id = v_domain.id;
  perform private.write_audit_event(v_domain.workspace_id, 'domain.lapsed', 'domain', v_domain.id,
    jsonb_build_object('profileId', v_domain.profile_id, 'hostname', v_domain.hostname, 'reason', 'recheck'));
  select p.slug into v_slug from public.profiles p where p.id = v_domain.profile_id;
  return jsonb_build_object('status', 'lapsed', 'slug', v_slug, 'hostname', v_domain.hostname);
end;
$$;

revoke all on function private.domain_recheck_limit(), private.reset_domain_recheck() from public, anon, authenticated, service_role;
revoke all on function public.list_domains_for_recheck(integer), public.record_domain_recheck(text, text) from public, anon, authenticated, service_role;
grant execute on function public.list_domains_for_recheck(integer), public.record_domain_recheck(text, text) to service_role;

-- The new job has a heartbeat like the others (ADR 0019).
alter table public.job_runs drop constraint job_runs_job_check;
alter table public.job_runs add constraint job_runs_job_check check (job in ('media-cleanup', 'analytics', 'billing', 'retention', 'domains'));
insert into public.job_runs (job, last_run_at, last_outcome, last_ok_at) values ('domains', now(), 'baseline', now());
