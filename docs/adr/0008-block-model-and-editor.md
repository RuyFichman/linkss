# ADR 0008 — Block model and editor persistence

- **Status:** accepted for the MVP (items marked *provisional* await founder confirmation)
- **Date:** 2026-09-30
- **Builds on:** ADR 0003 (published snapshots), ADR 0004 (tenancy and authorization), ADR 0007 (publishing and the public renderer)
- **Extended by:** ADR 0010 (image, embed, Pix and form blocks; theme and avatar saved in the same draft write; additive document changes do not bump the schema version); ADR 0011 (the `data-block-id` / `data-block-type` hooks are now read by the analytics collector: renaming them, or moving them off the element that contains the block's controls, changes what is counted)

## Context

Sprint 4 replaces the Sprint 3 link/social forms (UX-024) with a block editor: link, text, social, WhatsApp and divider blocks that can be created, edited, reordered, duplicated, hidden and deleted, with autosave, simple conflict recovery and a persistent mobile preview. Sprint 5 adds image, embed, Pix and form blocks; Sprint 6 counts clicks per block; Sprint 7 duplicates pages. What the person sees in the editor must be exactly what gets published (same order, same content), and a request that skips the UI must be rejected by the database.

## Decision

### Block schema (draft `profiles.blocks`)

A JSON array of objects discriminated by `type`. Every block has `id` (lowercase UUID, unique within the page), `type` and `visible` (boolean). Keys are exact per type: unknown keys are rejected, so a future field is always a deliberate change on both sides.

| Type | Fields | Limits |
|---|---|---|
| `link` | `title`, `url` | title 1–80 chars (trimmed); URL per the URL policy below, ≤ 2048 |
| `text` | `text` | 1–1000 chars, plain text; line breaks (`\n`) allowed, other control characters rejected; rendered as a text node, never HTML/Markdown |
| `social` | `items: [{network, url}]` | 0–8 items, one per network, https URL on the network's host allowlist (unchanged from Sprint 3) |
| `whatsapp` | `label`, `phone`, `message` | label 1–80; phone = E.164 digits without `+` (8–15 digits, `55…` must have 12–13); message 0–500, line breaks allowed |
| `divider` | — | — |

Page-wide caps: at most 100 blocks (existing `profiles_blocks_shape` check) and 64 KiB of serialized JSON (`octet_length(blocks::text)`), enforced in `private.validate_profile_draft` and mirrored as named constants in `modules/blocks/limits.ts`. These are abuse/performance limits, not plan limits; a plan-dependent limit would go through entitlements.

Sprint 5 types (`image`, `embed`, `pix`, `form`) are new members of the union: new key set in the validator, new parser branch, new renderer branch. Nothing in the existing types changes, so no stored draft needs rewriting.

The WhatsApp destination is **not** stored as a URL. The renderer builds `https://wa.me/<phone>?text=<encoded message>` at render time from the structured fields, so the phone number can never smuggle another host or scheme.

### Social links become a block

The Sprint 3 page-level `social_links` column is replaced by the `social` block, which owns its items. A page may have more than one social block (each is just a positioned row of icons), which also lets Sprint 5 templates seed them like any other block.

- Migration `202609300001_block_editor.sql` prepends one visible `social` block containing the existing `social_links` to every draft that has social links and no social block yet (idempotent; skipped for a page already at the 100-block cap). The bump-revision trigger is disabled for that statement only: the draft's visible content is unchanged, so a page that was "up to date" stays up to date.
- `social_links` is **no longer written** by the application but is kept (not cleared, not dropped) and still validated. Dropping it needs founder approval and belongs to a later cleanup migration.
- Old snapshots are untouched: a schema-version-1 document keeps its header `socialLinks`, and the renderer turns them into a leading social block (visually the same position, right under the bio).

### Snapshot document, schema version 2

`private.build_publication_document` now emits `schemaVersion: 2`: `{schemaVersion, title, bio, avatarPath, blocks}`. Blocks keep draft order; hidden blocks and social blocks with no items are dropped; `visible` is removed; every other field is copied explicitly per type (no draft-only data can leak by accident). `profile_publications.schema_version` defaults to 2 and a check constraint keeps it equal to `document ->> 'schemaVersion'`.

`parsePublishedDocument` accepts versions 1 and 2 and normalizes both to the version-2 view model; unknown versions still return `null` (the route fails and ISR keeps the last good copy). Individual invalid blocks are dropped, never rendered. Every snapshot that can be restored (the last 10 versions, UX-023) therefore still renders.

**Application rollback caveat.** A Sprint 3 build cannot read version-2 snapshots (it only accepts version 1), and its link form would rewrite `blocks` with link blocks only. No environment runs Sprint 3 today (nothing is deployed), so this sprint accepts the break. From the first real deployment on, document format changes follow expand/contract: ship the reader for version N+1 one release before the writer.

### URL policy

One pure module, `modules/blocks/url-policy.ts`, is the TypeScript source of truth; `private.is_allowed_block_url()` mirrors it in SQL, and both are covered by the same malicious-input table.

- Allowed schemes: `https:`, `http:`, `mailto:`, `tel:`. Everything else is rejected, including `javascript:`, `data:`, `vbscript:`, `file:`, `blob:`, `about:`, `intent:` and custom app schemes, in any letter case, and when obfuscated with whitespace, control characters, percent-encoding or HTML entities.
- `http:` is **kept, not upgraded** (*provisional*): some small-business sites still have no TLS and silently upgrading would break them. The editor shows a hint that the link is not secure.
- Bare domains get `https://` (`exemplo.com.br` → `https://exemplo.com.br/`). Protocol-relative (`//host`) and relative paths are rejected.
- Web URLs must have a dotted host with an alphabetic or punycode top-level label (so `localhost`, intranet names and bare IPv4 addresses are rejected) and no userinfo (`user:pass@`, `user@`).
- Hosts are stored in the WHATWG serialization (lowercase, IDN as punycode `xn--…`). The editor shows the stored form, so a mixed-script look-alike host is visible as punycode; see the homograph note in `docs/THREAT_MODEL.md`.
- `mailto:` needs one plausible address (`local@domain.tld`), optionally followed by a query (`?subject=`). `tel:` keeps only `+` and digits (3–20 digits).
- Links to the product's own origin (other public pages, the landing page) are allowed like any https URL. There are no state-changing GET routes, and Server Actions carry their own CSRF protection, so blocking them would add no security.

### Rendering

- Links: `rel="ugc nofollow noopener noreferrer"`. This amends ADR 0007 (`ugc nofollow noopener`) at the founder's request; the trade-off is that destinations no longer see the page's origin as referrer (UTM parameters in the destination URL still work).
- Social icons keep `rel="me ugc nofollow noopener noreferrer"`. Text is rendered with `whitespace-pre-line`. The divider is an `<hr>`. The WhatsApp button's accessible name includes "WhatsApp".
- Every rendered block has `data-block-id` and `data-block-type` for Sprint 6 click analytics (no tracking is implemented).
- The editor preview uses the same `PublicPageView` fed by the same `documentFromDraft` mapping as the database builder (drift-tested), with inert links (anchors without `href`) so the preview neither navigates nor triggers anything.

### Save granularity and concurrency

- **Whole draft per save:** title, bio and the complete `blocks` array go in one conditional `UPDATE … WHERE draft_revision = <expected>` issued as the signed-in user under RLS (the Sprint 3 compare-and-swap). One statement is one transaction: order and content are atomic, and there is no second versioning mechanism. The largest allowed payload is ~64 KiB, far below any request limit; per-block patches would need an RPC per operation type and make ordering conflicts harder.
- Zero rows with a different revision is a **conflict**; the Server Action returns a typed result (`saved` with the new revision, or `conflict` / `validation` / `forbidden` / `not_found` / `unauthenticated` / `unavailable`).
- **Debounce 1000 ms** after text edits, a compromise between few requests while typing and a short window for losing work. Structural actions (add, move, duplicate, hide/show, delete, undo) save immediately. Saves never overlap: while one is in flight, further edits only mark the draft dirty, and the latest state is sent when the request returns. Transient failures are retried three times (1 s, 2 s, 4 s); after that the status shows "Não foi possível salvar" with "Tentar novamente". Validation, permission and session errors are not retried.
- "Salvo" appears only when the server confirmed the revision for the latest local change.
- **Conflict policy:** on a stale revision the editor stops saving and keeps the local copy. The person chooses "Carregar a versão mais recente" (discards local changes after a confirmation) or "Manter as minhas alterações" (re-reads the current revision and overwrites it after a confirmation). Nothing is ever overwritten silently.
- **Publishing** uses the confirmed revision (`publish_profile(p, expected_revision)`, `LK030` on mismatch) and is disabled while there are unsaved, failing or conflicting changes.
- **Audit:** autosave writes no audit events (they would be per keystroke and carry no security signal). Publishing, restore and unpublish remain audited. No editor action needs its own audit event.

### Editor state and reordering

- Editor state (reducer, undo of the last deletion, autosave controller) lives in `modules/editor/draft/`, framework-free and unit-tested. React components only dispatch actions and render.
- Reordering uses accessible buttons (move up/down, plus move to top/bottom in the edit panel). **No drag-and-drop in this sprint** and no new dependency: WCAG 2.5.7 requires a non-drag alternative anyway, and the plan's §12 mitigation for editor overrun is "single column, no drag". Pointer drag can be added later with native pointer events.
- No new runtime dependency was added for the editor.

## Alternatives considered

- **Keep `social_links` as a page-level field positioned by a `social` marker block:** keeps the column written (friendlier to a Sprint 3 rollback) but splits one visual element across two storage locations and makes templates and duplication special-case it. Rejected.
- **A `profile_blocks` table:** per-row RLS and partial updates, but ordering, snapshotting and conflict detection get harder, and every save becomes several statements. Rejected again (see ADR 0007).
- **Per-block patch RPCs:** smaller payloads, but every structural operation needs its own server-side reorder logic and concurrency story. Rejected for the MVP.
- **Additive document without a version bump:** a Sprint 3 renderer would silently drop the new block types instead of failing. Rejected: the shape change (social position, new block union) is real, and nothing runs Sprint 3 yet.
- **Drag-and-drop library (e.g. dnd-kit):** good accessibility story but a new dependency and more editor surface this sprint. Deferred.

## Consequences

- The database validator, `modules/blocks/*`, `modules/publishing/document.ts`, the renderer and both test suites change together for every new block type (unchanged rule from ADR 0007).
- Pre-Sprint-4 drafts may contain links the stricter policy now rejects (e.g. hosts without a dot). The editor flags them as invalid and saving stays blocked until they are fixed or removed; published snapshots drop such links when rendered.
- The editor holds the whole draft in memory. At 100 blocks and 64 KiB this is trivial for the browser and the network.
