-- Sprint 8, part 1: audit actions for billing (ADR 0014). Kept in its own migration because a new
-- enum value cannot be used in the same transaction that adds it. Forward-only; an application one
-- version behind ignores these values.

alter type public.audit_action add value if not exists 'billing.checkout_started';
alter type public.audit_action add value if not exists 'billing.change_requested';
alter type public.audit_action add value if not exists 'billing.subscription_changed';
alter type public.audit_action add value if not exists 'billing.plan_changed';
