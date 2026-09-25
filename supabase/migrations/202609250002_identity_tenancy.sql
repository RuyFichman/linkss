-- Sprint 2: identity, workspaces, memberships, entitlements and the audit trail.
-- Design: docs/adr/0004-tenancy-and-authorization.md. Forward-only; compatible with rolling the
-- application back one version because it only adds objects.
--
-- Conventions used below:
--   * every table REVOKEs all privileges from anon/authenticated and GRANTs exactly what its
--     policies need (tables are never exposed implicitly);
--   * policies are per command and always `to authenticated`;
--   * privileged helpers live in the unexposed `private` schema, are `security definer`,
--     `set search_path = ''` and read the caller from `(select auth.uid())`;
--   * sensitive mutations are narrow `public` RPCs that re-check the caller's role and write one
--     audit event in the same transaction.
--   * stable SQLSTATEs: LK010 entitlement exceeded, LK020 last owner, LK050 workspace limit,
--     42501 forbidden, P0002 not found (see ADR 0004 "Error contract").

create schema if not exists private;
revoke all on schema private from public;
-- RLS policies evaluate helper functions with the caller's privileges, so the schema must be usable.
grant usage on schema private to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------------------------

create type public.workspace_kind as enum ('personal', 'agency');
create type public.workspace_status as enum ('active', 'suspended');
create type public.workspace_role as enum ('owner', 'admin', 'editor');
create type public.membership_status as enum ('invited', 'active', 'revoked');
create type public.entitlement_key as enum (
  'max_profiles',
  'analytics_days',
  'team_members',
  'custom_domain',
  'remove_badge',
  'shareable_reports'
);
create type public.audit_action as enum (
  'auth.sign_in',
  'auth.sign_out',
  'auth.password_reset_completed',
  'workspace.created',
  'workspace.deleted',
  'membership.role_changed',
  'membership.removed',
  'profile.slug_changed',
  'profile.deleted',
  'profile.published' -- prepared: emitted by publishing in Sprint 3
);

-- ---------------------------------------------------------------------------------------------
-- Shared helpers
-- ---------------------------------------------------------------------------------------------

create function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Soft-deleted rows become eligible for the (Sprint 9) purge job after this period.
create function private.soft_delete_retention()
returns interval
language sql
immutable
set search_path = ''
as $$ select interval '30 days' $$;

-- ---------------------------------------------------------------------------------------------
-- Accounts
-- ---------------------------------------------------------------------------------------------

create table public.user_accounts (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text check (display_name is null or char_length(display_name) between 1 and 80),
  locale text not null default 'pt-BR' check (locale ~ '^[a-z]{2}-[A-Z]{2}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  purge_after timestamptz,
  constraint user_accounts_soft_delete_pair check ((deleted_at is null) = (purge_after is null))
);

create index user_accounts_purge_after_idx on public.user_accounts (purge_after) where purge_after is not null;

create trigger user_accounts_set_updated_at
before update on public.user_accounts
for each row execute function private.set_updated_at();

comment on table public.user_accounts is
  'Application data for an auth.users row (1:1). Not named "profiles": a profile is a link page. Retention: life of the account; soft delete then purge after purge_after (Sprint 9 job).';

-- ---------------------------------------------------------------------------------------------
-- Plans and entitlements
-- ---------------------------------------------------------------------------------------------

create table public.plans (
  id text primary key check (id ~ '^[a-z][a-z0-9_]{1,31}$'),
  name text not null check (char_length(name) between 1 and 40),
  created_at timestamptz not null default now()
);

create table public.plan_entitlements (
  plan_id text not null references public.plans (id) on delete cascade,
  key public.entitlement_key not null,
  int_value integer check (int_value is null or int_value >= 0),
  bool_value boolean,
  created_at timestamptz not null default now(),
  primary key (plan_id, key),
  constraint plan_entitlements_typed_value check (
    case
      when key in ('max_profiles', 'analytics_days', 'team_members')
        then int_value is not null and bool_value is null
      else bool_value is not null and int_value is null
    end
  )
);

comment on table public.plan_entitlements is
  'Typed entitlement catalogue. Values mirror apps/web/src/lib/product.ts (hypotheses until Sprint 8 billing); a Vitest drift test compares them.';

insert into public.plans (id, name) values
  ('free', 'Free'),
  ('pro', 'Pro'),
  ('agency', 'Agency');

insert into public.plan_entitlements (plan_id, key, int_value, bool_value) values
  ('free', 'max_profiles', 1, null),
  ('free', 'analytics_days', 7, null),
  ('free', 'team_members', 1, null),
  ('free', 'custom_domain', null, false),
  ('free', 'remove_badge', null, false),
  ('free', 'shareable_reports', null, false),
  ('pro', 'max_profiles', 1, null),
  ('pro', 'analytics_days', 90, null),
  ('pro', 'team_members', 1, null),
  ('pro', 'custom_domain', null, true),
  ('pro', 'remove_badge', null, true),
  ('pro', 'shareable_reports', null, false),
  ('agency', 'max_profiles', 10, null),
  ('agency', 'analytics_days', 90, null),
  ('agency', 'team_members', 5, null),
  ('agency', 'custom_domain', null, true),
  ('agency', 'remove_badge', null, true),
  ('agency', 'shareable_reports', null, true);

-- ---------------------------------------------------------------------------------------------
-- Workspaces and memberships
-- ---------------------------------------------------------------------------------------------

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  kind public.workspace_kind not null,
  status public.workspace_status not null default 'active',
  plan_id text not null default 'free' references public.plans (id),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  purge_after timestamptz,
  constraint workspaces_soft_delete_pair check ((deleted_at is null) = (purge_after is null)),
  constraint workspaces_personal_not_deleted check (kind <> 'personal' or deleted_at is null)
);

