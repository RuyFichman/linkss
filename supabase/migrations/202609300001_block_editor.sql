-- Sprint 4: block editor. Design: docs/adr/0008-block-model-and-editor.md.
-- Forward-only. Adds text/social/whatsapp/divider blocks and the URL policy to the draft validator,
-- moves page-level social links into a `social` block, and publishes snapshot schema version 2.
-- `profiles.social_links` is kept (no longer written by the application); dropping it needs
-- founder approval. Mirrors: apps/web/src/modules/blocks/*.

-- ---------------------------------------------------------------------------------------------
-- Field rules (mirror of modules/blocks/url-policy.ts, whatsapp.ts and model.ts)
-- ---------------------------------------------------------------------------------------------

-- Stored link destinations are printable ASCII (the app stores the WHATWG serialization: IDN hosts
-- as punycode, non-ASCII paths percent-encoded). Allowed: http(s) with a dotted host and an
-- alphabetic/punycode TLD and no userinfo, mailto with one address, tel with 3-20 digits.
create function private.is_allowed_block_url(p_url text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    char_length(p_url) <= 2048
    and p_url ~ '^[!-~]+$'
    and (
      p_url ~ '^https?://(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})(?::[0-9]{1,5})?(?:[/?#].*)?$'
      or p_url ~ '^mailto:[^@/?#]+@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})(?:\?.*)?$'
      or p_url ~ '^tel:\+?[0-9]{3,20}$'
    ),
    false);
$$;

-- E.164 digits without "+"; Brazilian numbers (55) need a valid area code and 8-9 digits.
create function private.is_valid_whatsapp_phone(p_phone text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(p_phone ~ '^[1-9][0-9]{7,14}$' and (p_phone !~ '^55' or p_phone ~ '^55[1-9][0-9]{9,10}$'), false);
$$;

-- Single-line label: 1..max characters after trimming, no control characters.
create function private.is_valid_block_label(p_value text, p_max integer)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(char_length(btrim(p_value)) >= 1 and char_length(p_value) <= p_max and p_value !~ '[[:cntrl:]]', false);
$$;

-- Plain multi-line text: min..max characters, line feeds allowed, other control characters refused.
-- Rendered as text nodes (never HTML), so markup characters are harmless.
create function private.is_valid_block_text(p_value text, p_min integer, p_max integer)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    char_length(p_value) <= p_max
    and char_length(btrim(p_value, E' \n')) >= p_min
    and replace(p_value, E'\n', '') !~ '[[:cntrl:]]',
    false);
$$;

-- [{network, url}] with one entry per network and an https URL on that network's hosts.
create function private.is_valid_social_links(p_links jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_item jsonb;
  v_keys text[];
  v_url text;
  v_host text;
  v_hosts text[];
begin
  if p_links is null or jsonb_typeof(p_links) <> 'array' then
    return false;
  end if;
  for v_item in select value from jsonb_array_elements(p_links) loop
    if jsonb_typeof(v_item) <> 'object' then
      return false;
    end if;
    select array_agg(k order by k) into v_keys from jsonb_object_keys(v_item) k;
    if v_keys is distinct from array['network', 'url']
      or jsonb_typeof(v_item -> 'network') <> 'string'
      or jsonb_typeof(v_item -> 'url') <> 'string' then
      return false;
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
      return false;
    end if;
  end loop;
  return (select count(*) from jsonb_array_elements(p_links))
    = (select count(distinct e ->> 'network') from jsonb_array_elements(p_links) e);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Draft validator (replaces the Sprint 3 link-only version)
-- ---------------------------------------------------------------------------------------------

create or replace function private.validate_profile_draft()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item jsonb;
  v_keys text[];
  v_expected text[];
  v_type text;
  v_valid boolean;
begin
  -- Legacy page-level social links (no longer written by the app, still validated).
  if not private.is_valid_social_links(new.social_links) then
    raise exception 'invalid social link' using errcode = 'LK040', detail = 'social_links';
  end if;

  -- Serialized size cap (MAX_BLOCKS_BYTES); the 100-block cap is the profiles_blocks_shape check.
  if octet_length(new.blocks::text) > 65536 then
    raise exception 'draft too large' using errcode = 'LK040', detail = 'blocks';
  end if;

  for v_item in select value from jsonb_array_elements(new.blocks) loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'invalid block' using errcode = 'LK040', detail = 'blocks';
    end if;
    v_type := case when jsonb_typeof(v_item -> 'type') = 'string' then v_item ->> 'type' end;
    v_expected := case v_type
      when 'link' then array['id', 'title', 'type', 'url', 'visible']
      when 'text' then array['id', 'text', 'type', 'visible']
      when 'social' then array['id', 'items', 'type', 'visible']
      when 'whatsapp' then array['id', 'label', 'message', 'phone', 'type', 'visible']
      when 'divider' then array['id', 'type', 'visible']
    end;
    select array_agg(k order by k) into v_keys from jsonb_object_keys(v_item) k;
    if v_expected is null
      or v_keys is distinct from v_expected
      or jsonb_typeof(v_item -> 'id') <> 'string'
      or (v_item ->> 'id') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or jsonb_typeof(v_item -> 'visible') <> 'boolean' then
      raise exception 'invalid block' using errcode = 'LK040', detail = 'blocks';
    end if;

    v_valid := case v_type
      when 'link' then
        jsonb_typeof(v_item -> 'title') = 'string'
        and jsonb_typeof(v_item -> 'url') = 'string'
        and private.is_valid_block_label(v_item ->> 'title', 80)
        and private.is_allowed_block_url(v_item ->> 'url')
      when 'text' then
        jsonb_typeof(v_item -> 'text') = 'string'
        and private.is_valid_block_text(v_item ->> 'text', 1, 1000)
      when 'social' then
        private.is_valid_social_links(v_item -> 'items')
      when 'whatsapp' then
        jsonb_typeof(v_item -> 'label') = 'string'
        and jsonb_typeof(v_item -> 'phone') = 'string'
        and jsonb_typeof(v_item -> 'message') = 'string'
        and private.is_valid_block_label(v_item ->> 'label', 80)
        and private.is_valid_whatsapp_phone(v_item ->> 'phone')
        and private.is_valid_block_text(v_item ->> 'message', 0, 500)
      when 'divider' then true
    end;
    if not coalesce(v_valid, false) then
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

comment on column public.profiles.blocks is
  'Draft blocks (ADR 0008): link, text, social, whatsapp, divider. Validated by private.validate_profile_draft (mirror of modules/blocks).';
comment on column public.profiles.social_links is
  'Legacy (Sprint 3) page-level social links. Moved into a social block by migration 202609300001 and no longer written by the application; kept until a founder-approved cleanup.';

-- ---------------------------------------------------------------------------------------------
-- Snapshot document, schema version 2 (mirror of modules/publishing/document.ts)
-- ---------------------------------------------------------------------------------------------

-- Render-ready copy of one visible block: explicit fields per type, `visible` removed.
create function private.published_block(p_block jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case p_block ->> 'type'
    when 'link' then jsonb_build_object('id', p_block ->> 'id', 'type', 'link', 'title', p_block ->> 'title', 'url', p_block ->> 'url')
    when 'text' then jsonb_build_object('id', p_block ->> 'id', 'type', 'text', 'text', p_block ->> 'text')
    when 'social' then jsonb_build_object('id', p_block ->> 'id', 'type', 'social', 'items', p_block -> 'items')
    when 'whatsapp' then jsonb_build_object('id', p_block ->> 'id', 'type', 'whatsapp', 'label', p_block ->> 'label', 'phone', p_block ->> 'phone', 'message', p_block ->> 'message')
    when 'divider' then jsonb_build_object('id', p_block ->> 'id', 'type', 'divider')
  end;
$$;

-- Hidden blocks and social rows without items are dropped; order is the draft order.
create or replace function private.build_publication_document(p_profile public.profiles)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'schemaVersion', 2,
    'title', p_profile.title,
    'bio', p_profile.bio,
    'avatarPath', p_profile.avatar_path,
    'blocks', coalesce((
      select jsonb_agg(private.published_block(b) order by ord)
      from jsonb_array_elements(p_profile.blocks) with ordinality as t(b, ord)
      where (b ->> 'visible')::boolean
        and private.published_block(b) is not null
        and not (b ->> 'type' = 'social' and jsonb_array_length(b -> 'items') = 0)
    ), '[]'::jsonb)
  );
$$;

alter table public.profile_publications
  alter column schema_version set default 2,
  add constraint profile_publications_schema_version_matches
    check (schema_version = (document ->> 'schemaVersion')::smallint);

-- ---------------------------------------------------------------------------------------------
-- Data migration: page-level social links -> a leading social block
-- ---------------------------------------------------------------------------------------------

-- Idempotent: only drafts with social links and no social block yet; pages already at the 100-block
-- cap are skipped (their links stay in the legacy column). The visible result is unchanged, so the
-- draft revision is not bumped and an up-to-date page stays up to date. Existing snapshots are not
-- touched. Returns the number of pages changed.
create function private.migrate_social_links_to_blocks()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  alter table public.profiles disable trigger profiles_40_bump_draft_revision;
  update public.profiles p
  set blocks = jsonb_build_array(jsonb_build_object('id', gen_random_uuid()::text, 'type', 'social', 'visible', true, 'items', p.social_links)) || p.blocks
  where jsonb_array_length(p.social_links) > 0
    and jsonb_array_length(p.blocks) < 100
    and not exists (select 1 from jsonb_array_elements(p.blocks) b where b ->> 'type' = 'social');
  get diagnostics v_count = row_count;
  alter table public.profiles enable trigger profiles_40_bump_draft_revision;
  return v_count;
end;
$$;

select private.migrate_social_links_to_blocks();

-- ---------------------------------------------------------------------------------------------
-- Privileges: helpers are internal (the validator and RPCs run as the owner)
-- ---------------------------------------------------------------------------------------------

revoke all on function
  private.is_allowed_block_url(text),
  private.is_valid_whatsapp_phone(text),
  private.is_valid_block_label(text, integer),
  private.is_valid_block_text(text, integer, integer),
  private.is_valid_social_links(jsonb),
  private.published_block(jsonb),
  private.migrate_social_links_to_blocks()
from public, anon, authenticated;

-- Draft content is written only through blocks/title/bio now, but the legacy grant stays so a
-- rolled-back application keeps working.
