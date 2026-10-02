# Sprint 6 — Analytics and proof of results (Projeto LNK)

## 0. Founder gate status

Edit this block before running the prompt if anything changed.

```text
SPRINTS 1–5: merged into main. Sprint 5 was verified locally and then applied to staging on 2026-10-02.
USABILITY_GATE: FOUNDER OVERRIDE (2026-09-25) still in force — the five-person sessions are pending.
UX_DECISIONS confirmed by the founder: UX-020, UX-021, UX-023, UX-025 (2026-09-30).
Other UX decisions (UX-026 to UX-042): provisional, and they are the implementation default (do not wait for confirmation).
Staging database: hosted Supabase project (Free) with all nine migrations up to 202610010002. Hosted Auth is on defaults.
Staging application: Vercel, https://linkss-black.vercel.app (main deploys automatically). One daily Vercel Cron exists (media cleanup, 06:00 UTC).
Still open on staging: real-visitor LCP/CLS and the first cron run. These do not block this sprint.
This sprint is developed and verified on the local stack. Do not apply Sprint 6 migrations, create secrets, add cron entries that take effect, or change settings on the hosted project or on Vercel; list them in the report as deploy steps for the founder. Merging to main deploys to staging: code that needs a Sprint 6 migration or a new environment variable must fail safe (the public page still opens, events are dropped, the dashboard shows "not available yet") until the founder applies them.
```

This sprint delivers the product's first measurable differentiator: the owner of a page sees visits, actions of value, sources and which blocks work. It is also the first time the product collects data about **visitors who never signed up**, and the first write path that scales with public traffic instead of with the number of customers. Those two facts carry most of the risk: privacy on one side, database capacity and abuse on the other. The numbers shown must be defensible. A dashboard that looks precise and is wrong is worse than no dashboard.

## 1. Your role

You are the senior full-stack engineer on **Projeto LNK**, working on your own in this repository with Claude Code. Sprints 0–5 are done (see `docs/SPRINT_5_REPORT.md`). Your job is to deliver **Sprint 6, "Analytics e prova de resultado"**: public pages emit visit and action events without ever delaying the visitor, the events are deduplicated, filtered, aggregated daily and purged after seven days, and the owner sees a dashboard per period with the visit → value-action funnel, block ranking and traffic sources, plus a CSV export. Deliver working, tested code and migrations, not a plan.

Don't stop for questions except where §9 requires approval. When a product decision is ambiguous, pick the option that fits the documents best, record it as *provisional, founder to confirm* in `docs/ux/UX_DECISIONS.md` (UX, next id UX-043) or in ADR 0011 (technical), and continue.

Keep a task list for the deliverables and update it as you go. Give a short progress report after each work-order phase (§8).

## 2. Read first (mandatory)

Read these in full before you write anything:

- `AGENTS.md` (canonical; it overrides your defaults, especially §6, §11, §12, §13, §19–§22), `README.md`.
- `PLANO_DE_EXECUCAO.md`: **Sprint 6**, plus Sprints 7, 8 and 9 (the consolidated dashboard and the read-only report link will read the same aggregates; history depth may become an entitlement; purge, export and deletion must reach analytics data), and the risk-table row "Pipeline de eventos".
- `BACKLOG.md` (Sprint 6 section and the open-debt section), `docs/SPRINT_5_REPORT.md` (especially "Implicações para a Sprint 6" and "Pendências, gaps e riscos"), `docs/SPRINT_1_REPORT.md` (the initial event taxonomy), `docs/ux/JOURNEYS.md` (proposed event names), `docs/ux/WIREFRAMES.md`, `docs/ux/UX_DECISIONS.md` (UX-025 expects badge clicks to be measured), `docs/ux/CONTENT_GUIDE.md`, `docs/ux/DESIGN_TOKENS.md`.
- `docs/ARCHITECTURE.md` (the analytics rows, the invariants, the extraction signals), all of `docs/adr/*` (especially 0003, 0007, 0008 and 0010), `docs/THREAT_MODEL.md` (the analytics row), `docs/DATA_MAP.md` (the analytics row: raw seven days, aggregates per policy), `docs/SUPABASE_CAPACITY.md` (the raw-analytics estimate: about 1 KB per event, 100 profiles ≈ 330 MB per month if nothing is purged), `docs/OBSERVABILITY.md`, `docs/ENVIRONMENTS.md`, `docs/runbooks/*`.
- Code: `apps/web/src/modules/publishing/*` (`document.ts`, `render/`, `public-page.ts`, `cache.ts`), the public route `apps/web/src/app/[slug]/`, the preview route under `/app/w/[workspaceId]/paginas/[profileId]/previa`, `apps/web/src/app/api/vitals/route.ts` (the existing beacon pattern), `apps/web/src/modules/leads/*` (`visitor-hash.ts`, `submission.ts`, the anonymous `submit_form_lead` RPC, the CSV export and its audit), `apps/web/src/app/api/jobs/media-cleanup/` and `apps/web/vercel.json` (the existing job pattern), `apps/web/src/modules/entitlements/*`, `apps/web/src/modules/identity/permissions.ts`, `apps/web/src/modules/blocks/model.ts`, `apps/web/src/content/public-page.ts` and `content/pt-BR.ts`, `apps/web/src/proxy.ts`, `apps/web/src/app/proto/analytics/[profileId]/page.tsx` (the Sprint 1 prototype of this dashboard — the UX reference, not production code), every migration in `supabase/migrations/` and the pgTAP suites in `supabase/tests/database/`.
- Load the `supabase:supabase` and `supabase:supabase-postgres-best-practices` skills before writing any SQL or policy. For Next.js 16, React 19, Vercel request headers (geolocation), Vercel Cron limits on the current plan and `navigator.sendBeacon` / `fetch` `keepalive` behavior in in-app browsers, check the installed versions and current documentation instead of relying on memory.

