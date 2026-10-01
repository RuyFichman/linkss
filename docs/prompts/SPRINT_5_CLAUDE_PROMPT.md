# Sprint 5 — Media, embeds and personalization (Projeto LNK)

## 0. Founder gate status

Edit this block before running the prompt if anything changed.

```text
SPRINT 4: merged into main, verified locally only.
USABILITY_GATE: FOUNDER OVERRIDE (2026-09-25) still in force — the five-person sessions are pending.
UX_DECISIONS confirmed by the founder: UX-020, UX-021, UX-023, UX-025 (2026-09-30).
Other UX decisions (including UX-026 to UX-032): provisional, and they are the implementation default (do not wait for confirmation).
Staging database: the hosted Supabase project (Free) has the seven migrations up to 202609300001_block_editor, applied on 2026-10-01 with `supabase db push`. Hosted Auth is on defaults.
Staging application: deployed on Vercel at https://linkss-black.vercel.app (main deploys automatically). Sign-up and publishing have not been exercised there.
This sprint is developed and verified on the local stack. Do not apply Sprint 5 migrations, create buckets or change settings on the hosted project or on Vercel; list them in the report as deploy steps for the founder (`supabase db push`, new environment variables, Storage bucket). Remember that merging to main deploys to staging: code that needs a Sprint 5 migration must not reach main before that migration is applied to the hosted database.
```

This sprint adds the first user-uploaded files and the first visitor-submitted personal data (form leads). Those two things carry most of the risk. The visual work (themes, templates) is the most exposed to usability findings, so keep copy in `apps/web/src/content/pt-BR.ts` and keep theme options, template definitions, provider allowlists and limits in typed catalogs that can change without touching the schema or the snapshot format.

## 1. Your role

You are the senior full-stack engineer on **Projeto LNK**, working on your own in this repository with Claude Code. Sprints 0–4 are done (see `docs/SPRINT_4_REPORT.md`). Your job is to deliver **Sprint 5, "Mídia, embeds e personalização"**: a person uploads images, adds image, embed, Pix/payment and simple form blocks, and gives the page a theme or one of five templates, so that the result looks good enough to replace what they use today. Deliver working, tested code and migrations, not a plan.

Don't stop for questions except where §9 requires approval. When a product decision is ambiguous, pick the option that fits the documents best, record it as *provisional, founder to confirm* in `docs/ux/UX_DECISIONS.md` (UX, next id UX-033) or in an ADR (technical), and continue.

Keep a task list for the deliverables and update it as you go. Give a short progress report after each work-order phase (§8).

## 2. Read first (mandatory)

Read these in full before you write anything:

- `AGENTS.md` (canonical; it overrides your defaults, especially §6, §10, §11, §13, §19–§22), `README.md`.
- `PLANO_DE_EXECUCAO.md`: **Sprint 5**, plus Sprints 6, 8 and 9 (form submissions and Pix clicks become analytics events; quotas become entitlements; export/deletion and moderation must be able to reach media and leads), and the risk table rows about media storage and the editor.
- `BACKLOG.md` (Sprint 5 section and "Débito/decisões abertas"), `docs/SPRINT_4_REPORT.md` (especially "Implicações para a Sprint 5" and "Pendências, gaps e riscos"), `docs/ux/UX_DECISIONS.md`, `docs/ux/DESIGN_TOKENS.md` (it defers contrast validation of free color choices to this sprint), `docs/ux/CONTENT_GUIDE.md`, `docs/ux/WIREFRAMES.md`, `docs/ux/JOURNEYS.md`.
- `docs/ARCHITECTURE.md`, all of `docs/adr/*` (especially 0003, 0007 and 0008), `docs/THREAT_MODEL.md`, `docs/DATA_MAP.md`, `docs/SUPABASE_CAPACITY.md` (storage and egress limits of the Free plan), `docs/OBSERVABILITY.md`, `docs/ENVIRONMENTS.md`, `docs/runbooks/EDITOR.md`, `docs/runbooks/PUBLIC_PAGE.md`.
- Code: `apps/web/src/modules/blocks/*`, `apps/web/src/modules/editor/*` (including `templates/`, the five Sprint 1 templates as typed data), `apps/web/src/modules/publishing/*` (`document.ts`, `render/`, `service.ts`, `cache.ts`), `apps/web/src/modules/profiles/*` (`avatar_path`, `profile-avatar.tsx`), `apps/web/src/modules/entitlements/*`, `apps/web/src/modules/waitlist/*` (the existing pattern for anonymous submissions), `apps/web/src/proxy.ts`, `next.config.*`, `apps/web/src/content/pt-BR.ts`, every migration in `supabase/migrations/` and the pgTAP suites.
- If the `supabase:supabase` and `supabase:supabase-postgres-best-practices` skills are available, load them before you write any SQL or Storage policy. For Next.js 16 / React 19 and Supabase Storage APIs, check the installed versions and current documentation instead of relying on memory. In particular, verify what the Supabase Free plan and the local stack actually offer for image transformation before you design around it.

