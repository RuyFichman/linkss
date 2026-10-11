-- Sprint 9: audit values for the account erasure (ADR 0018). Kept in its own migration because a
-- new enum value cannot be used in the same transaction that adds it. Forward-only; an application
-- one version behind ignores these values.

alter type public.audit_action add value if not exists 'privacy.erasure_started';
alter type public.audit_action add value if not exists 'privacy.account_erased';
