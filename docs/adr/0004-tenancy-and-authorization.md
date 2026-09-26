# ADR 0004 — Tenancy and authorization model

- **Status:** accepted for the MVP (items marked *provisional* await founder confirmation)
- **Date:** 2026-09-25
- **Supersedes:** none. Builds on ADR 0001 (modular monolith) and ADR 0002 (Supabase).

## Context

Every link page ("profile" in code, "página" in the UI) must belong to a workspace, individuals included. Agencies operate many pages with collaborators. Authorization must hold even if a UI or Server Action bug forwards a forged identifier, and paid limits must not be bypassable from the client. The Sprint 1 usability gate was overridden by the founder, so the schema vocabulary must stay independent of provisional UI terms (UX-001 to UX-003).

## Decision

### Tables (schema `public`)

| Table | Purpose | Tenant key |
|---|---|---|
| `user_accounts` | 1:1 with `auth.users`; display name, locale, soft delete | `id` = user |
| `workspaces` | tenant; `kind` `personal\|agency`, `status` `active\|suspended`, `plan_id`, `created_by`, soft delete | `id` |
| `workspace_memberships` | `(workspace_id, user_id)` unique; `role` `owner\|admin\|editor`; `status` `invited\|active\|revoked`; `invited_by` | `workspace_id` |
| `profiles` | link pages; `title`, `bio` (≤ 280), `slug`, `avatar_path` (storage key, no upload yet), `status` `draft\|published\|archived`, `published_at`, soft delete | `workspace_id` |
| `plans`, `plan_entitlements` | typed entitlement catalogue (`int_value` or `bool_value` per key) | global, read-only |
| `reserved_slugs` | slugs that can never be claimed | global, server-only |
| `slug_history` | released slugs and their hold period | `workspace_id` |
| `audit_events` | append-only security trail | `workspace_id` (nullable for account events) |

Enumerations are Postgres enums so generated TypeScript types are unions; adding a value is a forward-only `alter type … add value`.

The name `profiles` means a link page. The per-person record is `user_accounts` to avoid the Supabase-tutorial meaning of `profiles`.

### Role matrix

| Capability | owner | admin | editor | Enforced by |
|---|:-:|:-:|:-:|---|
| View workspace, members and pages | ✓ | ✓ | ✓ | RLS select |
| Rename workspace | ✓ | ✓ | – | RLS update + column grant (`name`) |
| Soft-delete agency workspace | ✓ | – | – | `soft_delete_workspace` RPC |
| Create page | ✓ | ✓ | – | RLS insert + `max_profiles` trigger |
| Edit page title/bio | ✓ | ✓ | ✓ | RLS update + column grant (`title`, `bio`) |
| Change page slug | ✓ | ✓ | – | `change_profile_slug` RPC |
| Soft-delete page | ✓ | ✓ | – | `soft_delete_profile` RPC |
| Publish page (Sprint 3) | ✓ | ✓ | ✓ | prepared: action `profile.publish` |
| Change a member's role | ✓ | non-owners only; cannot grant `owner` | – | `change_member_role` RPC |
| Remove member | ✓ | non-owners only | self only (leave) | `remove_workspace_member` RPC |
| Read workspace audit events | ✓ | ✓ | – | RLS select |

The same matrix lives in TypeScript (`apps/web/src/modules/identity/permissions.ts`) and is unit-tested; pgTAP proves the database side. Editors creating pages is excluded because a page consumes a paid entitlement (*provisional*).

Invariants enforced in the database:

- A workspace always keeps at least one active owner. A `BEFORE UPDATE OR DELETE` trigger on memberships locks the workspace row (serializing concurrent demotions) and rejects the change. This also blocks deleting an `auth.users` row that is the last owner of a live workspace; account deletion (Sprint 9) must transfer or delete owned workspaces first.
- At most one personal workspace per user (unique index on `created_by where kind = 'personal'`, including soft-deleted rows). Personal workspaces cannot be soft-deleted by users; they end with the account.
- `profiles.workspace_id`, `created_by` and `created_at` are immutable.
- Suspended or soft-deleted workspaces accept no writes; soft-deleted workspaces are invisible.

### RLS strategy

- RLS is enabled on every table in `public`. Every table first `REVOKE`s all privileges from `anon` and `authenticated`, then grants exactly what the policies need (column-level `UPDATE` grants where only some columns are user-editable). `anon` has no privilege on any tenant table.
- Policies are separate per command and always `TO authenticated`.
- Membership checks go through helper functions in the unexposed `private` schema: `security definer`, `stable`, `set search_path = ''`, reading `(select auth.uid())`. Policies use the set form `workspace_id in (select private.member_workspace_ids())` so the lookup runs once per statement, backed by the `(user_id, status, workspace_id)` membership index.
- Sensitive mutations (role change, member removal, slug change, soft delete, workspace creation) are **narrow RPCs** in `public`: `security definer`, `set search_path = ''`, `EXECUTE` revoked from `public`/`anon` and granted only to `authenticated`. Each RPC re-derives the caller from `auth.uid()`, validates the role, performs the change and writes exactly one audit event in the same transaction.
- Server code is still the first gate (ADR 0005, `modules/identity/guard.ts`); RLS is defense in depth. The service/secret key is never used for these operations.

