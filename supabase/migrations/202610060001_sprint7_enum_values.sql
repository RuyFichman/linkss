-- Sprint 7: audit actions for archiving, duplication and invitations. Kept in its own migration
-- because a new enum value cannot be used in the same transaction that adds it. Forward-only; an
-- application one version behind ignores these values.

alter type public.audit_action add value if not exists 'profile.archived';
alter type public.audit_action add value if not exists 'profile.unarchived';
alter type public.audit_action add value if not exists 'profile.duplicated';
alter type public.audit_action add value if not exists 'invitation.created';
alter type public.audit_action add value if not exists 'invitation.revoked';
alter type public.audit_action add value if not exists 'invitation.accepted';
