-- Sprint 9: legal acceptance and data-subject request surface. Draft documents are never activated
-- by this migration. A reviewed text must be inserted and activated by a later approved migration.
-- convert_to() is only STABLE, so a generated column cannot call it directly. With the encoding
-- fixed to UTF8 the result depends on the text alone, which is what IMMUTABLE asserts here.
create function private.text_sha256(p_text text)
returns text language sql immutable strict set search_path = ''
as $$ select encode(sha256(convert_to(p_text, 'UTF8')), 'hex') $$;

create table public.legal_documents (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('terms', 'privacy', 'cookies')),
  version text not null check (version ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}(-[a-z0-9]+)?$'),
  body text not null check (char_length(body) between 100 and 65536),
  body_sha256 text generated always as (private.text_sha256(body)) stored,
  status text not null default 'draft' check (status in ('draft', 'active', 'retired')),
  created_at timestamptz not null default now(),
  activated_at timestamptz,
  unique (kind, version),
  constraint legal_documents_active_date check (status <> 'active' or activated_at is not null)
);
create unique index legal_documents_one_active_kind on public.legal_documents (kind) where status = 'active';
create index legal_documents_kind_status_idx on public.legal_documents (kind, status);

-- Once offered for acceptance, the exact text and its identity are immutable. Only retirement is allowed.
create function private.protect_legal_document()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if old.status <> 'draft' and (new.body is distinct from old.body
      or new.kind is distinct from old.kind or new.version is distinct from old.version
      or new.status = 'draft' or new.activated_at is distinct from old.activated_at) then
    raise exception 'activated legal document is immutable' using errcode = 'LK115';
  end if;
  return new;
end;
$$;
create trigger legal_documents_immutable_before_update before update on public.legal_documents
for each row execute function private.protect_legal_document();
create table public.legal_acceptances (
  user_id uuid not null references auth.users (id) on delete cascade,
  document_id uuid not null references public.legal_documents (id) on delete restrict,
  document_sha256 text not null check (document_sha256 ~ '^[0-9a-f]{64}$'),
  accepted_at timestamptz not null default now(),
  primary key (user_id, document_id)
);
create index legal_acceptances_document_idx on public.legal_acceptances (document_id);

alter table public.legal_documents enable row level security;
alter table public.legal_acceptances enable row level security;
revoke all on public.legal_documents, public.legal_acceptances from public, anon, authenticated, service_role;
-- Anonymous visitors read the active text through get_legal_status(); anon holds no table grant.
grant select on public.legal_documents to authenticated;
create policy legal_documents_active_read on public.legal_documents
for select to authenticated using (status = 'active');
grant select on public.legal_acceptances to authenticated;
create policy legal_acceptances_own_read on public.legal_acceptances
for select to authenticated using (user_id = (select auth.uid()));

create function public.accept_current_legal(
  p_terms_id uuid, p_terms_hash text, p_privacy_id uuid, p_privacy_hash text
)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_terms public.legal_documents;
  v_privacy public.legal_documents;
  v_count integer := 0;
begin
  if v_uid is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if not exists (select 1 from public.user_accounts a where a.id = v_uid and a.deleted_at is null) then
    raise exception 'account is not available' using errcode = '42501';
  end if;
  select * into v_terms from public.legal_documents where id = p_terms_id and kind = 'terms' and status = 'active';
  select * into v_privacy from public.legal_documents where id = p_privacy_id and kind = 'privacy' and status = 'active';
  if v_terms.id is null or v_privacy.id is null or v_terms.body_sha256 is distinct from p_terms_hash
     or v_privacy.body_sha256 is distinct from p_privacy_hash then
    raise exception 'document changed' using errcode = 'LK110';
  end if;
  insert into public.legal_acceptances (user_id, document_id, document_sha256)
    values (v_uid, v_terms.id, v_terms.body_sha256), (v_uid, v_privacy.id, v_privacy.body_sha256)
    on conflict do nothing;
  get diagnostics v_count = row_count;
  if v_count > 0 then
    perform private.write_audit_event(null, 'legal.accepted', 'user', v_uid,
      jsonb_build_object('termsVersion', v_terms.version, 'privacyVersion', v_privacy.version,
                         'termsHash', v_terms.body_sha256, 'privacyHash', v_privacy.body_sha256));
  end if;
  return v_count > 0;
