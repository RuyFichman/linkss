create table if not exists public.waitlist_signups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 100),
  email text not null check (char_length(email) <= 254),
  whatsapp text,
  segment text not null,
  managed_profiles text not null,
  current_tool text,
  willingness_to_pay text not null,
  pilot_interest boolean not null default false,
  consent_at timestamptz not null,
  variant text not null,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  referrer text,
  created_at timestamptz not null default now()
);

create unique index if not exists waitlist_signups_email_lower_key on public.waitlist_signups (lower(email));
alter table public.waitlist_signups enable row level security;

comment on table public.waitlist_signups is 'Pilot waitlist. Server-only writes; review and delete stale records within 12 months. RLS intentionally has no anon or authenticated policies.';
comment on column public.waitlist_signups.consent_at is 'Timestamp of the explicit waitlist consent submitted by the visitor.';
