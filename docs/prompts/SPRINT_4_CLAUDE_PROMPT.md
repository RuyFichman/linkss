# Sprint 4 — Block editor (Projeto LNK)

## 0. Founder gate status

```text
USABILITY_GATE: FOUNDER OVERRIDE (2026-09-25) still in force — the five-person sessions are pending.
UX_DECISIONS confirmed by the founder: UX-020, UX-021, UX-023, UX-025 (2026-09-30).
Other UX decisions: provisional, and they are the implementation default (do not wait for confirmation).
UX-024 (simple link/social forms) was accepted for Sprint 3 only — this sprint replaces it.
Staging (Supabase Free + Vercel): deferred until after Sprint 4 — do not provision.
```

The editor is the flow most exposed to usability findings. Keep copy in `apps/web/src/content/pt-BR.ts`, keep block types, labels and limits in typed catalogs, and keep editor state logic out of React components, so the sessions can change vocabulary and flow without touching the schema or the snapshot format.

## 1. Your role

You are the senior full-stack engineer on **Projeto LNK**, working on your own in this repository with Claude Code. Sprints 0–3 are merged into `main` (see `docs/SPRINT_3_REPORT.md`). Your job is to deliver **Sprint 4, "Editor por blocos"**: a person builds their page from blocks without code, sees it in a persistent mobile preview, and publishes it with the order and content they see. Deliver working, tested code and migrations, not a plan.

Don't stop for questions except where §9 requires approval. When a product decision is ambiguous, pick the option that fits the documents best, record it as *provisional, founder to confirm* in `docs/ux/UX_DECISIONS.md` (UX, next id UX-026) or in an ADR (technical), and continue.

Keep a task list for the deliverables and update it as you go. Give a short progress report after each work-order phase (§8).

## 2. Read first (mandatory)

Read these in full before you write anything:

- `AGENTS.md` (canonical; it overrides your defaults, especially §6, §10, §11, §13, §19–§22), `README.md`.
- `PLANO_DE_EXECUCAO.md`: **Sprint 4**, plus Sprints 5, 6 and 7 (the block model must not block images/embeds/Pix/forms, click analytics per block, or multi-profile operations), and the risk row "Editor consome várias sprints" (§12).
- `BACKLOG.md` (Sprint 4 section), `docs/SPRINT_3_REPORT.md` (especially "Implicações para a Sprint 4"), `docs/ux/UX_DECISIONS.md`, `docs/ux/JOURNEYS.md`, `docs/ux/WIREFRAMES.md`, `docs/ux/CONTENT_GUIDE.md`, `docs/ux/DESIGN_TOKENS.md`.
- `docs/ARCHITECTURE.md`, all of `docs/adr/*` (especially 0003, 0004 and 0007), `docs/THREAT_MODEL.md`, `docs/DATA_MAP.md`, `docs/OBSERVABILITY.md`, `docs/runbooks/PUBLIC_PAGE.md`.
- Code: `apps/web/src/modules/profiles/*` (`draft-content.ts`, `service.ts`, `actions.ts`, `components/`), `apps/web/src/modules/publishing/*` (`document.ts`, `social.ts`, `render/`, `service.ts`), `apps/web/src/modules/editor/*`, `apps/web/src/prototype/*` (the Sprint 1 editor prototype: reuse its patterns, never import prototype code into production routes), `apps/web/src/ui/*`, `apps/web/src/content/pt-BR.ts`, and every migration and pgTAP test that touches `blocks`, `social_links`, `draft_revision`, `private.validate_profile_draft` and the publishing RPCs.
- If the `supabase:supabase` and `supabase:supabase-postgres-best-practices` skills are available, load them before you write any SQL. For Next.js 16 / React 19 APIs (Server Actions, `useOptimistic`, `useActionState`, `useTransition`), check the installed version instead of relying on memory.

### Facts you must not get wrong

- **Draft and published stay separate.** The editor writes only the draft (`blocks`, `social_links`, `draft_revision`). The public page reads only immutable `profile_publications` snapshots. Autosave never publishes; publishing stays explicit (UX-023).
- **Optimistic concurrency already exists:** `draft_revision` plus a `conflict` outcome, and publishing requires the reviewed revision (`LK030`). Build autosave on this. Don't invent a second versioning mechanism.
- **Adding a block type means changing all of these together** (AGENTS.md §22): `private.validate_profile_draft`, `modules/profiles/draft-content.ts`, `modules/publishing/document.ts` (bump `schemaVersion` if the shape changes), the renderer, and both test suites.
- **Old snapshots must still render.** Rollback (UX-023) can restore a version published before this sprint. The renderer must accept every earlier `schemaVersion`.
- **Block visibility already exists** (`visible`) and is respected by the snapshot and the preview.
- Validation lives in both places: TypeScript at the boundary for UX, and `private.validate_profile_draft` in the database as the authority. A request crafted to skip the UI must be rejected by the database.
- User-facing copy is pt-BR. Code, identifiers, ADRs and technical docs are English.
- Stack: npm workspaces, Next.js 16 App Router, React 19, TypeScript strict, Tailwind v4, Vitest, pgTAP through `npm run test:db`, Node 24. `npm run check` = lint + typecheck + test + build.