### Facts you must not get wrong

- **Analytics never sits in the visitor's path.** A click on a link, WhatsApp, Pix or social block opens its destination whether or not the event is sent, is accepted, or the endpoint is down. No redirect-through tracking URLs, no `await` before navigation, no `preventDefault` on links. Events go out with `sendBeacon` or `fetch` with `keepalive`, fire-and-forget. `docs/ARCHITECTURE.md` forbids writing analytics in the critical path of a click.
- **The public page is static HTML served by ISR from the snapshot.** A page view cannot be counted while rendering, because most views never reach the server render. Do not make `/[slug]` dynamic and do not read cookies or headers there. The page view is a client beacon. Visitors without JavaScript are therefore not counted; say so in the ADR and next to the numbers where it matters.
- **The preview reuses the public renderer.** The preview, the editor and any admin surface must never emit customer-analytics events. Prove it with a test.
- **Customer analytics and product analytics are separate** (AGENTS.md §12). This sprint builds customer analytics. Do not mix the two in one table, endpoint or dashboard.
- **`data-block-id` and `data-block-type` are already on every rendered block** (ADR 0008, ADR 0010). They are the collection hooks. Form submission and Pix copy are already identifiable actions.
- **Raw events are short-lived** (seven days by default) and **the dashboard reads aggregates**, never an unbounded raw table. Re-running the aggregation for a day must give the same result as running it once.
- **No raw IP address, no full user-agent string and no full referrer URL are stored.** `modules/leads/visitor-hash.ts` is the precedent for a salted daily hash. No cookie or `localStorage` identifier is set on visitors unless ADR 0011 justifies it and the privacy page says so.
- **The database is the authority.** A crafted request that skips the client must not be able to inflate another page's numbers beyond the rate limit, write events for an unpublished, suspended or non-existent page, reference a block that is not in the published snapshot, or store arbitrary strings.
- **No service or secret key in the ingestion path.** Anonymous ingestion goes through a narrow `security definer` RPC granted to `anon`, the way `submit_form_lead` and `get_public_page` work. Scheduled jobs follow the `media-cleanup` pattern (`CRON_SECRET`; `GET` for the cron, `POST` for manual runs).
- **Numbers are approximations and must be labeled as such.** "Visitors" derived from a daily hash is an estimate; do not call it an exact count (AGENTS.md §12).
- **Copy read by visitors lives in `content/public-page.ts`**, the only copy file in the public client bundle. Everything else goes in `content/pt-BR.ts`. User-facing copy is pt-BR; code, identifiers, ADRs and technical docs are English.
- **Every new top-level route goes into `reserved_slugs`** (migration + TypeScript list). Prefer routes under the existing `/api` and `/app` prefixes.
- Stack: npm workspaces, Next.js 16 App Router, React 19, TypeScript strict, Tailwind v4, Vitest, pgTAP through `npm run test:db`, Node 24. `npm run check` = lint + typecheck + test + build. Baseline at the end of Sprint 5: 402 Vitest tests, 479 pgTAP assertions, 37 routes.
- **Local environment:** the founder has test accounts in the local database. Apply migrations with `supabase migration up`; do not run `npm run db:reset` without approval. Stay inside this repository: write temporary files only to the session scratchpad, and leave Docker containers that belong to other projects alone. Lighthouse on this machine is inflated by a render-blocking script injected by the antivirus unless it is blocked with `--blocked-url-patterns`.