end;
$$;

-- Platform administrators are provisioned by an operator after identity verification. No
-- browser role can enumerate or grant this role.
create table public.platform_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.platform_admins enable row level security;
revoke all on public.platform_admins from public, anon, authenticated, service_role;
create function private.is_platform_admin()
returns boolean language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.platform_admins where user_id = (select auth.uid())) $$;

create table public.privacy_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  kind text not null check (kind in ('account_deletion', 'data_access')),
  status text not null check (status in ('received', 'needs_action', 'processing', 'completed', 'rejected')),
  reason_code text check (reason_code in ('active_subscription', 'shared_workspace', 'manual_review', 'fulfilled', 'cannot_verify')),
  evidence_reference text check (evidence_reference is null or char_length(evidence_reference) between 4 and 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  reviewed_by uuid references auth.users (id) on delete set null,
  reviewed_at timestamptz
);
create unique index privacy_requests_one_open_per_kind on public.privacy_requests (user_id, kind)
  where status in ('received', 'needs_action', 'processing');
create index privacy_requests_status_created_idx on public.privacy_requests (status, created_at);
create index privacy_requests_user_created_idx on public.privacy_requests (user_id, created_at desc);
create trigger privacy_requests_set_updated_at before update on public.privacy_requests
for each row execute function private.set_updated_at();

create table public.privacy_request_events (
  id bigint generated always as identity primary key,
  request_id uuid not null references public.privacy_requests (id) on delete restrict,
  actor_user_id uuid,
  from_status text,
  to_status text not null,
  reason_code text,
  created_at timestamptz not null default now()
);
create index privacy_request_events_request_idx on public.privacy_request_events (request_id, created_at);
create function private.prevent_privacy_event_mutation()
returns trigger language plpgsql set search_path = ''
as $$ begin raise exception 'privacy request history is append-only' using errcode = '42501'; end $$;
create trigger privacy_request_events_append_only before update or delete on public.privacy_request_events
for each row execute function private.prevent_privacy_event_mutation();

alter table public.privacy_requests enable row level security;
alter table public.privacy_request_events enable row level security;
revoke all on public.privacy_requests, public.privacy_request_events from public, anon, authenticated, service_role;
grant select on public.privacy_requests, public.privacy_request_events to authenticated;
-- Direct reads are limited to the person's own requests. The platform queue is served only by
-- list_privacy_requests(), so no client role needs to execute private.is_platform_admin().
create policy privacy_requests_own_read on public.privacy_requests
for select to authenticated using (user_id = (select auth.uid()));
create policy privacy_request_events_own_read on public.privacy_request_events
for select to authenticated using (exists (
  select 1 from public.privacy_requests r where r.id = request_id and r.user_id = (select auth.uid())
));

create function public.request_account_deletion()
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_existing public.privacy_requests;
  v_reason text;
  v_status text;
