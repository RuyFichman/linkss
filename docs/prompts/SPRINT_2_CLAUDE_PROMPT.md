# Sprint 2 — Identity, workspaces and multi-tenant model (Projeto LNK)

## 0. Founder gate decision

```text
USABILITY_GATE: (b) FOUNDER OVERRIDE — start Sprint 2 now; the five-person test runs later.
  Decided: 2026-09-25 by the founder.
  Reason: the founder chose to build the identity/tenancy foundation now and run the usability sessions afterwards.
UX_DECISIONS confirmed/changed: none yet
```

`AGENTS.md` §22 says the Sprint 2 multi-tenant schema must not begin until the usability gate is reviewed; the founder has explicitly overridden that gate. Proceed, and record the override (date, reason, risk) in the Sprint 2 report, in `docs/ux/UX_DECISIONS.md` and in the updated `AGENTS.md` §22.

Because the usability test has not happened yet, reduce rework risk: keep user-facing vocabulary, onboarding order and page-creation copy isolated in `apps/web/src/content/pt-BR.ts` and presentation components, so usability findings change copy and flow without touching the schema. Keep the database vocabulary neutral (`workspace`, `profile`, `membership`), independent of the provisional UI terms (UX-001 to UX-003).

## 1. Your role

You are the senior full-stack engineer on **Projeto LNK**, working autonomously in this repository with Claude Code. Sprints 0 and 1 are complete (see `docs/SPRINT_0_REPORT.md` and `docs/SPRINT_1_REPORT.md`). Your job is to deliver **Sprint 2 — "Identidade, workspaces e modelo multi-tenant"**: the secure foundation for individual users and teams. Deliver working, tested code and migrations, not a plan.

Work without stopping for questions except where §9 requires approval. When a product decision is ambiguous, choose the option most consistent with the documents, log it as *provisional — founder to confirm* in `docs/ux/UX_DECISIONS.md` (UX) or in an ADR (technical), and continue.

Keep a task list for the deliverables below and update it as you go. Report progress briefly after each work-order phase (§8).

## 2. Read first (mandatory)

Read these completely before writing anything:

- `AGENTS.md` (canonical; it overrides your defaults), `README.md`.
- `PLANO_DE_EXECUCAO.md`: §4, §5, §6, **Sprint 2**, and Sprints 3, 4, 7, 8, 9 (the schema must not block them).
- `PLANO_DE_NEGOCIO.md`: plans/pricing hypotheses and MVP non-goals.
- `BACKLOG.md`, `docs/SPRINT_1_REPORT.md` (especially "Implicações para a Sprint 2+"), `docs/ux/UX_DECISIONS.md`, `docs/ux/JOURNEYS.md`, `docs/ux/WIREFRAMES.md`, `docs/ux/CONTENT_GUIDE.md`, `docs/ux/DESIGN_TOKENS.md`.
- `docs/ARCHITECTURE.md`, `docs/adr/*`, `docs/THREAT_MODEL.md`, `docs/DATA_MAP.md`, `docs/ENVIRONMENTS.md`, `docs/OBSERVABILITY.md`, `docs/SUPABASE_CAPACITY.md`, `docs/runbooks/*`.
- All of `apps/web/src`, `supabase/migrations/*`, `.env.example`, `.github/workflows/*`, root and `apps/web` configs.
- If the `supabase:supabase` and `supabase:supabase-postgres-best-practices` skills are available, load them before writing any SQL, RLS or auth code. For Next.js 16 APIs (`proxy.ts`, Server Actions, cookies), verify against the installed version rather than memory.

### Facts you must not get wrong