### Facts you must not get wrong

- **Adding a block type means changing all of these together** (AGENTS.md §22, ADR 0008): `private.validate_profile_draft`, `private.published_block`, `modules/blocks/model.ts` (keys, validator, `BLOCK_TYPES`, copy, `blockSummary`), `modules/publishing/document.ts`, the renderer (`BlockView`), and both test suites.
- **Old snapshots must still render.** The renderer reads schema versions 1 and 2 today. Any format change this sprint is additive, and versions 1 and 2 keep rendering exactly as before. Rollback can restore a version that has no theme and no media.
- **Snapshots are immutable and retained** (the last 10 versions). A published snapshot that references an image must keep working after the person replaces or removes that image in the draft, and after a rollback. Media lifetime therefore depends on references from the draft *and* from retained publications. Design this explicitly; do not delete a file just because the draft stopped using it.
- **Draft and published stay separate.** Autosave never publishes. Theme and template changes are draft changes that go through the same `draft_revision` compare-and-swap and the same autosave status machine as blocks. Don't add a second save mechanism.
- **The database is the authority.** TypeScript validates at the boundary for UX; `private.validate_profile_draft` rejects a crafted request that skips the UI. This applies to media references, embed providers, theme values and form definitions too.
- **Draft limits still apply:** 100 blocks and 64 KiB per draft, including whatever a template seeds. Images are never stored as base64 or blobs in Postgres (AGENTS.md §6.9); the draft holds a reference plus dimensions.
- **No user-supplied HTML, CSS or JavaScript, anywhere.** Embeds are a provider id plus a resource id, never pasted embed code. Themes are a closed set of validated tokens, never a CSS string.
- **Public pages are static HTML from the snapshot** and must stay useful without JavaScript. New blocks must not add blocking scripts or third-party requests on first load.
- **No service/secret key in ordinary user paths.** Uploads run as the signed-in user under Storage policies. Anonymous form submission goes through a narrow `security definer` RPC, the same way `get_public_page` works.
- User-facing copy is pt-BR. Code, identifiers, ADRs and technical docs are English.
- Stack: npm workspaces, Next.js 16 App Router, React 19, TypeScript strict, Tailwind v4, Vitest, pgTAP through `npm run test:db`, Node 24. `npm run check` = lint + typecheck + test + build.
- **Local environment:** the founder has test accounts in the local database. Apply migrations with `supabase migration up`; do not run `npm run db:reset` without approval. Stay inside this repository: write temporary files only to the session scratchpad, and leave Docker containers that belong to other projects alone.

## 3. Sprint goal and acceptance criteria

**Goal:** a person uploads and crops an avatar and images, adds image, embed, Pix/payment and simple form blocks, and applies a theme or one of five templates without losing content. Images are delivered at a size and format suited to the device, invalid files are never stored, arbitrary embeds and scripts never run, and the form resists basic spam and records consent.

