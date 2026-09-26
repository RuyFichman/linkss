-- Sprint 2: link pages ("profiles"), slug rules, reservation and hold period, max_profiles guard.
-- Design: docs/adr/0004-tenancy-and-authorization.md. Forward-only.
-- SQLSTATEs: LK001 invalid slug, LK002 reserved slug, LK003 slug on hold for another workspace,
-- 23505 slug taken (profiles_slug_active_key), LK010 entitlement exceeded, 42501 forbidden,
-- P0002 not found.

create type public.profile_status as enum ('draft', 'published', 'archived');
create type public.slug_release_reason as enum ('changed', 'deleted');

-- ---------------------------------------------------------------------------------------------
-- Slug rules (mirror apps/web/src/modules/profiles/slug.ts)
-- ---------------------------------------------------------------------------------------------

-- trim -> lowercase -> NFD -> strip combining marks -> whitespace to hyphen -> collapse -> trim hyphens
create function private.normalize_slug(p_value text)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select regexp_replace(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          normalize(lower(regexp_replace(p_value, '^\s+|\s+$', '', 'g')), NFD),
          '[' || chr(768) || '-' || chr(879) || ']', '', 'g'),  -- U+0300..U+036F combining marks
        '\s+', '-', 'g'),
      '-+', '-', 'g'),
    '^-|-$', '', 'g');
$$;

create function private.slug_is_well_formed(p_slug text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_slug is not null
    and p_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
    and char_length(p_slug) between 3 and 40;
$$;

-- How long a released slug stays reserved for the workspace that released it (provisional).
create function private.slug_hold_period()
returns interval
language sql
immutable
set search_path = ''
as $$ select interval '90 days' $$;

create table public.reserved_slugs (
  slug text primary key check (slug ~ '^[a-z0-9-]+$'),
  reason text not null check (reason in ('route', 'platform')),
  created_at timestamptz not null default now()
);

comment on table public.reserved_slugs is
  'Slugs that can never be claimed. Must include every top-level app route; apps/web/src/modules/profiles/reserved-slugs.ts is kept in sync by a Vitest drift test.';

insert into public.reserved_slugs (slug, reason) values
  -- Sprint 1 list
  ('admin', 'platform'),
  ('api', 'route'),
  ('app', 'route'),
  ('login', 'platform'),
  ('logout', 'platform'),
  ('proto', 'route'),
  ('p', 'route'),
  ('r', 'route'),
  ('suporte', 'platform'),
  ('privacidade', 'route'),
  ('agencias', 'route'),
  ('profissionais', 'route'),
  -- Sprint 2 routes
  ('auth', 'route'),
  ('cadastro', 'route'),
  ('entrar', 'route'),
  ('sair', 'platform'),
  ('confirmar-email', 'route'),
  ('recuperar-acesso', 'route'),
  ('redefinir-senha', 'route'),
  -- Likely platform pages; reserving now avoids takeovers later
  ('ajuda', 'platform'),
  ('termos', 'platform'),
  ('precos', 'platform'),
  ('planos', 'platform'),
  ('status', 'platform'),
  ('seguranca', 'platform'),
  ('contato', 'platform'),
  ('conta', 'platform'),
  ('contas', 'platform'),
  ('configuracoes', 'platform'),
  ('relatorio', 'platform'),
  ('relatorios', 'platform'),
  ('blog', 'platform'),
  ('www', 'platform');

-- ---------------------------------------------------------------------------------------------
-- Profiles
-- ---------------------------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 80),
  bio text not null default '' check (char_length(bio) <= 280),
  -- Inlined (not private.slug_is_well_formed) because CHECK constraints run with the caller's privileges.
  slug text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) between 3 and 40),
  -- Storage object key only (Sprint 5 StorageAdapter). Never a URL or inline data.
  avatar_path text check (
    avatar_path is null
    or (char_length(avatar_path) between 1 and 512 and avatar_path !~* '^[a-z][a-z0-9+.-]*:')
  ),
  status public.profile_status not null default 'draft',
  published_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  purge_after timestamptz,
  constraint profiles_soft_delete_pair check ((deleted_at is null) = (purge_after is null)),
  constraint profiles_published_at check (status <> 'published' or published_at is not null)
);

-- Globally unique among live pages; released slugs are then protected by slug_history.
create unique index profiles_slug_active_key on public.profiles (slug) where deleted_at is null;
create index profiles_workspace_id_idx on public.profiles (workspace_id);
create index profiles_workspace_live_created_idx on public.profiles (workspace_id, created_at desc) where deleted_at is null;
create index profiles_created_by_idx on public.profiles (created_by);
create index profiles_purge_after_idx on public.profiles (purge_after) where purge_after is not null;