## 3. Sprint goal and acceptance criteria

**Goal:** the owner of a published page opens a dashboard and sees, for a chosen period, how many visits the page had, how many turned into an action of value, where the traffic came from and which blocks were used — with numbers that are deduplicated, filtered for bots and internal traffic, consistent across timezones, honest about gaps, and collected without slowing or blocking a single visitor.

| # | Criterion (`PLANO_DE_EXECUCAO.md`) | Required evidence |
|---|---|---|
| AC1 | Analytics never prevents the clicked destination from opening | A browser check for each clickable block type with the ingestion endpoint (a) returning 500, (b) hanging, (c) blocked by the client: the destination opens every time and nothing is thrown to the console that breaks the page; a test that the client collector never calls `preventDefault` or delays navigation; the public page renders and works with the collector script failing to load |
| AC2 | Events duplicated by a retry have defined deduplication | The deduplication key and window documented in ADR 0011; Vitest for the client retry behavior; pgTAP showing that the same event sent twice (and the same batch sent twice) is stored and aggregated once; the aggregation job run twice for the same day gives identical rows |
| AC3 | The dashboard distinguishes "no data" from "zero" | Distinct, tested states for: page never published; published but no event yet; period before the page existed; a day with zero visits; data delayed (aggregation behind or failed); analytics not deployed yet. Each has its own copy and none relies on color alone. A pure function maps aggregate rows plus the aggregation watermark to these states, with a Vitest table |
| AC4 | Timezone and date window are consistent | The reporting timezone and the definition of "day", "today" and "last N days" stated in ADR 0011 and visible in the dashboard; Vitest and pgTAP cases at the day boundary (an event at 23:59 and at 00:01 local time, and at the UTC boundary); totals for a period equal the sum of its days; the CSV uses the same windows and says which timezone it uses |
| AC5 | In a controlled test, aggregated totals are within 5% of the valid event set | A reproducible fixture with a known composition (valid events, retries, bot traffic, preview/admin traffic, malformed and out-of-window events) sent through the real ingestion path on the local stack, then aggregated; the report states expected valid totals, the aggregated totals and the difference per metric, and explains any difference above zero |
| AC6 | No visitor personal data is shown without a defined basis and purpose | `docs/DATA_MAP.md` lists every stored field with purpose, legal basis and retention; pgTAP shows `anon` cannot read events or aggregates and another workspace cannot read them; the dashboard and the CSV contain only aggregates (no per-visitor rows, no hash, no IP, no full referrer URL); a test that a query string or a path in a referrer never reaches storage |

## 4. Deliverables

### D1 — ADR 0011 (customer analytics: event contract and pipeline)

Decide, justify and record. Where a recommended default is given, you may choose differently if the code or current documentation shows a better option; say why.

