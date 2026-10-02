-- Sprint 6: audit action for the analytics CSV export. Kept in its own migration because a new enum
-- value cannot be used in the same transaction that adds it. Forward-only; an application one
-- version behind ignores the value.

alter type public.audit_action add value if not exists 'analytics.exported';
