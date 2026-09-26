# ADR 0006 — Database testing strategy

- **Status:** accepted
- **Date:** 2026-09-25

## Context

Tenant isolation is the highest-risk property of the MVP (PLANO_DE_EXECUCAO §12, "Multi-tenant inseguro"). It must be proven against the real Postgres, RLS policies, grants, triggers and functions, not mocks. `npm run check` must keep working on machines and CI jobs without Docker.

## Decision

### Tooling

- **Supabase CLI** pinned as a root devDependency (`supabase@2.118.0`, exact). It runs the local stack (Postgres 17, Auth, PostgREST, Mailpit) in Docker and executes pgTAP tests with `supabase test db`.
  - *Maintenance:* first-party, released weekly by Supabase.
  - *License:* MIT.
  - *Cost:* devDependency only; downloads a Go binary on install and Docker images on first `start`. Nothing reaches the app bundle.
  - *Exit path:* tests are plain pgTAP SQL files; they run under `pg_prove` against any Postgres with the same migrations and a stub `auth` schema.
- **pgTAP** (bundled with the Supabase Postgres image) for SQL assertions.

### Layout

- `supabase/tests/database/000-setup-test-helpers.test.sql` creates a `tests` schema with helpers (`tests.create_user`, `tests.authenticate_as`, `tests.authenticate_anon`). It commits, so later files can use it; the `tests` schema exists only in local/CI databases because it is not a migration.
- Every other file wraps its work in `begin … rollback`, creates at least two users in two workspaces and asserts both positive and negative behavior for `authenticated`-as-member, `authenticated`-as-non-member and `anon`.
- Test identities are simulated by setting `role` and `request.jwt.claims` inside the transaction, exactly as PostgREST does.

### Commands

- `npm run db:start` / `npm run db:stop` — local stack.
- `npm run db:reset` — re-apply migrations and `supabase/seed.sql`.
- `npm run test:db` — `supabase test db` against the running local stack.
- `npm run db:types` — regenerate `apps/web/src/lib/database.types.ts` from the local database.

### CI

A separate `database` job in `.github/workflows/ci.yml` installs dependencies, runs `supabase start` with only the services needed (database, Auth, PostgREST), runs `npm run test:db`, and verifies that the committed generated types match the migrations. The `quality` job (`npm run check`) stays Docker-free.

### When Docker is unavailable

`npm run check` still passes (lint, typecheck, Vitest, build) because Vitest tests never touch a database. `npm run test:db` fails fast with the CLI's Docker error; the developer must state in the handoff/report that DB tests were not run, and the CI `database` job remains the required gate before merge.

## Consequences

- RLS, grants and RPC changes land together with pgTAP tests or CI fails.
- First CI run downloads several hundred MB of images; the job has a longer timeout.
- Server-layer authorization is additionally unit-tested in Vitest with fakes; end-to-end browser tests are deferred until the Sprint 9 QA gate.
