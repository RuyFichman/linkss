-- Sprint 3: draft content, immutable published snapshots, publish/restore/unpublish RPCs and the
-- anonymous public read surface. Design: docs/adr/0007-publishing-and-public-renderer.md.
-- Forward-only and additive: the Sprint 2 application keeps working against this schema.
-- SQLSTATEs (ADR 0004 contract, extended): LK030 draft changed since it was reviewed,
-- LK040 invalid draft content, 42501 forbidden, P0002 not found.

-- ---------------------------------------------------------------------------------------------
-- Draft content on profiles
-- ---------------------------------------------------------------------------------------------

alter table public.profiles
  add column social_links jsonb not null default '[]'::jsonb,
  add column blocks jsonb not null default '[]'::jsonb,
  -- Bumped by trigger whenever draft content changes; used for idempotent publishing and
  -- optimistic concurrency between tabs.
  add column draft_revision bigint not null default 1 check (draft_revision >= 1),
  add column live_publication_id uuid,
  add constraint profiles_social_links_shape check (
    jsonb_typeof(social_links) = 'array'
    and jsonb_array_length(social_links) <= 10
    and pg_column_size(social_links) <= 4096
  ),
  add constraint profiles_blocks_shape check (
    jsonb_typeof(blocks) = 'array'
    and jsonb_array_length(blocks) <= 100
    and pg_column_size(blocks) <= 65536
  );

comment on column public.profiles.social_links is
  'Draft header social links: [{network, url}]. Validated by private.validate_profile_draft (mirror of modules/profiles/draft-content.ts).';
comment on column public.profiles.blocks is
  'Draft blocks. Sprint 3 supports only {id, type: "link", title, url, visible}; the Sprint 4 editor extends the validator.';