- **Event taxonomy and contract.** A versioned contract (a `v` field or equivalent) with a closed set of event types. At minimum: page view; click on a link block; click on a social item; WhatsApp click; Pix key copied and Pix payment link opened; form submitted; embed loaded; image block click when the image has a link; click on the "Criado com Projeto LNK" badge (UX-025). State which of them are **actions of value** for the funnel (recommended: WhatsApp, Pix, form submission and link clicks reported separately so the owner can tell "contact" from "navigation"; decide and record it as provisional). State how a contract change is rolled out (expand/contract, as in ADR 0008).
- **Form submission.** The form works without JavaScript and the server already knows when a lead is accepted. Decide whether the event is recorded on the server at submission, on the client, or both, and how double counting is prevented. Do not read `form_leads` to count.
- **Client collector.** A small script on the public page only: event delegation on `data-block-id`, `sendBeacon` with a `keepalive` fetch fallback, batching, a client-generated event id for deduplication, and a bounded retry. Decide what happens in in-app browsers (Instagram, WhatsApp, TikTok) where the page is unloaded on navigation. Give its size a budget in bytes and measure it.
- **Ingestion endpoint and write path.** A Route Handler that validates and normalizes at the boundary, derives the server-side dimensions, and calls the anonymous RPC. It answers quickly, with no body the client depends on, and must be safe when the database is slow or down. State the timeout and what is dropped.
- **Validation against the published snapshot.** The page must be published and not suspended; the block id must exist in the current publication (decide what to do with events for a version that was just replaced). Decide whether the publication version is stored with the event.
- **Deduplication.** Key, scope and window; what happens to a duplicate (ignored without error).
- **Visit and visitor definitions.** What counts as one visit (recommended: a page view deduplicated per visitor hash within a short window, so a reload does not count twice — decide the window), and whether "unique visitors" is shown at all. Decide whether the daily hash reuses `VISITOR_HASH_SALT` or uses its own secret, and why. The hash must not allow following one person across days or across pages of different workspaces.
- **Dimensions, at privacy-compatible granularity.** Referrer reduced to a host and classified into a source (Instagram, WhatsApp, TikTok, Google, direct, other); UTM `source`, `medium` and `campaign` with length caps and a character policy, and a cap on distinct values per page per day so a hostile sender cannot explode cardinality; device class (mobile, tablet, desktop) derived on the server without storing the user agent; country and region from the hosting platform's request headers when present, "unknown" otherwise (they are absent on the local stack — design and test for that). Decide whether region stays in scope or only country.
- **Bot, preview and admin exclusion.** A documented, reasonable filter: known bot and link-preview user agents (WhatsApp, Instagram and Facebook fetch pages to build cards), headless and automation signals, Lighthouse/PageSpeed, the app's own preview, and the signed-in owner viewing their own public page (decide how this is detected without making the public page dynamic and without a database round trip per event, or record why it is not filtered). State whether filtered events are dropped or stored with a flag, and list the known limits.
- **Storage model.** Raw events table: append-only, with explicit workspace and profile, the minimum columns, and the indexes required by ingestion, aggregation and purge. Decide between plain deletes and time partitioning for the seven-day purge, using measured row size. Daily aggregate tables shaped for the dashboard's queries (totals, per block, per source, per device, per country) so that no dashboard query scans raw events, with a note on how Sprint 7's consolidated dashboard and report link will read them.
- **Aggregation and freshness.** When the aggregation runs, how late events and re-runs are handled (idempotent upsert per day), where the watermark lives, and how "today" is shown (recommended: aggregate completed days in the job and compute the current day from the bounded raw window, or aggregate incrementally; decide based on what the scheduler on the current Vercel plan allows — verify the cron limits). State the maximum delay the owner can see and show it in the UI.
- **Timezone.** One reporting timezone and the reason (recommended: `America/Sao_Paulo` for every page in the MVP, stored as an explicit setting rather than hard-coded in queries, so a per-workspace timezone can come later). State what would be needed to support another timezone.
- **Rate limiting and abuse.** Per-visitor and per-page limits enforced in the database (the `form_submission_hits` precedent), payload size caps, and what happens under a flood: the page stays up, events are dropped, the owner's numbers are bounded. Global rate limiting in front of the endpoint is still Sprint 9; say what is left exposed.
- **Retention.** Raw seven days. Aggregate retention: pick a default, tie it to an entitlement if `modules/entitlements/catalog.ts` already models history depth, and never check a plan name. How purge, profile soft delete, workspace deletion and Sprint 9's export/deletion reach events and aggregates.
- **Capacity.** Measured bytes per raw event and per aggregate row, the resulting ceiling on the Free plan for the private MVP, and the signal that triggers the upgrade or the extraction described in `docs/ARCHITECTURE.md`.
- **Audit.** Which actions need an audit event (CSV export probably does, following `lead.exported`).

### D2 — Database (forward-only migrations + pgTAP)