### Personal workspace creation

**Decision: idempotent server-called function, not an `auth.users` trigger.** `public.ensure_personal_workspace()` creates the `user_accounts` row, the personal workspace and the owner membership, each with `on conflict do nothing`, and writes `workspace.created` only when it actually created the workspace. It refuses callers whose email is not confirmed.

It is called by `/auth/confirm` right after verification and again, as self-healing, by the authenticated layout whenever the user has no personal workspace.

Rationale:

- A trigger on `auth.users` that fails aborts the signup with a generic "Database error saving new user"; our schema must never make signup unavailable.
- Unverified (possibly abusive) signups create no tenant rows.
- Idempotency and the partial unique index make retries and concurrent calls safe.

Failure behavior: if the call fails, the user remains signed in, the app shows a retryable error state ("Não foi possível preparar sua conta") and the next request retries. No partial state is possible because the function runs in a single transaction.

### Entitlements

- `plans(id)` + `plan_entitlements(plan_id, key, int_value | bool_value)`, with a check constraint binding each key to its value type. Keys: `max_profiles`, `analytics_days`, `team_members` (integers) and `custom_domain`, `remove_badge`, `shareable_reports` (booleans).
- Seed values mirror `apps/web/src/lib/product.ts`; a Vitest drift test parses the migration and compares.
- `private.entitlement_int(workspace_id, key)` resolves the workspace's plan value. A `BEFORE INSERT` trigger on `profiles` locks the workspace row and rejects inserts beyond `max_profiles` (all non-deleted pages count, archived included, so archive/unarchive cannot bypass the limit — *provisional*). `team_members` is enforced by a membership trigger (prepared for Sprint 7 invitations).
- `workspaces.plan_id` is not user-writable (no column grant). Sprint 8 billing changes it through a server-side, webhook-driven path.
- Application code calls `assertEntitlement(...)` from `modules/entitlements`; plan names are never compared in business logic.
- Abuse guard: a user may own at most three live agency workspaces (*provisional*), otherwise free workspaces would multiply free pages. Revisit when billing defines agency plans.

### Slugs

- Canonical form: lowercase, accents removed (NFD + strip combining marks), whitespace → hyphen, collapsed/trimmed hyphens, `[a-z0-9-]`, 3–40 characters. `private.normalize_slug` mirrors `modules/profiles/slug.ts`; the `BEFORE INSERT/UPDATE` trigger normalizes, then validates, so the database never stores a non-canonical value.
- Uniqueness: unique index on `slug` for non-deleted profiles (so `Café` and `cafe` collide after normalization).
- Reserved words: `reserved_slugs`, seeded from the Sprint 1 list plus every top-level route; a Vitest test fails if a top-level route is not reserved or if the SQL and TypeScript lists drift.
- Hold period: releasing a slug (change or soft delete) writes `slug_history` with `hold_until = now() + 90 days` (*provisional*). During the hold only the releasing workspace may reclaim it (undo), preventing takeover/impersonation of a recently used public link.

### Soft delete and retention

- `deleted_at` + `purge_after` on `user_accounts`, `workspaces` and `profiles`, with a check that both are set together. Soft-deleted rows are excluded by RLS.
- `purge_after = deleted_at + 30 days` (*provisional*). The purge job is documented, not scheduled, until Sprint 9 (`docs/DATA_MAP.md`).

### Error contract

RPCs and triggers raise stable SQLSTATEs the app maps to pt-BR copy: `LK001` invalid slug, `LK002` reserved, `LK003` held, `23505` taken, `LK010` entitlement exceeded, `LK020` last owner, `LK050` workspace limit, `42501` forbidden, `P0002` not found.

## Consequences

- Isolation is provable with pgTAP (ADR 0006) and does not depend on UI correctness.
- Adding a role or capability requires changing the TypeScript matrix, the policies/RPCs and both test suites together.
- Security-definer RPCs are a privileged surface: each must check `auth.uid()` and role explicitly and is covered by negative tests.
- Column-level grants mean new user-editable columns need an explicit grant in their migration.
- Invitations for people without an account need a separate `workspace_invitations` table (token hash, email, expiry, revocation) in Sprint 7; memberships already carry `invited` status and `invited_by`.