- **Every profile belongs to a workspace**, including individual users (personal workspace). Workspace kinds: `personal` and `agency`. User-facing terms follow `CONTENT_GUIDE.md` (e.g. "página" for profile, "Pessoal" / "conta da agência" for workspace).
- **Authorization lives on the server and in RLS**, never only in the UI. RLS is defense in depth, not the only check.
- **Draft and published are separate states.** This sprint only models `status`; publishing, snapshots and the public renderer are Sprint 3.
- **Entitlements, not plan-name checks.** Free = 1 profile; Pro and Agência limits come from `apps/web/src/lib/product.ts` (prices are hypotheses).
- **Service-role/secret key never reaches the browser** and is not used for ordinary user actions.
- User-facing copy is pt-BR; code, identifiers, ADRs and technical docs are English.
- Stack: npm workspaces, Next.js 16 App Router, React 19, TypeScript strict, Tailwind v4, Vitest, `@supabase/ssr` + `@supabase/supabase-js` (already installed), Node 24. `npm run check` = lint + typecheck + test + build.

## 3. Sprint goal and acceptance criteria

**Goal:** a person can sign up, verify their email, sign in, recover access, get a personal workspace automatically, create a basic page (name, slug, bio, avatar placeholder, draft state) and navigate an authenticated area — with tenant isolation proven by automated tests.

Acceptance criteria (from `PLANO_DE_EXECUCAO.md`) and the evidence required:

| # | Criterion | Required evidence |
|---|---|---|
| AC1 | A user cannot access another workspace's data by manipulating URL or payload | pgTAP RLS tests (positive + negative, cross-workspace, anon, each role) **and** server-layer tests for route/action authorization |
| AC2 | Invalid, reserved and duplicate slugs are rejected with a clear message | DB constraints/tests + Vitest for normalization/validation + pt-BR messages in the UI |
| AC3 | Access recovery expires and does not reveal whether an email exists | Neutral responses in code, configured expiry in `supabase/config.toml`, tests for the neutral-response behavior |
| AC4 | Soft delete and retention policy are represented in the model | `deleted_at` / `purge_after` (or equivalent) columns, RLS hiding deleted rows, retention documented in `DATA_MAP.md` |
| AC5 | Tests cover tenant isolation and the main auth flows | Test inventory in the report with exact counts and results |

## 4. Deliverables

### D1 — ADRs (`docs/adr/`)

- **0004 — Tenancy and authorization model:** tables, role matrix (`owner` / `admin` / `editor`), RLS helper-function strategy, how personal-workspace creation is guaranteed (DB trigger vs. idempotent server function — decide, justify, and note failure behavior during signup), soft-delete semantics, entitlement model.
- **0005 — Authentication:** Supabase Auth with email + password, mandatory email verification, password recovery via `token_hash` confirmation route, cookie sessions via `@supabase/ssr`, server-side identity via `getClaims()`/`getUser()` (never trust `getSession()` on the server), redirect allowlist, rate limits, and the path to a `MailAdapter`/Resend later. OAuth/social login and MFA are deferred — say so.
- **0006 — Database testing strategy:** Supabase CLI local stack + pgTAP (`supabase test db`), how CI runs it, and what happens when Docker is unavailable.

### D2 — Migrations (`supabase/migrations/`, forward-only, timestamped after the existing waitlist migration)

Do not modify the existing waitlist migration. Model at minimum:

- **User account** (1:1 with `auth.users`; avoid the name `profiles`, which means a link page here): display name, locale, timestamps, soft delete.
- **`workspaces`**: name, `kind` (`personal|agency`), `status` (`active|suspended`), plan reference, `created_by`, timestamps, `deleted_at`, `purge_after`. At most one personal workspace per user (partial unique index).
- **`workspace_memberships`**: `workspace_id`, `user_id`, `role`, status, `invited_by`, timestamps; unique `(workspace_id, user_id)`. A workspace must always keep at least one owner (enforce in the database and test it). Full invitations UI is Sprint 7; the model must already support it.
- **`profiles`** (link pages): `workspace_id` (required), `title`, `bio` (length limit), `slug`, `avatar_path` (nullable storage key — **no upload this sprint**; UI shows an initials fallback), `status` (`draft|published|archived`), `published_at`, timestamps, `deleted_at`, `purge_after`.
- **Slugs:** normalized (lowercase, accents removed, hyphens, 3–40 chars — reuse and graduate `apps/web/src/modules/editor/model/slug.ts`), globally unique on the normalized value, reserved-word table seeded from the Sprint 1 list (`admin`, `api`, `app`, `login`, `logout`, `proto`, `p`, `r`, `suporte`, `privacidade`, `agencias`, `profissionais`, plus every top-level route you create), and a `slug_history` table so released slugs have a documented hold period before reuse (prevents takeover/impersonation).
- **Entitlements:** `plans` + `plan_entitlements` (typed key/value, e.g. `max_profiles`, `analytics_days`, `custom_domain`, `remove_badge`, `team_members`, `shareable_reports`), a function that resolves a workspace's entitlement, and a DB-level guard for `max_profiles` so the limit cannot be bypassed from the client. Seed Free/Pro/Agência from `product.ts` values.
- **`audit_events`**: append-only (no update/delete for any client role), `workspace_id` (nullable for account-level events), `actor_user_id`, `action`, `target_type`, `target_id`, minimal non-PII `metadata`, `created_at`. Actions: `auth.sign_in`, `auth.sign_out`, `auth.password_reset_completed`, `profile.slug_changed`, `membership.role_changed`, `profile.published` (defined now, emitted in Sprint 3 — mark it *prepared*). Never store tokens, passwords, raw IPs or full emails in metadata.
- **RLS on every table** before exposing it: helper functions `security definer`, `stable`, `set search_path = ''`, using `(select auth.uid())`; separate policies per command; `anon` gets nothing on tenant tables. Sensitive mutations (role change, slug change, soft delete) go through narrow RPCs/functions that validate role and write the audit event in the same transaction.
- **Indexes** on every foreign key and every column used by RLS, lookups (`slug`), ordering and retention jobs.
- Retention: add SQL comments and a documented (not scheduled) purge approach; the actual purge job is Sprint 9.

Generate typed DB definitions with the Supabase CLI into `apps/web/src/lib/database.types.ts` (or the path you justify) and commit them.

### D3 — Database tests (`supabase/tests/database/*.test.sql`, pgTAP)

Minimum cases, each with at least two users in two workspaces:

- Members read/write their own workspace rows; non-members get zero rows or an error on select/insert/update/delete of another workspace's workspace, memberships, profiles and audit events — including by forging `workspace_id` in the payload.
- `anon` cannot read or write any tenant table.
- Role matrix: `editor` cannot change roles, delete the workspace or (per your matrix) change slugs; `admin` cannot demote/remove the last `owner`; nobody can leave a workspace without an owner.
- Slug: invalid format, reserved word, duplicate (including different case/accents), and a slug inside its hold period are rejected.
- Entitlement: a Free workspace cannot insert a second profile.
- Soft-deleted rows are invisible through RLS.
- `audit_events` cannot be updated or deleted by any client role; sensitive RPCs write exactly one audit event.
- Personal workspace: a new user ends up with exactly one personal workspace and an owner membership, and re-running creation is idempotent.

Add `npm run test:db` (root) that runs these. Add a **separate CI job** that installs the Supabase CLI, starts the local stack and runs `test:db`, so `npm run check` keeps working without Docker. The Supabase CLI may be added as a pinned devDependency — record the justification (maintenance, license, exit path) in ADR 0006 and run `npm audit`.

### D4 — Authentication (pt-BR UI, server-validated)