begin
  if v_uid is null then raise exception 'authentication required' using errcode = '42501'; end if;
  perform 1 from public.user_accounts where id = v_uid and deleted_at is null for update;
  if not found then raise exception 'account not available' using errcode = '42501'; end if;
  select * into v_existing from public.privacy_requests
    where user_id = v_uid and kind = 'account_deletion'
      and status in ('received', 'needs_action', 'processing') order by created_at desc limit 1;
  if v_existing.id is not null then
    return jsonb_build_object('id', v_existing.id, 'status', v_existing.status, 'reason', v_existing.reason_code);
  end if;
  if exists (
    select 1 from public.workspace_memberships m
    join public.billing_subscriptions s on s.workspace_id = m.workspace_id
    where m.user_id = v_uid and m.role = 'owner' and m.status = 'active' and s.status <> 'ended'
  ) then
    v_reason := 'active_subscription';
  elsif exists (
    select 1 from public.workspace_memberships m
    join public.workspace_memberships other on other.workspace_id = m.workspace_id
      and other.user_id <> v_uid and other.status = 'active'
    where m.user_id = v_uid and m.role = 'owner' and m.status = 'active'
  ) then
    v_reason := 'shared_workspace';
  else
    v_reason := 'manual_review';
  end if;
  v_status := case when v_reason = 'manual_review' then 'received' else 'needs_action' end;
  insert into public.privacy_requests (user_id, kind, status, reason_code)
    values (v_uid, 'account_deletion', v_status, v_reason) returning * into v_existing;
  insert into public.privacy_request_events (request_id, actor_user_id, to_status, reason_code)
    values (v_existing.id, v_uid, v_status, v_reason);
  perform private.write_audit_event(null, 'privacy.deletion_requested', 'user', v_uid,
    jsonb_build_object('requestId', v_existing.id, 'state', v_status, 'reason', v_reason));
  return jsonb_build_object('id', v_existing.id, 'status', v_status, 'reason', v_reason);
end;
$$;

create function public.review_privacy_request(
  p_request_id uuid, p_status text, p_reason_code text, p_evidence_reference text default null
)
returns text language plpgsql security definer set search_path = ''
as $$
declare
  v_request public.privacy_requests;
begin
  if not private.is_platform_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_status is null or p_status not in ('needs_action', 'processing', 'completed', 'rejected')
    or p_reason_code is null or p_reason_code not in ('active_subscription', 'shared_workspace', 'manual_review', 'fulfilled', 'cannot_verify') then
    raise exception 'invalid state' using errcode = '22023';
  end if;
  if p_status = 'completed' and (p_reason_code <> 'fulfilled' or char_length(coalesce(p_evidence_reference, '')) < 4) then
    raise exception 'completion needs evidence' using errcode = '22023';
  end if;
  select * into v_request from public.privacy_requests where id = p_request_id for update;
  if not found then raise exception 'not found' using errcode = 'P0002'; end if;
  if p_status = 'completed' and v_request.kind = 'account_deletion'
    and exists (select 1 from auth.users u where u.id = v_request.user_id) then
    raise exception 'account still exists' using errcode = 'LK114';
  end if;
  if v_request.status in ('completed', 'rejected') then
    if v_request.status = p_status then return v_request.status; end if;
    raise exception 'terminal request' using errcode = 'LK111';
  end if;
  if v_request.status = p_status and v_request.reason_code = p_reason_code then return v_request.status; end if;
  update public.privacy_requests set status = p_status, reason_code = p_reason_code,
    evidence_reference = p_evidence_reference, reviewed_by = (select auth.uid()), reviewed_at = now()
    where id = p_request_id;
  insert into public.privacy_request_events (request_id, actor_user_id, from_status, to_status, reason_code)
    values (p_request_id, (select auth.uid()), v_request.status, p_status, p_reason_code);
  perform private.write_audit_event(null, 'privacy.request_reviewed', 'user', v_request.user_id,
    jsonb_build_object('requestId', p_request_id, 'from', v_request.status, 'to', p_status,
                       'reason', p_reason_code));
  return p_status;
end;
$$;

-- Self export never includes credentials, other members' records, visitor hashes or a workspace's
-- customer data. A separate owner-only export covers the tenant stores.
create function public.export_my_data()
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_email text;
  v_result jsonb;
