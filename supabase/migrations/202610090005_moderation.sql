-- Sprint 9: public abuse reports and per-page moderation. No admin is provisioned by this migration.
alter table public.profiles add column moderation_status text not null default 'active'
  check (moderation_status in ('active', 'suspended'));
create index profiles_moderation_status_idx on public.profiles (moderation_status) where moderation_status = 'suspended';

alter table public.audit_events drop constraint audit_events_target_type_check;
alter table public.audit_events add constraint audit_events_target_type_check
  check (target_type in ('user', 'workspace', 'membership', 'profile', 'invitation',
                         'report_link', 'subscription', 'moderation_report'));

create table public.moderation_reports (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null,
  workspace_id uuid not null,
  slug text not null check (char_length(slug) between 3 and 30),
  reason text not null check (reason in ('phishing', 'impersonation', 'illegal', 'spam', 'privacy', 'other')),
  detail text check (detail is null or char_length(detail) between 10 and 500),
  reporter_hash text not null check (reporter_hash ~ '^([0-9a-f]{32}|direct)$'),
  reported_day date not null default ((now() at time zone 'UTC')::date),
  status text not null default 'new' check (status in ('new', 'in_review', 'dismissed', 'actioned')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users (id) on delete set null,
  review_reason text check (review_reason is null or char_length(review_reason) between 10 and 500),
  unique (profile_id, reporter_hash, reason, reported_day)
);
create index moderation_reports_status_created_idx on public.moderation_reports (status, created_at);
create index moderation_reports_hash_created_idx on public.moderation_reports (reporter_hash, created_at desc);
create index moderation_reports_profile_day_idx on public.moderation_reports (profile_id, reported_day);
create index moderation_reports_workspace_idx on public.moderation_reports (workspace_id, created_at desc);

alter table public.moderation_reports enable row level security;
revoke all on public.moderation_reports from public, anon, authenticated, service_role;
-- No client role reads this table: the queue is served only by list_moderation_reports().

create function private.moderation_signing_secret()
returns text language sql stable security definer set search_path = ''
as $$ select s.decrypted_secret from vault.decrypted_secrets s
       where s.name = 'moderation_signing_secret' limit 1 $$;

create function private.moderation_signature_is_valid(p_text text, p_signature text)
returns boolean language plpgsql stable security definer set search_path = ''
as $$
declare
  v_secret text := private.moderation_signing_secret();
  v_expected text;
begin
  if v_secret is null or char_length(v_secret) < 32 then return null; end if;
  if p_text is null or p_signature is null or p_signature !~ '^[0-9a-f]{64}$' then return false; end if;
  v_expected := encode(extensions.hmac(convert_to(p_text, 'UTF8'),
    convert_to(v_secret, 'UTF8'), 'sha256'), 'hex');
  return extensions.digest(convert_to(v_expected, 'UTF8'), 'sha256')
       = extensions.digest(convert_to(p_signature, 'UTF8'), 'sha256');
end;
$$;

-- The server signs the exact JSON string after validating the form. Direct calls with only the
-- publishable key cannot forge the address hash or bypass the input checks.
create function public.submit_moderation_report(p_text text, p_signature text)
returns text language plpgsql security definer set search_path = ''
as $$
declare
  v_valid boolean;
  v_data jsonb;
  v_slug text;
  v_reason text;
  v_detail text;
  v_hash text;
  v_at timestamptz;
  v_profile public.profiles;
  v_report_id uuid;
begin
  if p_text is null or octet_length(p_text) > 1400 then return 'invalid'; end if;
  v_valid := private.moderation_signature_is_valid(p_text, p_signature);
  if v_valid is null then return 'not_configured'; end if;
  if not v_valid then return 'invalid'; end if;
  begin v_data := p_text::jsonb; exception when others then return 'invalid'; end;
  if jsonb_typeof(v_data) <> 'object'
    or (select array_agg(k order by k) from jsonb_object_keys(v_data) k)
       <> array['at','detail','hash','reason','slug','v']::text[] then return 'invalid'; end if;
  if v_data ->> 'v' <> '1' then return 'invalid'; end if;
  v_slug := v_data ->> 'slug';
  v_reason := v_data ->> 'reason';
  v_detail := nullif(btrim(v_data ->> 'detail'), '');
  v_hash := v_data ->> 'hash';
  if v_slug is null or v_slug !~ '^[a-z0-9][a-z0-9-]{2,29}$'
    or v_reason is null or v_reason not in ('phishing', 'impersonation', 'illegal', 'spam', 'privacy', 'other')
    or (v_detail is not null and (char_length(v_detail) not between 10 and 500 or v_detail ~ '[[:cntrl:]]'))
    or v_hash is null or v_hash !~ '^([0-9a-f]{32}|direct)$' then return 'invalid'; end if;
  begin v_at := (v_data ->> 'at')::timestamptz; exception when others then return 'invalid'; end;
  if v_at is null or v_at < now() - interval '5 minutes' or v_at > now() + interval '5 minutes'
    then return 'invalid'; end if;
  select p.* into v_profile from public.profiles p
    join public.workspaces w on w.id = p.workspace_id
    where p.slug = v_slug and p.deleted_at is null and w.deleted_at is null;
  if not found then return 'received'; end if; -- neutral response: no address enumeration
  if (select count(*) from public.moderation_reports r
      where r.reporter_hash = v_hash and r.created_at > now() - interval '24 hours') >= 3 then
    return 'received';
  end if;
  if (select count(*) from public.moderation_reports r
      where r.profile_id = v_profile.id and r.created_at > now() - interval '24 hours') >= 30 then
    return 'received';
  end if;
  insert into public.moderation_reports (profile_id, workspace_id, slug, reason, detail, reporter_hash)
    values (v_profile.id, v_profile.workspace_id, v_slug, v_reason, v_detail, v_hash)
    on conflict (profile_id, reporter_hash, reason, reported_day) do nothing
    returning id into v_report_id;
  if v_report_id is not null then
    perform private.write_audit_event(v_profile.workspace_id, 'moderation.reported',
      'moderation_report', v_report_id, jsonb_build_object('reason', v_reason));
  end if;
  return 'received';
end;
$$;

create function public.review_moderation_report(
  p_report_id uuid, p_status text, p_reason text
)
returns text language plpgsql security definer set search_path = ''
as $$
declare
  v_report public.moderation_reports;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if not private.is_platform_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_status not in ('in_review', 'dismissed', 'actioned') or char_length(v_reason) not between 10 and 500 then
    raise exception 'invalid review' using errcode = '22023';
  end if;
  select * into v_report from public.moderation_reports where id = p_report_id for update;
  if not found then raise exception 'report not found' using errcode = 'P0002'; end if;
  if v_report.status in ('dismissed', 'actioned') then
    if v_report.status = p_status then return p_status; end if;
    raise exception 'terminal report' using errcode = 'LK112';
  end if;
  if v_report.status = p_status and v_report.review_reason = v_reason then return p_status; end if;
  update public.moderation_reports set status = p_status, reviewed_at = now(),
    reviewed_by = (select auth.uid()), review_reason = v_reason where id = p_report_id;
  perform private.write_audit_event(v_report.workspace_id, 'moderation.reviewed',
    'moderation_report', p_report_id,
    jsonb_build_object('from', v_report.status, 'to', p_status, 'reason', v_reason));
  return p_status;
end;
$$;

create function public.set_profile_moderation(
  p_profile_id uuid, p_suspend boolean, p_reason text, p_report_id uuid default null
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_profile public.profiles;
  v_target text := case when p_suspend then 'suspended' else 'active' end;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if not private.is_platform_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_suspend is null or char_length(v_reason) not between 10 and 500 then
    raise exception 'reason required' using errcode = '22023';
  end if;
  select * into v_profile from public.profiles where id = p_profile_id and deleted_at is null for update;
  if not found then raise exception 'profile not found' using errcode = 'P0002'; end if;
  if p_report_id is not null and not exists
    (select 1 from public.moderation_reports r where r.id = p_report_id and r.profile_id = p_profile_id) then
    raise exception 'report mismatch' using errcode = 'P0002';
  end if;
  if v_profile.moderation_status = v_target then return jsonb_build_object('status', v_target, 'slug', v_profile.slug); end if;
  update public.profiles set moderation_status = v_target where id = p_profile_id;
  perform private.write_audit_event(v_profile.workspace_id,
    case when p_suspend then 'moderation.suspended'::public.audit_action
         else 'moderation.reactivated'::public.audit_action end,
    'profile', p_profile_id, jsonb_build_object('reason', v_reason, 'reportId', p_report_id));
  return jsonb_build_object('status', v_target, 'slug', v_profile.slug);
end;
$$;

-- A suspended page cannot replace or restore the live snapshot, even if the owner calls the RPC
-- directly. Draft edits may continue for remediation. Its previously live snapshot is retained.
create or replace function private.lock_profile_for_publishing(p_profile_id uuid)
returns public.profiles language plpgsql security definer set search_path = ''
as $$
declare
  v_profile public.profiles;
  v_role public.workspace_role;
begin
  if (select auth.uid()) is null then raise exception 'authentication required' using errcode = '42501'; end if;
  select p.* into v_profile from public.profiles p where p.id = p_profile_id and p.deleted_at is null for update;
  if not found then raise exception 'profile not found' using errcode = 'P0002'; end if;
  v_role := private.workspace_role(v_profile.workspace_id);
  if v_role is null then raise exception 'profile not found' using errcode = 'P0002'; end if;
  if not private.workspace_is_writable(v_profile.workspace_id) then
    raise exception 'workspace does not accept changes' using errcode = '42501'; end if;
  if v_profile.moderation_status = 'suspended' then
    raise exception 'page suspended' using errcode = 'LK113'; end if;
  if v_role not in ('owner', 'admin', 'editor') then
    raise exception 'role cannot publish' using errcode = '42501'; end if;
  if v_profile.status = 'archived' then
    raise exception 'page is archived' using errcode = 'LK070'; end if;
  return v_profile;
end;
$$;

create or replace function public.get_public_page(p_slug text)
returns table (
  state text, canonical_slug text, document jsonb, version integer,
  published_at timestamptz, show_badge boolean
)
language plpgsql stable security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  v_slug text := private.normalize_slug(coalesce(p_slug, ''));
  v_profile public.profiles;
  v_workspace_status public.workspace_status;
begin
  state := 'not_found';
  if not private.slug_is_well_formed(v_slug) then return next; return; end if;
  select p.* into v_profile from public.profiles p
    join public.workspaces w on w.id = p.workspace_id
    where p.slug = v_slug and p.deleted_at is null and w.deleted_at is null;
  if v_profile.id is not null then
    select w.status into v_workspace_status from public.workspaces w where w.id = v_profile.workspace_id;
    canonical_slug := v_slug;
    if v_workspace_status = 'suspended' or v_profile.moderation_status = 'suspended' then
      state := 'suspended';
    elsif v_profile.live_publication_id is null then
      state := 'unpublished';
    else
      select pp.document, pp.version into document, version
        from public.profile_publications pp where pp.id = v_profile.live_publication_id;
      state := 'published';
      published_at := v_profile.published_at;
      show_badge := not coalesce(private.entitlement_bool(v_profile.workspace_id, 'remove_badge'), false);
    end if;
    return next; return;
  end if;
  select p.slug into canonical_slug from public.slug_history h
    join public.profiles p on p.id = h.profile_id
    join public.workspaces w on w.id = p.workspace_id
    where h.slug = v_slug and h.reason = 'changed' and h.hold_until > now()
      and p.deleted_at is null and p.live_publication_id is not null
      and p.moderation_status = 'active' and w.deleted_at is null and w.status = 'active'
    order by h.released_at desc limit 1;
  if canonical_slug is not null then state := 'moved'; end if;
  return next;
end;
$$;

revoke all on function
  public.submit_moderation_report(text, text),
  public.review_moderation_report(uuid, text, text),
  public.set_profile_moderation(uuid, boolean, text, uuid)
from public, anon, authenticated, service_role;
grant execute on function public.submit_moderation_report(text, text) to anon, authenticated;
grant execute on function
  public.review_moderation_report(uuid, text, text),
  public.set_profile_moderation(uuid, boolean, text, uuid)
to authenticated;

create function public.list_moderation_reports()
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
begin
  if not private.is_platform_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
    'id', r.id, 'profileId', r.profile_id, 'workspaceId', r.workspace_id,
    'slug', r.slug, 'reason', r.reason, 'detail', r.detail,
    'status', r.status, 'createdAt', r.created_at, 'reviewedAt', r.reviewed_at,
    'reviewReason', r.review_reason, 'moderationStatus', p.moderation_status)
    order by r.created_at desc)
    from (select * from public.moderation_reports
      order by created_at desc limit 100) r
    left join public.profiles p on p.id = r.profile_id), '[]'::jsonb);
end;
$$;
revoke all on function public.list_moderation_reports() from public, anon, authenticated, service_role;
grant execute on function public.list_moderation_reports() to authenticated;

insert into public.reserved_slugs (slug, reason)
values
  ('aceite', 'route'),
  ('denunciar', 'route'),
  ('cookies', 'route')
on conflict (slug) do nothing;

revoke all on function private.moderation_signing_secret() from public, anon, authenticated;
revoke all on function private.moderation_signature_is_valid(text, text) from public, anon, authenticated;