-- Hosts accepted for each social network (mirror of modules/publishing/social.ts, drift-tested).
-- An icon that says "Instagram" must never point somewhere else.
create function private.social_network_hosts(p_network text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select case p_network
    when 'instagram' then array['instagram.com']
    when 'tiktok' then array['tiktok.com']
    when 'youtube' then array['youtube.com', 'youtu.be']
    when 'facebook' then array['facebook.com', 'fb.com']
    when 'linkedin' then array['linkedin.com']
    when 'x' then array['x.com', 'twitter.com']
    when 'threads' then array['threads.net', 'threads.com']
    when 'pinterest' then array['pinterest.com', 'pin.it']
  end;
$$;

create function private.url_host(p_url text)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select lower(substring(p_url from '^[a-z]+://([^/?#:@]+)(?::[0-9]{1,5})?(?:[/?#]|$)'));
$$;

-- Defense in depth: members can write draft columns directly through the Data API, so the database
-- enforces the same shape, URL schemes and host allowlist as the application.
create function private.validate_profile_draft()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item jsonb;
  v_keys text[];
  v_url text;
  v_host text;
  v_hosts text[];
  v_title text;
begin
  for v_item in select value from jsonb_array_elements(new.social_links) loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'invalid social link' using errcode = 'LK040', detail = 'social_links';
    end if;
    select array_agg(k order by k) into v_keys from jsonb_object_keys(v_item) k;
    if v_keys is distinct from array['network', 'url']
      or jsonb_typeof(v_item -> 'network') <> 'string'
      or jsonb_typeof(v_item -> 'url') <> 'string' then
      raise exception 'invalid social link' using errcode = 'LK040', detail = 'social_links';
    end if;
    v_url := v_item ->> 'url';
    v_hosts := private.social_network_hosts(v_item ->> 'network');
    v_host := private.url_host(v_url);
    if v_hosts is null
      or char_length(v_url) > 300
      -- userinfo ("user@host") is refused in the authority; "@" stays valid in paths (tiktok.com/@ana).
      or v_url !~ '^https://[^/?#@[:space:][:cntrl:]]+([/?#][^[:space:][:cntrl:]]*)?$'
      or v_host is null
      or not exists (select 1 from unnest(v_hosts) h where v_host = h or v_host like '%.' || h) then
      raise exception 'invalid social link' using errcode = 'LK040', detail = 'social_links';
    end if;
  end loop;
  if (select count(*) from jsonb_array_elements(new.social_links))
    <> (select count(distinct e ->> 'network') from jsonb_array_elements(new.social_links) e) then
    raise exception 'duplicate social network' using errcode = 'LK040', detail = 'social_links';
  end if;

  for v_item in select value from jsonb_array_elements(new.blocks) loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'invalid block' using errcode = 'LK040', detail = 'blocks';
    end if;
    select array_agg(k order by k) into v_keys from jsonb_object_keys(v_item) k;
    if v_keys is distinct from array['id', 'title', 'type', 'url', 'visible']
      or v_item ->> 'type' is distinct from 'link'
      or jsonb_typeof(v_item -> 'id') <> 'string'
      or jsonb_typeof(v_item -> 'title') <> 'string'
      or jsonb_typeof(v_item -> 'url') <> 'string'
      or jsonb_typeof(v_item -> 'visible') <> 'boolean' then
      raise exception 'invalid block' using errcode = 'LK040', detail = 'blocks';
    end if;
    v_title := v_item ->> 'title';
    v_url := v_item ->> 'url';
    if (v_item ->> 'id') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or char_length(btrim(v_title)) not between 1 and 80
      or char_length(v_url) > 2048
      or v_url !~ '^(https?://|mailto:|tel:)[^[:space:][:cntrl:]]+$' then
      raise exception 'invalid block' using errcode = 'LK040', detail = 'blocks';
    end if;
  end loop;
  if (select count(*) from jsonb_array_elements(new.blocks))
    <> (select count(distinct e ->> 'id') from jsonb_array_elements(new.blocks) e) then
    raise exception 'duplicate block id' using errcode = 'LK040', detail = 'blocks';
  end if;

  return new;
end;
$$;

create trigger profiles_30_validate_draft
before insert or update of social_links, blocks on public.profiles
for each row execute function private.validate_profile_draft();

create function private.bump_draft_revision()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.title is distinct from old.title
    or new.bio is distinct from old.bio
    or new.avatar_path is distinct from old.avatar_path
    or new.social_links is distinct from old.social_links
    or new.blocks is distinct from old.blocks then
    new.draft_revision := old.draft_revision + 1;
  else
    new.draft_revision := old.draft_revision;
  end if;
  return new;
end;
$$;

create trigger profiles_40_bump_draft_revision
before update on public.profiles
for each row execute function private.bump_draft_revision();

-- ---------------------------------------------------------------------------------------------
-- Published snapshots (immutable)
-- ---------------------------------------------------------------------------------------------

create table public.profile_publications (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  -- Denormalized tenant key (profiles.workspace_id is immutable) so RLS needs no join.
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  version integer not null check (version >= 1),
  schema_version smallint not null default 1 check (schema_version >= 1),
  -- Render-ready document; never contains workspace/user identifiers or draft-only data.
  document jsonb not null check (jsonb_typeof(document) = 'object' and pg_column_size(document) <= 131072),
  source_revision bigint not null,
  published_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint profile_publications_profile_version_key unique (profile_id, version),
  -- Target of the composite foreign key below (the live version must belong to the same page).
  constraint profile_publications_profile_id_id_key unique (profile_id, id)
);

create index profile_publications_workspace_idx on public.profile_publications (workspace_id);
create index profile_publications_published_by_idx on public.profile_publications (published_by) where published_by is not null;

comment on table public.profile_publications is
  'Immutable published snapshots of a page (ADR 0003/0007). The live one is profiles.live_publication_id. Retention: the latest private.publication_retention_count() versions per page; removed with the page by the purge job.';

alter table public.profiles
  add constraint profiles_live_publication_fkey
  foreign key (id, live_publication_id) references public.profile_publications (profile_id, id);

create index profiles_live_publication_idx on public.profiles (live_publication_id) where live_publication_id is not null;

create function private.prevent_publication_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Retention pruning (inside security definer RPCs) and the purge cascade run as the owner.
  if tg_op = 'DELETE' and current_user in ('postgres', 'supabase_admin') then
    return old;
  end if;
  raise exception 'published snapshots are immutable' using errcode = '42501';
end;
$$;

create trigger profile_publications_immutable
before update or delete on public.profile_publications
for each row execute function private.prevent_publication_mutation();

-- Versions kept per page, the live one included (provisional).
create function private.publication_retention_count()
returns integer
language sql
immutable
set search_path = ''
as $$ select 10 $$;

create function private.entitlement_bool(p_workspace_id uuid, p_key public.entitlement_key)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select pe.bool_value
  from public.workspaces w
  join public.plan_entitlements pe on pe.plan_id = w.plan_id and pe.key = p_key
  where w.id = p_workspace_id;
$$;

-- Snapshot document, schema version 1 (mirror of modules/publishing/document.ts). Hidden blocks
-- are dropped here so they never reach the public surface.
create function private.build_publication_document(p_profile public.profiles)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'schemaVersion', 1,
    'title', p_profile.title,
    'bio', p_profile.bio,
    'avatarPath', p_profile.avatar_path,
    'socialLinks', p_profile.social_links,
    'blocks', coalesce((
      select jsonb_agg(jsonb_build_object('id', b ->> 'id', 'type', b ->> 'type', 'title', b ->> 'title', 'url', b ->> 'url') order by ord)
      from jsonb_array_elements(p_profile.blocks) with ordinality as t(b, ord)
      where (b ->> 'visible')::boolean
    ), '[]'::jsonb)
  );