begin
  if v_uid is null then raise exception 'authentication required' using errcode = '42501'; end if;
  select u.email into v_email from auth.users u where u.id = v_uid;
  if v_email is null then raise exception 'account not found' using errcode = 'P0002'; end if;
  select jsonb_build_object(
    'schemaVersion', 1, 'exportedAt', now(), 'scope', 'person',
    'auth', jsonb_build_object('id', u.id, 'email', u.email, 'emailConfirmedAt', u.email_confirmed_at,
                               'createdAt', u.created_at, 'lastSignInAt', u.last_sign_in_at),
    'account', (select to_jsonb(a) from public.user_accounts a where a.id = v_uid),
    'memberships', coalesce((select jsonb_agg(jsonb_build_object(
      'workspaceId', m.workspace_id, 'role', m.role, 'status', m.status, 'createdAt', m.created_at,
      'acceptedAt', m.accepted_at, 'revokedAt', m.revoked_at) order by m.created_at)
      from public.workspace_memberships m where m.user_id = v_uid), '[]'::jsonb),
    'invitations', coalesce((select jsonb_agg(jsonb_build_object(
      'workspaceId', i.workspace_id, 'email', i.email, 'role', i.role,
      'createdAt', i.created_at, 'expiresAt', i.expires_at, 'acceptedAt', i.accepted_at, 'revokedAt', i.revoked_at)
      order by i.created_at) from public.workspace_invitations i
      where i.email = lower(v_email) or i.invited_by = v_uid or i.accepted_by = v_uid), '[]'::jsonb),
    'acceptances', coalesce((select jsonb_agg(jsonb_build_object(
      'kind', d.kind, 'version', d.version, 'sha256', a.document_sha256, 'acceptedAt', a.accepted_at)
      order by a.accepted_at) from public.legal_acceptances a
      join public.legal_documents d on d.id = a.document_id where a.user_id = v_uid), '[]'::jsonb),
    'privacyRequests', coalesce((select jsonb_agg(jsonb_build_object(
      'id', r.id, 'kind', r.kind, 'status', r.status, 'reason', r.reason_code,
      'createdAt', r.created_at, 'reviewedAt', r.reviewed_at) order by r.created_at)
      from public.privacy_requests r where r.user_id = v_uid), '[]'::jsonb),
    'waitlist', coalesce((select jsonb_agg(to_jsonb(w) order by w.created_at)
      from public.waitlist_signups w where lower(w.email) = lower(v_email)), '[]'::jsonb),
    'audit', coalesce((select jsonb_agg(jsonb_build_object(
      'action', e.action, 'targetType', e.target_type, 'targetId', e.target_id,
      'metadata', e.metadata, 'createdAt', e.created_at) order by e.created_at)
      from public.audit_events e where e.actor_user_id = v_uid), '[]'::jsonb)
  ) into v_result from auth.users u where u.id = v_uid;
  perform private.write_audit_event(null, 'privacy.account_exported', 'user', v_uid,
    jsonb_build_object('format', 'json', 'schemaVersion', 1));
  return v_result;
end;
$$;

revoke all on function
  public.accept_current_legal(uuid, text, uuid, text),
  public.request_account_deletion(),
  public.review_privacy_request(uuid, text, text, text),
  public.export_my_data()
from public, anon, authenticated, service_role;
grant execute on function
  public.accept_current_legal(uuid, text, uuid, text),
  public.request_account_deletion(),
  public.review_privacy_request(uuid, text, text, text),
  public.export_my_data()
to authenticated;

-- Owner-only workspace export. This is an administrative data package for the controller of that
-- workspace; editors/admins cannot extract leads, invoices or the immutable publication history.
-- Raw analytics/anti-abuse hashes and report token hashes are deliberately omitted.
create function public.export_workspace_data(p_workspace_id uuid)
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

revoke all on function public.export_workspace_data(uuid) from public, anon, authenticated, service_role;
grant execute on function public.export_workspace_data(uuid) to authenticated;