## 3. Sprint goal and acceptance criteria

**Goal:** a person can create, edit, reorder, duplicate, show/hide and delete link, text, social, WhatsApp and divider blocks. Changes autosave with honest status. A persistent mobile preview shows the page as it will be published, and the person publishes that exact order and content.

| # | Criterion (`PLANO_DE_EXECUCAO.md`) | Required evidence |
|---|---|---|
| AC1 | Editor order equals published order | Editor, preview and snapshot all derive order from one source (the draft array); Vitest for the reorder/duplicate/delete reducers and the draft → document mapping; pgTAP showing that publish keeps order; a browser check: reorder → publish → the public page shows the same order |
| AC2 | A failed save is visible and never shows false success | The status machine (`salvo` / `salvando` / `alterações não salvas` / `erro ao salvar` / `conflito`) is unit-tested; "Salvo" appears only after the server confirms the new `draft_revision`; tests for network failure, validation rejection, a stale revision, and leaving the page with unsaved changes; a manual check with the server offline |
| AC3 | Dangerous URLs and disallowed schemes are blocked | One URL policy module with an explicit allowlist, a Vitest table of malicious inputs, and matching pgTAP cases in `validate_profile_draft` (the DB rejects them even when the UI is bypassed); renderer output adds `rel` attributes as defined in ADR 0007 |
| AC4 | Editing works by keyboard and in a mobile viewport | Every action (add, edit, move, duplicate, hide, delete, undo, publish) works with the keyboard only; focus is managed after move/delete/undo; `aria-live` announces reorder and save status; checked at 360 px, 390 px, 768 px and ≥1280 px with no horizontal scroll; Lighthouse accessibility on the editor route |
| AC5 | A new user creates and publishes five blocks in under 10 minutes | **You cannot verify this with real users.** Run a scripted walkthrough (sign up → onboarding → add 5 blocks of different types → publish) in a browser, record the time and number of steps, and mark AC5 as **partial: internal proxy**, with real validation pending the usability sessions in `docs/research/USABILITY_TEST_PLAN.md`. Never mark it as verified |

## 4. Deliverables

### D1 — ADR 0008: Block model and editor persistence

Decide, justify and record:

- **Block schema:** a discriminated union with `id` (UUID), `type`, `visible` and type-specific fields. Types this sprint are `link`, `text`, `social`, `whatsapp` and `divider`. It must be extensible for Sprint 5 (`image`, `embed`, `pix`, `form`) without breaking earlier snapshots.
- **Social links:** decide whether the existing `social_links` column becomes a `social` block (and whether a page may have more than one), or stays as a page-level field that a `social` block positions. Either way: provide a forward-only data migration for existing drafts, keep old snapshots renderable, and keep the application rollback-compatible (AGENTS.md §6.13). If a column stops being written, do not drop it this sprint.
- **Document `schemaVersion`** bump and the renderer's compatibility strategy for earlier versions.
- **Save granularity:** the whole draft per save (simple and atomic) versus per-block patches. Recommended default: send the whole `blocks` array with the expected `draft_revision`, debounced, because it keeps order and content atomic. Justify whichever you choose.
- **Conflict policy** ("recuperação de conflito simples"): on a stale revision, never overwrite silently. Offer "Carregar a versão mais recente" or "Manter as minhas alterações" (an explicit overwrite that re-reads the current revision), and keep the local copy until the person chooses.
- **Limits:** technical caps as named constants that are also enforced in SQL. Examples: max blocks per page, text length, link title length, WhatsApp message length, and total draft payload size. These are abuse and performance limits, not plan limits. Any plan-dependent limit goes through entitlements; never check plan names.
- **Reordering interaction:** accessible move up/down controls (and "move to top/bottom" if cheap) are mandatory. Pointer drag is optional. Do not add a drag-and-drop dependency unless native pointer events are clearly not enough; if you add one, justify it here (maintenance, license, bundle cost, accessibility, exit path).