| # | Criterion (`PLANO_DE_EXECUCAO.md`) | Required evidence |
|---|---|---|
| AC1 | Images are delivered in a size and format suited to the device | Stored variants (or the chosen delivery mechanism) documented in ADR 0009; rendered `<img>` has `width`/`height`, `srcset`/`sizes`, a modern format and lazy loading below the fold; a browser check at 360 px and ≥1280 px showing which variant and how many bytes were downloaded; Lighthouse mobile on a page with avatar + at least 3 images + 1 embed, compared with Sprint 4 (LCP 2.42 s, CLS 0) |
| AC2 | Invalid or oversized files are not stored | One upload policy module with a Vitest table (wrong magic bytes with an image extension, SVG, HTML disguised as an image, animated/oversized files, pixel-count bombs, zero-byte files, a file over the size cap, a file over the workspace quota); a check that nothing is left in the bucket or the database after each rejection; pgTAP for Storage policies and quota; a forged direct upload that bypasses the UI is rejected |
| AC3 | Changing template does not delete blocks or essential settings | A pure "apply template" function with Vitest proving that blocks, their order, visibility, title, bio, avatar and slug are unchanged for every one of the five templates; applying a template is undoable; a browser check: page with 8 mixed blocks → apply each template → publish → content identical |
| AC4 | Arbitrary embeds and user-supplied scripts are not executed | A provider allowlist module with a Vitest table of malicious inputs (pasted `<iframe>`/`<script>`, unknown host, lookalike host, `javascript:`/`data:` URLs, a valid provider URL carrying extra parameters or a redirect, HTML in every text field); the same cases in pgTAP; the renderer builds the iframe `src` itself from provider + id; a browser check that no script from user input runs and that the embed iframe carries the documented `sandbox`/`referrerpolicy`/`allow` attributes |
| AC5 | The form has basic spam prevention and configurable consent | Honeypot plus a rate limit that works without client JavaScript, both unit- and pgTAP-tested; the owner can set the consent text and whether consent is required; a submission without required consent is rejected by the database; the stored lead records the consent text version and timestamp; `anon` can submit but never read leads; another workspace cannot read them |

## 4. Deliverables

### D1 — ADR 0009 (media and `StorageAdapter`) and ADR 0010 (themes, templates and the new block types)

Decide, justify and record. Where a recommended default is given, you may choose differently if the code or current vendor documentation shows a better option; say why.

**ADR 0009 — media**

- **`StorageAdapter` interface:** narrow and vendor-neutral (put, delete, public URL for a key/variant, list by prefix for cleanup). Supabase Storage is the only implementation this sprint; keys and URLs must be portable to Cloudflare R2 (no Supabase-specific URL stored in drafts or snapshots — store a key and resolve the URL at render time).
- **Where optimization happens:** the plan asks for hard limits and asynchronous transformation. Compare at least: resizing/re-encoding in the browser before upload plus server verification; server-side processing in a Route Handler or Server Action; the platform image optimizer at delivery time. Weigh Free-plan limits, egress, Vercel cost, new dependencies and the R2 exit path. State clearly which variants exist, when they are produced, and what the page shows while a variant is not ready.
- **Validation of real content:** magic bytes, decoded dimensions, pixel-count cap, byte cap, allowed formats (no SVG, no animated formats unless you justify them), and metadata stripping (EXIF, including GPS). The file is validated on the server regardless of what the browser did.
- **Bucket and path layout, and access:** public or private bucket, unguessable keys under a workspace/profile prefix, Storage RLS policies based on workspace membership and role, cache headers, and immutability of keys (a replaced image gets a new key so CDN and snapshots stay consistent).
- **Lifecycle:** how references from drafts and retained publications are tracked, when a file becomes an orphan, how orphans are removed, and what happens on profile soft delete and purge. If a scheduled cleanup job is needed and no job runner exists, implement the idempotent cleanup function and document how it will be triggered; do not add a queue.
- **Quota:** a per-workspace storage quota resolved through `modules/entitlements` (never a plan-name check), enforced on the server and in the database, with a visible "espaço usado" state.
- **Crop:** the minimum that satisfies "upload, recorte e remoção" — recommended: a fixed-aspect crop for the avatar and a small set of aspect ratios for image blocks, operable by keyboard, with the crop stored as parameters or applied before upload. No image-editing dependency unless native canvas APIs are clearly not enough.