create function public.get_legal_status()
returns jsonb language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'documents', coalesce((select jsonb_agg(jsonb_build_object(
      'id', d.id, 'kind', d.kind, 'version', d.version, 'body', d.body,
      'sha256', d.body_sha256, 'activatedAt', d.activated_at,
      'accepted', exists (select 1 from public.legal_acceptances a
        where a.user_id = (select auth.uid()) and a.document_id = d.id))
      order by d.kind) from public.legal_documents d where d.status = 'active'), '[]'::jsonb)
  )
$$;
revoke all on function public.get_legal_status() from public, anon, authenticated, service_role;
grant execute on function public.get_legal_status() to anon, authenticated;

create function public.get_my_privacy_requests()
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v_uid uuid := (select auth.uid());
begin
  if v_uid is null then raise exception 'authentication required' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
    'id', r.id, 'kind', r.kind, 'status', r.status, 'reason', r.reason_code,
    'createdAt', r.created_at, 'updatedAt', r.updated_at, 'reviewedAt', r.reviewed_at)
    order by r.created_at desc) from public.privacy_requests r where r.user_id = v_uid), '[]'::jsonb);
end;
$$;
revoke all on function public.get_my_privacy_requests() from public, anon, authenticated, service_role;
grant execute on function public.get_my_privacy_requests() to authenticated;

create function public.get_my_legal_history()
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v_uid uuid := (select auth.uid());
begin
  if v_uid is null then raise exception 'authentication required' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
    'kind', d.kind, 'version', d.version, 'sha256', a.document_sha256,
    'acceptedAt', a.accepted_at, 'status', d.status)
    order by a.accepted_at desc)
    from public.legal_acceptances a
    join public.legal_documents d on d.id = a.document_id
    where a.user_id = v_uid), '[]'::jsonb);
end;
$$;
revoke all on function public.get_my_legal_history() from public, anon, authenticated, service_role;
grant execute on function public.get_my_legal_history() to authenticated;

create function public.request_data_access()
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_request public.privacy_requests;
begin
  if v_uid is null then raise exception 'authentication required' using errcode = '42501'; end if;
  perform 1 from public.user_accounts where id = v_uid and deleted_at is null for update;
  if not found then raise exception 'account not available' using errcode = '42501'; end if;
  select * into v_request from public.privacy_requests
    where user_id = v_uid and kind = 'data_access'
      and status in ('received', 'needs_action', 'processing')
    order by created_at desc limit 1;
  if v_request.id is not null then return v_request.id; end if;
  insert into public.privacy_requests (user_id, kind, status, reason_code)
    values (v_uid, 'data_access', 'received', 'manual_review') returning * into v_request;
  insert into public.privacy_request_events (request_id, actor_user_id, to_status, reason_code)
    values (v_request.id, v_uid, 'received', 'manual_review');
  perform private.write_audit_event(null, 'privacy.data_access_requested', 'user', v_uid,
    jsonb_build_object('requestId', v_request.id));
  return v_request.id;
end;
$$;
revoke all on function public.request_data_access() from public, anon, authenticated, service_role;
grant execute on function public.request_data_access() to authenticated;

-- Minimal administrative queue; the public self-service surface never exposes other users' requests.
create function public.list_privacy_requests()
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
begin
  if not private.is_platform_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
    'id', r.id, 'userId', r.user_id, 'email', u.email, 'kind', r.kind,
    'status', r.status, 'reason', r.reason_code, 'evidenceReference', r.evidence_reference,
    'createdAt', r.created_at, 'updatedAt', r.updated_at, 'reviewedAt', r.reviewed_at)
    order by r.created_at desc)
    from (select * from public.privacy_requests order by created_at desc limit 100) r
    left join auth.users u on u.id = r.user_id), '[]'::jsonb);
end;
$$;
revoke all on function public.list_privacy_requests() from public, anon, authenticated, service_role;
grant execute on function public.list_privacy_requests() to authenticated;
revoke all on function
  private.is_platform_admin(),
  private.text_sha256(text),
  private.protect_legal_document(),
  private.prevent_privacy_event_mutation()
from public, anon, authenticated;