### D2 — Database (forward-only migrations + pgTAP)

- Extend `private.validate_profile_draft` for every block type: required fields, lengths, types, unique block ids, the block-count cap and the payload-size cap. Apply the URL policy from D3 (scheme allowlist, no credentials, no control characters or whitespace, length cap), plus WhatsApp number format, and plain text only for the text block.
- A data migration for existing drafts and social links, if ADR 0008 needs one. It must be idempotent, keep existing publications intact, and have pgTAP coverage for "before → after".
- If the draft-save RPC's shape changes, keep the `draft_revision` compare-and-swap in one transaction and return a typed `conflict` result. Autosave does **not** write audit events per keystroke. Publishing already audits. Record in the ADR whether any editor action needs an audit event (probably none).
- pgTAP, at minimum: every valid block type is accepted; every malicious URL case from D3 is rejected; invalid WhatsApp numbers are rejected; caps are enforced; publishing keeps order and `visible`; a stale `draft_revision` is rejected; a member of another workspace and `anon` cannot read or write the draft (including with a forged `profile_id`); an `editor` role can edit the draft according to the existing permission matrix; old-version snapshots stay readable through `get_public_page`.
- Regenerate `apps/web/src/lib/database.types.ts` (`npm run db:types`).

### D3 — URL and input policy (`apps/web/src/modules/profiles/` or a dedicated `links`/`url-policy` module)

- One pure module that is the TypeScript source of truth, mirrored in SQL:
  - Allowed: `https:`, `http:` (decide whether to upgrade to `https:` or keep it with a note; record the decision), `mailto:`, `tel:`. Everything else is rejected, including `javascript:`, `data:`, `vbscript:`, `file:`, `blob:`, `about:`, `intent:`, custom app schemes, protocol-relative `//host`, relative paths, mixed-case or whitespace/control-character/entity-obfuscated variants (`JaVaScRiPt:`, `java\tscript:`, `%6Aavascript:`, leading spaces or newlines), and URLs with `user:pass@`.
  - Normalization: trim, add `https://` to bare domains (`exemplo.com.br` → `https://exemplo.com.br`), keep IDN hosts but display punycode-aware text if a host mixes scripts (at least document homograph risk in the threat model), and enforce a length cap.
  - Links to the app's own authenticated routes and to reserved paths are allowed or blocked by an explicit rule, not by accident. Decide and document.
- WhatsApp: accept Brazilian input (`(11) 91234-5678`, `11912345678`, `+55 11 …`) and international numbers with a `+` prefix. Normalize to E.164 digits. An optional pre-filled message has a length cap and is URL-encoded. The renderer builds `https://wa.me/<digits>?text=…`; never store a pre-built URL as the source of truth.
- Text block: plain text with line breaks only. No HTML or Markdown rendering, rendered as text nodes (React escaping), with a length cap.
- Vitest table tests for every case above, and the same cases in pgTAP (D2).

### D4 — Editor UI (pt-BR, mobile-first)

Replace `LinkListEditor` / `SocialLinksForm` (UX-024) with the block editor at the page's existing edit route. Don't create new top-level routes; if one is unavoidable, add it to `reserved_slugs` (migration + TS list).

- **Block list:** each block shows its type, a short summary, a hidden badge ("Oculto: não aparece na página") and actions: editar, mover para cima/baixo, duplicar, ocultar/mostrar, excluir. Duplicating inserts right after the original with a new UUID. Hidden blocks stay in the editor and preview (marked) and are left out of the snapshot.
- **Add block:** a type picker with pt-BR labels and a one-line description per type. The new block is inserted at a sensible position (after the selected block, or at the end), focus moves to its first field, and there is an empty state for a page with no blocks.
- **Block forms:** field-level validation with `aria-describedby`, normalized values shown back to the user (for example the `https://` that was added, or the formatted WhatsApp number), and inline hints for rejected URLs that say why ("Esse tipo de link não é permitido" and similar, not a generic error).
- **Autosave:** debounced after edits (about 800–1500 ms, choose and justify), immediate on structural actions (move, duplicate, hide, delete). Show a visible status indicator with text, not color alone, announced through `aria-live="polite"`. Retry on transient errors with backoff. When a save fails, keep the local state and show "Tentar novamente". Warn on `beforeunload` or navigation while there are unsaved or failed changes. Saves never overlap: serialize them and send only the latest state.
- **Conflict:** the flow from ADR 0008, with no silent data loss in either direction.
- **Destructive actions and undo:** deleting a block removes it at once and shows an "Excluído. Desfazer" toast for a fixed window (about 10 s), which restores the block in its original position and content. Deleting several blocks, or anything the undo toast can't reverse, asks for confirmation in an accessible dialog (focus trap, focus return, Esc). Record the policy as UX-026 (provisional). Undo works by keyboard and is announced.
- **Persistent mobile preview:** on desktop, a sticky phone-width preview next to the editor that updates from local state immediately (not only after save). On mobile, an "Editar / Pré-visualizar" toggle that keeps the scroll position. The preview **must reuse the public renderer components** fed by the same draft → document mapping used at publish, so what you see is what gets published (AC1). Make sure the preview has no analytics side effects and can't be mistaken for the live page.
- **Publish entry point** from the editor. It is disabled while saving or while there are unsaved or failed changes, and publishes the confirmed `draft_revision`. Keep the Sprint 3 publish/rollback/unpublish flows working.
- Loading, empty, success, validation and failure states for every part. 44 px targets, visible focus, `prefers-reduced-motion`, no layout shift when the status indicator changes.
- Keep business rules (reducers, validation, status machine, mapping) in `src/modules/`, not in components. Client components only where browser interaction needs them; keep the client bundle for the editor route reasonable and report its size.

