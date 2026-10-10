-- Sprint 8, part 2: custom domains with proof of control (ADR 0016) and Meta Pixel / Google
-- Analytics identifiers per page (ADR 0017).
--
-- Both are entitlements read at request time: public.get_public_page decides, on every
-- regeneration, whether the domain and the pixels of a page are in force. Losing the plan deletes
-- nothing; the domain stops answering and the pixels stop loading, and both come back with the plan.
--
-- Forward-only. An application one version behind keeps working: it ignores the two columns added
-- to the answer of get_public_page and never calls the new functions.

-- ---------------------------------------------------------------------------------------------
-- Catalogue and audit
-- ---------------------------------------------------------------------------------------------

-- Mirror of lib/product.ts (`trackingPixels`); the drift test compares both.
insert into public.plan_entitlements (plan_id, key, int_value, bool_value) values
  ('free', 'tracking_pixels', null, false),
  ('pro', 'tracking_pixels', null, true),
  ('agency', 'tracking_pixels', null, true);

alter table public.audit_events drop constraint audit_events_target_type_check;
alter table public.audit_events add constraint audit_events_target_type_check
  check (target_type in ('user', 'workspace', 'membership', 'profile', 'invitation',
                         'report_link', 'subscription', 'moderation_report', 'domain'));

-- ---------------------------------------------------------------------------------------------
-- Hostname rules (mirror apps/web/src/modules/domains/hostname.ts)
-- ---------------------------------------------------------------------------------------------

-- Lowercase ASCII (IDNs arrive as punycode), at least two labels, no trailing dot, a top-level
-- label that starts with a letter (so an IPv4 address never passes), 253 characters at most.
create function private.domain_hostname_is_well_formed(p_hostname text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_hostname is not null
    and char_length(p_hostname) between 4 and 253
    and p_hostname ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]([a-z0-9-]{0,61}[a-z0-9])?$';
$$;