comment on table public.profiles is
  'Link page (UI: "página"). Draft state only in Sprint 2; publishing snapshots arrive in Sprint 3. Soft delete: deleted_at + purge_after (30 days); the slug moves to slug_history.';

create table public.slug_history (
  id bigint generated always as identity primary key,
  slug text not null,
  profile_id uuid references public.profiles (id) on delete set null,
  -- No foreign key: the hold must survive a purged workspace.
  workspace_id uuid not null,
  reason public.slug_release_reason not null,
  released_by uuid,
  released_at timestamptz not null default now(),
  hold_until timestamptz not null,
  constraint slug_history_hold_after_release check (hold_until >= released_at)
);

create index slug_history_slug_hold_idx on public.slug_history (slug, hold_until desc);
create index slug_history_workspace_idx on public.slug_history (workspace_id, released_at desc);
create index slug_history_profile_idx on public.slug_history (profile_id) where profile_id is not null;

comment on table public.slug_history is
  'Released slugs. Another workspace cannot claim a slug until hold_until (90 days, provisional). Retention: keep at least until hold_until + 1 year for support/impersonation investigations.';

-- ---------------------------------------------------------------------------------------------
-- Profile triggers
-- ---------------------------------------------------------------------------------------------

-- Trigger names carry a numeric prefix because Postgres fires same-event triggers alphabetically:
-- authorization/limits (10) must run before slug validation (20).
create function private.prepare_profile_slug()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.slug := private.normalize_slug(new.slug);

  if not private.slug_is_well_formed(new.slug) then
    raise exception 'invalid slug' using errcode = 'LK001';
  end if;
  if exists (select 1 from public.reserved_slugs r where r.slug = new.slug) then
    raise exception 'reserved slug' using errcode = 'LK002';
  end if;
  if exists (
    select 1 from public.slug_history h
    where h.slug = new.slug and h.hold_until > now() and h.workspace_id <> new.workspace_id
  ) then
    raise exception 'slug is on hold' using errcode = 'LK003';
  end if;
  return new;
end;
$$;

create trigger profiles_20_prepare_slug
before insert or update of slug on public.profiles
for each row execute function private.prepare_profile_slug();

create function private.prepare_new_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit integer;
  v_live integer;
begin
  -- BEFORE triggers run before RLS WITH CHECK. Authorize first so a forged workspace_id gets the
  -- same answer as RLS instead of leaking the target's page count through the limit error.
  -- (auth.uid() is null only for server-side service_role/postgres sessions.)
  if (select auth.uid()) is not null
    and new.workspace_id not in (
      select private.writable_workspace_ids(array['owner', 'admin']::public.workspace_role[])
    ) then
    raise exception 'new row violates row-level security policy for table "profiles"' using errcode = '42501';
  end if;

  -- New pages always start as live drafts owned by the caller.
  new.created_by := (select auth.uid());
  new.status := 'draft';
  new.published_at := null;
  new.deleted_at := null;
  new.purge_after := null;

  -- Lock the workspace so concurrent inserts cannot both pass the limit.
  perform 1 from public.workspaces w where w.id = new.workspace_id for update;
  v_limit := coalesce(private.entitlement_int(new.workspace_id, 'max_profiles'), 0);

  -- Archived pages count too, so archive/unarchive cannot bypass the limit (provisional).
  select count(*) into v_live
  from public.profiles p
  where p.workspace_id = new.workspace_id and p.deleted_at is null;

  if v_live >= v_limit then
    raise exception 'profile limit reached' using errcode = 'LK010', detail = 'max_profiles';
  end if;
  return new;
end;
$$;

create trigger profiles_10_authorize_new
before insert on public.profiles
for each row execute function private.prepare_new_profile();

create function private.guard_profile_immutable_columns()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.workspace_id <> old.workspace_id
    or new.created_by is distinct from old.created_by
    or new.created_at <> old.created_at then
    raise exception 'workspace_id, created_by and created_at are immutable' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger profiles_guard_immutable
before update on public.profiles
for each row execute function private.guard_profile_immutable_columns();

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------------------------

