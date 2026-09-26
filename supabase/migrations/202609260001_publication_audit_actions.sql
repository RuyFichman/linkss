-- Sprint 3: audit actions for publishing. Kept in its own migration because a new enum value
-- cannot be used in the same transaction that adds it. Forward-only.

alter type public.audit_action add value if not exists 'profile.unpublished';
alter type public.audit_action add value if not exists 'profile.publication_restored';
