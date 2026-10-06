-- Sprint 7, part 1: page list, archiving, duplication, invitations and the members read.
-- Design: docs/adr/0012-multi-page-operations-invitations-and-roles.md.
-- Forward-only and additive: the Sprint 6 application keeps working against this schema (it never
-- archives, duplicates or invites, and ignores the new column and tables).
-- SQLSTATEs (ADR 0004 contract, extended): LK070 the page is archived, LK081 the invited e-mail
-- already belongs to an active member, LK082 too many invitations, LK010 entitlement exceeded
-- (detail team_members or max_profiles), 22023 invalid e-mail or token hash, 42501 forbidden,
-- P0002 not found.
-- Mirrors: apps/web/src/modules/identity/{permissions,invitations}.ts, modules/profiles/*.

-- ---------------------------------------------------------------------------------------------
-- Audit: invitations are a new kind of target
-- ---------------------------------------------------------------------------------------------

alter table public.audit_events drop constraint audit_events_target_type_check;
alter table public.audit_events add constraint audit_events_target_type_check
  check (target_type in ('user', 'workspace', 'membership', 'profile', 'invitation'));

-- ---------------------------------------------------------------------------------------------
-- Page states: archived pages are off the air and frozen
-- ---------------------------------------------------------------------------------------------

alter table public.profiles
  -- Informational only (no foreign key): the page this one was copied from. Nothing is shared
  -- through it; the editor uses it to ask for a review before the first publication.
  add column duplicated_from uuid,
  -- status and the live snapshot always agree: published <=> a snapshot is on the air. In
  -- particular an archived page never has one.
  add constraint profiles_status_matches_publication
    check ((status = 'published') = (live_publication_id is not null));

comment on column public.profiles.duplicated_from is
  'Id of the page this draft was duplicated from (ADR 0012). Not a foreign key and never read for authorization; the copy shares no content with its source.';

-- The draft of an archived page is frozen: unarchive first. (Status itself changes only through
-- the RPCs below; members hold no grant on that column.)
drop policy profiles_update_member on public.profiles;
create policy profiles_update_member on public.profiles
for update to authenticated
using (
  deleted_at is null
  and status <> 'archived'
  and workspace_id in (select private.writable_workspace_ids(array['owner', 'admin', 'editor']::public.workspace_role[]))
)
with check (
  deleted_at is null
  and status <> 'archived'
  and workspace_id in (select private.writable_workspace_ids(array['owner', 'admin', 'editor']::public.workspace_role[]))
);

-- Publishing commands refuse an archived page (LK070): unarchiving and publishing are two
-- deliberate steps.
create or replace function private.lock_profile_for_publishing(p_profile_id uuid)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles;
  v_role public.workspace_role;
begin
  if (select auth.uid()) is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  select p.* into v_profile from public.profiles p where p.id = p_profile_id and p.deleted_at is null for update;
  if not found then
    raise exception 'profile not found' using errcode = 'P0002';
  end if;

  v_role := private.workspace_role(v_profile.workspace_id);
  if v_role is null then
    raise exception 'profile not found' using errcode = 'P0002';
  end if;
  if not private.workspace_is_writable(v_profile.workspace_id) then
    raise exception 'workspace does not accept changes' using errcode = '42501';
  end if;
  -- Matrix: profile.publish = owner, admin, editor (modules/identity/permissions.ts).
  if v_role not in ('owner', 'admin', 'editor') then
    raise exception 'role cannot publish' using errcode = '42501';
  end if;
  if v_profile.status = 'archived' then
    raise exception 'page is archived' using errcode = 'LK070';
  end if;
  return v_profile;
end;
$$;

-- Shared authorization for the owner/admin page commands below: returns the locked live page.
create function private.lock_profile_for_management(p_profile_id uuid)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles;
  v_role public.workspace_role;
begin
  if (select auth.uid()) is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  select p.* into v_profile from public.profiles p where p.id = p_profile_id and p.deleted_at is null for update;
  if not found then
    raise exception 'profile not found' using errcode = 'P0002';
  end if;

  v_role := private.workspace_role(v_profile.workspace_id);
  if v_role is null then
    -- Same answer as a missing row: do not confirm other tenants' pages.
    raise exception 'profile not found' using errcode = 'P0002';
  end if;
  if not private.workspace_is_writable(v_profile.workspace_id) then
    raise exception 'workspace does not accept changes' using errcode = '42501';
  end if;
  -- Matrix: profile.archive and profile.duplicate = owner, admin (modules/identity/permissions.ts).
  if v_role not in ('owner', 'admin') then
    raise exception 'only owners and admins manage pages' using errcode = '42501';
  end if;
  return v_profile;
end;
$$;

-- Takes the page off the air (same effect as unpublish_profile) and freezes it. The address stays
-- with the page, snapshots, analytics and leads are kept, and the page keeps counting toward
-- max_profiles. Idempotent. The caller revalidates the public cache when was_published is true.
create function public.archive_profile(p_profile_id uuid)
returns table (slug text, was_published boolean)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_profile public.profiles;
  v_version integer;
begin
  v_profile := private.lock_profile_for_management(p_profile_id);
  slug := v_profile.slug;
  was_published := false;
  if v_profile.status = 'archived' then
    return next;
    return;
  end if;

  was_published := v_profile.live_publication_id is not null;
  select pp.version into v_version from public.profile_publications pp where pp.id = v_profile.live_publication_id;

  update public.profiles
  set status = 'archived', published_at = null, live_publication_id = null
  where id = v_profile.id;

  perform private.write_audit_event(v_profile.workspace_id, 'profile.archived', 'profile', v_profile.id,
    jsonb_build_object('slug', v_profile.slug, 'wasPublished', was_published, 'version', v_version));
  return next;
end;
$$;

-- Back to a draft. Never republishes: that is a separate, deliberate step. Idempotent.
create function public.unarchive_profile(p_profile_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles;
begin
  v_profile := private.lock_profile_for_management(p_profile_id);
  if v_profile.status <> 'archived' then
    return;
  end if;

  update public.profiles set status = 'draft' where id = v_profile.id;

  perform private.write_audit_event(v_profile.workspace_id, 'profile.unarchived', 'profile', v_profile.id,
    jsonb_build_object('slug', v_profile.slug));
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Media: an asset can be kept alive by other pages of the same workspace (duplication)
-- ---------------------------------------------------------------------------------------------

-- "This page may also reference this asset." A permission, not a reference: whether the page still
-- uses the image is computed from its documents, as before (ADR 0009), so the two cannot drift in
-- a harmful way. Written only by duplicate_profile and by the cleanup when it re-homes an asset.
create table public.media_asset_shares (
  media_id uuid not null references public.media_assets (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (media_id, profile_id)
);

create index media_asset_shares_profile_idx on public.media_asset_shares (profile_id);
create index media_asset_shares_workspace_idx on public.media_asset_shares (workspace_id);

comment on table public.media_asset_shares is
  'Pages, other than the owner page, allowed to reference a media asset (ADR 0012). Created when a page is duplicated; always the same workspace as the asset. No personal data.';

-- True while one page's draft or any of its retained publications points at the asset.
create function private.media_page_references(p_media_id uuid, p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
      select 1 from public.profiles p
      where p.id = p_profile_id
        and (p.avatar_path = p_media_id::text
          or p.blocks @> jsonb_build_array(jsonb_build_object('type', 'image', 'mediaId', p_media_id::text)))
    )
    or exists (
      select 1 from public.profile_publications pp
      where pp.profile_id = p_profile_id
        and (pp.document ->> 'avatarPath' = p_media_id::text
          or pp.document -> 'blocks' @> jsonb_build_array(jsonb_build_object('type', 'image', 'mediaId', p_media_id::text)))
    );
$$;

-- Referenced by the owner page or by any page the asset is shared with. Still computed from the
-- documents; bounded by the number of copies of a page.
create or replace function private.media_is_referenced(p_media_id uuid, p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.media_page_references(p_media_id, p_profile_id)
    or exists (
      select 1 from public.media_asset_shares s
      where s.media_id = p_media_id and private.media_page_references(p_media_id, s.profile_id)
    );
$$;

-- A ready asset of the given kind that this page owns or was given a share of.
create or replace function private.is_ready_media(p_profile_id uuid, p_kind public.media_kind, p_media_id text, p_width jsonb, p_height jsonb)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.media_assets m
    where m.id::text = p_media_id
      and m.kind = p_kind
      and m.status = 'ready'
      and (m.profile_id = p_profile_id
        or exists (select 1 from public.media_asset_shares s where s.media_id = m.id and s.profile_id = p_profile_id))
      and (p_width is null or (to_jsonb(m.width) = p_width and to_jsonb(m.height) = p_height))
  );
$$;

-- Cleanup, step 1, now aware of shares. Before claiming, an asset whose owner page is due for
-- purge moves to a live page that still uses it, so deleting the original never breaks a copy and
-- the owner page can still be purged (media_assets -> profiles is ON DELETE RESTRICT).
create or replace function public.claim_media_cleanup(p_limit integer default 50)
returns table (media_id uuid, object_names text[])
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_row record;
begin
  for v_row in
    select m.id, h.profile_id as heir
    from public.media_assets m
    join public.profiles op on op.id = m.profile_id and op.purge_after < now()
    cross join lateral (
      select s.profile_id
      from public.media_asset_shares s
      join public.profiles sp on sp.id = s.profile_id
      where s.media_id = m.id
        and (sp.purge_after is null or sp.purge_after >= now())
        and private.media_page_references(m.id, s.profile_id)
      order by s.created_at, s.profile_id
      limit 1
    ) h
    where m.status = 'ready'
    limit 200
  loop
    update public.media_assets m set profile_id = v_row.heir where m.id = v_row.id;
    delete from public.media_asset_shares s where s.media_id = v_row.id and s.profile_id = v_row.heir;
  end loop;

  for v_row in
    select m.id, m.profile_id
    from public.media_assets m
    where m.status = 'deleting'
      or (m.status in ('pending', 'failed') and m.created_at < now() - private.media_pending_grace())
      or (m.status = 'ready' and m.created_at < now() - private.media_orphan_grace()
          and not private.media_is_referenced(m.id, m.profile_id))
      or exists (select 1 from public.profiles p where p.id = m.profile_id and p.purge_after < now())
    order by m.created_at
    limit greatest(1, least(coalesce(p_limit, 50), 200))
  loop
    perform 1 from public.profiles p where p.id = v_row.profile_id for update;
    update public.media_assets m
    set status = 'deleting'
    where m.id = v_row.id
      and (
        m.status in ('deleting', 'pending', 'failed')
        or exists (select 1 from public.profiles p where p.id = m.profile_id and p.purge_after < now())
        or not private.media_is_referenced(m.id, m.profile_id)
      );
    if found then
      media_id := v_row.id;
      select array_agg(v_row.id::text || '/' || (v ->> 'w') || '.webp' order by (v ->> 'w')::integer) into object_names
      from public.media_assets m, jsonb_array_elements(m.variants) v
      where m.id = v_row.id;
      return next;
    end if;
  end loop;
end;
$$;

comment on table public.media_assets is
  'Uploaded images (ADR 0009). One row per asset; objects live in the "media" bucket under "<id>/<width>.webp". An asset is kept while its owner page or a page it is shared with (media_asset_shares, ADR 0012) references it in the draft or in a retained publication, and removed by the cleanup job otherwise. May show people and places; EXIF/GPS metadata is stripped before storage.';

alter table public.media_asset_shares enable row level security;
revoke all on public.media_asset_shares from public, anon, authenticated, service_role;
grant select on public.media_asset_shares to authenticated, service_role;

create policy media_asset_shares_select_member on public.media_asset_shares
for select to authenticated
using (workspace_id in (select private.member_workspace_ids()));

-- ---------------------------------------------------------------------------------------------
-- Duplication: one transaction, deep copy, nothing mutable shared
-- ---------------------------------------------------------------------------------------------

-- Copies the draft (bio, blocks with new ids, theme, avatar) of a live page into a new draft page
-- of the same workspace. Not copied: publications, analytics, leads, slug history and anything
-- added later that belongs to the page's history (domain, pixels, report links). Images are not
-- copied either: the new page gets a share of each asset the draft uses, so they count once
-- against storage_mb. max_profiles and the slug rules are enforced by the profiles triggers.
create function public.duplicate_profile(p_profile_id uuid, p_title text, p_slug text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source public.profiles;
  v_new_id uuid;
  v_blocks jsonb;
  v_shared integer;
begin
  -- Owners and admins of the source's workspace; the source may be archived, never deleted.
  v_source := private.lock_profile_for_management(p_profile_id);

  insert into public.profiles (workspace_id, title, bio, slug, duplicated_from)
  values (v_source.workspace_id, btrim(coalesce(p_title, '')), v_source.bio, coalesce(p_slug, ''), v_source.id)
  returning id into v_new_id;

  insert into public.media_asset_shares (media_id, profile_id, workspace_id)
  select m.id, v_new_id, m.workspace_id
  from public.media_assets m
  where m.workspace_id = v_source.workspace_id
    and m.status = 'ready'
    and (m.profile_id = v_source.id
      or exists (select 1 from public.media_asset_shares s where s.media_id = m.id and s.profile_id = v_source.id))
    and (v_source.avatar_path = m.id::text
      or v_source.blocks @> jsonb_build_array(jsonb_build_object('type', 'image', 'mediaId', m.id::text)));
  get diagnostics v_shared = row_count;

  select coalesce(jsonb_agg(jsonb_set(b, '{id}', to_jsonb(gen_random_uuid()::text)) order by ord), '[]'::jsonb)
  into v_blocks
  from jsonb_array_elements(v_source.blocks) with ordinality as t(b, ord);

  -- Goes through private.validate_profile_draft like any other draft write.
  update public.profiles
  set blocks = v_blocks, theme = v_source.theme, avatar_path = v_source.avatar_path
  where id = v_new_id;

  perform private.write_audit_event(v_source.workspace_id, 'profile.duplicated', 'profile', v_new_id,
    jsonb_build_object('sourceProfileId', v_source.id, 'blocks', jsonb_array_length(v_blocks), 'sharedMedia', v_shared));
  return v_new_id;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Page list: everything the list shows, in one bounded query
-- ---------------------------------------------------------------------------------------------

-- Runs with the caller's privileges: RLS on profiles and profile_publications is what keeps other
-- workspaces out, whatever the arguments. The search string is matched literally (wildcards are
-- escaped). At most 50 items per call; totals cover the whole workspace so the list can show the
-- plan usage and the filter counts without a second query.
create function public.list_workspace_profiles(
  p_workspace_id uuid,
  p_search text default '',
  p_slug_search text default '',
  p_status public.profile_status default null,
  p_order text default 'recent',
  p_limit integer default 20,
  p_offset integer default 0
)
returns table (
  total_pages integer,
  draft_pages integer,
  published_pages integer,
  archived_pages integer,
  matched_pages integer,
  items jsonb
)
language sql
stable
security invoker
set search_path = ''
as $$
  with scope as materialized (
    select p.id, p.title, p.slug, p.status, p.avatar_path, p.published_at, p.created_at, p.updated_at,
      p.draft_revision, p.live_publication_id
    from public.profiles p
    where p.workspace_id = p_workspace_id and p.deleted_at is null
  ),
  term as (
    select
      nullif(replace(replace(replace(left(btrim(coalesce(p_search, '')), 80), '\', '\\'), '%', '\%'), '_', '\_'), '') as title_term,
      nullif(replace(replace(replace(left(btrim(coalesce(p_slug_search, '')), 80), '\', '\\'), '%', '\%'), '_', '\_'), '') as slug_term
  ),
  matched as (
    select s.*
    from scope s, term t
    where (p_status is null or s.status = p_status)
      and (
        (t.title_term is null and t.slug_term is null)
        or (t.title_term is not null and s.title ilike '%' || t.title_term || '%' escape '\')
        or (t.slug_term is not null and s.slug like '%' || t.slug_term || '%' escape '\')
      )
  ),
  page as (
    select m.*, pp.source_revision,
      row_number() over (order by case when p_order = 'name' then lower(m.title) end, m.created_at desc, m.id) as position
    from matched m
    left join public.profile_publications pp on pp.id = m.live_publication_id
    order by position
    limit least(greatest(coalesce(p_limit, 20), 1), 50)
    offset greatest(coalesce(p_offset, 0), 0)
  )
  select
    (select count(*)::integer from scope),
    (select count(*)::integer from scope where status = 'draft'),
    (select count(*)::integer from scope where status = 'published'),
    (select count(*)::integer from scope where status = 'archived'),
    (select count(*)::integer from matched),
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', g.id, 'title', g.title, 'slug', g.slug, 'status', g.status, 'avatarPath', g.avatar_path,
        'publishedAt', g.published_at, 'createdAt', g.created_at, 'updatedAt', g.updated_at,
        'hasUnpublishedChanges', g.live_publication_id is not null and g.source_revision is distinct from g.draft_revision
      ) order by g.position)
      from page g), '[]'::jsonb);
$$;

-- ---------------------------------------------------------------------------------------------
-- Invitations
-- ---------------------------------------------------------------------------------------------

-- How long an invitation link works (provisional).
create function private.invitation_ttl()
returns interval
language sql
immutable
set search_path = ''
as $$ select interval '7 days' $$;

-- How long a finished invitation (accepted, revoked or expired) keeps its e-mail address.
create function private.invitation_retention()
returns interval
language sql
immutable
set search_path = ''
as $$ select interval '30 days' $$;

-- Mirror of normalizeInvitationEmail (modules/identity/invitations.ts).
create function private.normalize_email(p_email text)
returns text
language sql
immutable
set search_path = ''
as $$ select lower(btrim(coalesce(p_email, ''), E' \t\n\r')) $$;

create table public.workspace_invitations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  -- Normalized (trimmed, lowercase). Personal data of someone who may never sign up.
  email text not null check (
    char_length(email) between 3 and 254
    and email = lower(email)
    and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  ),
  -- Ownership is never granted by invitation.
  role public.workspace_role not null check (role in ('admin', 'editor')),
  -- SHA-256 of the token, hex. The token itself is shown once to the inviter and never stored.
  token_hash text not null check (token_hash ~ '^[0-9a-f]{64}$'),
  invited_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  -- Null when the system closed it (superseded by a new invitation or opened by a current member).
  revoked_by uuid references auth.users (id) on delete set null,
  accepted_at timestamptz,
  accepted_by uuid references auth.users (id) on delete set null,
  constraint workspace_invitations_token_hash_key unique (token_hash),
  constraint workspace_invitations_expiry_after_creation check (expires_at > created_at),
  constraint workspace_invitations_one_outcome check (revoked_at is null or accepted_at is null),
  constraint workspace_invitations_accepted_by check ((accepted_at is null) = (accepted_by is null))
);

-- One open invitation per address per workspace; a new one supersedes the old.
create unique index workspace_invitations_open_email_key
  on public.workspace_invitations (workspace_id, email) where revoked_at is null and accepted_at is null;
create index workspace_invitations_workspace_created_idx on public.workspace_invitations (workspace_id, created_at desc);
create index workspace_invitations_expires_idx on public.workspace_invitations (expires_at);
create index workspace_invitations_invited_by_idx on public.workspace_invitations (invited_by, created_at desc) where invited_by is not null;
create index workspace_invitations_revoked_by_idx on public.workspace_invitations (revoked_by) where revoked_by is not null;
create index workspace_invitations_accepted_by_idx on public.workspace_invitations (accepted_by) where accepted_by is not null;

comment on table public.workspace_invitations is
  'Invitations to join a workspace (ADR 0012). Pending state lives only here: a membership row is created (or reactivated) as active when the invitation is accepted. Holds the invited e-mail address (personal data); finished invitations are deleted private.invitation_retention() after they end.';

-- Seats taken: members that are not revoked plus open, unexpired invitations.
create function private.workspace_seats_in_use(p_workspace_id uuid, p_except_invitation uuid default null)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select (
    (select count(*) from public.workspace_memberships m
     where m.workspace_id = p_workspace_id and m.status <> 'revoked')
    + (select count(*) from public.workspace_invitations i
       where i.workspace_id = p_workspace_id
         and i.revoked_at is null and i.accepted_at is null and i.expires_at > now()
         and i.id is distinct from p_except_invitation)
  )::integer;
$$;

-- The application generates the token and sends only its hash, so the token never reaches the
-- database on this path.
create function public.create_workspace_invitation(
  p_workspace_id uuid,
  p_email text,
  p_role public.workspace_role,
  p_token_hash text
)
returns table (invitation_id uuid, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := (select auth.uid());
  v_role public.workspace_role;
  v_email text := private.normalize_email(p_email);
  v_superseded integer;
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  v_role := private.workspace_role(p_workspace_id);
  if v_role is null then
    raise exception 'workspace not found' using errcode = 'P0002';
  end if;
  if not private.workspace_is_writable(p_workspace_id) then
    raise exception 'workspace does not accept changes' using errcode = '42501';
  end if;
  -- Matrix: members.invite = owner, admin (modules/identity/permissions.ts).
  if v_role not in ('owner', 'admin') then
    raise exception 'only owners and admins invite people' using errcode = '42501';
  end if;
  if p_role is null or p_role not in ('admin', 'editor') then
    raise exception 'ownership is never granted by invitation' using errcode = '42501';
  end if;
  if char_length(v_email) not between 3 and 254 or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'invalid e-mail address' using errcode = '22023', detail = 'email';
  end if;
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid token hash' using errcode = '22023', detail = 'token_hash';
  end if;

  -- Serializes seat accounting with acceptances and other invitations.
  perform 1 from public.workspaces w where w.id = p_workspace_id for update;

  -- Finished invitations of this workspace lose their e-mail address after the retention period.
  delete from public.workspace_invitations i
  where i.workspace_id = p_workspace_id
    and least(coalesce(i.accepted_at, i.revoked_at), i.expires_at) < now() - private.invitation_retention();

  if (select count(*) from public.workspace_invitations i
      where i.workspace_id = p_workspace_id and i.created_at > now() - interval '24 hours') >= 20
    or (select count(*) from public.workspace_invitations i
        where i.invited_by = v_uid and i.created_at > now() - interval '24 hours') >= 30 then
    raise exception 'too many invitations' using errcode = 'LK082';
  end if;

  if exists (
    select 1
    from public.workspace_memberships m
    join auth.users u on u.id = m.user_id
    where m.workspace_id = p_workspace_id and m.status = 'active' and lower(u.email) = v_email
  ) then
    raise exception 'already a member' using errcode = 'LK081';
  end if;

  update public.workspace_invitations i
  set revoked_at = now()
  where i.workspace_id = p_workspace_id and i.email = v_email and i.revoked_at is null and i.accepted_at is null;
  get diagnostics v_superseded = row_count;

  if private.workspace_seats_in_use(p_workspace_id) + 1 > coalesce(private.entitlement_int(p_workspace_id, 'team_members'), 0) then
    raise exception 'team member limit reached' using errcode = 'LK010', detail = 'team_members';
  end if;

  insert into public.workspace_invitations (workspace_id, email, role, token_hash, invited_by, expires_at)
  values (p_workspace_id, v_email, p_role, p_token_hash, v_uid, now() + private.invitation_ttl())
  returning id, workspace_invitations.expires_at into invitation_id, expires_at;

  -- The trail never holds the address or anything derived from the token.
  perform private.write_audit_event(p_workspace_id, 'invitation.created', 'invitation', invitation_id,
    jsonb_build_object('role', p_role, 'superseded', v_superseded > 0));
  return next;
end;
$$;

create function public.revoke_workspace_invitation(p_invitation_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_invitation public.workspace_invitations;
  v_role public.workspace_role;
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  select i.* into v_invitation from public.workspace_invitations i where i.id = p_invitation_id for update;
  if not found then
    raise exception 'invitation not found' using errcode = 'P0002';
  end if;
  v_role := private.workspace_role(v_invitation.workspace_id);
  if v_role is null then
    -- Same answer as a missing row: do not confirm other tenants' invitations.
    raise exception 'invitation not found' using errcode = 'P0002';
  end if;
  if not private.workspace_is_writable(v_invitation.workspace_id) then
    raise exception 'workspace does not accept changes' using errcode = '42501';
  end if;
  -- Matrix: invitations.revoke = owner, admin (modules/identity/permissions.ts).
  if v_role not in ('owner', 'admin') then
    raise exception 'only owners and admins revoke invitations' using errcode = '42501';
  end if;
  if v_invitation.revoked_at is not null or v_invitation.accepted_at is not null then
    return;
  end if;

  update public.workspace_invitations set revoked_at = now(), revoked_by = v_uid where id = p_invitation_id;

  perform private.write_audit_event(v_invitation.workspace_id, 'invitation.revoked', 'invitation', p_invitation_id,
    jsonb_build_object('role', v_invitation.role));
end;
$$;

-- What the token resolves to for the signed-in caller. One answer, 'invalid', for a token that is
-- malformed, unknown, expired, revoked, already used, or whose workspace is gone or suspended.
-- 'wrong_account' says only that the invitation is for another address. Read-only.
create function private.resolve_invitation(p_token text)
returns table (state text, invitation_id uuid, workspace_id uuid, role public.workspace_role, invited_by uuid, expires_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := (select auth.uid());
  v_invitation public.workspace_invitations;
  v_email text;
  v_confirmed_at timestamptz;
begin
  state := 'invalid';
  if v_uid is null or p_token is null or p_token !~ '^[A-Za-z0-9_-]{43}$' then
    return next;
    return;
  end if;

  select i.* into v_invitation
  from public.workspace_invitations i
  join public.workspaces w on w.id = i.workspace_id
  where i.token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
    and i.revoked_at is null
    and i.accepted_at is null
    and i.expires_at > now()
    and w.deleted_at is null
    and w.status = 'active';
  if not found then
    return next;
    return;
  end if;

  select lower(u.email), u.email_confirmed_at into v_email, v_confirmed_at from auth.users u where u.id = v_uid;
  if exists (select 1 from public.user_accounts a where a.id = v_uid and a.deleted_at is not null) then
    return next;
    return;
  end if;
  -- The link travels through chat apps: only the invited, confirmed address may use it.
  if v_confirmed_at is null or v_email is distinct from v_invitation.email then
    state := 'wrong_account';
    return next;
    return;
  end if;

  invitation_id := v_invitation.id;
  workspace_id := v_invitation.workspace_id;
  role := v_invitation.role;
  invited_by := v_invitation.invited_by;
  expires_at := v_invitation.expires_at;
  if exists (
    select 1 from public.workspace_memberships m
    where m.workspace_id = v_invitation.workspace_id and m.user_id = v_uid and m.status = 'active'
  ) then
    state := 'already_member';
  elsif private.workspace_seats_in_use(v_invitation.workspace_id, v_invitation.id) + 1
      > coalesce(private.entitlement_int(v_invitation.workspace_id, 'team_members'), 0) then
    state := 'limit_reached';
  else
    state := 'valid';
  end if;
  return next;
end;
$$;

-- For the acceptance screen: the workspace name, the role and who invited, and only when the
-- invitation is for the caller.
create function public.get_workspace_invitation(p_token text)
returns table (state text, workspace_id uuid, workspace_name text, role public.workspace_role, inviter_name text, expires_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_resolved record;
begin
  if (select auth.uid()) is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  select r.* into v_resolved from private.resolve_invitation(p_token) r;
  state := v_resolved.state;
  if v_resolved.state in ('valid', 'already_member', 'limit_reached') then
    workspace_id := v_resolved.workspace_id;
    role := v_resolved.role;
    expires_at := v_resolved.expires_at;
    select w.name into workspace_name from public.workspaces w where w.id = v_resolved.workspace_id;
    select a.display_name into inviter_name from public.user_accounts a where a.id = v_resolved.invited_by and a.deleted_at is null;
  end if;
  return next;
end;
$$;

-- Accepts once. The membership is created active, or reactivated when the person had been removed
-- before. Answers with a state instead of raising, so every refusal maps to one screen.
create function public.accept_workspace_invitation(p_token text)
returns table (state text, workspace_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := (select auth.uid());
  v_resolved record;
  v_invitation public.workspace_invitations;
  v_membership public.workspace_memberships;
  v_membership_id uuid;
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  -- First pass without locks, to learn which workspace to lock; everything is re-read after it.
  select r.* into v_resolved from private.resolve_invitation(p_token) r;
  if v_resolved.state in ('invalid', 'wrong_account') then
    state := v_resolved.state;
    return next;
    return;
  end if;

  -- Same lock order as create_workspace_invitation: workspace, then invitation.
  perform 1 from public.workspaces w where w.id = v_resolved.workspace_id for update;
  select i.* into v_invitation from public.workspace_invitations i where i.id = v_resolved.invitation_id for update;
  select r.* into v_resolved from private.resolve_invitation(p_token) r;
  state := v_resolved.state;
  if v_resolved.state in ('invalid', 'wrong_account') then
    return next;
    return;
  end if;
  workspace_id := v_invitation.workspace_id;

  if v_resolved.state = 'already_member' then
    -- Nothing to grant; close the invitation so it stops holding a seat.
    update public.workspace_invitations set revoked_at = now() where id = v_invitation.id;
    return next;
    return;
  end if;
  if v_resolved.state = 'limit_reached' then
    workspace_id := null;
    return next;
    return;
  end if;

  select m.* into v_membership
  from public.workspace_memberships m
  where m.workspace_id = v_invitation.workspace_id and m.user_id = v_uid
  for update;
  if found then
    -- Removed before and invited again: the same row comes back with the invited role.
    update public.workspace_memberships
    set status = 'active', role = v_invitation.role, revoked_at = null,
      invited_by = v_invitation.invited_by, invited_at = v_invitation.created_at, accepted_at = now()
    where id = v_membership.id;
    v_membership_id := v_membership.id;
  else
    insert into public.workspace_memberships (workspace_id, user_id, role, status, invited_by, invited_at, accepted_at)
    values (v_invitation.workspace_id, v_uid, v_invitation.role, 'active', v_invitation.invited_by, v_invitation.created_at, now())
    returning id into v_membership_id;
  end if;

  update public.workspace_invitations set accepted_at = now(), accepted_by = v_uid where id = v_invitation.id;

  perform private.write_audit_event(v_invitation.workspace_id, 'invitation.accepted', 'invitation', v_invitation.id,
    jsonb_build_object('role', v_invitation.role, 'membershipId', v_membership_id));
  state := 'accepted';
  return next;
end;
$$;

-- Members screen. Display names come from user_accounts (which RLS limits to one's own row), so
-- the read is a function. E-mail addresses are returned to owners and admins only, and to each
-- person for their own row.
create function public.list_workspace_members(p_workspace_id uuid)
returns table (
  membership_id uuid,
  user_id uuid,
  role public.workspace_role,
  display_name text,
  email text,
  joined_at timestamptz,
  is_self boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := (select auth.uid());
  v_role public.workspace_role;
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  v_role := private.workspace_role(p_workspace_id);
  -- Matrix: members.view = owner, admin, editor, that is, every member.
  if v_role is null then
    raise exception 'workspace not found' using errcode = 'P0002';
  end if;

  return query
  select m.id, m.user_id, m.role, a.display_name,
    case when v_role in ('owner', 'admin') or m.user_id = v_uid then u.email::text end,
    coalesce(m.accepted_at, m.created_at),
    m.user_id = v_uid
  from public.workspace_memberships m
  left join public.user_accounts a on a.id = m.user_id and a.deleted_at is null
  left join auth.users u on u.id = m.user_id
  where m.workspace_id = p_workspace_id and m.status = 'active'
  order by array_position(array['owner', 'admin', 'editor']::public.workspace_role[], m.role), m.created_at, m.id
  limit 100;
end;
$$;

alter table public.workspace_invitations enable row level security;
revoke all on public.workspace_invitations from public, anon, authenticated, service_role;

-- Owners and admins see their workspace's invitations. token_hash is not granted: nobody reads it
-- through the API, and it would be useless anyway (acceptance hashes the token it is given).
grant select (id, workspace_id, email, role, invited_by, created_at, expires_at, revoked_at, revoked_by, accepted_at, accepted_by)
  on public.workspace_invitations to authenticated;

create policy workspace_invitations_select_owner_admin on public.workspace_invitations
for select to authenticated
using (workspace_id in (select private.workspace_ids_with_role(array['owner', 'admin']::public.workspace_role[])));

-- Server-side administration only (the Sprint 9 purge and account deletion).
grant select, delete on public.workspace_invitations to service_role;

-- ---------------------------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------------------------

revoke all on all functions in schema private from public, anon, authenticated;
grant execute on function
  private.member_workspace_ids(),
  private.writable_workspace_ids(public.workspace_role[]),
  private.workspace_ids_with_role(public.workspace_role[])
to authenticated;

revoke all on function
  public.archive_profile(uuid),
  public.unarchive_profile(uuid),
  public.duplicate_profile(uuid, text, text),
  public.list_workspace_profiles(uuid, text, text, public.profile_status, text, integer, integer),
  public.create_workspace_invitation(uuid, text, public.workspace_role, text),
  public.revoke_workspace_invitation(uuid),
  public.get_workspace_invitation(text),
  public.accept_workspace_invitation(text),
  public.list_workspace_members(uuid)
from public, anon, authenticated, service_role;

grant execute on function
  public.archive_profile(uuid),
  public.unarchive_profile(uuid),
  public.duplicate_profile(uuid, text, text),
  public.list_workspace_profiles(uuid, text, text, public.profile_status, text, integer, integer),
  public.create_workspace_invitation(uuid, text, public.workspace_role, text),
  public.revoke_workspace_invitation(uuid),
  public.get_workspace_invitation(text),
  public.accept_workspace_invitation(text),
  public.list_workspace_members(uuid)
to authenticated;

comment on table public.workspace_memberships is
  'User access to a workspace. Only status=active grants access. Pending invitations live in workspace_invitations (ADR 0012); the invited status is not written.';