- Raw events and aggregate tables with RLS enabled. `anon` and `authenticated` have no direct access to raw events. Aggregates are readable by workspace members according to the existing permission matrix and by nobody else.
- The anonymous ingestion RPC (`security definer`, fixed `search_path`, granted to `anon`): validates the page and block against the published snapshot, enforces enumerations, length caps, deduplication and rate limits, accepts a bounded batch, and is safe to retry.
- The aggregation function and the purge function, both idempotent, both callable by the job only, with a watermark or run log that the dashboard can read to tell "delayed" from "zero".
- Read functions or views for the dashboard that take a profile and a date window and return bounded results.
- Indexes on every foreign key and on the fields used by RLS, ingestion lookups, aggregation and purge.
- If a new top-level route is added, `reserved_slugs` (migration + TypeScript list).
- pgTAP, at minimum: happy path for every event type; duplicate event and duplicate batch; unknown type, oversized field, malformed id, a referrer with path and query; unpublished, suspended and non-existent page; block id not in the published snapshot; per-visitor and per-page rate limits; `anon` cannot select events or aggregates; a member of another workspace cannot read aggregates; an editor can or cannot according to the matrix; aggregation correctness on a fixture, including the day boundary in the reporting timezone; aggregation run twice; late event after a first aggregation; purge removes only rows older than the window and never touches aggregates; profile deletion behavior.
- Regenerate `apps/web/src/lib/database.types.ts` (`npm run db:types`). Run the Supabase advisors on the local stack and fix what they report.

### D3 — Pure modules (TypeScript source of truth, mirrored in SQL where the database enforces it)

Under `apps/web/src/modules/analytics/`:

- **Event contract:** types, the validator and normalizer used at the boundary, and the catalog of value actions.
- **Source classification:** referrer host → source, UTM normalization, with a table of real-world cases (in-app browsers, `l.instagram.com`, `wa.me`, `t.co`, `android-app://` referrers, empty referrer, the page's own origin, hostile strings).
- **Device and bot classification** from the user agent, with a table of cases. No dependency for this unless ADR 0011 justifies it.
- **Date windows:** reporting-timezone day arithmetic, the period presets, and the bucket boundaries, with boundary tests. Use platform primitives (`Intl`), not a date library.
- **Dashboard state:** the function behind AC3, and the funnel and ranking calculations (conversion rate with a zero-visit denominator, removed blocks, ties).
- **CSV:** reuse the lead export's escaping, including protection against spreadsheet formula injection in UTM values and block titles.
- Vitest tables for all of them, with the hostile cases repeated in pgTAP.

### D4 — Collection on the public page

- The collector, loaded so that it does not block rendering and does not move LCP or CLS. Report the public route's client JS size before and after.
- Page view on load (once per load; decide about back/forward cache restores and prerender), and one event per interaction in the taxonomy. The embed click-to-load and the Pix copy must not wait for the network.
- Nothing is collected in the preview or the editor.
- No third-party request and no third-party script.
- The page stays fully usable with JavaScript disabled, with the collector blocked, and with the endpoint failing.

### D5 — Ingestion endpoint and jobs

- The ingestion Route Handler: boundary validation, server-derived dimensions, the RPC call, structured logs with a correlation id and outcome counts (never the payload, the hash or the referrer). Always cheap, never cached, never a redirect.
- The aggregation and purge job route(s) following the `media-cleanup` pattern: `CRON_SECRET`, `GET` for the scheduler and `POST` for manual runs, bounded work per run, idempotent, and a clear log line with rows aggregated and purged. Add the schedule to `apps/web/vercel.json` only if the current plan allows another cron; otherwise fold it into the existing daily job or document the alternative. The route must answer safely when the migration is not applied yet.
- A performance check for the ingestion endpoint on the local stack (latency under a burst, and what the database does at the rate limit), recorded in the report.

### D6 — Dashboard (pt-BR, mobile-first)

A per-page analytics screen under the existing workspace routes, linked from the page's management screen. Use `/proto/analytics/[profileId]` and `docs/ux/WIREFRAMES.md` as the starting point.

- Period presets (recommended: 7, 30 and 90 days, plus "hoje" if the freshness model supports it), with the timezone and the "atualizado em" time shown.
- Totals: visits and actions of value, with the conversion rate; the visit → action funnel.
- Daily series for the period. No chart library: server-rendered SVG or CSS, with an accessible text or table alternative and no meaning carried by color alone.
- Block ranking by clicks and by click-through rate, using the block's current title, with a clear label for blocks that no longer exist in the draft.
- Traffic sources (source, and UTM campaign when present), device classes, and country (and region if kept in scope).
- Every state from AC3, plus loading, error and permission-denied states. Server Components by default; data access and authorization on the server.
- CSV export of the daily aggregates for the selected period, authorized on the server, audited as decided in ADR 0011, with honest column names and the timezone stated.
- A short "como contamos" explanation reachable from the dashboard: what a visit is, what is filtered, that the numbers are estimates, and the delay.
- 44 px targets, visible focus, `prefers-reduced-motion`. Business rules stay in `src/modules/`.

### D7 — Tests (Vitest + pgTAP)

Minimum Vitest coverage: every D3 table; the collector (delegation by block type, batching, retry, no navigation delay, silent failure); preview and editor emit nothing; the ingestion handler (valid, malformed, oversized, wrong content type, database down); the job routes (unauthorized, idempotent, not-deployed-yet); dashboard state mapping; funnel and ranking; CSV. pgTAP: see D2. The AC5 controlled test is a script kept in the repository so it can be re-run. Every deterministic bug found during the sprint gets a regression test.

### D8 — Documentation and sprint closure

- `docs/adr/0011-*.md` (D1). Update `docs/ARCHITECTURE.md`, and ADR 0007/0008/0010 where the renderer contract changed.
- `docs/THREAT_MODEL.md`: event forgery and inflation, replay, flooding, cardinality attacks through UTM values, referrer leakage, cross-tenant reads; implemented versus pending.
- `docs/DATA_MAP.md`: every stored field of the raw events and of the aggregates, the visitor hash and its secret, purpose, legal basis, retention, and how export/deletion in Sprint 9 will reach them. Note the controller/operator relationship for visitor data.
- `apps/web/src/app/(marketing)/privacidade`: the privacy page must describe what is collected from visitors of public pages once this ships. Marketing pages may only claim analytics features that exist.
- `docs/SUPABASE_CAPACITY.md`: measured bytes per event and per aggregate row, and the revised ceiling.
- `docs/OBSERVABILITY.md`: ingestion accepted/rejected/rate-limited signals, aggregation lag and failure, purge, with proposed thresholds and owners.
- `docs/ENVIRONMENTS.md`: new environment variables, the cron entry, and the ordered deploy steps for staging (migration first, then secrets, then the merge).
- `docs/runbooks/ANALYTICS.md`: "the numbers stopped updating", "a page's numbers look inflated", "the events table is growing", "re-run the aggregation for a day".
- `.env.example` if a variable was added (placeholders only).
- `docs/ux/CONTENT_GUIDE.md` and `docs/ux/UX_DECISIONS.md` (UX-043+ as provisional).
- `BACKLOG.md`: check off only Sprint 6 items that are actually done and verified.
- **`docs/SPRINT_6_REPORT.md`**, using `docs/SPRINT_5_REPORT.md` as the structural baseline and following AGENTS.md §20: objective and outcome, decisions (including §0), the acceptance-criteria table with honest status (implemented / verified / prepared / partial / blocked / not started) and direct evidence, deliverables with paths, exact final results of `npm audit`, lint, typecheck, unit tests, DB tests, advisors and build, the AC5 numbers, security/privacy/a11y/performance/ops implications, gaps and risks, questions for the founder, the staging deploy steps, and implications for Sprint 7.
- Update `AGENTS.md` §22 "Current project state" to the real end state.

## 5. Out of scope

Product analytics instrumentation and any product-analytics vendor (the customer-event contract may name the product events as a documented list, nothing more); the multi-profile consolidated dashboard, the read-only report link, invitations and profile duplication (Sprint 7); billing, plan UI, custom domains, Meta Pixel and GA integrations (Sprint 8); global rate limiting in front of public routes, CAPTCHA, the moderation workflow, account export/deletion execution and the lead purge schedule (Sprint 9); real-time dashboards; per-visitor timelines, session replay, heatmaps, cohort or attribution models; A/B testing; e-mail reports; a public API; an external analytics database, queue or cache; a chart or date library; generative AI; staging provisioning.

## 6. Engineering rules

- No `any`, `@ts-ignore`, `eslint-disable`, relaxed `tsconfig`/ESLint/CI, or skipped tests to get to green. Never weaken RLS, validation, rate limits or authorization to make a test pass.
- No new runtime dependency without a concrete need and a justification in ADR 0011 (maintenance, license, bundle or runtime cost, security posture, exit path). Run `npm audit` after any dependency change.
- Migrations are forward-only and compatible with rolling the application back one version. No destructive changes.
- Preserve Sprint 0–5 behavior (onboarding, block editor, autosave and conflict flow, publish/rollback/unpublish, canonical redirects, OG image, Web Vitals, uploads, leads, media cleanup). Old snapshots (schema versions 1 and 2) keep rendering. Don't touch `node_modules/`, `.next/` or local caches.
- Tests must not use wall-clock sleeps or the real clock for date logic; inject the clock.

## 7. Quality bar

- Mobile 360–430 px, about 768 px and desktop ≥1280 px, with no horizontal scroll, for the dashboard in every state.
- WCAG 2.2 AA for the dashboard: data available as text or tables, not only as charts; labelled controls; `aria-live` where the period change updates content; focus management; contrast; no color-only state.
- Public page: LCP p75 ≤ 2.5 s and CLS ≤ 0.1 are unchanged by the collector. Measure the Sprint 5 media-heavy page before and after with the same method, and report both.
- With Docker and the local stack running, verify in a browser: a published page with every block type → interact with each → events stored → run aggregation → dashboard shows them; each AC1 failure mode; reload and retry do not double count; the preview emits nothing; a forged request for another workspace's page within limits is counted as an ordinary anonymous event and beyond limits is dropped; a forged request for an unpublished page and for a block not in the snapshot is rejected; a second workspace cannot open the first one's dashboard or CSV; the day boundary in the reporting timezone; every AC3 state; the CSV opened in a spreadsheet. If any of this can't be done, say so and mark the item *prepared*, not verified.

## 8. Work order

1. **Read and plan:** read §2 and inspect the git state. Summarize the plan, the schema drafts, the risks, and how AC1–AC6 will be evidenced.
2. **Branch:** create `feat/sprint-6-analytics` from up-to-date `main`. If the current branch has commits that are not in `main`, say which and branch from where the documentation is most current, and record it in the report.
3. **ADR 0011.**
4. **Pure modules + Vitest** (D3).
5. **Migrations + pgTAP;** iterate until `npm run test:db` passes; regenerate types; run advisors.
6. **Ingestion endpoint and job routes** (D5).
7. **Collector on the public page** (D4), measuring JS size, LCP and CLS as it lands.
8. **Dashboard and CSV** (D6).
9. **Controlled accuracy test** (AC5), **browser verification** (§7) and the performance checks.
10. **Docs, runbook, privacy page, backlog, report, AGENTS.md §22.**
11. **Final gate:** review the full diff for unrelated or accidental changes and secrets, then run `npm audit`, `npm run test:db` and `npm run check`, and fix everything that fails.

Commit along the way in coherent Conventional Commits (for example `feat(db): add analytics events, daily aggregates and ingestion RPC`, `feat(analytics): collect page views and block actions on public pages`, `feat(analytics): add the per-page dashboard and CSV export`).

**If the sprint is at risk of overrunning,** cut in this order and record each cut in the report: region (keep country); the device breakdown; UTM campaign detail (keep source); the "hoje" view (keep completed days); CSV export. Do not cut non-blocking collection, deduplication, the seven-day purge and daily aggregation, the zero-versus-missing states, tenant isolation, the rate limits, the basic bot and preview filter, or accessibility.

## 9. Stop and ask for approval before

- applying migrations, creating secrets, changing settings or creating anything on a **hosted** Supabase project or on Vercel (including through MCP tools); use the local stack only;
- running `npm run db:reset` or anything else that deletes local data;
- adding any paid service, new vendor, subprocessor or runtime dependency not justified in ADR 0011;
- setting any cookie or persistent identifier on visitors of public pages;
- any destructive migration or data loss;
- any destructive git operation, force-push, pushing to the remote, or opening a PR;
- writing or deleting anything outside this repository;
- expanding scope beyond §4, or cutting a P0 item that is not in the §8 cut list.

## 10. Final response format

1. Outcome in 3–5 sentences.
2. Acceptance-criteria table (status + evidence).
3. Files and routes to review (links, no large pastes).
4. Exact results: `npm audit`, lint, typecheck, unit tests (files/tests), DB tests (files/assertions), advisors, build (routes), the AC5 table (expected, aggregated, difference per metric), ingestion latency, public-route client JS size and Lighthouse LCP/CLS before and after, bytes per raw event and per aggregate row.
5. Security and privacy negative cases tested (forged and replayed events, flooding, cardinality, unpublished pages, cross-workspace reads, anon, referrer and UTM sanitization, preview and bot exclusion).
6. Decisions awaiting founder confirmation (UX-043+ and the ADR 0011 choices), and any item cut from scope.
7. Ordered staging deploy steps for the founder, blockers, pending external setup and the recommended starting point for Sprint 7.
