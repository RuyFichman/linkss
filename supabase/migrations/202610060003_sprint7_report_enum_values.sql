-- Sprint 7, part 2: audit actions for shared report links. Kept in its own migration because a new
-- enum value cannot be used in the same transaction that adds it. Forward-only; an application one
-- version behind ignores these values.

alter type public.audit_action add value if not exists 'report_link.created';
alter type public.audit_action add value if not exists 'report_link.revoked';
