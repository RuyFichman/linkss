-- Transactional e-mail (ADR 0021): a new form contact, a page suspended, an appeal answered, a
-- payment that failed and a yearly renewal coming. The provider is Resend, behind a MailAdapter in
-- the application; nothing here talks to it.
--
-- Shape: an outbox. The fact that deserves an e-mail writes a message in the same transaction
-- (triggers on the tables where the facts already land), so a message is never lost and never
-- invented. The application server drains the outbox right after the request that caused it and
-- once a day from a job; it sends each message with its id as the provider's idempotency key.
--
-- Guarantees, whatever the application does:
--   * enqueueing can never make the original write fail: every trigger swallows its own errors;
--   * no client role reads or writes the outbox; only the service role claims and completes;
--   * a message names a recipient by user id; the address is read at send time, and only if it
--     is confirmed, so an erased or unconfirmed account gets nothing;
--   * the message for a new contact never carries what the visitor typed;
--   * a message that waited too long (mail switched off, provider down for days) expires instead
--     of arriving late; a sent message is purged after 30 days.
--
-- Forward-only and additive: one column with a default, one table, functions and triggers. An
-- application one version behind never drains the outbox; messages then expire.

-- ---------------------------------------------------------------------------------------------
-- Preference
-- ---------------------------------------------------------------------------------------------

alter table public.user_accounts add column notify_new_leads boolean not null default true;
comment on column public.user_accounts.notify_new_leads is
  'Whether this person gets an e-mail when a form of a page they manage receives a contact. The other notices (suspension, appeal, billing) are about the account itself and are always sent.';
grant update (notify_new_leads) on public.user_accounts to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Outbox
-- ---------------------------------------------------------------------------------------------

create table public.mail_outbox (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('new_lead', 'page_suspended', 'appeal_decided', 'payment_failed', 'renewal_upcoming')),
  recipient_user_id uuid not null references auth.users (id) on delete cascade,
  workspace_id uuid references public.workspaces (id) on delete cascade,
  -- One message per fact and recipient: a repeated fact (a retry, a second lead in the same hour)
  -- finds the key taken and adds nothing.
  dedupe_key text not null check (char_length(dedupe_key) between 1 and 300),
  payload jsonb not null check (jsonb_typeof(payload) = 'object' and pg_column_size(payload) <= 4096),
  status text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed', 'skipped')),
  attempts smallint not null default 0 check (attempts between 0 and 20),
  -- While pending: when it may be tried. While sending: the end of the lease of whoever claimed it.
  next_attempt_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_error text check (last_error is null or char_length(last_error) <= 80),
  provider_message_id text check (provider_message_id is null or char_length(provider_message_id) <= 120),
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  constraint mail_outbox_dedupe_key unique (dedupe_key)
);

create index mail_outbox_due_idx on public.mail_outbox (next_attempt_at) where status in ('pending', 'sending');
create index mail_outbox_finished_idx on public.mail_outbox (finished_at) where finished_at is not null;
create index mail_outbox_recipient_idx on public.mail_outbox (recipient_user_id);
create index mail_outbox_workspace_idx on public.mail_outbox (workspace_id) where workspace_id is not null;

comment on table public.mail_outbox is
  'Transactional e-mails waiting to be sent or recently sent (ADR 0021). Written only by triggers and private.enqueue_mail; claimed and completed only by the service role. Holds a user id, never an address. Retention: 30 days after it finished; an unsent message expires.';

alter table public.mail_outbox enable row level security;
revoke all on public.mail_outbox from public, anon, authenticated, service_role;
grant select on public.mail_outbox to service_role;

-- Active members of a workspace with one of the roles. Who gets an account notice.
create function private.mail_recipients(p_workspace_id uuid, p_roles public.workspace_role[])
returns setof uuid language sql stable security definer set search_path = ''
as $$
  select m.user_id from public.workspace_memberships m
  where m.workspace_id = p_workspace_id and m.status = 'active' and m.role = any (p_roles);
$$;

-- One message per recipient. The key is the fact's key plus the recipient.
create function private.enqueue_mail(p_kind text, p_workspace_id uuid, p_recipients uuid[], p_key text, p_payload jsonb, p_expires_at timestamptz)
returns integer language plpgsql security definer set search_path = ''
as $$
declare
  v_count integer;
