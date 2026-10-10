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

Sprints 1 to 5 are merged into `main`; Sprint 5 (media, embeds and personalization, PR #10, merged 2026-10-02) was verified on the local stack only. Sprint 3 delivered draft content, immutable `profile_publications`, audited publish/restore/unpublish RPCs, the anonymous `get_public_page(slug)` surface, the ISR public route `/[slug]` with Open Graph image, canonical redirects in `proxy.ts`, and Web Vitals/error instrumentation (ADR 0007). Sprint 4 added link, text, social, WhatsApp and divider blocks with a shared URL policy, whole-draft autosave against `draft_revision` with conflict recovery, undo of the last deletion, a live preview that reuses the public renderer, and snapshot schema version 2 (ADR 0008).

Sprint 5 added (ADR 0009, ADR 0010, `docs/SPRINT_5_REPORT.md`): image upload with crop for the page photo and image blocks, re-encoded by the server with `sharp` into WebP variants (448/896/1344 px; avatar 96/192/288 px) in the public `media` bucket behind a `StorageAdapter`; HMAC-attested registration (`MEDIA_SIGNING_SECRET` on the server, `media_signing_secret` in Supabase Vault) so a signed-in user cannot upload around the validation; a `storage_mb` entitlement; media kept alive by computed references from the draft and the retained publications, with an orphan cleanup job at `/api/jobs/media-cleanup` (`CRON_SECRET`; `GET` for the daily Vercel Cron declared in `apps/web/vercel.json` at 06:00 UTC, `POST` for manual runs; up to 10 batches of 50 per run); `embed` (YouTube, Vimeo, Spotify by provider + id, click-to-load), `pix` (key + copy button, no QR code) and `form` blocks; a closed theme token set in `profiles.theme` with derived text colors; five templates that change appearance only; leads in `form_leads` through the anonymous `submit_form_lead` RPC (honeypot, per-visitor and per-page limits, consent record, 90-day retention) with a per-page list, CSV export and deletion. The snapshot stays at schema version 2 with additive changes only. Lint, typecheck, 402 Vitest tests, 479 pgTAP assertions, advisors and build (37 routes) pass. Lighthouse mobile on a page with avatar, three images and an embed: CLS 0; LCP 1.7–2.0 s with applied throttling but 2.95–3.62 s with the simulated throttling used in Sprint 4 (Sprint 4 page: 2.27 s) — field measurement is pending.

Sprint 6 (customer analytics, ADR 0011, `docs/SPRINT_6_REPORT.md`) is merged into `main` (PR #16, 2026-10-02) and **applied to staging; the founder confirmed it working there on 2026-10-06** (see the staging paragraph below). It adds: a collector mounted only by `/[slug]` (passive listeners, `sendBeacon` with a `keepalive` fallback, no cookie or browser storage; the preview and the editor never mount it); `POST /api/events`, which answers 204 before the database is involved, drops automated traffic, signed-in people and visits coming from `/app`, derives source, device class and country, and signs the batch; the anonymous `ingest_analytics_events` RPC, which verifies the signature (`ANALYTICS_SIGNING_SECRET` on the server, `analytics_signing_secret` in Vault) and validates the page and the block against the live publication; `form_submit` recorded by `submit_form_lead` itself; raw events in `analytics_events` (7 days), daily aggregates in `analytics_daily` (100 days; what a plan sees is the `analytics_days` entitlement), `analytics_day_status`, `analytics_rate_hits` and `analytics_settings` (reporting timezone `America/Sao_Paulo`), none of them readable by a client role; database limits per address per page, per address across pages, per page and a shed threshold on the raw table; the daily job `/api/jobs/analytics` (second Vercel Cron in `apps/web/vercel.json`, 04:00 UTC); the per-page dashboard under `/resultados` with CSV export. Cut: region (only country). Lint, typecheck, 690 Vitest tests, 639 pgTAP assertions, advisors and build (41 routes) pass; the controlled accuracy test (`apps/web/scripts/analytics-accuracy.mjs`) matched all 15 metrics at 0.0%. Measured: 329 bytes per raw event, 241 per aggregate row; the collector adds 1,176 bytes of compressed JavaScript and no measurable LCP or CLS change. Without the migration or the secret the public page works, events are dropped and the dashboard says results are not available yet. Deploy steps for the founder are in `docs/ENVIRONMENTS.md` ("Passos de deploy da Sprint 6"). The analytics event contract, the SQL enums, the collector and both test suites change together; the `data-block-id` / `data-block-type` hooks are what the collector reads.

Sprint 7 (multi-profile and agency operations, ADR 0012 and ADR 0013, `docs/SPRINT_7_REPORT.md`) is **merged into `main` (PR #18, 2026-10-07) and was verified on the local stack only; its result on staging has not been checked yet**. It was built in two sessions. Part 1 (ADR 0012): the page list as one query (`list_workspace_profiles`: search by name or address, status filter, order, 20 per screen, all in the URL); archiving (`archive_profile` takes the page off the air in the same transaction, keeps address, versions, results and leads, freezes the draft; archived pages count toward `max_profiles`); duplication in one transaction with new block ids, media shared through `media_asset_shares` instead of copied, and a review notice on the copy; invitations in `workspace_invitations` (256-bit token in the URL path, only its hash stored, 7 days, single use, accepted only by the invited confirmed e-mail, pending invitations hold seats, no e-mail is sent: the inviter copies the link); the members screen with role change, removal and leaving. Part 2 (ADR 0013): the consolidated dashboard at `/app/w/<workspace>/resultados` reading `get_workspace_analytics` (totals, daily series, sources and one row per page in one call; soft-deleted pages are left out; three PostgREST requests per render whatever the number of pages) with a per-page CSV; report links in `report_links` (one page per link, rolling window of 7, 30 or 90 **completed** days, required expiry of at most 90 days, optional label, only the token hash stored, at most 5 active per page), created and revoked by owners and admins on the page's results screen; and the public report at `/r/<token>` through the anonymous `get_shared_report` RPC, which returns a closed field list (no identifiers, no UTM values, nothing from the draft) or `{"status":"unavailable"}`. The route is dynamic (never ISR), sets no cookie, loads nothing from a third party, does not mount the collector, gets `Cache-Control: private, no-store`, `Referrer-Policy: no-referrer` and `X-Robots-Tag: noindex` from `next.config.ts`, and answers every token that does not open a report with the same 404. `get_profile_analytics` now delegates to `private.profile_analytics`, which the report also calls; `modules/analytics/workspace.ts` and `modules/reports/shared-report.ts` reuse `modules/analytics/dashboard.ts`, so every number has one definition: change them together and keep pgTAP `160-reports` (consolidated = sum of pages; report = page dashboard for the same days) green. Links stop resolving, and are kept, when the workspace loses `shareable_reports`. Not built: a "last opened" timestamp, a fixed date range, remembering the last workspace used. Lint, typecheck, 943 Vitest tests (34 files), 951 pgTAP assertions (18 files), advisors and build (47 routes) pass. The tenth-page measurement (`apps/web/scripts/agency-scale.mjs`, local, synthetic data) passed its threshold: page list 18 ms at 1 and 10 pages and 20 ms at 50; consolidated dashboard 21, 25 and 51 ms; requests per render constant. Without the migrations the application fails safe: the list falls back to the Sprint 2 query, the new screens say the feature is not available yet and `/r/<token>` shows the generic state. The report 404 is rendered by the client runtime, so without JavaScript it is an empty page with the right status and headers. Deploy steps are in `docs/ENVIRONMENTS.md` ("Passos de deploy da Sprint 7"); runbook `docs/runbooks/REPORTS.md`.

The marketing home (`/`, `apps/web/src/app/(marketing)/home.tsx`, copy in `HOME_COPY`) is a product page whose calls to action go to `/cadastro`; it is merged into `main` (PR #19, 2026-10-07) and was verified on the local stack only. It lists the paid plans as "em breve" without prices and draws its example pages in CSS with invented names (no customer content, testimonials or usage numbers). The Sprint 1 waitlist landing still serves `/agencias` and `/profissionais`.

The page editor (`/app/w/<workspace>/paginas/<page>`, for who can edit) was introduced as a full-viewport workspace modeled on the same reference (UX-072, provisional; merged into `main` with PR #21 on 2026-10-07, verified on the local stack only): `modules/editor/components/block-editor.tsx` plus `studio.css` originally rendered a dark navigation (top bar on phones, icon rail from 1024 px), a panel with the tabs "Conteúdo", "Estilos" and "Página" that shows one view at a time, and the preview always on screen (framed phone beside the panel; the page above a bottom sheet on phones). Only the layout changed: reducer, autosave, validation, publishing and the renderer are untouched. The account header and the workspace navigation carry `data-app-chrome` and are hidden by `body:has(.studio)`; the page settings (publishing history, address, archive, delete) are server-rendered in the route and passed to the editor as the "Página" tab. The preview finds blocks through the renderer's `data-block-id` hooks. Archived pages and read-only roles keep the previous page layout.

The mobile editor follow-up (UX-085, 2026-10-09; `docs/ux/MOBILE_EDITOR_REVIEW.md`, PR #24 merged into `main`) replaces that phone layout: below 1024 px, editing and preview use the available viewport, with bottom navigation and a fixed add button. Preview hides the panel without unmounting it, so unfinished fields, style sections and uploads survive the round trip. `use-studio-viewport.ts` follows the visual viewport while preserving zoom; controls that would unmount an active upload are disabled until it finishes or is canceled. Desktop keeps its two columns. All CSS remains scoped to `.studio`; public pages and other product screens are unchanged. Browser checks use a disposable local account (`scripts/editor-mobile.mjs`). After PR #24 reached staging, the founder reported an iPhone Safari regression: finishing a field left the editor shifted and at keyboard height. The viewport fix releases keyboard sizing as soon as text focus ends; a real-device retest of that fix and broader iOS/Android usability checks remain pending.

The rest of the product wears the same look (UX-073, provisional; merged into `main` with PR #22, verified on the local stack only): the tokens and `ui-*` classes in `apps/web/src/app/globals.css` carry it (ink primary buttons as pills, softer cards, pastel wash), and a layout opts in with `BRAND_CLASS` from `apps/web/src/ui/brand-font.ts` (the `brand` class plus the self-hosted display face). The app and auth layouts, the waitlist landing and the privacy notice use it; the shared report `/r/<token>` gets only the tokens (its layout is imported by a Vitest suite, where `next/font` does not run), and the public page `/[slug]` and the root 404 do not load the font. Inside `brand`, headings take the display face, so anything that renders a customer page there must sit in `page-canvas` (or the editor frame) to keep the fonts of the page theme. The workspace sections are `modules/identity/components/workspace-nav.tsx`.

Sprint 8 is split in two. **Part 1 (plans, subscriptions and billing, ADR 0014, `docs/SPRINT_8_REPORT.md`) is merged into `main` (PR #23), verified on the local stack only, and has never talked to a real payment provider**: the founder chose Stripe on 2026-10-09 and no account exists. Part 2 (custom domains, pixels) is not started. What part 1 adds: one price catalogue (`modules/billing/catalog.ts`, derived from `lib/product.ts`, mirrored by the `plan_prices` seed with a drift test; Pro R$ 14,90/month or R$ 149/year, Agency R$ 57,90/month or R$ 579/year); `PaymentsAdapter` with a Stripe implementation over `fetch` (no SDK, API version `2026-09-30.endive`) and an in-memory fake; tables `billing_customers`, `billing_subscriptions`, `billing_events` (the idempotency ledger) and `billing_invoices`, none writable by a client role; and **one attested path to `workspaces.plan_id`**: a webhook (or an owner action, or the daily job) is only a hint, the server reads the subscription at the provider, signs a snapshot with `BILLING_SIGNING_SECRET` (mirrored in Vault as `billing_signing_secret`) and `public.apply_billing_snapshot` verifies it; `private.billing_sync_plan` is the only statement that writes the plan, and the plan granted is the one whose `plan_prices` row matches the amount actually charged. States: `incomplete`, `active`, `past_due` (seven days of grace from the first failure, ended by the job), `ended` (terminal). Upgrades apply at once; a cheaper paid plan and a cancellation apply at the end of the paid period (the row holds the plan already paid for). A downgrade, a failed payment or a cancellation deletes nothing and blocks only new creations; a plan set by hand for a workspace with no subscription is left alone and shown as "definido manualmente". The state machine exists in TypeScript (`modules/billing/subscription.ts`) and in SQL: change them together and keep the Vitest table and pgTAP `170-billing` green. `BILLING_MODE` is `off` by default (the product behaves as before billing: no checkout button, limit screens unchanged, the webhook answers 503), `sandbox` with a Stripe test key (every billing screen says so) or `live` with a live key; a key that does not match the mode turns billing off. Only the owner pays, changes plan and cancels (`billing.manage`); admins see the plan (`billing.view`); editors see nothing about payment. Routes: `/app/w/<workspace>/plano` (plus `/confirmar` and `/retorno`), `POST /api/billing/webhook`, and `/api/jobs/billing` (third Vercel Cron, 05:00 UTC). The marketing home offers paid plans and shows prices only in `live`. Cut: changing between monthly and yearly on a running subscription. Locally there is no provider sandbox, so `apps/web/scripts/billing-lifecycle.mjs` serves an emulator of Stripe's API (`modules/billing/testing/stripe-emulator.ts`, written from the documentation, never imported by application code), starts the production build against it and plays a whole life cycle (124 checks pass; `--serve` for a browser, `--cleanup` removes the `qa-billing-*@example.test` accounts); it creates the local Vault secret if missing. Lint, typecheck, 1,136 Vitest tests (39 files), 1,116 pgTAP assertions (19 files), advisors and build (52 routes) pass. `npm audit` reports a new high advisory in `next` 16.0.0–16.3.7 (fixed in 16.4.0), not addressed in this branch. Stripe accounts in Brazil have no recurring Pix: subscriptions are paid by card. Deploy steps are in `docs/ENVIRONMENTS.md` ("Passos de deploy da Sprint 8, parte 1"); runbook `docs/runbooks/BILLING.md`.

Sprint 9 (legal acceptance, privacy requests, moderation and security headers, ADR 0015, `docs/SPRINT_9_REPORT.md`) is **partial**, on branch `codex/sprint-9-private-mvp`, verified on the local stack only and applied nowhere else. What exists: `legal_documents` (one active version per kind, body immutable once activated, SHA-256 computed by Postgres) and `legal_acceptances`; the app layout sends a signed-in person to `/aceite` while an active Terms or Privacy text is unaccepted, and **no text is active**: the drafts in `docs/legal/` wait for the lawyer and must be activated together by a later migration (activating only one blocks `/app`). `/app/conta/dados` offers a personal JSON export (`export_my_data`), an owner-only workspace JSON export (`export_workspace_data`, 8 MiB cap, no media files, no visitor or token hashes) and **requests** for data access and account deletion (`privacy_requests` with an append-only history): deletion is never automatic, has no written procedure yet, and cannot be marked complete while the Auth user exists. Public abuse reports go through `/denunciar` and the anonymous `submit_moderation_report` RPC, which accepts only a payload signed by the server (`MODERATION_SIGNING_SECRET`, mirrored in Vault as `moderation_signing_secret`), answers the same for unknown pages, duplicates and limits (3 per address, 30 per page, per 24 hours); `profiles.moderation_status` suspends one page (`get_public_page` answers `suspended`, publishing is refused). The queues at `/app/administracao/denuncias` and `/app/administracao/privacidade` are for platform administrators only, who are rows in `platform_admins` inserted by SQL; both queues are served only by security-definer RPCs, and no client role reads `moderation_reports` or executes a `private` function for them. Every response carries a CSP and the other security headers from `apps/web/src/lib/security/response-headers.ts` (scripts and styles still allow `unsafe-inline`; a new embed provider or media origin must be added there); `/api/events` and `/api/vitals` read a bounded body. Next is 16.4.0. Lint, typecheck, 1,144 Vitest tests (41 files), 1,156 pgTAP assertions (20 files) and build pass; in a browser only the public page and the report form were checked (desktop Chrome, signed out). **Not done:** backup and restore, new runbooks, alerts, global edge rate limits, CAPTCHA, scheduled purges, executing a deletion, cross-browser and mobile QA, accessibility review, seed/demo. Deploy steps are in `docs/ENVIRONMENTS.md` ("Passos de deploy da Sprint 9"); the per-store export and deletion inventory is in `docs/DATA_MAP.md`.

The public origin comes only from `NEXT_PUBLIC_APP_URL`; the domain will be bought later and switching is a configuration change plus redeploy (`docs/ENVIRONMENTS.md`). Public pages live at the domain root (`/<slug>`); every new top-level route must be added to `reserved_slugs` (migration + TypeScript list; `r`, used by the shared report, has been reserved since Sprint 1; Sprint 9 reserved `aceite`, `denunciar` and `cookies`). Adding a block type means changing `private.validate_profile_draft` and `private.published_block`, `modules/blocks/model.ts` (and its copy/summary), `modules/publishing/document.ts`, the renderer and both test suites together; document format changes follow expand/contract (ADR 0008, ADR 0010). Image variant widths are a contract between `modules/media/policy.ts`, `private.media_variants_are_valid` and the renderer's `srcset`: change them together. Copy read by visitors lives in `apps/web/src/content/public-page.ts`, the only copy file shipped to the public page's client bundle; keep everything else in `content/pt-BR.ts`. `profiles.social_links` is legacy (no longer written, kept until a founder-approved cleanup).

The Sprint 1 five-person usability gate was **overridden by the founder on 2026-09-25**; the sessions from `docs/research/USABILITY_TEST_PLAN.md` are still pending. The founder confirmed UX-020, UX-021, UX-023 and UX-025 on 2026-09-30, and UX-019 and UX-051 to UX-059 (Sprint 7, part 1) on 2026-10-06; the other provisional decisions (including UX-026 to UX-032 from Sprint 4, UX-033 to UX-042 from Sprint 5, UX-043 to UX-050 from Sprint 6, and UX-060 to UX-071 from Sprint 7) stay provisional and are the implementation default until the founder decides. UX-024 was superseded by the block editor. AC5 of Sprint 4 (five blocks in under 10 minutes) has only an internal proxy, pending real usability sessions. Cut from Sprint 5: the Pix BR Code/QR code, a background image in the theme, and e-mail notification of new leads.

A hosted Supabase project (Free plan) is the staging database; its project ref is kept out of this public repository and lives in the Supabase dashboard and the local CLI link. On 2026-10-01 the seven migrations up to `202609300001_block_editor` were applied with `supabase db push`, and the hosted schema was compared with the local one. The application is deployed on Vercel at `https://linkss-black.vercel.app` (staging; `main` deploys automatically; root directory `apps/web`, Node 24). On 2026-10-02 the founder ran the full journey on staging: sign-up, email confirmation, sign-in, image uploads, publishing, the public page on a phone, and a form submission seen under Contacts. The database holds only the founder's test account and page. Hosted Auth is still on defaults: the checklist in `docs/ENVIRONMENTS.md` is not applied. On 2026-10-02 the Sprint 5 migrations (`202610010001`, `202610010002`) were applied to staging with `supabase db push`. All nine migrations are recorded, and the new tables, `profiles.theme`, the public `media` bucket and its Storage policy are present. The Vault secret `media_signing_secret` was created on 2026-10-02. The founder set the Vercel variables `MEDIA_SIGNING_SECRET` (same value as the Vault secret), `VISITOR_HASH_SALT` and `CRON_SECRET` the same day and redeployed. The cleanup route answers 401 rather than 503, which means `CRON_SECRET` and `SUPABASE_SECRET_KEY` are present. Uploads and form submissions work on staging. Apply migrations with `supabase db push` from the linked CLI, never through the dashboard. The CI `database` job now starts Storage.

Locally, uploads need `MEDIA_SIGNING_SECRET` in `apps/web/.env.local` and the same value in the local Vault (`README.md`), and analytics needs `ANALYTICS_SIGNING_SECRET` the same way (a signed-in browser is never counted: test in a private window); the local database holds the founder's test accounts, so use `supabase migration up`, not `db reset`, unless the founder approves.

Before external users: choose custom SMTP, apply the hosted Auth checklist, enable Auth CAPTCHA, add rate limiting in front of the public renderer, `/api/vitals`, `/api/media`, `/api/events`, `/r/` and the form submission, schedule the purge of finished invitations and report links, get the privacy notice and the legal basis for visitor analytics reviewed, schedule the lead purge, and build reporting/moderation for images and Pix keys (Sprint 9). Lab measurements on staging are in `docs/SPRINT_5_REPORT.md` ("Medição no staging"): CLS 0; PageSpeed mobile scored 95 or more. Lighthouse runs from the development machine gave LCP 2.7–3.4 s when an image in the second block was the LCP element, because it was lazy-loaded. The first image among the first three blocks is now eager (PR #14, merged 2026-10-02); after it, PageSpeed mobile gave LCP 2.3–2.4 s (score 97–98), while Lighthouse from the development machine gave 2.9–3.1 s with the image still the LCP element. Lighthouse runs on that machine are inflated by a render-blocking script injected by the antivirus unless it is blocked with `--blocked-url-patterns`, so there is no reliable before/after comparison from there. The page declares a `preconnect` to the media origin (since Sprint 5) but no `preload` for the priority image; that is the next optimization to consider. On 2026-10-02 ("Verificações no staging depois da correção" in the same report) a publication was visible in about 5 s (one manual run), the Open Graph card rendered in WhatsApp and Instagram, and a first read of the `web_vital` logs gave LCP p75 680 ms and CLS 0 over 115 events. Those events are the founder's own visits mixed with Lighthouse runs, not real visitors, and only about 50 minutes of logs were available, so the log retention on Vercel needs confirming before relying on the 24-hour thresholds in `docs/OBSERVABILITY.md`. By 2026-10-06 the Sprint 6 migrations (`202610020001`, `202610020002`) were applied to staging with `supabase db push`, the Vault secret `analytics_signing_secret` was created, and the founder set `ANALYTICS_SIGNING_SECRET` on Vercel and redeployed. On 2026-10-06 the founder also replaced `CRON_SECRET` on Vercel (the previous value had not been kept) and redeployed; a manual `POST /api/jobs/analytics` answered `{"ok":true,"status":"ok",...}` with no events yet, and the founder then reported that a visit and a click from a private window on a phone appeared under *Resultados* (founder's report; no log or screenshot is recorded). The Supabase CLI must be signed in to the account that owns the staging project: another account gets a 403 on `db push`. Still open on staging: real-visitor LCP/CLS and the first scheduled run of both crons with a successful outcome (`analytics.maintenance` with `outcome=ok` and a non-null `lastFinalDay`). For Sprint 7 on staging: the founder reported on 2026-10-06 that the two part 1 migrations (`202610060001`, `202610060002`) were applied with `supabase db push` (not checked from this repository); and on 2026-10-07 that the two part 2 migrations (`202610060003`, `202610060004`) were applied the same way (also not checked from this repository); the PR was merged on 2026-10-07 (PR #18), so `main` deployed it to staging automatically; the result still has to be checked there. Every workspace is created on the Free plan. Until Sprint 8 part 1 is applied to staging with a Stripe test account, `workspaces.plan_id` changes there only by SQL, so testing several pages, invitations, 90 days of history or report links on staging needs `update public.workspaces set plan_id = 'agency' where id = '<workspace>';` (such a plan is left alone by billing; never do it to a workspace that has a subscription). Locally, the measurement script leaves the `qa-ac5-*@example.test` accounts and about 53,000 synthetic aggregate rows (`node scripts/agency-scale.mjs --cleanup` in `apps/web` removes them), next to the `qa-sprint7-*@example.test` data from part 1. The next steps are: check Sprint 7 on staging; review and merge Sprint 8 part 1, open a Stripe test account and run its staging steps, comparing what Stripe really does with what the emulator assumed; finish Sprint 9 (continuation list in `docs/SPRINT_9_REPORT.md`) and get the legal drafts reviewed; then Sprint 8 part 2 (custom domains and pixels), whose entitlements follow the same plan-change path with no change to it (handoff in `docs/SPRINT_8_REPORT.md`).
