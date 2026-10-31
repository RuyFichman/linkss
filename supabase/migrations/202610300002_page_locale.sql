-- Language of a public page (ADR 0022).
--
-- The words the product puts on a public page (the copy button, the consent notice, the form's
-- messages, the not-found page) follow the page's language, chosen by who edits it, not the
-- visitor's. A new page takes the language of the account that creates it; the editor's "Página"
-- tab changes it. It is a page setting, like a custom domain: it is not part of the published
-- snapshot, so changing it does not need a new publication and the snapshot format is unchanged.
-- get_public_page, get_public_page_by_domain and get_shared_report return it.
--
-- Forward-only and compatible with rollback: a new column with a default and a trigger, the two public page
-- functions recreated with one more output column (the application reads columns by name), and
-- get_shared_report with one more key.

alter table public.profiles
  add column locale text not null default 'pt-BR'
    constraint profiles_locale_supported check (locale in ('pt-BR', 'es-ES'));

comment on column public.profiles.locale is
  'Language of the words the product shows on this public page (ADR 0022): pt-BR or es-ES. Starts in the creating account''s language; members who can edit the page change it. Not in the published snapshot. Mirrors LOCALES in apps/web/src/lib/locale.ts.';

-- A new page starts in the language of the account that creates it (pt-BR without a session, as
-- for the service role). A trigger rather than a column default: it runs with its owner's rights,
-- so no client role needs to execute a function in private. An insert that names another
-- supported language keeps it.
create function private.profiles_default_locale()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.locale = 'pt-BR' then
    new.locale := coalesce(
      (select a.locale from public.user_accounts a where a.id = (select auth.uid())),
      'pt-BR');
  end if;
  return new;
end;
$$;

revoke all on function private.profiles_default_locale() from public, anon, authenticated;

create trigger profiles_default_locale
before insert on public.profiles
for each row execute function private.profiles_default_locale();

-- Same rule as every other draft column: the update policy limits it to owners, admins and
-- editors of the workspace, and freezes it while the page is archived.
grant update (locale) on public.profiles to authenticated;

drop function public.get_public_page_by_domain(text);
drop function public.get_public_page(text);

create function public.get_public_page(p_slug text)
returns table (
  state text, canonical_slug text, document jsonb, version integer,
  published_at timestamptz, show_badge boolean, custom_domain text, pixels jsonb, locale text
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
    locale := v_profile.locale;
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
      if coalesce(private.entitlement_bool(v_profile.workspace_id, 'custom_domain'), false) then
        select d.hostname into custom_domain from public.profile_domains d
          where d.profile_id = v_profile.id and d.status = 'active';
      end if;
      if coalesce(private.entitlement_bool(v_profile.workspace_id, 'tracking_pixels'), false) then
        select jsonb_strip_nulls(jsonb_build_object('meta', x.meta_pixel_id, 'ga', x.ga_measurement_id)) into pixels
          from public.profile_pixels x where x.profile_id = v_profile.id;
      end if;
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


-- The page a custom hostname opens: the same answer as get_public_page for that page.
create function public.get_public_page_by_domain(p_hostname text)
returns table (
  state text, canonical_slug text, document jsonb, version integer,
  published_at timestamptz, show_badge boolean, custom_domain text, pixels jsonb, locale text
)
language plpgsql stable security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  v_hostname text := lower(btrim(coalesce(p_hostname, '')));
  v_slug text;
begin
  if private.domain_hostname_is_well_formed(v_hostname) then
    select p.slug into v_slug
    from public.profile_domains d
    join public.profiles p on p.id = d.profile_id
    join public.workspaces w on w.id = d.workspace_id
    where d.hostname = v_hostname and d.status = 'active'
      and p.deleted_at is null and w.deleted_at is null
      and coalesce(private.entitlement_bool(d.workspace_id, 'custom_domain'), false);
  end if;
  if v_slug is null then
    state := 'not_found';
    return next; return;
  end if;
  return query select * from public.get_public_page(v_slug);
end;
$$;


revoke all on function
  public.get_public_page(text),
  public.get_public_page_by_domain(text)
from public, anon, authenticated, service_role;

grant execute on function
  public.get_public_page(text),
  public.get_public_page_by_domain(text)
to anon, authenticated, service_role;

-- The shared report is read in the page's language. Same function, one more key.
create or replace function public.get_shared_report(p_token text, p_client text default null)
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
    'locale', v_profile.locale,
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