begin
  insert into public.mail_outbox (kind, recipient_user_id, workspace_id, dedupe_key, payload, expires_at)
  select p_kind, r, p_workspace_id, p_key || ':' || r::text, p_payload, p_expires_at
  from unnest(p_recipients) as r
  where r is not null
  on conflict (dedupe_key) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- The facts
-- ---------------------------------------------------------------------------------------------

-- A form contact. At most one message per page, per recipient and per hour: a burst of contacts
-- (or of spam) is one e-mail. Never what the visitor typed: the e-mail sends the owner to the panel.
create function private.mail_on_form_lead()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_profile public.profiles;
begin
  begin
    select p.* into v_profile from public.profiles p where p.id = new.profile_id;
    if found and v_profile.deleted_at is null then
      perform private.enqueue_mail('new_lead', new.workspace_id,
        array(select r from private.mail_recipients(new.workspace_id, array['owner', 'admin']::public.workspace_role[]) r
              join public.user_accounts a on a.id = r where a.notify_new_leads),
        'new_lead:' || new.profile_id::text || ':' || to_char(date_trunc('hour', new.created_at at time zone 'UTC'), 'YYYYMMDDHH24'),
        jsonb_build_object('profileId', v_profile.id, 'title', v_profile.title, 'slug', v_profile.slug),
        new.created_at + interval '2 days');
    end if;
  exception when others then
    -- The contact is the visitor's: it is stored even if its notice cannot be.
    null;
  end;
  return null;
end;
$$;
create trigger form_leads_mail after insert on public.form_leads
for each row execute function private.mail_on_form_lead();

-- A page taken off the air by moderation (ADR 0019): owners and admins, who may appeal.
create function private.mail_on_suspension()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_profile public.profiles;
begin
  begin
    select p.* into v_profile from public.profiles p where p.id = new.profile_id;
    if found then
      perform private.enqueue_mail('page_suspended', new.workspace_id,
        array(select private.mail_recipients(new.workspace_id, array['owner', 'admin']::public.workspace_role[])),
        'page_suspended:' || new.id::text,
        jsonb_build_object('profileId', v_profile.id, 'title', v_profile.title, 'slug', v_profile.slug, 'category', new.category),
        new.suspended_at + interval '14 days');
    end if;
  exception when others then
    null;
  end;
  return null;
end;
$$;
create trigger moderation_suspensions_mail after insert on public.moderation_suspensions
for each row execute function private.mail_on_suspension();

-- An appeal answered: owners, admins and whoever sent it. The answer was written for the workspace
-- (decide_moderation_appeal); the administrator's internal justification is not in this table.
create function private.mail_on_appeal_decided()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_profile public.profiles;
begin
  begin
    if old.status = 'open' and new.status in ('accepted', 'denied') then
      select p.* into v_profile from public.profiles p where p.id = new.profile_id;
      if found then
        perform private.enqueue_mail('appeal_decided', new.workspace_id,
          array(select distinct r from (
            select private.mail_recipients(new.workspace_id, array['owner', 'admin']::public.workspace_role[]) as r
            union select new.created_by) t where r is not null),
          'appeal_decided:' || new.id::text,
          jsonb_build_object('profileId', v_profile.id, 'title', v_profile.title, 'slug', v_profile.slug,
            'accepted', new.status = 'accepted', 'response', new.response),
          coalesce(new.decided_at, now()) + interval '14 days');
      end if;
    end if;
  exception when others then
    null;
  end;
  return null;
end;
$$;
create trigger moderation_appeals_mail after update of status on public.moderation_appeals
for each row execute function private.mail_on_appeal_decided();

-- A payment that failed (ADR 0014): the owner, once per failure, when the grace period starts.
create function private.mail_on_payment_failed()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  begin
    if new.status = 'past_due' and (tg_op = 'INSERT' or old.status is distinct from 'past_due') then
      perform private.enqueue_mail('payment_failed', new.workspace_id,
        array(select private.mail_recipients(new.workspace_id, array['owner']::public.workspace_role[])),
        'payment_failed:' || new.id::text || ':' || to_char(new.grace_until at time zone 'UTC', 'YYYYMMDDHH24MISS'),
        jsonb_build_object('planId', new.plan_id, 'graceUntil', new.grace_until),
        new.grace_until);
    end if;
  exception when others then
    null;
  end;
  return null;
end;
$$;
create trigger billing_subscriptions_mail after insert or update of status on public.billing_subscriptions
for each row execute function private.mail_on_payment_failed();