$$;

-- Shared authorization for publishing commands: returns the locked live profile or raises.
create function private.lock_profile_for_publishing(p_profile_id uuid)
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
  return v_profile;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Publishing RPCs
-- ---------------------------------------------------------------------------------------------

-- Idempotent: publishing an unchanged draft returns the live version (created = false) without a
-- new snapshot or audit event, so retries and double submits are safe.
create function public.publish_profile(p_profile_id uuid, p_expected_revision bigint default null)
returns table (publication_id uuid, version integer, created boolean)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_profile public.profiles;
  v_live public.profile_publications;
  v_version integer;
  v_id uuid;
begin
  v_profile := private.lock_profile_for_publishing(p_profile_id);

  if p_expected_revision is not null and p_expected_revision <> v_profile.draft_revision then
    raise exception 'draft changed since it was reviewed' using errcode = 'LK030';
  end if;

  if v_profile.live_publication_id is not null then
    select pp.* into v_live from public.profile_publications pp where pp.id = v_profile.live_publication_id;
    if v_live.source_revision = v_profile.draft_revision then
      publication_id := v_live.id;
      version := v_live.version;
      created := false;
      return next;
      return;
    end if;
  end if;

  select coalesce(max(pp.version), 0) + 1 into v_version
  from public.profile_publications pp where pp.profile_id = v_profile.id;

  insert into public.profile_publications (profile_id, workspace_id, version, document, source_revision, published_by)
  values (v_profile.id, v_profile.workspace_id, v_version, private.build_publication_document(v_profile),
    v_profile.draft_revision, (select auth.uid()))
  returning id into v_id;

  update public.profiles
  set status = 'published', published_at = now(), live_publication_id = v_id
  where id = v_profile.id;

  delete from public.profile_publications pp
  where pp.profile_id = v_profile.id
    and pp.id <> v_id
    and pp.version <= v_version - private.publication_retention_count();

  perform private.write_audit_event(v_profile.workspace_id, 'profile.published', 'profile', v_profile.id,
    jsonb_build_object('version', v_version, 'slug', v_profile.slug));

  publication_id := v_id;
  version := v_version;
  created := true;
  return next;
end;
$$;

