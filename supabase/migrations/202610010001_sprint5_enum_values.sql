-- Sprint 5: enum values for the storage quota and for lead audit actions. Kept in its own
-- migration because a new enum value cannot be used in the same transaction that adds it.
-- Forward-only; an application one version behind ignores these values.

alter type public.entitlement_key add value if not exists 'storage_mb';
alter type public.audit_action add value if not exists 'lead.deleted';
alter type public.audit_action add value if not exists 'lead.exported';