-- Yearly renewals in the next seven days, once per paid period. Called by the mail job. Monthly
-- renewals get no reminder: the provider's receipt follows every charge.
create function private.enqueue_renewal_reminders(p_now timestamptz)
returns integer language plpgsql security definer set search_path = ''
as $$
declare
  v_row record;
  v_total integer := 0;
begin
  for v_row in
    select s.id, s.workspace_id, s.plan_id, s.amount_cents, s.current_period_end
    from public.billing_subscriptions s
    where s.status = 'active' and s.billing_interval = 'year' and not s.cancel_at_period_end
      and s.current_period_end > p_now and s.current_period_end <= p_now + interval '7 days'
    order by s.current_period_end
    limit 200
  loop
    v_total := v_total + private.enqueue_mail('renewal_upcoming', v_row.workspace_id,
      array(select private.mail_recipients(v_row.workspace_id, array['owner']::public.workspace_role[])),
      'renewal_upcoming:' || v_row.id::text || ':' || to_char(v_row.current_period_end at time zone 'UTC', 'YYYYMMDD'),
      jsonb_build_object('planId', v_row.plan_id, 'renewsAt', v_row.current_period_end, 'amountCents', v_row.amount_cents),
      v_row.current_period_end);
  end loop;
  return v_total;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- The service role's side
-- ---------------------------------------------------------------------------------------------

-- Daily housekeeping of the job: renewal reminders, expiry and the 30-day purge. Bounded.
create function public.run_mail_maintenance(p_now timestamptz default now())
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_reminders integer;
  v_expired integer;
  v_purged integer;
begin
  v_reminders := private.enqueue_renewal_reminders(p_now);

  update public.mail_outbox m set status = 'skipped', last_error = 'expired', finished_at = p_now
  where m.id in (
    select o.id from public.mail_outbox o
    where o.status in ('pending', 'sending') and o.expires_at <= p_now
    order by o.expires_at limit 1000);
  get diagnostics v_expired = row_count;

  delete from public.mail_outbox m
  where m.id in (
    select o.id from public.mail_outbox o
    where o.finished_at < p_now - interval '30 days'
    order by o.finished_at limit 5000);
  get diagnostics v_purged = row_count;

  return jsonb_build_object('reminders', v_reminders, 'expired', v_expired, 'purged', v_purged,
    'pending', (select count(*) from public.mail_outbox o where o.status in ('pending', 'sending')));
end;
$$;

-- Takes up to p_limit due messages for ten minutes (a lease: a crashed sender's messages come back
-- by themselves). Returns the address only when it is confirmed; the caller skips the others.
create function public.claim_mail_outbox(p_limit integer default 20)
returns table (id uuid, kind text, workspace_id uuid, payload jsonb, attempts smallint, email text, display_name text)
language plpgsql security definer set search_path = ''
as $$
begin
  return query
  with due as (
    select o.id from public.mail_outbox o
    where o.status in ('pending', 'sending') and o.next_attempt_at <= now() and o.expires_at > now()
    order by o.next_attempt_at
    limit least(greatest(coalesce(p_limit, 20), 1), 100)
    for update skip locked
  ), claimed as (
    update public.mail_outbox m
    set status = 'sending', attempts = m.attempts + 1, next_attempt_at = now() + interval '10 minutes'
    from due where m.id = due.id
    returning m.id, m.kind, m.workspace_id, m.payload, m.attempts, m.recipient_user_id
  )
  select c.id, c.kind, c.workspace_id, c.payload, c.attempts,
    (select u.email::text from auth.users u where u.id = c.recipient_user_id and u.email_confirmed_at is not null),
    (select a.display_name from public.user_accounts a where a.id = c.recipient_user_id)
  from claimed c;
end;
$$;

-- What happened to a claimed message. `retry` backs off (5, 10, 20... minutes) and gives up after
-- five attempts; `failed` and `skipped` are final. Only a message being sent can be completed.
create function public.complete_mail_outbox(p_id uuid, p_outcome text, p_error text default null, p_provider_message_id text default null)
returns text language plpgsql security definer set search_path = ''
as $$
declare
  v_row public.mail_outbox;