-- Rollback: puts a retained earlier snapshot back on the air. The draft is not touched.
create function public.restore_profile_publication(p_profile_id uuid, p_publication_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles;
  v_target public.profile_publications;
  v_previous_version integer;
begin
  v_profile := private.lock_profile_for_publishing(p_profile_id);

  select pp.* into v_target from public.profile_publications pp
  where pp.id = p_publication_id and pp.profile_id = v_profile.id;
  if not found then
    raise exception 'publication not found' using errcode = 'P0002';
  end if;
  if v_profile.live_publication_id = v_target.id then
    return v_target.version;
  end if;

  select pp.version into v_previous_version from public.profile_publications pp where pp.id = v_profile.live_publication_id;

  update public.profiles
  set status = 'published', published_at = now(), live_publication_id = v_target.id
  where id = v_profile.id;

  perform private.write_audit_event(v_profile.workspace_id, 'profile.publication_restored', 'profile', v_profile.id,
    jsonb_build_object('version', v_target.version, 'fromVersion', v_previous_version, 'slug', v_profile.slug));
  return v_target.version;
end;
$$;

-- Takes the page off the air; snapshots are kept so it can be restored.
create function public.unpublish_profile(p_profile_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles;
  v_version integer;
begin
  v_profile := private.lock_profile_for_publishing(p_profile_id);
  if v_profile.live_publication_id is null then
    return;
  end if;

  select pp.version into v_version from public.profile_publications pp where pp.id = v_profile.live_publication_id;

  update public.profiles
  set status = 'draft', published_at = null, live_publication_id = null
  where id = v_profile.id;

  perform private.write_audit_event(v_profile.workspace_id, 'profile.unpublished', 'profile', v_profile.id,
    jsonb_build_object('version', v_version, 'slug', v_profile.slug));
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Public read surface (the only function anon may execute)
-- ---------------------------------------------------------------------------------------------

-- Resolves one address for the public renderer. Lookup by exact slug only: there is no way to list
-- pages. Returns identifiers of neither workspaces nor people.
--   published   -> document of the live snapshot
--   unpublished -> the address exists but nothing is on the air (renderer answers 404)
--   suspended   -> the workspace is suspended
--   moved       -> the address was changed during its hold period; canonical_slug is the new one
--   not_found   -> anything else (invalid, reserved, deleted, never used, hold expired)
create function public.get_public_page(p_slug text)
returns table (
  state text,
  canonical_slug text,
  document jsonb,
  version integer,
  published_at timestamptz,
  show_badge boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_slug text := private.normalize_slug(coalesce(p_slug, ''));
  v_profile public.profiles;
  v_workspace_status public.workspace_status;
begin
  state := 'not_found';
  if not private.slug_is_well_formed(v_slug) then
    return next;
    return;
  end if;

  select p.* into v_profile
  from public.profiles p
  join public.workspaces w on w.id = p.workspace_id
  where p.slug = v_slug and p.deleted_at is null and w.deleted_at is null;

  if v_profile.id is not null then
    select w.status into v_workspace_status from public.workspaces w where w.id = v_profile.workspace_id;
    canonical_slug := v_slug;
    if v_workspace_status = 'suspended' then
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
    return next;
    return;
  end if;

  select p.slug into canonical_slug
  from public.slug_history h
  join public.profiles p on p.id = h.profile_id
  join public.workspaces w on w.id = p.workspace_id
  where h.slug = v_slug
    and h.reason = 'changed'
    and h.hold_until > now()
    and p.deleted_at is null
    and p.live_publication_id is not null
    and w.deleted_at is null
    and w.status = 'active'
  order by h.released_at desc
  limit 1;

  if canonical_slug is not null then
    state := 'moved';
  end if;
  return next;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Row Level Security and privileges
-- ---------------------------------------------------------------------------------------------

alter table public.profile_publications enable row level security;
revoke all on public.profile_publications from public, anon, authenticated, service_role;

-- Members read the version history of live pages in their workspaces. Writes only through RPCs.
grant select on public.profile_publications to authenticated;

create policy profile_publications_select_member on public.profile_publications
for select to authenticated
using (
  workspace_id in (select private.member_workspace_ids())
  and profile_id in (select p.id from public.profiles p)
);

grant select on public.profile_publications to service_role;

-- Every role that edits title/bio also edits the other draft content.
grant update (social_links, blocks) on public.profiles to authenticated;

revoke all on all functions in schema private from public, anon, authenticated;
grant execute on function
  private.member_workspace_ids(),
  private.writable_workspace_ids(public.workspace_role[]),
  private.workspace_ids_with_role(public.workspace_role[])
to authenticated;

revoke all on function
  public.publish_profile(uuid, bigint),
  public.restore_profile_publication(uuid, uuid),
  public.unpublish_profile(uuid),
  public.get_public_page(text)
from public, anon, authenticated;

grant execute on function
  public.publish_profile(uuid, bigint),
  public.restore_profile_publication(uuid, uuid),
  public.unpublish_profile(uuid)
to authenticated;

grant execute on function public.get_public_page(text) to anon, authenticated;

comment on table public.profiles is
  'Link page (UI: "página"). Columns title, bio, avatar_path, social_links and blocks are the draft; the public page is the snapshot in live_publication_id. Soft delete: deleted_at + purge_after (30 days); the slug moves to slug_history.';
