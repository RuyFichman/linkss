# AGENTS.md

This file is the canonical operating guide for coding agents and human contributors in this repository. Read it completely before changing code, configuration, database schemas, infrastructure, or product documentation.

## 1. Instruction precedence

Follow instructions in this order:

1. Explicit user request for the current task.
2. System, security, and platform policies.
3. This `AGENTS.md` file.
4. Accepted architecture decision records in `docs/adr/`.
5. Product and execution documents.
6. Existing local conventions in the code being changed.

If instructions conflict, follow the higher-priority source and call out the conflict. Do not silently reinterpret product, security, pricing, or data-retention decisions.

## 2. Product context

`Projeto LNK` is the internal codename for a Brazilian link-in-bio and mobile conversion platform. The public brand has not been selected.

The product should let an individual or agency:

- create and publish a professional mobile page in under ten minutes;
- compose pages from reusable blocks;
- route visitors to WhatsApp, forms, scheduling, Pix/payment links, and other calls to action;
- measure visits, clicks, sources, and actions of value;
- manage multiple profiles and share understandable reports;
- subscribe to Free, Pro, or Agency plans priced in BRL.

Brazil is the preferred initial market, not an architectural restriction. Agencies and social media managers are the provisional initial ICP, not a permanent vertical.

The initial differentiator is **multi-profile operations plus proof of results**. Do not reduce the product to a generic list of links.

## 3. Sources of truth

Read the documents relevant to the task before implementation:

- `PLANO_DE_NEGOCIO.md`: business model, pricing assumptions, risks, and product boundaries.
- `PLANO_DE_EXECUCAO.md`: phases, sprint outcomes, acceptance criteria, gates, and launch requirements.
- `BACKLOG.md`: executable priority order for upcoming work.
- `docs/PRODUCT_BRIEF.md`: problem, promise, audience, North Star, and non-goals.
- `docs/ARCHITECTURE.md`: system boundaries, scaling path, and invariants.
- `docs/ENVIRONMENTS.md`: environments, delivery, secrets, migrations, and rollback.
- `docs/THREAT_MODEL.md`: abuse and security controls.
- `docs/DATA_MAP.md`: personal-data inventory and retention direction.
- `docs/OBSERVABILITY.md`: health signals, thresholds, and alert expectations.
- `docs/SUPABASE_CAPACITY.md`: Free-plan assumptions and upgrade policy.
- `docs/adr/`: accepted architecture decisions.

When a change invalidates a source of truth, update that document in the same change. Avoid documentation that describes an intended future state as if it already existed.

## 4. Repository layout

```text
apps/web/                 Next.js web application and public renderer
  src/app/                App Router routes, layouts, and route handlers
  src/lib/                framework-independent application helpers
docs/                     product, architecture, operations, and security
  adr/                    architecture decision records
  runbooks/               incident and operational procedures
.github/workflows/        CI workflows
BACKLOG.md                 prioritized implementation backlog
PLANO_DE_NEGOCIO.md        business plan, in Portuguese
PLANO_DE_EXECUCAO.md       delivery plan, in Portuguese
```

Create new top-level packages or services only when the architecture document's extraction signals are present. Prefer a cohesive module inside the current application over premature service separation.

## 5. Approved technical direction

- Node.js 24 and npm 11+.
- Next.js 16 App Router, React 19, and TypeScript in strict mode.
- Tailwind CSS for styling; accessible product components remain owned by the repository.
- Supabase Postgres and Auth, with Row Level Security as defense in depth.
- Supabase Storage may be used behind a `StorageAdapter`; public media must be portable to Cloudflare R2 or another object store.
- Public profiles are served from immutable published snapshots, not live editor tables.
- Customer analytics uses non-blocking event ingestion, short raw-event retention, and daily aggregates.
- External payment, mail, storage, and similar vendors must be isolated behind narrow adapters.
- GitHub Actions runs the required quality checks.

Do not introduce a second application framework, ORM, state library, component library, queue, cache, or analytics database without a concrete requirement and an ADR.

## 6. Architecture invariants

These rules are non-negotiable unless superseded by an accepted ADR:

1. Every profile belongs to a workspace, including individual profiles.
2. Authorization is enforced on the server and in database policies, never only in the UI.
3. Every tenant-owned row has an explicit tenant/workspace relationship and supporting indexes.
4. Draft content and published content are separate states.
5. Public rendering reads a cacheable published snapshot.
6. Publishing is idempotent and retains a rollback path to the previous good version.
7. Analytics, logging, and third-party failures never block visitor navigation.
8. Raw analytics events are not retained indefinitely in the transactional database.
9. Images and files are never stored as base64 or large blobs in Postgres.
10. Webhooks, jobs, and retried commands are idempotent.
11. Paid capabilities are modeled as entitlements rather than scattered plan-name checks.
12. Secret/service-role credentials never reach browser bundles.
13. Database migrations are forward-only and compatible with application rollback.
14. Public scripts and embeds use allowlists; arbitrary user-supplied JavaScript is prohibited.