**ADR 0010 — themes, templates and block types**

- **Block schemas** for `image`, `embed`, `pix` and `form` as new members of the union, with their limits as named constants mirrored in SQL.
- **Embed model:** provider enum + resource id, parsed from a pasted URL by a per-provider parser. Recommended initial allowlist: providers that work with a plain iframe and no third-party script (for example YouTube through the no-cookie host, Vimeo, Spotify). Providers that require injecting their script are out for this sprint. Decide on a click-to-load facade (recommended, for LCP and visitor privacy), and on iframe `sandbox`, `allow`, `referrerpolicy`, `loading` and `title`.
- **Pix/payment block:** no native checkout and no stored value (AGENTS.md §18). Recommended: a payment-link variant that goes through the existing URL policy, and a Pix variant that shows the key with a copy button. Decide whether to generate a static "copia e cola" BR Code (a pure, tested function) and whether a QR code is worth its cost; a QR dependency needs justification. A Pix key can be a CPF, phone or e-mail: treat it as personal data that the owner chooses to publish, validate its format per key type, and say so in the UI.
- **Form block and leads:** a fixed small set of field types (name, e-mail, phone, short message), not a form builder. Decide the leads table, how a submission is validated against the **published** form definition, the consent model (text, required or optional, version stored with each lead), default retention (the data map says short and exportable — pick a default and record it as provisional), how the owner sees and deletes leads (a minimal list is enough; a CRM is out of scope), and the spam controls. Do not store raw visitor IP addresses; if rate limiting needs an identifier, use a salted, short-lived hash and document it.
- **Theme model:** a closed token set — palette, font, background, button style, spacing and corners — stored in the draft and copied into the snapshot. Fonts come from a short curated list, self-hosted, with a measured cost per font; no arbitrary font URLs. Decide whether a background image is in scope (it costs LCP). **Contrast:** free color choices must not produce unreadable pages — either validate to WCAG AA and block/warn, or derive the text color automatically. Decide and record.
- **Templates:** the five Sprint 1 templates graduate to production data. Applying a template to a page with content changes presentation only; seeding example blocks happens only on an empty page and only with consent. Applying is undoable.
- **Snapshot format:** the `schemaVersion` bump (if any), what is additive, and how versions 1 and 2 render (default theme, no media). Nothing is deployed yet, but write the change as expand/contract anyway, per ADR 0008.
- **Audit:** which actions need an audit event (lead deletion and lead export probably do; uploads and theme changes probably don't).

### D2 — Database and Storage (forward-only migrations + pgTAP)

- Storage bucket(s) and policies as migrations, not dashboard edits. Media metadata table (key, owner workspace/profile, bytes, dimensions, content type, status) with RLS, indexes on every foreign key and on the fields used by RLS, quota and cleanup.
- Extend `private.validate_profile_draft` and `private.published_block` for the four block types, the theme and media references: a draft may only reference media that belongs to the same profile/workspace and is in a usable state; embed provider and id formats; Pix key formats; form definition limits; theme token ranges and enumerations.
- Leads: table with explicit workspace/profile relationship, RLS (members read according to the existing permission matrix; `anon` has no table access), a `security definer` submit RPC granted to `anon` that validates against the published snapshot, enforces consent, honeypot and rate limit, caps payload size, and is safe to retry. A `purge_after` (or equivalent) so the Sprint 9 purge job can enforce retention.
- Quota enforcement in the database, not only in the application.
- If you add a top-level route, add it to `reserved_slugs` (migration + TypeScript list).
- pgTAP, at minimum: every valid new block type accepted; every malicious embed/Pix/form/theme case rejected; media reference to another workspace's file rejected; Storage policies for owner, editor, member of another workspace and `anon`; quota exceeded; publish copies theme and media references and keeps order and `visible`; version 1 and 2 snapshots still readable through `get_public_page`; lead submit happy path, missing consent, honeypot filled, rate limit hit, unpublished or suspended profile, form block that does not exist in the published snapshot; `anon` and other workspaces cannot read leads.
- Regenerate `apps/web/src/lib/database.types.ts` (`npm run db:types`). Run the Supabase advisors on the local stack and fix what they report.

### D3 — Pure policy modules (TypeScript source of truth, mirrored in SQL)

- **Upload policy:** format detection from bytes, size/dimension/pixel caps, variant plan. No dependence on file name or browser MIME.
- **Embed providers:** allowlist catalog, URL → `{ provider, id }` parsers, and `{ provider, id }` → iframe `src` builders. The builder never interpolates unvalidated input.
- **Pix:** key-type detection and validation (CPF/CNPJ check digits, phone, e-mail, random key), and the BR Code generator if ADR 0010 includes it (with the CRC and published test vectors).
- **Form:** field catalog, definition validation, submission validation and normalization.
- **Theme:** token catalog, validation, contrast calculation, and the pure "apply template" function.
- Vitest table tests for all of them, with the same malicious cases repeated in pgTAP.

### D4 — Editor UI (pt-BR, mobile-first)

Extend the Sprint 4 block editor at its existing route; keep its autosave, conflict, undo and preview behavior intact.

- **Upload:** file picker and drag target with a keyboard path, client-side pre-checks with specific messages ("Esse arquivo é maior que X MB", "Esse tipo de arquivo não é aceito"), visible progress, cancel, retry, and honest failure states. An upload in progress blocks publishing in the same way an unsaved change does. Alt text is required or explicitly marked decorative for image blocks.
- **Avatar:** upload, crop, replace and remove, with initials as the fallback that exists today.
- **Block forms** for image, embed, Pix and form, following the Sprint 4 field patterns (`aria-describedby` errors, normalized value shown back, reasons for rejection). The embed field accepts a pasted URL and shows which provider was recognized, or why it was refused.
- **Appearance panel:** theme controls and the template gallery, with the live preview updating from local state. Applying a template states plainly what will change and offers undo. Contrast problems are shown in text, not color alone.
- **Leads:** a minimal list per profile with date, fields, consent status and delete; empty, loading and error states. Add CSV export only if it is cheap and audited.
- **Storage usage** indicator and the quota-exceeded state.
- Loading, empty, success, validation and failure states for every part. 44 px targets, visible focus, `prefers-reduced-motion`. Business rules stay in `src/modules/`. Report the editor route's client JS size against Sprint 4.

### D5 — Renderer

- Render image, embed, Pix and form blocks and apply the theme in the public page and the preview, from the snapshot only. Theme reaches the page as CSS variables from validated tokens; no inline style built from raw strings.
- Images: explicit dimensions, responsive sources, lazy loading below the fold, and priority only for the element most likely to be LCP. Avatar included. Add the storage host to the image/CSP configuration that exists, and nothing broader.
- Embeds: the facade or iframe per ADR 0010, with a meaningful `title`, and no third-party request before interaction if the facade is chosen.
- Pix: the copy button works with JavaScript and the key stays selectable text without it.
- Form: works as a plain HTML form post without JavaScript, shows success, validation and failure states, and never blocks the rest of the page. The preview renders the form but cannot submit.
- Keep `data-block-id` / `data-block-type` on the new blocks for Sprint 6. Do not implement analytics.
- Keep LCP p75 ≤ 2.5 s and CLS ≤ 0.1. Sprint 4 left about 0.08 s of LCP margin on 12 blocks; fonts and images will spend it unless you measure as you go. If a theme option breaks the budget, cut or constrain the option.

### D6 — Tests (Vitest + pgTAP)

Minimum Vitest coverage: every D3 table; draft → document mapping with theme and media (order, hidden blocks, `schemaVersion`); the renderer accepting versions 1 and 2; "apply template" preserving content for all five templates; contrast calculation; the upload state machine (success, rejection, cancel, retry, quota); media reference tracking and orphan detection; the `StorageAdapter` contract against an in-memory implementation; lead submission service (consent, honeypot, rate limit, retry). pgTAP: see D2. Every deterministic bug found during the sprint gets a regression test.

### D7 — Documentation and sprint closure

- `docs/adr/0009-*.md` and `docs/adr/0010-*.md` (D1). Update `docs/ARCHITECTURE.md` and ADR 0007/0008 where the document format or renderer contract changed.
- `docs/THREAT_MODEL.md`: malicious uploads, embed abuse, form spam, Pix impersonation/fraud (reporting and moderation are still Sprint 9), storage exhaustion; implemented versus pending.
- `docs/DATA_MAP.md`: uploaded media (may contain faces and metadata), Pix keys, leads and consent records, the rate-limit identifier — purpose, owner, legal basis, retention, and how export/deletion in Sprint 9 will reach them. Note the controller/operator relationship for leads.
- `docs/SUPABASE_CAPACITY.md`: measured bytes per image and per page, and what the Free plan's storage and egress allow at that size.
- `docs/OBSERVABILITY.md`: upload failure, quota, lead submission and spam-rejection signals (structured logs with a correlation id; never log lead content, Pix keys or file contents).
- Runbooks: "an inappropriate or malicious image was published", "storage quota reached", "leads are not arriving / form is being spammed", "orphan cleanup".
- `docs/ux/CONTENT_GUIDE.md`, `docs/ux/DESIGN_TOKENS.md` and `docs/ux/UX_DECISIONS.md`: new labels and messages, the theme token set, and UX-033+ as provisional.
- `BACKLOG.md`: check off only Sprint 5 items that are actually done and verified.
- **`docs/SPRINT_5_REPORT.md`**, using `docs/SPRINT_4_REPORT.md` as the structural baseline and following AGENTS.md §20: objective and outcome, decisions (including §0), an acceptance-criteria table with honest status (implemented / verified / prepared / partial / blocked / not started) and direct evidence, deliverables with paths, exact final results of `npm audit`, lint, typecheck, unit tests, DB tests, advisors and build, security/privacy/a11y/performance/ops implications, gaps and risks, questions for the founder, and implications for Sprint 6.
- Update `AGENTS.md` §22 "Current project state" to the real end state.
- Save this prompt as `docs/prompts/SPRINT_5_CLAUDE_PROMPT.md` if it is not already there.

## 5. Out of scope

Analytics ingestion and click/submit events (Sprint 6); multi-profile dashboard, invitations UI, profile duplication and reports (Sprint 7); billing, plans UI, custom domains, pixels and native checkout (Sprint 8); moderation/reporting workflow, full CSP hardening, global rate limiting, purge jobs and account export/deletion (Sprint 9); e-mail notification of new leads (no SMTP is chosen); a form builder, CRM or e-mail marketing; user CSS, custom fonts by URL, arbitrary HTML embeds; video or file hosting (video is embed only); generative AI; drag-and-drop reordering; dropping `profiles.social_links`; staging provisioning.

## 6. Engineering rules

- No `any`, `@ts-ignore`, `eslint-disable`, relaxed `tsconfig`/ESLint/CI, or skipped tests to get to green. Never weaken RLS, Storage policies, validation, the URL policy or authorization to make a test pass.
- No new runtime dependency without a concrete need and a justification in ADR 0009/0010 (maintenance, license, bundle or runtime cost, security posture, exit path). No component, form, state or image-editing library by default. Run `npm audit` after any dependency change.
- Vendor SDK calls for storage stay inside the adapter.
- Migrations are forward-only and compatible with rolling the application back one version. No destructive changes.
- Preserve Sprint 0–4 behavior (onboarding, block editor, autosave and conflict flow, publish/rollback/unpublish, canonical redirects, OG image, Web Vitals). Don't touch `node_modules/`, `.next/` or local caches.

## 7. Quality bar

- Mobile 360–430 px, about 768 px and desktop ≥1280 px, with no horizontal scroll, for the editor, the appearance panel and every theme/template combination on the public page.
- WCAG 2.2 AA: labels, `aria-describedby` errors, `aria-live` for upload progress and results, keyboard-operable crop, alt text handling, text contrast under every theme the UI allows, focus return after dialogs, 44 px targets, `prefers-reduced-motion`, no color-only state.
- With Docker and the local stack running, verify in a browser: upload → crop → publish → the public page serves the right variant at two viewport widths; each AC2 rejected file through the UI **and** as a forged request, followed by a check that the bucket and tables are clean; replace an image, publish, roll back, and confirm the older version still shows its image; each AC4 malicious embed typed into the UI and sent as a forged Server Action payload; all five templates applied to a page with content; a form submitted with and without JavaScript, without consent, with the honeypot filled, and past the rate limit; leads invisible to another workspace; a pre-Sprint-5 snapshot still rendering; Lighthouse mobile on the media-heavy page. If any of this can't be done, say so and mark the item *prepared*, not verified.

## 8. Work order

1. **Read and plan:** read §2 and inspect the git state. Summarize the plan, the schema drafts, the risks, and how AC1–AC5 will be evidenced.
2. **Branch:** if Sprint 4 is merged, create `feat/sprint-5-media-personalization` from up-to-date `main`. If it is not, branch from `feat/sprint-4-block-editor` and say so in the report.
3. **ADR 0009 and ADR 0010.**
4. **Pure policy modules + Vitest** (D3).
5. **Migrations, Storage policies + pgTAP**; iterate until `npm run test:db` passes; regenerate types; run advisors.
6. **`StorageAdapter`, upload pipeline, media lifecycle.**
7. **Document mapping + renderer** (new blocks, theme, backward compatibility), measuring LCP/CLS as each piece lands.
8. **Editor UI:** uploads and avatar, the four block forms, appearance panel and templates, leads list.
9. **Browser verification** (§7) and Lighthouse runs.
10. **Docs, runbooks, backlog, report, AGENTS.md §22.**
11. **Final gate:** review the full diff for unrelated or accidental changes and secrets, then run `npm audit`, `npm run test:db` and `npm run check`, and fix everything that fails.

Commit along the way in coherent Conventional Commits (for example `feat(media): add StorageAdapter and validated image upload`, `feat(db): validate image, embed, pix and form blocks`, `feat(editor): add themes and template gallery`).

**If the sprint is at risk of overrunning,** cut in this order and record each cut in the report: the QR code for Pix; free-form crop (keep fixed-aspect); background image in themes; the number of fonts and embed providers; CSV export of leads. Do not cut server-side file validation, the embed allowlist, consent and spam controls, content-preserving template application, backward-compatible rendering, or accessibility.

## 9. Stop and ask for approval before

- applying migrations, creating buckets, changing settings or creating anything on a **hosted** Supabase project or Vercel (including through MCP tools); use the local stack only;
- running `npm run db:reset` or anything else that deletes local data;
- adding any paid service, new vendor, subprocessor or runtime dependency not justified in ADR 0009/0010;
- any destructive migration or data loss;
- any destructive git operation, force-push, pushing to the remote, or opening a PR;
- writing or deleting anything outside this repository;
- expanding scope beyond §4, or cutting a P0 item that is not in the §8 cut list.

## 10. Final response format

1. Outcome in 3–5 sentences.
2. Acceptance-criteria table (status + evidence).
3. Files and routes to review (links, no large pastes).
4. Exact results: `npm audit`, lint, typecheck, unit tests (files/tests), DB tests (files/assertions), advisors, build (routes), Lighthouse (LCP/CLS, before/after), editor route client JS size, bytes per image variant.
5. Security and privacy negative cases tested (malicious files, forged uploads, embed and script injection, cross-workspace media and leads, anon, spam, missing consent).
6. Decisions awaiting founder confirmation (UX-033+ and the ADR 0009/0010 choices), and any item cut from scope.
7. Blockers, pending external setup and the recommended starting point for Sprint 6.