- Routes (adjust names to `CONTENT_GUIDE.md`, and reserve them as slugs): `/cadastro`, `/entrar`, `/recuperar-acesso`, `/redefinir-senha`, `/auth/confirm` (route handler, `verifyOtp` with `token_hash`), sign-out via POST only.
- Supabase clients in one infrastructure module (`server`, `browser`, `proxy` variants); no Supabase imports scattered through components. Use `import "server-only"` where applicable.
- Session refresh in Next.js 16 `proxy.ts`; protected routes redirect to `/entrar?next=…` with the `next` value validated against an allowlist of internal paths (no open redirect).
- Neutral responses: signup with an existing email and password recovery for an unknown email show the same message and timing class as success.
- Validation at the boundary (password minimum length, email format) with field-level errors linked by `aria-describedby`.
- `supabase/config.toml`: email confirmations on, OTP/recovery expiry, auth rate limits, `site_url`/redirect URLs for local, minimum password length. Document the equivalent settings required on hosted projects in `docs/ENVIRONMENTS.md` (do not apply them).
- Local email: use the local stack's mail catcher (Inbucket/Mailpit); document it in `README.md`.
- Every auth flow has loading, validation error, generic failure, success and expired-link states.

### D5 — Authenticated app, onboarding and pages

- Authenticated route group with a layout that resolves the user and their workspaces on the server.
- **Onboarding:** after first verified sign-in → personal workspace exists → create the first page (title, slug with debounced server-side availability check, optional bio, avatar placeholder) → land on the workspace home. Graduate UI patterns and components from `apps/web/src/prototype` and `apps/web/src/ui`; do not import from prototype-only code in production routes.
- **Workspace switcher** (personal + any agency workspace the user belongs to) and a minimal "create conta da agência" action. Switching context never changes authorization — every request re-checks membership on the server.
- **Page list and basic settings:** list, create (blocked with a clear message when the entitlement limit is reached), edit title/bio, change slug (confirmation dialog explaining the old link stops working; writes `profile.slug_changed`), soft delete, and a visible draft/published badge. No block editor, publishing or public page — Sprint 3/4.
- Empty, loading, error and success states on every screen; mobile-first; keyboard and focus rules from Sprint 1.
- Keep `/proto/**` working and clearly separated from the real app.

### D6 — Domain modules (`apps/web/src/modules/`)

- `identity`: session resolution, workspace membership lookup, a typed permission matrix (`can(role, action)`) that mirrors the RLS matrix, and an authorization guard used by every Server Action and route handler.
- `profiles`: slug normalization/validation/reservation (moved from `editor/model/slug.ts` with a re-export or updated imports), profile commands.
- `entitlements`: typed keys, resolution, and `assertEntitlement` — no `if (plan === "pro")` anywhere.
- `audit`: a single function for writing events with a redaction policy.
- Business rules stay out of React components. Structured logs with a correlation ID for auth and sensitive mutations; never log emails, tokens or cookies.

Vitest (minimum): slug normalization/validation/reserved words, redirect-allowlist validation, auth input validation and neutral-message mapping, permission matrix, entitlement resolution, audit redaction.

### D7 — Documentation and sprint closure

- Update `docs/ARCHITECTURE.md`, `docs/DATA_MAP.md` (account, workspace, membership, profile, audit rows with purpose and retention), `docs/THREAT_MODEL.md` (implemented vs. pending controls), `docs/ENVIRONMENTS.md` (local Supabase, hosted settings checklist), `docs/OBSERVABILITY.md` (auth failure and signup signals), `.env.example` (placeholders only), `README.md` (setup with local Supabase, test commands, local email).
- Add `docs/runbooks/AUTH_ACCESS.md`: user cannot sign in / verification email not received / suspected account takeover / leaked key.
- Update `docs/ux/CONTENT_GUIDE.md` and `docs/ux/UX_DECISIONS.md` with auth/onboarding copy and new provisional decisions.
- `BACKLOG.md`: check only Sprint 2 items that are actually done and verified.
- **`docs/SPRINT_2_REPORT.md`** following the Sprint 1 report structure and `AGENTS.md` §20: objective and outcome, decisions (including the gate decision from §0), acceptance-criteria table with honest status (implemented / verified / prepared / partial / blocked / not started) and direct evidence, deliverables with file paths, exact final results of lint, typecheck, unit tests, DB tests and build, security/privacy/a11y/performance/ops implications, gaps and risks, founder questions, and implications for Sprint 3.
- Update `AGENTS.md` §22 "Current project state" to reflect the real end state.