-- At most one personal workspace per user, ever (soft-deleted rows included).
create unique index workspaces_one_personal_per_user on public.workspaces (created_by) where kind = 'personal';
create index workspaces_created_by_idx on public.workspaces (created_by);
create index workspaces_plan_id_idx on public.workspaces (plan_id);
create index workspaces_purge_after_idx on public.workspaces (purge_after) where purge_after is not null;

create trigger workspaces_set_updated_at
before update on public.workspaces
for each row execute function private.set_updated_at();

comment on table public.workspaces is
  'Tenant. Every profile belongs to one. kind=personal is created by ensure_personal_workspace(); agency via create_agency_workspace(). Soft delete: deleted_at + purge_after (deleted_at + 30 days); purge job is Sprint 9.';

create table public.workspace_memberships (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.workspace_role not null,
  status public.membership_status not null default 'active',
  invited_by uuid references auth.users (id) on delete set null,
  invited_at timestamptz,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workspace_memberships_workspace_user_key unique (workspace_id, user_id),
  constraint workspace_memberships_revoked_at check ((status = 'revoked') = (revoked_at is not null))
);

-- Serves every RLS membership lookup: (user_id = auth.uid() and status = 'active') -> workspace_id.
create index workspace_memberships_user_lookup_idx
  on public.workspace_memberships (user_id, status, workspace_id);
create index workspace_memberships_invited_by_idx
  on public.workspace_memberships (invited_by) where invited_by is not null;

create trigger workspace_memberships_set_updated_at
before update on public.workspace_memberships
for each row execute function private.set_updated_at();

comment on table public.workspace_memberships is
  'User access to a workspace. Only status=active grants access. invited/invited_by prepare Sprint 7 invitations; email invitations for people without an account will use a separate table.';

-- ---------------------------------------------------------------------------------------------
-- Audit trail (append-only)
-- ---------------------------------------------------------------------------------------------

create table public.audit_events (
  id bigint generated always as identity primary key,
  -- Deliberately no foreign keys: the trail must outlive purged workspaces and deleted users.
  workspace_id uuid,
  actor_user_id uuid,
  action public.audit_action not null,
  target_type text check (target_type in ('user', 'workspace', 'membership', 'profile')),
  target_id uuid,
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object' and pg_column_size(metadata) <= 2048),
  created_at timestamptz not null default now()
);

create index audit_events_workspace_created_idx on public.audit_events (workspace_id, created_at desc) where workspace_id is not null;
create index audit_events_actor_created_idx on public.audit_events (actor_user_id, created_at desc);
create index audit_events_created_at_idx on public.audit_events (created_at);