### D5 — Renderer

- Render the new block types in the public page and the preview: link (existing), text, social row, WhatsApp button, divider. Use semantic HTML and landmarks consistent with Sprint 3, give icons accessible names, and add `rel="noopener noreferrer"` (plus `nofollow`/`ugc` according to ADR 0007) on external links.
- Keep the public page's LCP/CLS budget (LCP p75 ≤ 2.5 s, CLS ≤ 0.1). Re-run Lighthouse mobile on a local production build with a page that has at least 10 mixed blocks, and compare against Sprint 3 (2.3–2.4 s, CLS 0).
- Leave a stable `data-block-id` / `data-block-type` (or equivalent) on rendered blocks, for Sprint 6 click analytics. Don't implement analytics.

### D6 — Tests (Vitest + pgTAP)

Minimum Vitest coverage: URL policy table; WhatsApp normalization; per-type block validation; editor reducers (add, edit, move, duplicate, toggle visibility, delete, undo, including edges such as first/last and an undo after another edit); the autosave status machine and save queue (success, failure, retry, conflict, overlapping edits, no false "Salvo"); draft → document mapping (order, hidden blocks left out, `schemaVersion`); the renderer accepting earlier snapshot versions. pgTAP: see D2. Every deterministic bug found during the sprint gets a regression test.

### D7 — Documentation and sprint closure

- `docs/adr/0008-block-model-and-editor.md` (D1). Update ADR 0007 or `docs/ARCHITECTURE.md` if the document format or renderer contract changed.
- `docs/THREAT_MODEL.md`: URL/scheme policy, homograph note, phishing via links (still needs Sprint 9 reporting/moderation), payload caps; implemented vs. pending.
- `docs/DATA_MAP.md`: WhatsApp numbers and messages in drafts/snapshots (purpose, owner, retention: they follow the draft/publication lifecycle).
- `docs/OBSERVABILITY.md`: autosave failure and conflict signals (structured logs with a correlation id; never log block content or phone numbers).
- `docs/runbooks/PUBLIC_PAGE.md` (or a new `EDITOR.md`): "my changes were not saved", "conflict between two tabs", "a malicious link was published".
- `docs/ux/CONTENT_GUIDE.md` and `docs/ux/UX_DECISIONS.md`: block labels, status texts, error texts, and UX-026+ as provisional. Mark UX-024 as superseded.
- `BACKLOG.md`: check off only Sprint 4 items that are actually done and verified.
- **`docs/SPRINT_4_REPORT.md`**, using `docs/SPRINT_3_REPORT.md` as the structural baseline and following AGENTS.md §20: objective and outcome, decisions (including §0), an acceptance-criteria table with honest status (implemented / verified / prepared / partial / blocked / not started) and direct evidence, deliverables with paths, exact final results of `npm audit`, lint, typecheck, unit tests, DB tests and build, security/privacy/a11y/performance/ops implications, gaps and risks, questions for the founder, and implications for Sprint 5.
- Update `AGENTS.md` §22 "Current project state" to the real end state.

## 5. Out of scope

