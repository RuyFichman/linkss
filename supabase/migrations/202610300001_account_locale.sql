-- Account language chosen at sign-up (ADR 0022).
--
-- user_accounts.locale has existed since the first identity migration, always 'pt-BR'. The sign-up
-- form now sends the language it was shown in as Auth user metadata (`locale`), and the first
-- ensure_personal_workspace() after confirmation copies it to the account row. The metadata is
-- written by the person signing up, so only a supported value is ever stored; anything else gives
-- the default. An existing row is never changed here: the language is chosen once, at creation.
--
-- Forward-only and compatible with rollback: the column, its default and its grants are unchanged;
-- the new check accepts every value stored so far ('pt-BR'); an older deployment never sends the
-- metadata and keeps creating 'pt-BR' accounts.

alter table public.user_accounts
  add constraint user_accounts_locale_supported check (locale in ('pt-BR', 'es-ES'));

comment on column public.user_accounts.locale is
  'Language of the account (ADR 0022): pt-BR or es-ES, from the sign-up form, set when the row is created. Mirrors LOCALES in apps/web/src/lib/locale.ts.';

create or replace function public.ensure_personal_workspace()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_confirmed_at timestamptz;
  v_display_name text;
  v_locale text;
  v_account_deleted_at timestamptz;
  v_workspace_id uuid;
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  select u.email_confirmed_at, left(nullif(btrim(u.raw_user_meta_data ->> 'display_name'), ''), 80), u.raw_user_meta_data ->> 'locale'
  into v_confirmed_at, v_display_name, v_locale
  from auth.users u
  where u.id = v_uid;

  if v_confirmed_at is null then
    raise exception 'email confirmation required' using errcode = '42501';
  end if;

  insert into public.user_accounts (id, display_name, locale)
  values (v_uid, v_display_name, case when v_locale in ('pt-BR', 'es-ES') then v_locale else 'pt-BR' end)
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

-- The Spanish marketing home lives at /es. Addresses have at least 3 characters, so no page could
-- take it; it is reserved anyway, like every top-level route (reserved-slugs.ts, drift test).
insert into public.reserved_slugs (slug, reason)
values
  ('es', 'route')
on conflict (slug) do nothing;
