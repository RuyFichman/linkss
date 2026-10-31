-- E-mails in the recipient's language (ADR 0022).
--
-- claim_mail_outbox already reads the recipient's address and name at claim time; it now also
-- returns user_accounts.locale, so each message is written in the language of its account. The
-- function is recreated with one more output column (the application reads columns by name, and
-- an application without it writes in Portuguese). Forward-only and compatible with rollback.

drop function public.claim_mail_outbox(integer);

create function public.claim_mail_outbox(p_limit integer default 20)
returns table (id uuid, kind text, workspace_id uuid, payload jsonb, attempts smallint, email text, display_name text, locale text)
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
    (select a.display_name from public.user_accounts a where a.id = c.recipient_user_id),
    (select a.locale from public.user_accounts a where a.id = c.recipient_user_id)
  from claimed c;
end;
$$;

revoke all on function public.claim_mail_outbox(integer) from public, anon, authenticated, service_role;
grant execute on function public.claim_mail_outbox(integer) to service_role;