Images, avatar upload, `StorageAdapter`, embeds, Pix, forms, themes and templates (Sprint 5); analytics ingestion and click events (Sprint 6); multi-profile dashboard, invitations UI and reports (Sprint 7); billing, custom domains and pixels (Sprint 8); moderation/reporting, CSP hardening, rate limiting and purge jobs (Sprint 9); real-time collaborative editing (AGENTS.md §18); multi-column or advanced layouts (single column only, per the §12 risk mitigation in the plan); staging provisioning. Keep the model ready for Sprint 5 block types, but don't build them.

## 6. Engineering rules

- No `any`, `@ts-ignore`, `eslint-disable`, relaxed `tsconfig`/ESLint/CI, or skipped tests to get to green. Never weaken RLS, validation, the URL policy or authorization to make a test pass.
- No new runtime dependency without a concrete need and a justification in ADR 0008: no state library, form library, component library, rich-text editor or ORM. Prefer React 19 primitives and small, tested reducers.
- No service/secret key in any editor or autosave path; every save runs as the signed-in user under RLS, with the server guard from `modules/identity`.
- Migrations are forward-only and compatible with rolling the application back one version. No destructive column drops this sprint.
- Preserve Sprint 0–3 behavior (onboarding, publish/rollback/unpublish, canonical redirects, OG image, Web Vitals). Don't touch `node_modules/`, `.next/` or local caches.

## 7. Quality bar

- Mobile 360–430 px, about 768 px and desktop ≥1280 px, with no horizontal scroll.
- WCAG 2.2 AA: labels, `aria-describedby` errors, `aria-live` for save status and reorder announcements, visible focus, focus return after dialogs/toasts, 44 px targets (2.5.8), a non-drag alternative for every drag action (2.5.7), `prefers-reduced-motion`, no color-only state.
- If Docker and the local stack are available, verify in a browser: the full AC5 walkthrough (timed); reordering → publish → identical public order; a save with the server stopped or the network offline (error visible, nothing claims "Salvo", recovery after reconnect); a two-tab conflict; delete → undo; every AC3 malicious URL typed into the UI **and** sent as a forged Server Action payload; keyboard-only editing; rollback to a pre-Sprint-4 snapshot still rendering. If any of this can't be done, say so and mark the item *prepared*, not verified.

## 8. Work order

1. **Read and plan:** read §2 and inspect the git state (`docs/confirm-ux-decisions` may still be unmerged; check). Summarize the plan, the block schema draft, the risks, and how AC1–AC5 will be evidenced.
2. **Branch:** create `feat/sprint-4-block-editor` from up-to-date `main`. If the UX-confirmation docs branch isn't merged, branch from it and say so in the report.
3. **ADR 0008.**
4. **URL policy + block validation modules + Vitest** (the pure core first).
5. **Migrations + pgTAP**; iterate until `npm run test:db` passes; regenerate types.
6. **Document mapping + renderer** (new types, backward compatibility).
7. **Editor state (reducers, save queue, status machine) + Vitest**, then **editor UI + preview**; remove the Sprint 3 minimal forms.
8. **Browser verification** (§7) and Lighthouse runs.
9. **Docs, runbook, backlog, report, AGENTS.md §22.**
10. **Final gate:** review the full diff for unrelated or accidental changes and secrets, then run `npm audit`, `npm run test:db` and `npm run check`, and fix everything that fails.

Commit along the way in coherent Conventional Commits (for example `feat(db): validate block types and URL policy in validate_profile_draft`, `feat(editor): add block editor with autosave and mobile preview`).

## 9. Stop and ask for approval before

- applying migrations, changing settings or creating anything on a **hosted** Supabase project or Vercel (including through MCP tools); use the local stack only;
- adding any paid service, new vendor, subprocessor or runtime dependency not justified in ADR 0008;
- any destructive migration or data loss (including dropping `social_links` or rewriting existing publications);
- any destructive git operation, force-push, pushing to the remote, or opening a PR;
- expanding scope beyond §4 or cutting a P0 item. If the editor is at risk of overrunning, propose the cut from the plan's §12 mitigation (single column, no drag) instead of dropping validation, autosave honesty or accessibility.

## 10. Final response format

1. Outcome in 3–5 sentences.
2. Acceptance-criteria table (status + evidence), with AC5 labeled honestly.
3. Files and routes to review (links, no large pastes).
4. Exact results: `npm audit`, lint, typecheck, unit tests (files/tests), DB tests (files/assertions), build (routes), Lighthouse (LCP/CLS, before/after), editor route client JS size.
5. Security negative cases tested (malicious URLs, forged payloads, cross-workspace, anon, stale revision).
6. Decisions awaiting founder confirmation (UX-026+ and ADR 0008 choices).
7. Blockers, pending external setup and the recommended starting point for Sprint 5.