## 7. Setup and commands

Requirements:

- Node.js 24
- npm 11+
- Docker (only for the local Supabase stack and database tests)

Setup:

```bash
npm install
npm run db:start
copy .env.example apps\web\.env.local
npm run dev
```

On Unix-like shells, replace `copy` with `cp` and use forward slashes. Fill the Supabase URL and publishable key from `npx supabase status`. Local auth emails are in Mailpit at `http://127.0.0.1:54324`.

Primary commands:

```bash
npm run dev        # start the web application
npm run lint       # lint all application code
npm run typecheck  # TypeScript without emitting files
npm run test       # run unit tests once
npm run build      # production build
npm run check      # lint + typecheck + test + build
npm run test:db    # pgTAP tests against the local Supabase stack (needs Docker)
npm run db:reset   # re-apply migrations and seed locally
npm run db:types   # regenerate apps/web/src/lib/database.types.ts
```

Database changes must ship with pgTAP tests (positive and negative, cross-workspace, anon) and regenerated types. If Docker is unavailable, say so in the handoff; the CI `database` job remains the gate.

Run `npm run check` before handing off any code change. Use the narrowest relevant command during iteration, then run the complete check before completion.

Do not edit generated files under `node_modules/` or `.next/`. Commit `package-lock.json` whenever dependencies change. Do not change package managers without an explicit repository-level decision.

## 8. Environment and secrets

- `.env.example` is the inventory of supported variables and must contain placeholders only.
- Local secrets belong in ignored environment files.
- Only deliberately public values may use the `NEXT_PUBLIC_` prefix.
- Treat Supabase secret/service keys, payment secrets, webhook secrets, mail keys, and observability tokens as server-only.
- Never log tokens, passwords, complete lead payloads, payment details, or cookies.
- Keep local, preview, staging, and production credentials separate.
- If a secret appears in code, logs, output, screenshots, or Git history, stop, report it, and rotate it.

## 9. Code conventions

- Use TypeScript for application code and keep `strict` mode enabled.
- Prefer small, explicit modules with domain language over generic utility layers.
- Keep React Server Components as the default; add client components only for actual browser interaction.
- Keep data access and authorization on the server.
- Validate all untrusted input at the boundary before domain logic.
- Represent money as integer cents and include currency explicitly.
- Store timestamps in UTC; convert for display at the boundary.
- Prefer named exports for reusable modules and descriptive names over abbreviations.
- Avoid hidden side effects, boolean argument traps, deep inheritance, and speculative abstractions.
- Comments should explain decisions and constraints, not restate the code.
- User-facing copy is Brazilian Portuguese unless a product decision says otherwise. Code, identifiers, ADRs, and technical documentation are English unless an existing document is intentionally Portuguese.

Keep business rules out of React components. Place reusable domain logic under an appropriately named module in `src/lib/` until a larger module boundary is justified.

## 10. Frontend and UX requirements

- Design mobile-first; public profiles are primarily opened inside social-app browsers.
- Every flow must define loading, empty, success, validation, and failure states.
- Forms must have programmatic labels, useful errors, keyboard support, and visible focus.
- Do not rely on color alone to communicate state.
- Preserve semantic HTML and target WCAG 2.2 AA for product flows.
- Avoid layout shift and unnecessarily large client bundles.
- Public pages must remain useful if customer analytics fails.
- Target public-page LCP p75 at or below 2.5 seconds and CLS p75 at or below 0.1 on mobile.
- Optimize and size images at upload/delivery; never ship original multi-megabyte images by default.
- Marketing claims must describe functionality that exists in the deployed product.

## 11. Database, Supabase, and multi-tenancy

- Schema changes must be migrations, never dashboard-only edits.
- Enable RLS on every tenant-accessible table before exposing it through Supabase APIs.
- Add positive and negative policy tests, including cross-workspace access attempts.
- Index foreign keys and fields used by RLS, public lookup, ordering, and retention jobs.
- Use database constraints for invariants such as uniqueness, required ownership, valid state transitions where practical.
- Do not use the service role to bypass RLS for ordinary user actions.
- Avoid unbounded selects and N+1 access on public routes.
- Slugs and custom domains require normalization, uniqueness, reservation rules, and auditable changes.
- Destructive migrations require an explicit data migration/rollback strategy and user approval when data loss is possible.