## 5. Out of scope

Public renderer, snapshots, publishing and cache (Sprint 3); block editor (Sprint 4); media upload/`StorageAdapter`, themes (Sprint 5); analytics ingestion (Sprint 6); invitations UI, consolidated dashboard, report links (Sprint 7); billing, payments, custom domains, pixels (Sprint 8); account export/deletion execution, moderation, CSP hardening, purge jobs (Sprint 9); OAuth/social login and MFA. Model the data these need where the plan requires it, but do not build them.

## 6. Engineering rules

- No `any`, `@ts-ignore`, `eslint-disable`, relaxed `tsconfig`/ESLint/CI, or skipped tests to get green. Never weaken RLS, validation or authorization to make a test pass.
- No new runtime dependencies except what is strictly required and justified in an ADR; no ORM, state library, component library or form library. The Supabase CLI as a devDependency is pre-approved (§4 D3).
- The service/secret key is used only for test setup or truly administrative server code with a comment explaining why; never in a request path for ordinary user actions.
- Migrations are forward-only and compatible with rolling back the application one version.
- Preserve Sprint 0/1 content; do not touch `node_modules/`, `.next/` or local caches.

## 7. Quality bar

- Mobile 360–430 px, ~768 px and desktop ≥ 1280 px with no horizontal scroll.
- WCAG 2.2 AA: labels, `aria-describedby` errors, `aria-live` for async status, visible focus, focus return after dialogs, 44 px targets, `prefers-reduced-motion`, no color-only state.
- If the local stack is available, verify the full journey in a browser (signup → email in the local mail catcher → verify → onboarding → create page → change slug → sign out → recover access), and a manual cross-workspace attempt by editing a URL and a form payload. If it is not available, say so and mark those items *prepared*, not verified.

## 8. Work order

1. **Read and plan:** read §2, inspect the git state, check the §0 gate. Summarize the plan, risks and the role matrix. If the gate fails, stop here.
2. **Branch:** create `feat/sprint-2-identity-tenancy`. If `feat/sprint-1-prototype` is not merged into `main`, branch from it and state that in the report.
3. **ADRs 0004–0006.**
4. **Migrations + seed + pgTAP tests**; iterate until `npm run test:db` passes. Generate DB types.
5. **Domain modules + Vitest.**
6. **Auth flows**, then **onboarding and authenticated app**.
7. **CI job for DB tests.**
8. **Docs, runbook, backlog, report, `AGENTS.md` §22.**
9. **Final gate:** review the full diff for unrelated or accidental changes and secrets, run `npm audit`, `npm run test:db` and `npm run check`, and fix everything that fails.

Commit in coherent Conventional Commits along the way (e.g. `feat(identity): add workspace and membership schema with RLS`).

## 9. Stop and ask for approval before

- applying migrations, changing settings or creating anything on a **hosted** Supabase project or Vercel (including through MCP tools) — local stack only;
- adding any paid service, new vendor or subprocessor;
- any destructive git operation, force-push, pushing to the remote or opening a PR;
- expanding scope beyond §4 or cutting a P0 item.

## 10. Final response format

1. Outcome in 3–5 sentences, including the gate decision used.
2. Acceptance-criteria table (status + evidence).
3. Files and routes to review (links, no large pastes).
4. Exact results: lint, typecheck, unit tests (files/tests), DB tests (files/tests), build (routes), `npm audit`.
5. Negative security cases tested.
6. Decisions awaiting founder confirmation.
7. Blockers, pending external setup and the recommended starting point for Sprint 3.
