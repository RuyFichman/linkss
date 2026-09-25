-- Sprint 2 hardening of the Sprint 1 waitlist table. Forward-only; does not alter data.
-- The original migration relied on implicit Data API grants. With implicit exposure disabled
-- (Supabase default for new tables, enforced from 2026-10-30) the server-side store, which uses the
-- secret key (service_role), would have lacked INSERT. Browser roles keep no privilege at all.

revoke all on public.waitlist_signups from public, anon, authenticated;
grant select, insert, update, delete on public.waitlist_signups to service_role;