begin
  if p_outcome is null or p_outcome not in ('sent', 'retry', 'failed', 'skipped') then
    raise exception 'unknown outcome' using errcode = '22023';
  end if;
  select o.* into v_row from public.mail_outbox o where o.id = p_id for update;
  if not found then return 'not_found'; end if;
  if v_row.status <> 'sending' then return 'not_sending'; end if;

  if p_outcome = 'sent' then
    update public.mail_outbox set status = 'sent', finished_at = now(), last_error = null,
      provider_message_id = left(p_provider_message_id, 120) where id = p_id;
  elsif p_outcome = 'retry' and v_row.attempts < 5 then
    update public.mail_outbox set status = 'pending', last_error = left(p_error, 80),
      next_attempt_at = now() + make_interval(mins => 5 * power(2, v_row.attempts - 1)::integer) where id = p_id;
  else
    update public.mail_outbox set status = case when p_outcome = 'skipped' then 'skipped' else 'failed' end,
      finished_at = now(), last_error = left(coalesce(p_error, p_outcome), 80) where id = p_id;
  end if;
  return (select status from public.mail_outbox where id = p_id);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Operations: a sixth job and what the monitor reads about mail (ADR 0019)
-- ---------------------------------------------------------------------------------------------

alter table public.job_runs drop constraint job_runs_job_check;
alter table public.job_runs add constraint job_runs_job_check check (job in ('media-cleanup', 'analytics', 'billing', 'retention', 'domains', 'mail'));
insert into public.job_runs (job, last_run_at, last_outcome, last_ok_at) values ('mail', now(), 'baseline', now());

-- Same function as in 202610110004 plus `mail`: messages that gave up in the last day, and
-- messages due for more than an hour that nobody sent.
create or replace function public.get_ops_status()
returns jsonb language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'now', now(),
    'jobs', (select coalesce(jsonb_agg(jsonb_build_object(
        'job', j.job, 'lastRunAt', j.last_run_at, 'lastOkAt', j.last_ok_at, 'lastOutcome', j.last_outcome) order by j.job), '[]'::jsonb)
      from public.job_runs j),
    'billing', jsonb_build_object(
      'stuckProcessing', (select count(*) from public.billing_events e where e.outcome = 'processing' and e.received_at < now() - interval '1 hour'),
      'mismatches24h', (select count(*) from public.billing_events e
        where e.outcome in ('unknown_customer', 'customer_mismatch', 'price_mismatch', 'conflict') and e.received_at > now() - interval '24 hours')),
    'queues', jsonb_build_object(
      'reportsWaiting', (select count(*) from public.moderation_reports r
        where r.status = 'new' and r.created_at < now() - interval '72 hours'
          and exists (select 1 from public.profiles p where p.id = r.profile_id and p.deleted_at is null)),
      'appealsWaiting', (select count(*) from public.moderation_appeals a where a.status = 'open' and a.created_at < now() - interval '72 hours'),
      'privacyWaiting', (select count(*) from public.privacy_requests q
        where q.status in ('received', 'needs_action', 'processing') and q.created_at < now() - interval '10 days')),
    'purge', jsonb_build_object(
      'profilesOverdue', (select count(*) from public.profiles p where p.purge_after < now() - interval '3 days'),
      'workspacesOverdue', (select count(*) from public.workspaces w where w.purge_after < now() - interval '3 days')),
    'mail', jsonb_build_object(
      'failed24h', (select count(*) from public.mail_outbox m where m.status = 'failed' and m.finished_at > now() - interval '24 hours'),
      'overdue', (select count(*) from public.mail_outbox m where m.status in ('pending', 'sending') and m.next_attempt_at < now() - interval '1 hour')));
$$;

-- ---------------------------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------------------------

revoke all on function
  private.mail_recipients(uuid, public.workspace_role[]),
  private.enqueue_mail(text, uuid, uuid[], text, jsonb, timestamptz),
  private.mail_on_form_lead(), private.mail_on_suspension(), private.mail_on_appeal_decided(), private.mail_on_payment_failed(),
  private.enqueue_renewal_reminders(timestamptz)
from public, anon, authenticated, service_role;

revoke all on function
  public.run_mail_maintenance(timestamptz),
  public.claim_mail_outbox(integer),
  public.complete_mail_outbox(uuid, text, text, text)
from public, anon, authenticated, service_role;
grant execute on function
  public.run_mail_maintenance(timestamptz),
  public.claim_mail_outbox(integer),
  public.complete_mail_outbox(uuid, text, text, text)
to service_role;
