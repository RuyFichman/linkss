-- Sprint 9: audit values for suspension appeals (ADR 0019). Kept in its own migration because a
-- new enum value cannot be used in the same transaction that adds it. Forward-only; an application
-- one version behind ignores these values.

alter type public.audit_action add value if not exists 'moderation.appealed';
alter type public.audit_action add value if not exists 'moderation.appeal_decided';
