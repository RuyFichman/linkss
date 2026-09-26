# ADR 0007 — Publishing and the public renderer

- **Status:** accepted for the MVP (items marked *provisional* await founder confirmation)
- **Date:** 2026-09-26
- **Builds on:** ADR 0003 (published snapshots), ADR 0004 (tenancy and authorization)

## Context

Sprint 3 must put the first real page on the air: a public route per address, served from an immutable snapshot, with idempotent publishing, rollback, cache invalidation, SEO/Open Graph metadata and explicit states for missing, unpublished and suspended pages. Visitors arrive mostly from in-app browsers on mobile, so the page must be fast and must work even if scripts fail. The public domain has not been purchased yet; everything must work with a configurable origin.

## Decision

### Draft model

- Draft content lives on `profiles`: `title`, `bio`, `avatar_path` (Sprint 2) plus `social_links jsonb` and `blocks jsonb` (Sprint 3). A document-in-a-row keeps publishing a single copy and gives the Sprint 4 editor a simple optimistic-concurrency unit.
- `draft_revision` is bumped by trigger whenever draft content changes. Writes from the app use `update … where draft_revision = <read revision>`; zero rows with a different revision is reported as a conflict.
- Sprint 3 supports only link blocks: `{id (uuid), type: "link", title (1–80), url, visible}` with `http(s)`, `mailto:` or `tel:` URLs. Social links are `{network, url}` with an https URL whose host belongs to the network (allowlist in `private.social_network_hosts`, mirrored in `modules/publishing/social.ts` and drift-tested).
- Members can write these columns directly through the Data API (column grants, like `title`/`bio`), so `private.validate_profile_draft()` enforces shape, schemes, hosts, lengths and unique ids in the database (`LK040`). The application validates the same rules first for good messages.

### Snapshots

- `profile_publications` rows are immutable (trigger rejects updates for everyone and deletes except by the owner role used for retention/purge). A snapshot stores `document` (schema version 1, render-ready, hidden blocks removed, no tenant or user identifiers), `version` (per page), `source_revision`, `published_by`.
- The live version is a pointer: `profiles.live_publication_id`, with a composite foreign key `(id, live_publication_id) → profile_publications (profile_id, id)` so a page can never point to another page's snapshot.
- Retention: the latest 10 versions per page (*provisional*), pruned inside `publish_profile`.

### Commands (security definer RPCs, audited in the same transaction)

| RPC | Behavior |
|---|---|
| `publish_profile(profile, expected_revision?)` | Role `owner/admin/editor` in an active workspace. If the draft equals the live snapshot's `source_revision`, returns it with `created = false` (idempotent: retries and double clicks create nothing). A stale `expected_revision` raises `LK030`, so what goes live is what the person reviewed. Otherwise creates version N+1, moves the pointer, prunes, writes `profile.published`. |
| `restore_profile_publication(profile, publication)` | Rollback: moves the pointer to a retained snapshot of the same page; draft untouched; `profile.publication_restored`. |
| `unpublish_profile(profile)` | Clears the pointer; snapshots kept; idempotent; `profile.unpublished`. |

Each command is also authorized first in the server (`modules/publishing/service.ts`, action `profile.publish`), exactly like the Sprint 2 commands.

### Public read surface

- `anon` still has **no** table privilege. The only function it may execute is `public.get_public_page(slug)` (stable, security definer). It looks up one address and returns `state` (`published`, `unpublished`, `suspended`, `moved`, `not_found`), the snapshot document, version, `published_at` and `show_badge` (resolved live from the `remove_badge` entitlement, so plan changes need no republish). There is no listing capability; no workspace or user identifiers are returned.
- `moved`: an address released by a slug change, during its 90-day hold, whose page is still live → temporary redirect to the current address (*provisional*, UX-020). Deleted pages, unpublished pages and suspended workspaces never redirect.

### Rendering and cache

- Route `app/[slug]/page.tsx`, Node runtime, on-demand ISR (`generateStaticParams` returns `[]`, `revalidate = 60`). The anonymous Supabase client uses no cookies (so the page stays static) and a 4 s fetch timeout.
- Invalidation: every committed change that affects a visitor (publish, restore, unpublish, slug change old + new, page deletion) calls `revalidatePath` for `/{slug}` and `/{slug}/opengraph-image` (`modules/publishing/cache.ts`). The 60 s window is only the fallback for changes made outside the app (e.g. suspension applied directly in the database, workspace deletion).
- Failure behavior: a lookup error throws; ISR keeps serving the last good copy of already-cached pages; uncached pages show the error boundary within ~4 s.
- Non-canonical spellings (`/Ana-Lima`, `/Caf%C3%A9`) are redirected (308) in `proxy.ts` by a matcher that only fires for single segments containing an uppercase letter or `%`. Canonical pages never run the proxy, and spelling variants never become cache entries.
- States: `published` → page; `moved` → 307; `suspended` → "Página indisponível" (HTTP 200, `noindex`: a distinct status would need the experimental `forbidden()` API); `unpublished` and `not_found` → the same real 404, so drafts are not revealed.
- Markup is server-rendered HTML with plain anchors (`rel="ugc nofollow noopener"`, social `rel="me …"`). The only client code is the Web Vitals reporter; the page is fully usable with all scripts blocked.

### Metadata

- `NEXT_PUBLIC_APP_URL` is the single source of the public origin (canonical, `og:url`, `metadataBase`, robots `host`, address labels in the app). Buying the domain is a configuration change plus a rebuild. The request `Host` is never used.
- `og:type = profile`, title, description (bio or default, ≤ 160 chars), generated 1200×630 Open Graph image per address (`app/[slug]/opengraph-image.tsx`, cached like the page). Only published pages are indexable; no sitemap is generated on purpose (it would enumerate every address).

### Observability

- `instrumentation.ts` `onRequestError` logs `request.error` with the route template, never the concrete path or headers.
- `public_page.resolved` / `public_page.lookup_failed` / `public_page.invalid_document` with duration.
- `/api/vitals` accepts TTFB/FCP/LCP/CLS/INP beacons from public pages, reduced to an allowlist (no URL, slug, id or user agent), always answers 204, rejects cross-site and oversized bodies.
- `publishing.publish|restore|unpublish` with outcome, version and duration.

## Alternatives considered

- **`profile_blocks` table** instead of JSON: per-row RLS and partial updates, but ordering, snapshotting and conflict detection get harder. Revisit in Sprint 4 if block-level collaboration is required.
- **Anon RLS policy on a snapshot table/view:** allows listing every published page through the Data API. Rejected in favor of an exact-slug RPC.
- **Cache Components (`use cache`) instead of route ISR:** would require enabling `cacheComponents` for the whole app and reworking existing dynamic pages. Rejected for now.
- **Rollback by copying the old snapshot into a new version:** linear history, but more writes and confusing version numbers. The pointer is simpler and the audit trail records the move.

## Consequences

- The public page costs one RPC per regeneration, not per view. ISR entries are created per requested address, including unknown ones; firewall/rate limiting in front of the renderer is part of the Sprint 9 abuse work.
- Adding a block type requires changing the database validator, `draft-content.ts`, `document.ts`, the renderer and both test suites together, and bumping `schemaVersion` if the document shape changes.
- ISR invalidation relies on the hosting platform sharing the cache across instances (true on Vercel). Self-hosting on several instances needs a shared cache handler.
- On case-insensitive file systems (local Windows/macOS) the file-system ISR cache conflates `/Ana` and `/ana`; the proxy redirect keeps non-canonical variants out of the cache.