comment on table public.audit_events is
  'Append-only security trail. Metadata must never contain tokens, passwords, raw IPs, cookies or full emails. Retention: 1 year (provisional), purged by the Sprint 9 job running as postgres.';

create function private.prevent_audit_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Only the retention job (running as a superuser-owned role) may delete; nobody may update.
  if tg_op = 'DELETE' and current_user in ('postgres', 'supabase_admin') then
    return old;
  end if;
  raise exception 'audit_events is append-only' using errcode = '42501';
end;
$$;

create trigger audit_events_append_only
before update or delete on public.audit_events
for each row execute function private.prevent_audit_mutation();

create function private.write_audit_event(
  p_workspace_id uuid,
  p_action public.audit_action,
  p_target_type text,
  p_target_id uuid,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.audit_events (workspace_id, actor_user_id, action, target_type, target_id, metadata)
  values (p_workspace_id, (select auth.uid()), p_action, p_target_type, p_target_id, coalesce(p_metadata, '{}'::jsonb));
$$;

-- ---------------------------------------------------------------------------------------------
-- Authorization helpers (used by policies and RPCs)
-- ---------------------------------------------------------------------------------------------

-- Workspaces where the caller has an active membership and that are not soft-deleted.
create function private.member_workspace_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.workspace_id
  from public.workspace_memberships m
  join public.workspaces w on w.id = m.workspace_id
  where m.user_id = (select auth.uid())
    and m.status = 'active'
    and w.deleted_at is null;
$$;

-- Same, restricted to roles and to workspaces that accept writes (active status).
create function private.writable_workspace_ids(p_roles public.workspace_role[])
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.workspace_id
  from public.workspace_memberships m
  join public.workspaces w on w.id = m.workspace_id
  where m.user_id = (select auth.uid())
    and m.status = 'active'
    and m.role = any (p_roles)
    and w.deleted_at is null
    and w.status = 'active';
$$;

-- Workspaces where the caller holds one of the roles (read access, suspended included).
create function private.workspace_ids_with_role(p_roles public.workspace_role[])
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.workspace_id
  from public.workspace_memberships m
  join public.workspaces w on w.id = m.workspace_id
  where m.user_id = (select auth.uid())
    and m.status = 'active'
    and m.role = any (p_roles)
    and w.deleted_at is null;
$$;

-- The caller's active role in a live workspace, or null.
create function private.workspace_role(p_workspace_id uuid)
returns public.workspace_role
language sql
stable
security definer
set search_path = ''
as $$
  select m.role
  from public.workspace_memberships m
  join public.workspaces w on w.id = m.workspace_id
  where m.workspace_id = p_workspace_id
    and m.user_id = (select auth.uid())
    and m.status = 'active'
    and w.deleted_at is null;
$$;

create function private.workspace_is_writable(p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.workspaces w
    where w.id = p_workspace_id and w.deleted_at is null and w.status = 'active'
  );
$$;

-- Integer entitlement of the workspace's plan; null means "not granted" and callers treat it as 0.
create function private.entitlement_int(p_workspace_id uuid, p_key public.entitlement_key)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select pe.int_value
  from public.workspaces w
  join public.plan_entitlements pe on pe.plan_id = w.plan_id and pe.key = p_key
  where w.id = p_workspace_id;
$$;

-- ---------------------------------------------------------------------------------------------
-- Membership invariants
-- ---------------------------------------------------------------------------------------------

create function private.guard_last_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_other_owners integer;
begin
  if old.role <> 'owner' or old.status <> 'active' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'UPDATE' and new.role = 'owner' and new.status = 'active' then
    return new;
  end if;

  -- Serialize concurrent demotions/removals on the same workspace.
  perform 1 from public.workspaces w where w.id = old.workspace_id for update;
  if not found then
    -- The workspace itself is being hard-deleted (purge cascade): nothing to protect.
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  select count(*) into v_other_owners
  from public.workspace_memberships m
  where m.workspace_id = old.workspace_id
    and m.role = 'owner'
    and m.status = 'active'
    and m.id <> old.id;

  if v_other_owners = 0 then
    raise exception 'a workspace must keep at least one owner' using errcode = 'LK020';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger workspace_memberships_guard_last_owner
before update or delete on public.workspace_memberships
for each row execute function private.guard_last_owner();

-- Prepared for Sprint 7 invitations: pending and active seats count against team_members.
create function private.enforce_team_member_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit integer;
  v_seats integer;
begin
  if new.status = 'revoked' then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.status <> 'revoked' then
    return new;
  end if;

  perform 1 from public.workspaces w where w.id = new.workspace_id for update;
  v_limit := coalesce(private.entitlement_int(new.workspace_id, 'team_members'), 0);

  select count(*) into v_seats
  from public.workspace_memberships m
  where m.workspace_id = new.workspace_id
    and m.status <> 'revoked'
    and m.id <> new.id;

  if v_seats + 1 > v_limit then
    raise exception 'team member limit reached' using errcode = 'LK010', detail = 'team_members';
  end if;
  return new;
end;
$$;

create trigger workspace_memberships_enforce_team_limit
before insert or update of status on public.workspace_memberships
for each row execute function private.enforce_team_member_limit();

-- ---------------------------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------------------------

-- Idempotent: creates the account row, the personal workspace and the owner membership if missing.
-- Called after email verification and by the authenticated layout as self-healing (ADR 0004).
create function public.ensure_personal_workspace()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_confirmed_at timestamptz;
  v_display_name text;
  v_account_deleted_at timestamptz;
  v_workspace_id uuid;
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  select u.email_confirmed_at, left(nullif(btrim(u.raw_user_meta_data ->> 'display_name'), ''), 80)
  into v_confirmed_at, v_display_name
  from auth.users u
  where u.id = v_uid;

  if v_confirmed_at is null then
    raise exception 'email confirmation required' using errcode = '42501';
  end if;

  insert into public.user_accounts (id, display_name)
  values (v_uid, v_display_name)
  on conflict (id) do nothing;

  select a.deleted_at into v_account_deleted_at from public.user_accounts a where a.id = v_uid;
  if v_account_deleted_at is not null then
    raise exception 'account is deleted' using errcode = '42501';
  end if;

  select w.id into v_workspace_id
  from public.workspaces w
  where w.created_by = v_uid and w.kind = 'personal';

  if v_workspace_id is null then
    insert into public.workspaces (name, kind, created_by)
    values (coalesce(v_display_name, 'Personal'), 'personal', v_uid)
    on conflict (created_by) where kind = 'personal' do nothing
    returning id into v_workspace_id;

    if v_workspace_id is null then
      -- A concurrent call created it first.
      select w.id into v_workspace_id
      from public.workspaces w
      where w.created_by = v_uid and w.kind = 'personal';
    else
      perform private.write_audit_event(v_workspace_id, 'workspace.created', 'workspace', v_workspace_id,
        jsonb_build_object('kind', 'personal'));
    end if;
  end if;

  -- Checked explicitly: BEFORE INSERT triggers (seat limit) fire even when ON CONFLICT would skip.
  if not exists (
    select 1 from public.workspace_memberships m
    where m.workspace_id = v_workspace_id and m.user_id = v_uid
  ) then
    insert into public.workspace_memberships (workspace_id, user_id, role, status, accepted_at)
    values (v_workspace_id, v_uid, 'owner', 'active', now())
    on conflict (workspace_id, user_id) do nothing;
  end if;

  return v_workspace_id;
end;
$$;

-- Creates an agency workspace owned by the caller. Capped per user so free workspaces cannot be
-- multiplied to bypass max_profiles (provisional cap: 3 live agency workspaces).
create function public.create_agency_workspace(p_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_name text := btrim(coalesce(p_name, ''));
  v_owned integer;
  v_workspace_id uuid;
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if not exists (select 1 from public.user_accounts a where a.id = v_uid and a.deleted_at is null) then
    raise exception 'account is not ready' using errcode = '42501';
  end if;
  if char_length(v_name) not between 2 and 80 then
    raise exception 'workspace name must have 2 to 80 characters' using errcode = '23514';
  end if;

  select count(*) into v_owned
  from public.workspaces w
  where w.created_by = v_uid and w.kind = 'agency' and w.deleted_at is null;
  if v_owned >= 3 then
    raise exception 'agency workspace limit reached' using errcode = 'LK050';
  end if;

  insert into public.workspaces (name, kind, created_by)
  values (v_name, 'agency', v_uid)
  returning id into v_workspace_id;

  insert into public.workspace_memberships (workspace_id, user_id, role, status, accepted_at)
  values (v_workspace_id, v_uid, 'owner', 'active', now());

  perform private.write_audit_event(v_workspace_id, 'workspace.created', 'workspace', v_workspace_id,
    jsonb_build_object('kind', 'agency'));
  return v_workspace_id;
end;
$$;

create function public.soft_delete_workspace(p_workspace_id uuid)
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

  update public.workspaces
  set deleted_at = now(), purge_after = now() + private.soft_delete_retention()
  where id = p_workspace_id;

  perform private.write_audit_event(p_workspace_id, 'workspace.deleted', 'workspace', p_workspace_id);
end;
$$;

create function public.change_member_role(p_membership_id uuid, p_role public.workspace_role)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_membership public.workspace_memberships;
  v_actor_role public.workspace_role;
begin
  if (select auth.uid()) is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  select m.* into v_membership from public.workspace_memberships m where m.id = p_membership_id for update;
  if not found then
    raise exception 'membership not found' using errcode = 'P0002';
  end if;

  v_actor_role := private.workspace_role(v_membership.workspace_id);
  if v_actor_role is null then
    -- Same answer as a missing row: do not reveal other tenants' memberships.
    raise exception 'membership not found' using errcode = 'P0002';
  end if;
  if not private.workspace_is_writable(v_membership.workspace_id) then
    raise exception 'workspace does not accept changes' using errcode = '42501';
  end if;
  if v_actor_role = 'editor' then
    raise exception 'editors cannot change roles' using errcode = '42501';
  end if;
  if v_actor_role = 'admin' and (v_membership.role = 'owner' or p_role = 'owner') then
    raise exception 'admins cannot grant or change the owner role' using errcode = '42501';
  end if;
  if v_membership.role = p_role then
    return;
  end if;

  update public.workspace_memberships set role = p_role where id = p_membership_id;

  perform private.write_audit_event(v_membership.workspace_id, 'membership.role_changed', 'membership', p_membership_id,
    jsonb_build_object('from', v_membership.role, 'to', p_role));
end;
$$;

-- Revokes a membership (kept for history). Members may always leave; owners/admins remove others.
create function public.remove_workspace_member(p_membership_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_membership public.workspace_memberships;
  v_actor_role public.workspace_role;
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  select m.* into v_membership from public.workspace_memberships m where m.id = p_membership_id for update;
  if not found then
    raise exception 'membership not found' using errcode = 'P0002';
  end if;

  v_actor_role := private.workspace_role(v_membership.workspace_id);
  if v_actor_role is null then
    raise exception 'membership not found' using errcode = 'P0002';
  end if;
  if v_membership.status = 'revoked' then
    return;
  end if;
  if v_membership.user_id <> v_uid then
    if v_actor_role = 'editor' then
      raise exception 'editors cannot remove members' using errcode = '42501';
    end if;
    if v_actor_role = 'admin' and v_membership.role = 'owner' then
      raise exception 'admins cannot remove owners' using errcode = '42501';
    end if;
  end if;

  update public.workspace_memberships
  set status = 'revoked', revoked_at = now()
  where id = p_membership_id;

  perform private.write_audit_event(v_membership.workspace_id, 'membership.removed', 'membership', p_membership_id,
    jsonb_build_object('role', v_membership.role, 'self', v_membership.user_id = v_uid));
end;
$$;

-- Authentication events recorded by the server after Supabase Auth succeeds. The actor is always
-- the caller; metadata is reduced to an allowlist of short string values.
create function public.record_auth_event(p_action public.audit_action, p_metadata jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_metadata jsonb;
begin
  if (select auth.uid()) is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_action not in ('auth.sign_in', 'auth.sign_out', 'auth.password_reset_completed') then
    raise exception 'only authentication events can be recorded here' using errcode = '42501';
  end if;

  select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb) into v_metadata
  from jsonb_each(case when jsonb_typeof(p_metadata) = 'object' then p_metadata else '{}'::jsonb end) e
  where e.key in ('method', 'correlation_id')
    and jsonb_typeof(e.value) = 'string'
    and char_length(e.value #>> '{}') <= 64;

  perform private.write_audit_event(null, p_action, 'user', (select auth.uid()), v_metadata);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Row Level Security and privileges
-- ---------------------------------------------------------------------------------------------

alter table public.user_accounts enable row level security;
alter table public.plans enable row level security;
alter table public.plan_entitlements enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_memberships enable row level security;
alter table public.audit_events enable row level security;

revoke all on public.user_accounts, public.plans, public.plan_entitlements, public.workspaces,
  public.workspace_memberships, public.audit_events from public, anon, authenticated, service_role;

-- user_accounts: a person reads and edits only their own live row.
grant select on public.user_accounts to authenticated;
grant update (display_name, locale) on public.user_accounts to authenticated;

create policy user_accounts_select_own on public.user_accounts
for select to authenticated
using (id = (select auth.uid()) and deleted_at is null);

create policy user_accounts_update_own on public.user_accounts
for update to authenticated
using (id = (select auth.uid()) and deleted_at is null)
with check (id = (select auth.uid()) and deleted_at is null);

-- plans / entitlements: public catalogue for signed-in users only.
grant select on public.plans, public.plan_entitlements to authenticated;

create policy plans_select_authenticated on public.plans
for select to authenticated using (true);

create policy plan_entitlements_select_authenticated on public.plan_entitlements
for select to authenticated using (true);

-- workspaces: members read; owners/admins rename. Creation/deletion only through RPCs.
grant select on public.workspaces to authenticated;
grant update (name) on public.workspaces to authenticated;

create policy workspaces_select_member on public.workspaces
for select to authenticated
using (id in (select private.member_workspace_ids()));

create policy workspaces_update_owner_admin on public.workspaces
for update to authenticated
using (id in (select private.writable_workspace_ids(array['owner', 'admin']::public.workspace_role[])))
with check (id in (select private.writable_workspace_ids(array['owner', 'admin']::public.workspace_role[])));

-- memberships: members see who belongs to their workspaces. All writes go through RPCs.
grant select on public.workspace_memberships to authenticated;

create policy workspace_memberships_select_member on public.workspace_memberships
for select to authenticated
using (workspace_id in (select private.member_workspace_ids()));

-- audit_events: owners/admins read their workspace trail; people read their own account events.
grant select on public.audit_events to authenticated;

create policy audit_events_select_owner_admin_or_self on public.audit_events
for select to authenticated
using (
  workspace_id in (select private.workspace_ids_with_role(array['owner', 'admin']::public.workspace_role[]))
  or (workspace_id is null and actor_user_id = (select auth.uid()))
);

-- service_role (server-side administration and test setup only; bypasses RLS). The audit trail
-- stays append-only for it too.
grant select, insert, update, delete on public.user_accounts, public.plans, public.plan_entitlements,
  public.workspaces, public.workspace_memberships to service_role;
grant select, insert on public.audit_events to service_role;

-- Functions: nothing is callable by default.
revoke all on all functions in schema private from public, anon, authenticated;
grant execute on function
  private.member_workspace_ids(),
  private.writable_workspace_ids(public.workspace_role[]),
  private.workspace_ids_with_role(public.workspace_role[])
to authenticated;

revoke all on function
  public.ensure_personal_workspace(),
  public.create_agency_workspace(text),
  public.soft_delete_workspace(uuid),
  public.change_member_role(uuid, public.workspace_role),
  public.remove_workspace_member(uuid),
  public.record_auth_event(public.audit_action, jsonb)
from public, anon;

grant execute on function
  public.ensure_personal_workspace(),
  public.create_agency_workspace(text),
  public.soft_delete_workspace(uuid),
  public.change_member_role(uuid, public.workspace_role),
  public.remove_workspace_member(uuid),
  public.record_auth_event(public.audit_action, jsonb)
to authenticated;