The Supabase Free plan is for development and the private MVP. Upgrade production before the paid beta or at 60% of database, storage, or egress quota, whichever comes first.

## 12. Analytics rules

Keep two concepts separate:

- **Customer analytics:** the visits, clicks, sources, and actions shown to profile owners.
- **Product analytics:** internal onboarding and feature-usage telemetry.

For customer analytics:

- event delivery is asynchronous and non-blocking;
- retries are deduplicated;
- admin, preview, bot, and known invalid traffic are filtered or identified;
- raw events default to seven-day retention in the MVP;
- durable reporting reads aggregates, not an unbounded raw table;
- timezone and date-window semantics are explicit;
- dashboards distinguish zero from missing or delayed data;
- changes to event definitions require versioning or documented compatibility.

Do not claim exact visitor counts when the implementation provides approximations. Document filtering and known limitations.

## 13. Security, privacy, and abuse

Assume public profiles will attract phishing, impersonation, spam, malicious uploads, and analytics abuse.

- Follow `docs/THREAT_MODEL.md` for applicable controls.
- Minimize personal data and define purpose, owner, and retention before collection.
- Do not collect or store card data; use provider tokens and identifiers.
- Sanitize content and enforce URL/protocol and embed-provider allowlists.
- Validate actual file content, size, and dimensions, not only filename or browser MIME.
- Apply rate limits to authentication, forms, uploads, event ingestion, and sensitive mutations.
- Sensitive changes require an audit trail.
- Deletion/export must cover every documented data store or record an explicit legal exception.
- New subprocessors or international data flows require an update to the data map and privacy review.
- A public reporting and suspension workflow is required before open launch.

Never weaken authorization, RLS, validation, CSP, rate limiting, or auditability to make a test pass or accelerate a demo.

## 14. Testing strategy

Test behavior at the lowest useful level:

- Unit tests for deterministic domain logic, formatting, entitlements, and validation.
- Integration tests for database constraints, RLS, adapters, publishing, and webhook idempotency.
- End-to-end tests for sign-up, create profile, edit, publish, view public page, upgrade, cancel, and delete/export.
- Contract tests for payment, mail, storage, and analytics adapters where practical.
- Performance checks for the public renderer and event endpoint.

Every bug fix should include a regression test when the failing behavior is deterministic. Tests must not depend on production data, shared mutable accounts, wall-clock sleeps, or uncontrolled external services.

Minimum handoff gate:

```bash
npm run check
```

For security- or tenancy-sensitive changes, also describe the negative cases tested.

## 15. Observability and operations

- Keep `/api/health` cheap, unauthenticated, secret-free, and uncached.
- Add structured logs and correlation IDs around public requests, jobs, publishing, billing, and external adapters.
- Every actionable alert needs an owner, severity, runbook, and expected response.
- Do not alert on symptoms with no action.
- Add metrics before launching a capacity-sensitive feature.
- Update runbooks when a change introduces a new failure mode.
- Practice restore and rollback; a backup is not considered valid until restoration succeeds.

## 16. Dependencies and external services

- Prefer platform and language primitives before adding a dependency.
- Verify maintenance, license, bundle/runtime cost, security posture, and exit path.
- Pin critical runtime/tooling versions deliberately and commit the lockfile.
- Keep vendor SDK usage inside adapters or infrastructure modules.
- Do not add a dependency solely to avoid writing a small, well-tested function.
- Run the relevant audit after dependency changes and report material findings.

## 17. Git and change discipline

- Preserve unrelated user changes.
- Use short-lived branches named by intent, such as `feat/profile-editor` or `fix/analytics-deduplication`.
- Keep commits coherent and use imperative Conventional Commit messages when practical.
- Do not commit secrets, `.env` files, generated build output, editor settings, or local caches.
- Do not rewrite shared history, force-push, or use destructive reset/checkout commands without explicit authorization.
- Review the diff before committing. Confirm that documentation and lockfiles changed when expected.
- PR descriptions should state outcome, important decisions, verification, risks, migrations, screenshots for UI changes, and follow-up work.

## 18. Product and scope discipline

MVP priorities are authentication/tenancy, editor, public renderer, publication, analytics, multi-profile operations, billing/entitlements, safety, privacy, and backups.

Do not add these before launch unless the user explicitly reprioritizes them:

- native checkout or stored-value wallet;
- full CRM or e-mail marketing suite;
- native mobile apps;
- generative AI as a core feature;
- marketplace;
- full white-labeling;
- public API/MCP;
- real-time collaborative editing.

A new pre-launch item must replace comparable scope or mitigate a security, legal, billing, reliability, or activation risk.

## 19. Working method for agents

Before changing files:

1. Read this file and relevant source-of-truth documents completely.
2. Inspect the current implementation and working-tree state.
3. Restate the intended outcome and identify risks/dependencies.
4. Prefer the smallest coherent change that fully solves the request.

While working:

1. Keep the user informed during long-running work.
2. Make reasonable in-scope assumptions and record consequential ones.
3. Do not invent completed integrations, credentials, tests, metrics, or customer evidence.
4. Keep docs synchronized with material technical or product decisions.
5. Stop for approval before destructive actions, irreversible data changes, new paid services, or scope expansion.

Before finishing:

1. Review the full diff for accidental or unrelated changes.
2. Run the proportionate checks, ending with `npm run check` for code changes.
3. Report what changed, what was verified, and what remains blocked or intentionally deferred.
4. Link to the most relevant files instead of pasting large documents.

## 20. Mandatory sprint reports

Every completed sprint must include a versioned report at `docs/SPRINT_<N>_REPORT.md`. The report is part of the sprint deliverable and must be created or updated before the sprint is declared complete.

Use the previous sprint report as the structural baseline and include, at minimum:

- sprint objective and the actual outcome;
- important product, UX, and technical decisions, including provisional decisions awaiting founder confirmation;
- an acceptance-criteria table with honest status and direct evidence;
- deliverables and the files or routes where they can be reviewed;
- verification performed, including the exact final result of lint, typecheck, tests, and build when applicable;
- security, privacy, accessibility, performance, data, and operational implications relevant to the sprint;
- known gaps, deferred work, blockers, risks, and items deliberately cut from scope;
- implications and dependencies for the next sprint;
- corresponding backlog updates, checking off only work that was actually completed.

Never mark a criterion as complete based only on implementation intent. Distinguish implemented, verified, prepared, partial, blocked, and not started where that distinction matters. Do not claim user research, usability testing, deployment, provisioning, migration execution, or external integration unless it actually occurred and the report identifies the evidence.

If a sprint ends with incomplete work, still produce the report and state the exact completion level and recommended continuation point. A sprint is not complete until its report and relevant source-of-truth documents are synchronized.

## 21. Definition of done

A change is done only when:

- acceptance criteria are satisfied;
- error, empty, loading, authorization, and edge cases are handled where relevant;
- tests cover the important behavior and pass;
- lint, typecheck, tests, and production build pass for code changes;
- security, privacy, accessibility, and observability implications were considered;
- migrations and operational steps are documented and safe;
- documentation and ADRs reflect changed decisions;
- the sprint report exists and accurately reflects evidence, gaps, and next steps when the change completes a sprint;
- no critical/high known defect is hidden;
- the final handoff is accurate about limitations and pending external setup.

## 22. Current project state

Sprints 1 and 2 are merged into `main`. Sprint 3 (published snapshots and public renderer) is complete at the local-verification level on branch `feat/sprint-3-public-renderer`: draft content (`social_links`, `blocks`, `draft_revision`), immutable `profile_publications`, audited publish/restore/unpublish RPCs, the anonymous `get_public_page(slug)` surface, the ISR public route `/[slug]` with Open Graph image, canonical redirects in `proxy.ts`, and Web Vitals/error instrumentation. Lint, typecheck, 127 Vitest tests, 231 pgTAP assertions, advisors and build pass; the publish/rollback/unpublish journey, a cross-tenant replay, an outage test and Lighthouse mobile runs (LCP 2.3–2.4 s, CLS 0) were verified against a local production build. See `docs/SPRINT_3_REPORT.md` and ADR 0007.

The public origin comes only from `NEXT_PUBLIC_APP_URL`; the domain will be bought later and switching is a configuration change plus redeploy (`docs/ENVIRONMENTS.md`). Public pages live at the domain root (`/<slug>`); every new top-level route must be added to `reserved_slugs` (migration + TypeScript list). Adding a block type means changing `private.validate_profile_draft`, `modules/profiles/draft-content.ts`, `modules/publishing/document.ts`, the renderer and both test suites together.

The Sprint 1 five-person usability gate was **overridden by the founder on 2026-09-25**; the sessions from `docs/research/USABILITY_TEST_PLAN.md` are still pending. Provisional decisions UX-001 to UX-025 await founder confirmation (UX-024 is accepted for Sprint 3 only).

Nothing has been provisioned or applied on hosted Supabase/Vercel. Before external users: approve and provision staging (a `*.vercel.app` URL is enough to measure the renderer on a real CDN), choose custom SMTP, apply the hosted Auth checklist, enable Auth CAPTCHA, and add rate limiting in front of the public renderer and `/api/vitals`. The recommended next step is Sprint 4 (block editor), which replaces the minimal link/social forms.
