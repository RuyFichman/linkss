-- Add enum values separately: PostgreSQL cannot use a new enum label in the same migration transaction.
alter type public.audit_action add value if not exists 'legal.accepted';
alter type public.audit_action add value if not exists 'privacy.account_exported';
alter type public.audit_action add value if not exists 'privacy.workspace_exported';
alter type public.audit_action add value if not exists 'privacy.deletion_requested';
alter type public.audit_action add value if not exists 'privacy.data_access_requested';
alter type public.audit_action add value if not exists 'privacy.request_reviewed';
alter type public.audit_action add value if not exists 'moderation.reported';
alter type public.audit_action add value if not exists 'moderation.reviewed';
alter type public.audit_action add value if not exists 'moderation.suspended';
alter type public.audit_action add value if not exists 'moderation.reactivated';
