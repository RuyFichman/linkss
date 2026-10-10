-- Sprint 8, part 2: entitlement and audit values for custom domains and pixels (ADR 0016, ADR 0017).
-- Kept in its own migration because a new enum value cannot be used in the same transaction that
-- adds it. Forward-only; an application one version behind ignores these values.

alter type public.entitlement_key add value if not exists 'tracking_pixels';
alter type public.audit_action add value if not exists 'domain.claimed';
alter type public.audit_action add value if not exists 'domain.verified';
alter type public.audit_action add value if not exists 'domain.lapsed';
alter type public.audit_action add value if not exists 'domain.removed';
alter type public.audit_action add value if not exists 'pixels.updated';
