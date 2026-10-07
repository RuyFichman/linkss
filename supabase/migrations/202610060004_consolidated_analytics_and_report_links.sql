-- Sprint 7, part 2 (ADR 0013): the consolidated results of a workspace and read-only report links.
--
-- Forward-only and additive. An application one version behind keeps working: the per-page read
-- keeps its signature and its numbers (it now delegates to a private core that the shared report
-- also uses, so there is one definition of every count).

alter table public.audit_events drop constraint audit_events_target_type_check;
alter table public.audit_events add constraint audit_events_target_type_check
  check (target_type in ('user', 'workspace', 'membership', 'profile', 'invitation', 'report_link'));

-- ---------------------------------------------------------------------------------------------
-- One definition of a page's report, used by the members' dashboard and by the shared report
-- ---------------------------------------------------------------------------------------------

-- The body that public.get_profile_analytics had in Sprint 6, unchanged, minus the caller checks.
-- Never granted to a client role: callers authorize first.
create function private.profile_analytics(p_profile public.profiles, p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today date := private.analytics_today();
  v_history integer;
  v_from date;
  v_to date;
  v_last_final date;
  v_live_from date;
  v_result jsonb;
begin
  if p_from is null or p_to is null or p_from > p_to then
    raise exception 'invalid window' using errcode = '22023';
  end if;

  v_history := least(greatest(coalesce(private.entitlement_int(p_profile.workspace_id, 'analytics_days'), 0), 1),
    private.analytics_aggregate_retention_days());
  v_to := least(p_to, v_today);
  v_from := least(greatest(p_from, v_today - (v_history - 1)), v_to);

  select max(s.day) into v_last_final from public.analytics_day_status s where s.finalized_at is not null;
  v_live_from := greatest(v_from, coalesce(v_last_final + 1, v_from));

  with counts as materialized (
    select d.day, d.dimension, d.key, d.event_type, d.count
    from public.analytics_daily d
    where d.profile_id = p_profile.id and d.day between v_from and v_to and d.day < v_live_from
    union all
    select c.day, c.dimension, c.key, c.event_type, c.count
    from private.analytics_counts(p_profile.id, v_live_from, v_to) c
  )
  select jsonb_build_object(
    'days', coalesce((
      select jsonb_agg(jsonb_build_object('day', t.day, 'event_type', t.event_type, 'count', t.total) order by t.day, t.event_type)
      from (select c.day, c.event_type, sum(c.count)::integer as total from counts c where c.dimension = 'total' group by c.day, c.event_type) t), '[]'::jsonb),
    'blocks', coalesce((
      select jsonb_agg(jsonb_build_object('block_id', t.key, 'event_type', t.event_type, 'count', t.total) order by t.total desc, t.key, t.event_type)
      from (select c.key, c.event_type, sum(c.count)::integer as total from counts c where c.dimension = 'block' group by c.key, c.event_type) t), '[]'::jsonb),
    'sources', coalesce((
      select jsonb_agg(jsonb_build_object('key', t.key, 'count', t.total) order by t.total desc, t.key)
      from (select c.key, sum(c.count)::integer as total from counts c where c.dimension = 'source' group by c.key) t), '[]'::jsonb),
    'utms', coalesce((
      select jsonb_agg(jsonb_build_object('key', t.key, 'count', t.total) order by t.total desc, t.key)
      from (select c.key, sum(c.count)::integer as total from counts c where c.dimension = 'utm' group by c.key order by 2 desc, 1 limit 20) t), '[]'::jsonb),
    'devices', coalesce((
      select jsonb_agg(jsonb_build_object('key', t.key, 'count', t.total) order by t.total desc, t.key)
      from (select c.key, sum(c.count)::integer as total from counts c where c.dimension = 'device' group by c.key) t), '[]'::jsonb),
    'countries', coalesce((
      select jsonb_agg(jsonb_build_object('key', t.key, 'count', t.total) order by t.total desc, t.key)
      from (select c.key, sum(c.count)::integer as total from counts c where c.dimension = 'country' group by c.key order by 2 desc, 1 limit 20) t), '[]'::jsonb)
  ) into v_result;

  return v_result || jsonb_build_object(
    'timezone', private.analytics_timezone(),
    'today', v_today,
    'from', v_from,
    'to', v_to,
    'history_days', v_history,
    'configured', private.analytics_is_configured(),
    -- The first day this page could have data.
    'collecting_since', greatest(
      private.analytics_local_day(p_profile.created_at),
      (select private.analytics_local_day(s.collection_started_at) from public.analytics_settings s)),
    -- Across the whole retained history, not only the window: "never had data" is not "zero here".
    'first_event_day', least(
      (select min(d.day) from public.analytics_daily d where d.profile_id = p_profile.id),
      (select min(e.day) from public.analytics_events e where e.profile_id = p_profile.id)),
    'last_final_day', v_last_final);
end;
$$;

-- Same signature, same answer as in Sprint 6.
create or replace function public.get_profile_analytics(p_profile_id uuid, p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles;
begin
  if (select auth.uid()) is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  select p.* into v_profile from public.profiles p where p.id = p_profile_id and p.deleted_at is null;
  -- Matrix: analytics.view = owner, admin, editor, that is, every member (modules/identity/permissions.ts).
  if not found or private.workspace_role(v_profile.workspace_id) is null then
    raise exception 'profile not found' using errcode = 'P0002';
  end if;
  return private.profile_analytics(v_profile, p_from, p_to);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Consolidated read (members)
-- ---------------------------------------------------------------------------------------------

-- Raw events of ONE workspace for days that are not final yet, counted the way
-- private.analytics_counts counts them, restricted to the two dimensions the consolidated view
-- shows. It exists apart from analytics_counts only so that the scan is bounded by the workspace
-- (index analytics_events_workspace_profile_time_idx) instead of by the day across every tenant;
-- pgTAP compares its result with the per-page read (160-reports.test.sql).
create function private.analytics_workspace_counts(p_workspace_id uuid, p_from date, p_to date)
returns table (
  profile_id uuid,
  day date,
  dimension public.analytics_dimension,
  key text,
  event_type public.analytics_event_type,
  count integer
)
language sql
stable
security definer
set search_path = ''
as $$
  with e as materialized (
    select ev.profile_id, ev.day, ev.event_type, ev.source
    from public.analytics_events ev
    where ev.workspace_id = p_workspace_id
      and ev.occurred_at >= private.analytics_day_start(p_from)
      and ev.day between p_from and p_to
  )
  select e.profile_id, e.day, 'total'::public.analytics_dimension, '', e.event_type, count(*)::integer
  from e group by e.profile_id, e.day, e.event_type
  union all
  select e.profile_id, e.day, 'source', e.source::text, e.event_type, count(*)::integer
  from e where e.event_type = 'page_view' and e.source is not null group by e.profile_id, e.day, e.source, e.event_type;
$$;

-- How many page rows the consolidated read returns. Totals always cover every page.
create function private.workspace_analytics_page_limit()
returns integer
language sql
immutable
set search_path = ''
as $$ select 200 $$;

-- Results of every page of a workspace for a window of reporting days: workspace totals per day,
-- sources summed across pages, and one row per page. The window is clamped exactly like the
-- per-page read (today, and the analytics_days entitlement). Soft-deleted pages are left out of
-- everything; a page is listed when it is on the air or has an event in the window, so drafts and
-- archived pages without results do not bury the ones that matter (they are counted in
-- pages_omitted). One JSON object, bounded: at most 100 days x 9 types, 12 sources and
-- private.workspace_analytics_page_limit() pages.
create function public.get_workspace_analytics(p_workspace_id uuid, p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today date := private.analytics_today();
  v_started date;
  v_created date;
  v_history integer;
  v_from date;
  v_to date;
  v_last_final date;
  v_live_from date;
  v_result jsonb;
begin
  if (select auth.uid()) is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  -- Matrix: analytics.view = owner, admin, editor, that is, every member (modules/identity/permissions.ts).
  if p_workspace_id is null or private.workspace_role(p_workspace_id) is null then
    raise exception 'workspace not found' using errcode = 'P0002';
  end if;
  if p_from is null or p_to is null or p_from > p_to then
    raise exception 'invalid window' using errcode = '22023';
  end if;

  v_history := least(greatest(coalesce(private.entitlement_int(p_workspace_id, 'analytics_days'), 0), 1),
    private.analytics_aggregate_retention_days());
  v_to := least(p_to, v_today);
  v_from := least(greatest(p_from, v_today - (v_history - 1)), v_to);

  select max(s.day) into v_last_final from public.analytics_day_status s where s.finalized_at is not null;
  v_live_from := greatest(v_from, coalesce(v_last_final + 1, v_from));
  select private.analytics_local_day(s.collection_started_at) into v_started from public.analytics_settings s;
  select private.analytics_local_day(w.created_at) into v_created from public.workspaces w where w.id = p_workspace_id;

  with pages as materialized (
    select p.id, p.title, p.slug, p.status, p.created_at
    from public.profiles p
    where p.workspace_id = p_workspace_id and p.deleted_at is null
  ),
  counts as materialized (
    select d.profile_id, d.day, d.dimension, d.key, d.event_type, d.count
    from public.analytics_daily d
    where d.workspace_id = p_workspace_id and d.day between v_from and v_to and d.day < v_live_from
      and d.dimension in ('total', 'source')
      and d.profile_id in (select pg.id from pages pg)
    union all
    select c.profile_id, c.day, c.dimension, c.key, c.event_type, c.count
    from private.analytics_workspace_counts(p_workspace_id, v_live_from, v_to) c
    where c.profile_id in (select pg.id from pages pg)
  ),
  page_counts as (
    select t.profile_id, jsonb_object_agg(t.event_type, t.total) as counts,
      coalesce(sum(t.total) filter (where t.event_type = 'page_view'), 0) as visits
    from (select c.profile_id, c.event_type, sum(c.count)::integer as total from counts c where c.dimension = 'total' group by c.profile_id, c.event_type) t
    group by t.profile_id
  ),
  -- Across the whole retained history, like first_event_day of the per-page read.
  first_days as (
    select x.profile_id, min(x.day) as day
    from (
      select d.profile_id, min(d.day) as day from public.analytics_daily d where d.workspace_id = p_workspace_id group by d.profile_id
      union all
      select e.profile_id, min(e.day) from public.analytics_events e where e.workspace_id = p_workspace_id group by e.profile_id
    ) x
    group by x.profile_id
  ),
  listed as (
    select pg.id, pg.title, pg.slug, pg.status, pg.created_at, pc.counts, coalesce(pc.visits, 0) as visits, fd.day as first_event_day,
      row_number() over (order by coalesce(pc.visits, 0) desc, pg.title, pg.id) as position
    from pages pg
    left join page_counts pc on pc.profile_id = pg.id
    left join first_days fd on fd.profile_id = pg.id
    where pg.status = 'published' or pc.profile_id is not null
  )
  select jsonb_build_object(
    'days', coalesce((
      select jsonb_agg(jsonb_build_object('day', t.day, 'event_type', t.event_type, 'count', t.total) order by t.day, t.event_type)
      from (select c.day, c.event_type, sum(c.count)::integer as total from counts c where c.dimension = 'total' group by c.day, c.event_type) t), '[]'::jsonb),
    'sources', coalesce((
      select jsonb_agg(jsonb_build_object('key', t.key, 'count', t.total) order by t.total desc, t.key)
      from (select c.key, sum(c.count)::integer as total from counts c where c.dimension = 'source' group by c.key) t), '[]'::jsonb),
    'pages', coalesce((
      select jsonb_agg(jsonb_build_object(
        'profile_id', l.id, 'title', l.title, 'slug', l.slug, 'status', l.status,
        'ever_published', exists (select 1 from public.profile_publications pub where pub.profile_id = l.id),
        'collecting_since', greatest(private.analytics_local_day(l.created_at), v_started),
        'first_event_day', l.first_event_day,
        'counts', coalesce(l.counts, '{}'::jsonb)) order by l.position)
      from listed l where l.position <= private.workspace_analytics_page_limit()), '[]'::jsonb),
    'page_count', (select count(*) from pages),
    'pages_omitted', (select count(*) from pages) - (select count(*) from listed),
    'pages_truncated', (select count(*) from listed) > private.workspace_analytics_page_limit(),
    'first_event_day', (select min(fd.day) from first_days fd where fd.profile_id in (select pg.id from pages pg))
  ) into v_result;

  return v_result || jsonb_build_object(
    'timezone', private.analytics_timezone(),
    'today', v_today,
    'from', v_from,
    'to', v_to,
    'history_days', v_history,
    'configured', private.analytics_is_configured(),
    'collecting_since', greatest(v_created, v_started),
    'last_final_day', v_last_final);
end;
$$;

-- Called by the application right before it hands the consolidated CSV to the person.
create function public.record_workspace_analytics_export(p_workspace_id uuid, p_from date, p_to date, p_rows integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  -- Matrix: analytics.export = owner, admin, editor (aggregates only; no visitor data).
  if p_workspace_id is null or private.workspace_role(p_workspace_id) is null then
    raise exception 'workspace not found' using errcode = 'P0002';
  end if;
  perform private.write_audit_event(p_workspace_id, 'analytics.exported', 'workspace', p_workspace_id,
    jsonb_build_object('scope', 'workspace', 'from', p_from, 'to', p_to, 'rows', greatest(0, coalesce(p_rows, 0))));
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Report links
-- ---------------------------------------------------------------------------------------------

-- Longest life of a link, in days (mirror of REPORT_LINK_MAX_EXPIRY_DAYS in modules/reports/links.ts).
create function private.report_link_max_days()
returns integer
language sql
immutable
set search_path = ''
as $$ select 90 $$;

-- How long a revoked or expired link is kept before it is deleted (provisional).
create function private.report_link_retention()
returns interval
language sql
immutable
set search_path = ''
as $$ select interval '90 days' $$;

create table public.report_links (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  -- The ONE page whose results the link shows.
  profile_id uuid not null references public.profiles (id) on delete cascade,
  -- SHA-256 of the token, hex. The token itself is shown once to its creator and never stored.
  token_hash text not null check (token_hash ~ '^[0-9a-f]{64}$'),
  -- Rolling window: this many reporting days ending on the last completed day.
  period_days integer not null check (period_days in (7, 30, 90)),
  -- The agency's own note ("Relatório de setembro"). Never shown on the report.
  label text check (label is null or (char_length(label) between 1 and 80 and label = btrim(label) and label !~ '[[:cntrl:]]')),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  revoked_by uuid references auth.users (id) on delete set null,
  constraint report_links_token_hash_key unique (token_hash),
  constraint report_links_expiry_window check (expires_at > created_at and expires_at <= created_at + interval '90 days')
);

-- RLS, the management list and the workspace foreign key.
create index report_links_workspace_created_idx on public.report_links (workspace_id, created_at desc);
-- The per-page list, the per-page limit and the page foreign key.
create index report_links_profile_created_idx on public.report_links (profile_id, created_at desc);
-- Retention purge.
create index report_links_expires_idx on public.report_links (expires_at);
create index report_links_created_by_idx on public.report_links (created_by) where created_by is not null;
create index report_links_revoked_by_idx on public.report_links (revoked_by) where revoked_by is not null;

comment on table public.report_links is
  'Read-only report links (ADR 0013). Each row lets anybody who holds the token read the aggregated results of ONE page through get_shared_report, until expires_at or revoked_at. Only the SHA-256 of the token is stored. No visitor data and no record of who opened the link. Finished links are deleted private.report_link_retention() after they ended, on the next creation in the workspace.';

-- Failed lookups of get_shared_report, to slow down somebody who tries addresses in bulk through
-- the application. `client_hash` is a salted daily hash of the address computed by the application
-- server (never the address), or 'direct' when the caller sent none. No token and no page.
create table public.report_lookup_failures (
  id bigint generated always as identity primary key,
  client_hash text not null check (client_hash ~ '^([0-9a-f]{32}|direct)$'),
  created_at timestamptz not null default now()
);

create index report_lookup_failures_client_idx on public.report_lookup_failures (client_hash, created_at desc);
create index report_lookup_failures_created_idx on public.report_lookup_failures (created_at);

comment on table public.report_lookup_failures is
  'Rate-limit counters for failed report-link lookups (ADR 0013): salted daily hash of the visitor address, or "direct". No raw IP, no token, no page. Rows are deleted after 24 hours by get_shared_report.';

alter table public.report_links enable row level security;
alter table public.report_lookup_failures enable row level security;
revoke all on public.report_links, public.report_lookup_failures from public, anon, authenticated, service_role;

-- Owners and admins see their workspace's links. token_hash is not granted: nobody reads it
-- through the API, and it would be useless anyway (the read hashes the token it is given).
grant select (id, workspace_id, profile_id, period_days, label, created_by, created_at, expires_at, revoked_at, revoked_by)
  on public.report_links to authenticated;

create policy report_links_select_owner_admin on public.report_links
for select to authenticated
using (workspace_id in (select private.workspace_ids_with_role(array['owner', 'admin']::public.workspace_role[])));

-- Server-side administration only (the Sprint 9 purge, export and account deletion).
grant select, delete on public.report_links to service_role;
grant select on public.report_lookup_failures to service_role;

-- Creates a link for one page. `p_token_hash` is the SHA-256 of a token generated by the
-- application server; the database never sees the token on this path.
--   42501  not signed in, workspace suspended, or the caller is not an owner or admin
--   P0002  the page does not exist, is deleted, or belongs to a workspace the caller is not in
--   LK010  (detail shareable_reports) the plan has no shared reports
--   22023  (detail period | expires | label | token_hash) invalid input
--   LK091  (detail page | workspace) too many active links
--   LK092  too many links created in 24 hours
create function public.create_report_link(p_profile_id uuid, p_token_hash text, p_period_days integer, p_expires_in_days integer, p_label text default null)
returns table (link_id uuid, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := (select auth.uid());
  v_profile public.profiles;
  v_role public.workspace_role;
  v_label text := nullif(btrim(regexp_replace(coalesce(p_label, ''), '\s+', ' ', 'g')), '');
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  select p.* into v_profile from public.profiles p where p.id = p_profile_id and p.deleted_at is null;
  if found then
    v_role := private.workspace_role(v_profile.workspace_id);
  end if;
  if v_role is null then
    -- Same answer as a missing page: do not confirm other tenants' pages.
    raise exception 'profile not found' using errcode = 'P0002';
  end if;
  if not private.workspace_is_writable(v_profile.workspace_id) then
    raise exception 'workspace does not accept changes' using errcode = '42501';
  end if;
  -- Matrix: reports.create = owner, admin (modules/identity/permissions.ts): a link publishes
  -- workspace data outside the workspace.
  if v_role not in ('owner', 'admin') then
    raise exception 'only owners and admins create report links' using errcode = '42501';
  end if;
  if not coalesce(private.entitlement_bool(v_profile.workspace_id, 'shareable_reports'), false) then
    raise exception 'shared reports are not in this plan' using errcode = 'LK010', detail = 'shareable_reports';
  end if;
  if p_period_days is null or p_period_days not in (7, 30, 90)
    or p_period_days > coalesce(private.entitlement_int(v_profile.workspace_id, 'analytics_days'), 0) then
    raise exception 'invalid period' using errcode = '22023', detail = 'period';
  end if;
  if p_expires_in_days is null or p_expires_in_days < 1 or p_expires_in_days > private.report_link_max_days() then
    raise exception 'invalid expiry' using errcode = '22023', detail = 'expires';
  end if;
  if v_label is not null and (char_length(v_label) > 80 or v_label ~ '[[:cntrl:]]') then
    raise exception 'invalid label' using errcode = '22023', detail = 'label';
  end if;
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid token hash' using errcode = '22023', detail = 'token_hash';
  end if;

  -- Serializes the counts below with other creations in the workspace.
  perform 1 from public.workspaces w where w.id = v_profile.workspace_id for update;

  delete from public.report_links l
  where l.workspace_id = v_profile.workspace_id
    and least(coalesce(l.revoked_at, l.expires_at), l.expires_at) < now() - private.report_link_retention();

  if (select count(*) from public.report_links l
      where l.workspace_id = v_profile.workspace_id and l.created_at > now() - interval '24 hours') >= 30 then
    raise exception 'too many report links created' using errcode = 'LK092';
  end if;
  if (select count(*) from public.report_links l
      where l.profile_id = v_profile.id and l.revoked_at is null and l.expires_at > now()) >= 5 then
    raise exception 'too many active report links' using errcode = 'LK091', detail = 'page';
  end if;
  if (select count(*) from public.report_links l
      where l.workspace_id = v_profile.workspace_id and l.revoked_at is null and l.expires_at > now()) >= 100 then
    raise exception 'too many active report links' using errcode = 'LK091', detail = 'workspace';
  end if;

  insert into public.report_links (workspace_id, profile_id, token_hash, period_days, label, created_by, expires_at)
  values (v_profile.workspace_id, v_profile.id, p_token_hash, p_period_days, v_label, v_uid, now() + make_interval(days => p_expires_in_days))
  returning id, report_links.expires_at into link_id, expires_at;

  -- The trail never holds the label or anything derived from the token.
  perform private.write_audit_event(v_profile.workspace_id, 'report_link.created', 'report_link', link_id,
    jsonb_build_object('profileId', v_profile.id, 'periodDays', p_period_days, 'expiresInDays', p_expires_in_days));
  return next;
end;
$$;

-- Revokes a link. The next read of its token answers "unavailable". Revoking twice is a no-op.
create function public.revoke_report_link(p_link_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_link public.report_links;
  v_role public.workspace_role;
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  select l.* into v_link from public.report_links l where l.id = p_link_id for update;
  if found then
    v_role := private.workspace_role(v_link.workspace_id);
  end if;
  if v_role is null then
    -- Same answer as a missing row: do not confirm other tenants' links.
    raise exception 'report link not found' using errcode = 'P0002';
  end if;
  -- Matrix: reports.revoke = owner, admin (modules/identity/permissions.ts). Unlike other writes,
  -- this one is accepted in a suspended workspace: taking data off the air is never blocked.
  if v_role not in ('owner', 'admin') then
    raise exception 'only owners and admins revoke report links' using errcode = '42501';
  end if;
  if v_link.revoked_at is not null then
    return;
  end if;

  update public.report_links set revoked_at = now(), revoked_by = v_uid where id = p_link_id;

  perform private.write_audit_event(v_link.workspace_id, 'report_link.revoked', 'report_link', p_link_id,
    jsonb_build_object('profileId', v_link.profile_id));
end;
$$;

-- The link a token opens, or no row. One answer for a token that is malformed, unknown, expired or
-- revoked, whose page is deleted, whose workspace is deleted or suspended, or whose workspace no
-- longer has shared reports in its plan. Read-only.
create function private.resolve_report_link(p_token text)
returns setof public.report_links
language sql
stable
security definer
set search_path = ''
as $$
  select l.*
  from public.report_links l
  join public.workspaces w on w.id = l.workspace_id
  join public.profiles p on p.id = l.profile_id
  where p_token ~ '^[A-Za-z0-9_-]{43}$'
    and l.token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
    and l.revoked_at is null
    and l.expires_at > now()
    and w.deleted_at is null
    and w.status = 'active'
    and p.deleted_at is null
    and coalesce(private.entitlement_bool(l.workspace_id, 'shareable_reports'), false);
$$;

-- The anonymous read behind /r/<token>. Answers {"status": "unavailable"} and nothing else for
-- every token that does not open a report (see private.resolve_report_link) and for a caller over
-- the failed-lookup limit; otherwise the closed field list below, which is the whole report:
--   status, workspace_name, page_title, page_slug (only while the page is on the air), expires_at,
--   ever_published, show_badge, timezone, today, from, to, configured, collecting_since,
--   first_event_day, last_final_day,
--   days[]    {day, event_type, count}
--   sources[] {key, count}
--   blocks[]  {ref, position, block_type, title, event_type, count}
-- No identifier of the workspace, the page, a block or a person; no UTM values, devices or
-- countries; nothing from the draft: titles come from the published snapshot. The window is the
-- link's period ending on the last completed reporting day, read by private.profile_analytics, so
-- the numbers are the per-page dashboard's numbers for the same days.
--
-- Failed lookups: 20 per client in 10 minutes (300 for callers that send no client hash, counted
-- together); past that, every lookup of that client is "unavailable" until the window moves on.
-- At most 5,000 failures are recorded per 10 minutes, so the counter table stays bounded.
create function public.get_shared_report(p_token text, p_client text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_unavailable constant jsonb := jsonb_build_object('status', 'unavailable');
  v_client text := case when p_client ~ '^[0-9a-f]{32}$' then p_client else 'direct' end;
  v_failure_limit integer := 20;
  v_link public.report_links;
  v_profile public.profiles;
  v_document jsonb;
  v_today date := private.analytics_today();
  v_report jsonb;
begin
  if v_client = 'direct' then
    v_failure_limit := 300;
  end if;
  if (select count(*) from public.report_lookup_failures f
      where f.client_hash = v_client and f.created_at > now() - interval '10 minutes') >= v_failure_limit then
    return v_unavailable;
  end if;

  select r.* into v_link from private.resolve_report_link(p_token) r;
  if not found then
    delete from public.report_lookup_failures f where f.created_at < now() - interval '24 hours';
    if (select count(*) from public.report_lookup_failures f where f.created_at > now() - interval '10 minutes') < 5000 then
      insert into public.report_lookup_failures (client_hash) values (v_client);
    end if;
    return v_unavailable;
  end if;

  select p.* into v_profile from public.profiles p where p.id = v_link.profile_id;
  -- What visitors see or last saw: the live snapshot, or the latest one for a page that is off the air.
  select pub.document into v_document
  from public.profile_publications pub
  where pub.profile_id = v_profile.id
  order by (pub.id = v_profile.live_publication_id) desc nulls last, pub.version desc
  limit 1;

  v_report := private.profile_analytics(v_profile, (v_today - 1) - (v_link.period_days - 1), v_today - 1);

  return jsonb_build_object(
    'status', 'ok',
    'workspace_name', (select w.name from public.workspaces w where w.id = v_link.workspace_id),
    'page_title', coalesce(v_document ->> 'title', v_profile.title),
    'page_slug', case when v_profile.live_publication_id is not null then v_profile.slug end,
    'expires_at', v_link.expires_at,
    'ever_published', v_document is not null,
    'show_badge', not coalesce(private.entitlement_bool(v_link.workspace_id, 'remove_badge'), false),
    'timezone', v_report -> 'timezone',
    'today', v_report -> 'today',
    'from', v_report -> 'from',
    'to', v_report -> 'to',
    'configured', v_report -> 'configured',
    'collecting_since', v_report -> 'collecting_since',
    'first_event_day', v_report -> 'first_event_day',
    'last_final_day', v_report -> 'last_final_day',
    'days', v_report -> 'days',
    'sources', v_report -> 'sources',
    'blocks', coalesce((
      select jsonb_agg(jsonb_build_object(
        'ref', b.ref, 'position', b.position, 'block_type', b.block_type, 'title', b.title,
        'event_type', b.event_type, 'count', b.count) order by b.ref, b.event_type)
      from (
        select dense_rank() over (order by r.block_id) as ref, d.position, d.block ->> 'type' as block_type,
          -- Mirror of blockTitle in modules/analytics/block-labels.ts, over the PUBLISHED block.
          nullif(btrim(case d.block ->> 'type'
            when 'link' then d.block ->> 'title'
            when 'whatsapp' then d.block ->> 'label'
            when 'pix' then d.block ->> 'label'
            when 'form' then d.block ->> 'title'
            when 'embed' then d.block ->> 'title'
          end), '') as title,
          r.event_type, r.count
        from jsonb_to_recordset(v_report -> 'blocks') as r (block_id text, event_type text, count integer)
        left join lateral (
          select t.block, t.position::integer as position
          from jsonb_array_elements(coalesce(v_document -> 'blocks', '[]'::jsonb)) with ordinality as t (block, position)
          where t.block ->> 'id' = r.block_id
          limit 1
        ) d on true
      ) b), '[]'::jsonb));
end;
$$;

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
  public.get_profile_analytics(uuid, date, date),
  public.get_workspace_analytics(uuid, date, date),
  public.record_workspace_analytics_export(uuid, date, date, integer),
  public.create_report_link(uuid, text, integer, integer, text),
  public.revoke_report_link(uuid),
  public.get_shared_report(text, text)
from public, anon, authenticated, service_role;

grant execute on function
  public.get_profile_analytics(uuid, date, date),
  public.get_workspace_analytics(uuid, date, date),
  public.record_workspace_analytics_export(uuid, date, date, integer),
  public.create_report_link(uuid, text, integer, integer, text),
  public.revoke_report_link(uuid)
to authenticated;

-- The report is opened without an account, through the application server acting as anon; a
-- signed-in person who opens a link reads it through the same door and gets the same answer.
grant execute on function public.get_shared_report(text, text) to anon, authenticated;