-- Names nobody may attach: the product's own, the hosting and database providers' shared
-- domains, and names reserved for local or private use. A suffix covers its subdomains.
create function private.domain_hostname_is_blocked(p_hostname text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select exists (
    select 1 from unnest(array[
      'linkfav.com', 'vercel.app', 'vercel.com', 'vercel-dns.com', 'now.sh', 'supabase.co', 'supabase.com',
      'localhost', 'local', 'internal', 'invalid', 'example', 'example.com', 'example.org', 'example.net', 'arpa'
    ]) as blocked(suffix)
    where p_hostname = blocked.suffix or p_hostname like '%.' || blocked.suffix
  );
$$;

-- ---------------------------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------------------------

-- One custom domain per page. `challenge` is the value the owner publishes in a TXT record to
-- prove control; it is not a secret (it is public in DNS) and is useless without DNS control.
--   pending  claimed, control not proven yet: serves nothing and reserves nothing
--   active   control proven: the hostname opens the page while the plan has `custom_domain`
--   lapsed   somebody else proved control of the hostname later and this proof was gone
-- `routing` is what the hosting provider said at the last check: whether the hostname reaches the
-- application with a certificate. It is information for the screen, never an authorization.
create table public.profile_domains (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  hostname text not null check (private.domain_hostname_is_well_formed(hostname)),
  challenge text not null check (challenge ~ '^linkfav-verify=[0-9a-f]{32}$'),
  status text not null default 'pending' check (status in ('pending', 'active', 'lapsed')),
  routing text not null default 'unknown' check (routing in ('unknown', 'pending', 'ok')),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  verified_at timestamptz,
  lapsed_at timestamptz,
  last_checked_at timestamptz,
  constraint profile_domains_profile_key unique (profile_id),
  constraint profile_domains_active_has_date check (status <> 'active' or verified_at is not null)
);

-- The invariant behind "cannot be hijacked": a hostname is in force for one page at most. Pending
-- claims are deliberately not unique, so claiming a name you do not control blocks nobody.
create unique index profile_domains_active_hostname_key on public.profile_domains (hostname) where status = 'active';
create index profile_domains_hostname_idx on public.profile_domains (hostname);
create index profile_domains_workspace_idx on public.profile_domains (workspace_id);
create index profile_domains_created_by_idx on public.profile_domains (created_by) where created_by is not null;

comment on table public.profile_domains is
  'Custom domains (ADR 0016). One row per page. A hostname opens a page only while its row is active and the workspace plan has custom_domain; public.confirm_profile_domain is the only path to active and requires a DNS proof attested by the application server. Not copied by page duplication. Rows go with the page.';

-- Third-party measurement identifiers of a page. Identifiers only: the product never stores or
-- accepts a script. Loaded on the public page after the visitor consents (ADR 0017).
create table public.profile_pixels (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  meta_pixel_id text check (meta_pixel_id ~ '^[0-9]{10,20}$'),
  ga_measurement_id text check (ga_measurement_id ~ '^G-[A-Z0-9]{6,14}$'),
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint profile_pixels_not_empty check (meta_pixel_id is not null or ga_measurement_id is not null)
);

create index profile_pixels_workspace_idx on public.profile_pixels (workspace_id);
create index profile_pixels_updated_by_idx on public.profile_pixels (updated_by) where updated_by is not null;

comment on table public.profile_pixels is
  'Meta Pixel and Google Analytics 4 identifiers of a page (ADR 0017). In force only while the workspace plan has tracking_pixels. Not copied by page duplication, never part of the published snapshot and never shown in shared reports.';

alter table public.profile_domains enable row level security;
alter table public.profile_pixels enable row level security;
revoke all on public.profile_domains, public.profile_pixels from public, anon, authenticated, service_role;

-- Every member sees the domain and the pixels of the pages they operate; writes are RPCs.
grant select on public.profile_domains, public.profile_pixels to authenticated;

create policy profile_domains_select_member on public.profile_domains
for select to authenticated
using (workspace_id in (select private.member_workspace_ids()));

create policy profile_pixels_select_member on public.profile_pixels
for select to authenticated
using (workspace_id in (select private.member_workspace_ids()));

-- Server-side administration only (export, account deletion, support).
grant select, delete on public.profile_domains, public.profile_pixels to service_role;

-- ---------------------------------------------------------------------------------------------
-- Attestation of the DNS check
-- ---------------------------------------------------------------------------------------------

create function private.domains_signing_secret()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select s.decrypted_secret from vault.decrypted_secrets s where s.name = 'domains_signing_secret' limit 1;
$$;

-- null: not configured; false: wrong signature; true: signed by the application server.
create function private.domains_signature_is_valid(p_text text, p_signature text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_secret text := private.domains_signing_secret();
  v_expected text;
begin
  if v_secret is null or char_length(v_secret) < 32 then
    return null;
  end if;
  if p_text is null or p_signature is null or p_signature !~ '^[0-9a-f]{64}$' then
    return false;
  end if;
  v_expected := encode(extensions.hmac(convert_to(p_text, 'UTF8'), convert_to(v_secret, 'UTF8'), 'sha256'), 'hex');
  return extensions.digest(convert_to(v_expected, 'UTF8'), 'sha256') = extensions.digest(convert_to(p_signature, 'UTF8'), 'sha256');
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Commands
-- ---------------------------------------------------------------------------------------------

-- Claims a hostname for a page and returns the challenge to publish in DNS. A claim proves
-- nothing and reserves nothing: the hostname may be active elsewhere, and that is not revealed here.
--   42501  not signed in, workspace suspended, or the caller is not an owner or admin
--   P0002  the page does not exist, is deleted, or belongs to a workspace the caller is not in
--   LK010  (detail custom_domain) the plan has no custom domain
--   22023  (detail hostname | blocked) invalid or reserved hostname
--   LK120  the page already has a domain
--   LK121  too many claims in 24 hours
create function public.claim_profile_domain(p_profile_id uuid, p_hostname text)
returns table (domain_id uuid, hostname text, challenge text)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  -- Matrix: domains.manage = owner, admin (modules/identity/permissions.ts).
  v_profile public.profiles := private.lock_profile_for_management(p_profile_id);
  v_hostname text := lower(btrim(coalesce(p_hostname, '')));
begin
  if not coalesce(private.entitlement_bool(v_profile.workspace_id, 'custom_domain'), false) then
    raise exception 'custom domains are not in this plan' using errcode = 'LK010', detail = 'custom_domain';
  end if;
  if not private.domain_hostname_is_well_formed(v_hostname) then
    raise exception 'invalid hostname' using errcode = '22023', detail = 'hostname';
  end if;
  if private.domain_hostname_is_blocked(v_hostname) then
    raise exception 'reserved hostname' using errcode = '22023', detail = 'blocked';
  end if;
  if exists (select 1 from public.profile_domains d where d.profile_id = v_profile.id) then
    raise exception 'page already has a domain' using errcode = 'LK120';
  end if;
  -- Removed claims leave no row, so the trail is what counts them.
  if (select count(*) from public.audit_events e
      where e.workspace_id = v_profile.workspace_id and e.action = 'domain.claimed'
        and e.created_at > now() - interval '24 hours') >= 20 then
    raise exception 'too many domain claims' using errcode = 'LK121';
  end if;

  insert into public.profile_domains (workspace_id, profile_id, hostname, challenge, created_by)
  values (v_profile.workspace_id, v_profile.id, v_hostname,
    'linkfav-verify=' || encode(extensions.gen_random_bytes(16), 'hex'), (select auth.uid()))
  returning id, profile_domains.hostname, profile_domains.challenge into domain_id, hostname, challenge;

  perform private.write_audit_event(v_profile.workspace_id, 'domain.claimed', 'domain', domain_id,
    jsonb_build_object('profileId', v_profile.id, 'hostname', v_hostname));
  return next;
end;
$$;

-- Records the result of a DNS check made by the application server. `p_text` is the exact JSON
-- the server signed after resolving the TXT record itself:
--   {"at": <epoch seconds>, "domainId": "<uuid>", "hostname": "...", "routing": "unknown|pending|ok",
--    "tokens": ["linkfav-verify=...", ...], "v": 1}
-- `tokens` are the challenge values found in DNS at that moment. A signed-in person calling this
-- function directly cannot produce the signature, so control is never proven by saying so.
--
-- Answers {"status": ...}:
--   not_configured  the signing secret is missing in this environment
--   invalid         bad signature, malformed or stale (older than 5 minutes) attestation
--   not_found       no such claim for the caller (other tenants' claims look the same)
--   forbidden       the caller is not an owner or admin, or the workspace does not accept changes
--   not_in_plan     the plan has no custom domain
--   dns_missing     this claim's challenge is not in DNS (an active domain stays active)
--   in_use          the hostname is active for another page whose proof is still in DNS
--   active          control proven; "slugs" lists the pages whose public cache the caller drops
--
-- Taking over: when the hostname is active for another page and that page's challenge is no longer
-- in DNS (or the page is gone), that row lapses in the same transaction. Whoever controls the DNS
-- zone today decides; a previous owner of the name keeps nothing.
create function public.confirm_profile_domain(p_text text, p_signature text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_valid boolean;
  v_data jsonb;
  v_at numeric;
  v_tokens text[];
  v_routing text;
  v_domain public.profile_domains;
  v_role public.workspace_role;
  v_other record;
  v_slugs jsonb := '[]'::jsonb;
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  v_valid := private.domains_signature_is_valid(p_text, p_signature);
  if v_valid is null then return jsonb_build_object('status', 'not_configured'); end if;
  if not v_valid then return jsonb_build_object('status', 'invalid'); end if;

  begin
    v_data := p_text::jsonb;
  exception when others then
    return jsonb_build_object('status', 'invalid');
  end;
  if jsonb_typeof(v_data) <> 'object'
    or (select array_agg(k order by k) from jsonb_object_keys(v_data) k) <> array['at', 'domainId', 'hostname', 'routing', 'tokens', 'v']::text[]
    or v_data ->> 'v' <> '1'
    or jsonb_typeof(v_data -> 'at') <> 'number'
    or jsonb_typeof(v_data -> 'tokens') <> 'array'
    or jsonb_array_length(v_data -> 'tokens') > 20
    or (v_data ->> 'domainId') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or (v_data ->> 'routing') is null or (v_data ->> 'routing') not in ('unknown', 'pending', 'ok') then
    return jsonb_build_object('status', 'invalid');
  end if;
  v_at := (v_data ->> 'at')::numeric;
  if v_at < extract(epoch from now()) - 300 or v_at > extract(epoch from now()) + 60 then
    return jsonb_build_object('status', 'invalid');
  end if;
  v_routing := v_data ->> 'routing';
  select coalesce(array_agg(t), '{}') into v_tokens from jsonb_array_elements_text(v_data -> 'tokens') t;

  select d.* into v_domain from public.profile_domains d where d.id = (v_data ->> 'domainId')::uuid for update;
  if found then
    v_role := private.workspace_role(v_domain.workspace_id);
  end if;
  if v_role is null or v_domain.hostname <> (v_data ->> 'hostname')
    or not exists (select 1 from public.profiles p where p.id = v_domain.profile_id and p.deleted_at is null) then
    return jsonb_build_object('status', 'not_found');
  end if;
  if v_role not in ('owner', 'admin') or not private.workspace_is_writable(v_domain.workspace_id) then
    return jsonb_build_object('status', 'forbidden');
  end if;
  if not coalesce(private.entitlement_bool(v_domain.workspace_id, 'custom_domain'), false) then
    return jsonb_build_object('status', 'not_in_plan');
  end if;

  if not (v_domain.challenge = any (v_tokens)) then
    update public.profile_domains set last_checked_at = now() where id = v_domain.id;
    return jsonb_build_object('status', 'dns_missing');
  end if;

  -- Serializes two pages proving the same hostname at once; the partial unique index is the backstop.
  perform pg_advisory_xact_lock(hashtextextended('profile_domains:' || v_domain.hostname, 0));

  for v_other in
    select d.id, d.workspace_id, d.profile_id, d.challenge, p.slug,
      (p.deleted_at is null and w.deleted_at is null) as page_exists
    from public.profile_domains d
    join public.profiles p on p.id = d.profile_id
    join public.workspaces w on w.id = d.workspace_id
    where d.hostname = v_domain.hostname and d.status = 'active' and d.id <> v_domain.id
    for update of d
  loop
    if v_other.page_exists and v_other.challenge = any (v_tokens) then
      update public.profile_domains set last_checked_at = now() where id = v_domain.id;
      return jsonb_build_object('status', 'in_use');
    end if;
    update public.profile_domains set status = 'lapsed', lapsed_at = now(), routing = 'unknown' where id = v_other.id;
    perform private.write_audit_event(v_other.workspace_id, 'domain.lapsed', 'domain', v_other.id,
      jsonb_build_object('profileId', v_other.profile_id, 'hostname', v_domain.hostname));
    v_slugs := v_slugs || to_jsonb(v_other.slug);
  end loop;

  update public.profile_domains
  set status = 'active', verified_at = coalesce(case when status = 'active' then verified_at end, now()),
      lapsed_at = null, routing = v_routing, last_checked_at = now()
  where id = v_domain.id;

  if v_domain.status <> 'active' then
    perform private.write_audit_event(v_domain.workspace_id, 'domain.verified', 'domain', v_domain.id,
      jsonb_build_object('profileId', v_domain.profile_id, 'hostname', v_domain.hostname));
  end if;

  return jsonb_build_object('status', 'active', 'routing', v_routing,
    'slugs', v_slugs || to_jsonb((select p.slug from public.profiles p where p.id = v_domain.profile_id)));
end;
$$;

-- Removes the domain of a page, whatever its state. Accepted in a suspended workspace: taking
-- something off the air is never blocked. Returns what the caller needs to drop caches and to
-- detach the hostname at the hosting provider.
create function public.remove_profile_domain(p_domain_id uuid)
returns table (hostname text, slug text, was_active boolean)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := (select auth.uid());
  v_domain public.profile_domains;
  v_role public.workspace_role;
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  select d.* into v_domain from public.profile_domains d where d.id = p_domain_id for update;
  if found then
    v_role := private.workspace_role(v_domain.workspace_id);
  end if;
  if v_role is null then
    -- Same answer as a missing row: do not confirm other tenants' domains.
    raise exception 'domain not found' using errcode = 'P0002';
  end if;
  if v_role not in ('owner', 'admin') then
    raise exception 'only owners and admins manage domains' using errcode = '42501';
  end if;

  delete from public.profile_domains where id = v_domain.id;
  perform private.write_audit_event(v_domain.workspace_id, 'domain.removed', 'domain', v_domain.id,
    jsonb_build_object('profileId', v_domain.profile_id, 'hostname', v_domain.hostname, 'status', v_domain.status));

  hostname := v_domain.hostname;
  was_active := v_domain.status = 'active';
  select p.slug into slug from public.profiles p where p.id = v_domain.profile_id;
  return next;
end;
$$;

-- Sets or clears the measurement identifiers of a page. Null or empty clears one; both empty
-- removes the row. Clearing is always allowed; setting needs the entitlement.
--   42501 / P0002  as lock_profile_for_management (pixels.manage = owner, admin)
--   LK010  (detail tracking_pixels) the plan has no pixels
--   22023  (detail meta | ga) not an identifier in the accepted format
create function public.set_profile_pixels(p_profile_id uuid, p_meta_pixel_id text, p_ga_measurement_id text)
returns table (slug text, is_live boolean)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_profile public.profiles := private.lock_profile_for_management(p_profile_id);
  v_meta text := nullif(btrim(coalesce(p_meta_pixel_id, '')), '');
  v_ga text := nullif(upper(btrim(coalesce(p_ga_measurement_id, ''))), '');
begin
  if v_meta is not null and v_meta !~ '^[0-9]{10,20}$' then
    raise exception 'invalid Meta Pixel id' using errcode = '22023', detail = 'meta';
  end if;
  if v_ga is not null and v_ga !~ '^G-[A-Z0-9]{6,14}$' then
    raise exception 'invalid Google Analytics id' using errcode = '22023', detail = 'ga';
  end if;

  if v_meta is null and v_ga is null then
    delete from public.profile_pixels where profile_id = v_profile.id;
  else
    if not coalesce(private.entitlement_bool(v_profile.workspace_id, 'tracking_pixels'), false) then
      raise exception 'pixels are not in this plan' using errcode = 'LK010', detail = 'tracking_pixels';
    end if;
    insert into public.profile_pixels (profile_id, workspace_id, meta_pixel_id, ga_measurement_id, updated_by)
    values (v_profile.id, v_profile.workspace_id, v_meta, v_ga, (select auth.uid()))
    on conflict (profile_id) do update
      set meta_pixel_id = excluded.meta_pixel_id, ga_measurement_id = excluded.ga_measurement_id,
          updated_by = excluded.updated_by, updated_at = now();
  end if;

  -- Which integrations are on, never the identifiers.
  perform private.write_audit_event(v_profile.workspace_id, 'pixels.updated', 'profile', v_profile.id,
    jsonb_build_object('meta', v_meta is not null, 'ga', v_ga is not null));

  slug := v_profile.slug;
  is_live := v_profile.live_publication_id is not null;
  return next;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Public read
-- ---------------------------------------------------------------------------------------------

-- Two columns are added to the answer, so the function is replaced. Same body as before
-- (202610090005_moderation.sql) plus, for a page on the air:
--   custom_domain  the page's active hostname while the plan has custom_domain, else null
--   pixels         {"meta": "...", "ga": "..."} (keys present only when set) while the plan has
--                  tracking_pixels, else null
drop function public.get_public_page(text);

create function public.get_public_page(p_slug text)
returns table (
  state text, canonical_slug text, document jsonb, version integer,
  published_at timestamptz, show_badge boolean, custom_domain text, pixels jsonb
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

-- The page a custom hostname opens: the same answer as get_public_page for that page, or
-- "not_found" for a hostname that is unknown, pending or lapsed, or whose plan lost custom_domain.
-- One answer for all of those, so the function does not tell which names were ever claimed.
create function public.get_public_page_by_domain(p_hostname text)
returns table (
  state text, canonical_slug text, document jsonb, version integer,
  published_at timestamptz, show_badge boolean, custom_domain text, pixels jsonb
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

-- `/d/<hostname>` is the internal route a custom hostname is rewritten to (apps/web/next.config.ts).
insert into public.reserved_slugs (slug, reason)
values
  ('d', 'route')
on conflict (slug) do nothing;

-- ---------------------------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------------------------

revoke all on function
  private.domain_hostname_is_well_formed(text),
  private.domain_hostname_is_blocked(text),
  private.domains_signing_secret(),
  private.domains_signature_is_valid(text, text)
from public, anon, authenticated;

revoke all on function
  public.claim_profile_domain(uuid, text),
  public.confirm_profile_domain(text, text),
  public.remove_profile_domain(uuid),
  public.set_profile_pixels(uuid, text, text),
  public.get_public_page(text),
  public.get_public_page_by_domain(text)
from public, anon, authenticated, service_role;

grant execute on function
  public.claim_profile_domain(uuid, text),
  public.confirm_profile_domain(text, text),
  public.remove_profile_domain(uuid),
  public.set_profile_pixels(uuid, text, text)
to authenticated;

grant execute on function
  public.get_public_page(text),
  public.get_public_page_by_domain(text)
to anon, authenticated, service_role;