-- Availability for the onboarding/settings form. Reads across tenants (hence security definer)
-- but returns only a status, never who owns a slug.
create function public.check_slug_availability(p_slug text, p_workspace_id uuid default null)
returns table (normalized text, status text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_slug text := private.normalize_slug(coalesce(p_slug, ''));
  v_workspace_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  -- Hold exceptions only apply to a workspace the caller actually belongs to.
  if p_workspace_id is not null and p_workspace_id in (select private.member_workspace_ids()) then
    v_workspace_id := p_workspace_id;
  end if;

  normalized := v_slug;
  if not private.slug_is_well_formed(v_slug) then
    status := 'invalid';
  elsif exists (select 1 from public.reserved_slugs r where r.slug = v_slug) then
    status := 'reserved';
  elsif exists (select 1 from public.profiles p where p.slug = v_slug and p.deleted_at is null) then
    status := 'taken';
  elsif exists (
    select 1 from public.slug_history h
    where h.slug = v_slug and h.hold_until > now()
      and (v_workspace_id is null or h.workspace_id <> v_workspace_id)
  ) then
    status := 'held';
  else
    status := 'available';
  end if;
  return next;
end;
$$;

create function public.change_profile_slug(p_profile_id uuid, p_slug text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles;
  v_role public.workspace_role;
  v_new_slug text := private.normalize_slug(coalesce(p_slug, ''));
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
  if v_role not in ('owner', 'admin') then
    raise exception 'only owners and admins can change the address' using errcode = '42501';
  end if;
  if v_new_slug = v_profile.slug then
    return v_new_slug;
  end if;

  update public.profiles set slug = v_new_slug where id = p_profile_id
  returning slug into v_new_slug;

  insert into public.slug_history (slug, profile_id, workspace_id, reason, released_by, hold_until)
  values (v_profile.slug, v_profile.id, v_profile.workspace_id, 'changed', (select auth.uid()),
    now() + private.slug_hold_period());

  perform private.write_audit_event(v_profile.workspace_id, 'profile.slug_changed', 'profile', v_profile.id,
    jsonb_build_object('from', v_profile.slug, 'to', v_new_slug));
  return v_new_slug;
end;
$$;

create function public.soft_delete_profile(p_profile_id uuid)
returns void
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
  if v_role not in ('owner', 'admin') then
    raise exception 'only owners and admins can delete a page' using errcode = '42501';
  end if;

  update public.profiles
  set deleted_at = now(), purge_after = now() + private.soft_delete_retention()
  where id = p_profile_id;

  insert into public.slug_history (slug, profile_id, workspace_id, reason, released_by, hold_until)
  values (v_profile.slug, v_profile.id, v_profile.workspace_id, 'deleted', (select auth.uid()),
    now() + private.slug_hold_period());

  perform private.write_audit_event(v_profile.workspace_id, 'profile.deleted', 'profile', v_profile.id,
    jsonb_build_object('slug', v_profile.slug));
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Row Level Security and privileges
-- ---------------------------------------------------------------------------------------------

alter table public.reserved_slugs enable row level security;
alter table public.profiles enable row level security;
alter table public.slug_history enable row level security;

revoke all on public.reserved_slugs, public.profiles, public.slug_history
  from public, anon, authenticated, service_role;

-- reserved_slugs: server-only (no policies); availability is exposed through check_slug_availability.

-- profiles: members read live pages; owners/admins create; every role edits title/bio.
-- Slug, status and deletion change only through RPCs (and Sprint 3 publishing).
grant select on public.profiles to authenticated;
grant insert (workspace_id, title, bio, slug) on public.profiles to authenticated;
grant update (title, bio) on public.profiles to authenticated;

create policy profiles_select_member on public.profiles
for select to authenticated
using (deleted_at is null and workspace_id in (select private.member_workspace_ids()));

create policy profiles_insert_owner_admin on public.profiles
for insert to authenticated
with check (workspace_id in (select private.writable_workspace_ids(array['owner', 'admin']::public.workspace_role[])));

create policy profiles_update_member on public.profiles
for update to authenticated
using (
  deleted_at is null
  and workspace_id in (select private.writable_workspace_ids(array['owner', 'admin', 'editor']::public.workspace_role[]))
)
with check (
  deleted_at is null
  and workspace_id in (select private.writable_workspace_ids(array['owner', 'admin', 'editor']::public.workspace_role[]))
);

-- slug_history: members may see their own workspace's released slugs.
grant select on public.slug_history to authenticated;

create policy slug_history_select_member on public.slug_history
for select to authenticated
using (workspace_id in (select private.member_workspace_ids()));

grant select, insert, update, delete on public.reserved_slugs, public.profiles, public.slug_history to service_role;

revoke all on all functions in schema private from public, anon, authenticated;
grant execute on function
  private.member_workspace_ids(),
  private.writable_workspace_ids(public.workspace_role[]),
  private.workspace_ids_with_role(public.workspace_role[])
to authenticated;

revoke all on function
  public.check_slug_availability(text, uuid),
  public.change_profile_slug(uuid, text),
  public.soft_delete_profile(uuid)
from public, anon;

grant execute on function
  public.check_slug_availability(text, uuid),
  public.change_profile_slug(uuid, text),
  public.soft_delete_profile(uuid)
to authenticated;
