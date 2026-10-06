# ADR 0012 — Multi-page operations, invitations and roles

- **Status:** accepted for the MVP (items marked *provisional* await founder confirmation)
- **Date:** 2026-10-06
- **Builds on:** ADR 0004 (tenancy and authorization), ADR 0005 (authentication), ADR 0007 (publishing), ADR 0008 (block model), ADR 0009 (media), ADR 0011 (analytics)
- **Scope:** Sprint 7, part 1 of 2. The consolidated dashboard and the read-only report link are ADR 0013 (part 2).

## Context

Sprint 7 turns a product one person uses for one page into a tool an agency operates: many pages, several people, different levels of access. This part changes **who can reach a workspace**, the most sensitive thing the product does after authentication. The failures that matter are an invitation that lands in the wrong workspace, a role check that exists only in the interface, and a duplicated page that still shares content with its original.

Much of the model already existed (ADR 0004): `workspace_memberships` with role and status, `change_member_role` and `remove_workspace_member` without an interface, the last-owner guard, the `team_members` and `max_profiles` triggers, and `profile_status = 'archived'`. This ADR extends that model; it does not add a parallel one.

There is no mail adapter and no custom SMTP, no billing (Sprint 8), and `main` deploys to staging before the founder applies migrations.

## Decision

### Archiving

| Question | Decision |
|---|---|
| What archiving does to a published page | `archive_profile` takes it off the air in the same transaction (clears `live_publication_id` and `published_at`, exactly what `unpublish_profile` does) and sets `status = 'archived'`. The Server Action then revalidates the public cache through the existing `revalidatePublicPage`, so `/[slug]` stays static |
| What a visitor sees | The same 404 as any unpublished address (`get_public_page` answers `unpublished`, UX-021). Nothing says the page exists or was archived |
| The address | Stays with the page (the unique index still holds it). It is not released to `slug_history` |
| History | Snapshots, analytics aggregates and leads are kept. The results screen and the contacts screen of an archived page stay open (**founder decision, 2026-10-06**) |
| The draft | Frozen: the `profiles` update policy excludes archived pages, and the editor is replaced by a read-only preview with "Desarquivar". Changing the address and deleting stay available to owners and admins |
| `max_profiles` | Archived pages **keep counting** (UX-019, kept on 2026-10-06 at the founder's request for the option that is best for the business: the page limit is what separates the plans, and an archive that did not count would be free unlimited storage of pages and addresses). The list says so next to the usage |
| Unarchiving | `unarchive_profile` returns the page to `draft`. It never republishes: publishing is a separate, deliberate step, and the previous snapshots are still there to restore |
| Who | Owners and admins (`profile.archive`). Editors do not: archiving takes a client's page off the air |

Transitions the database enforces:

- `check ((status = 'published') = (live_publication_id is not null))`: status and the live snapshot cannot disagree, so an archived page can never be on the air.
- `publish_profile` and `restore_profile_publication` raise `LK070` for an archived page.
- `status` has no column grant; it changes only through `publish_profile`, `restore_profile_publication`, `unpublish_profile`, `archive_profile` and `unarchive_profile`.
- Both RPCs are idempotent and write one audit event per real transition (`profile.archived`, `profile.unarchived`).

### Duplication

`duplicate_profile(source, title, slug)` is one transaction:

1. authorizes the caller as owner or admin of the **source's** workspace (`profile.duplicate`) and locks the source row;
2. inserts a new draft page **in the same workspace** through the ordinary `profiles` insert, so the `max_profiles` trigger and the slug rules (normalization, reservation, hold, uniqueness) apply unchanged;
3. gives the new page a share of every ready asset the source draft uses (below);
4. copies the blocks with **a new id for every block**, the theme, the bio and the avatar reference, through the ordinary draft validator;
5. writes `profile.duplicated`.

| Copied | Not copied |
|---|---|
| bio; blocks (new ids), including hidden ones; theme; avatar and image references | publications and their versions; `status` (always draft); analytics; leads; slug and slug history; `draft_revision` (the copy has its own counter); legacy `social_links`; anything added later that is the page's history or identity (custom domain, pixels, report links — UX-008) |

The name and the address are chosen by the person in the duplication form. The suggestions come from pure functions (`modules/profiles/duplicate-naming.ts`): "Cópia de <name>" cut to 80 characters and `<slug>-copia`, `-copia-2`, … cut to 40.

The copy records `duplicated_from` (a plain uuid, no foreign key, never used for authorization). It is what lets the editor show the review notice.

**Contact and payment details (*provisional*, UX-052).** Pix keys, payment links, WhatsApp numbers and form consent text are copied: a page duplicated for another unit of the same business needs them, and silently blanking blocks would produce a draft that fails validation. Because the same copy made for a *different* client would send that client's money and contacts to the first one, the new draft shows a notice listing exactly which of those details it contains, until the page is published for the first time. Publishing is still a deliberate step taken by a person.

**Media: the reference rule is widened, objects are not copied.** ADR 0009 left this open. Copying objects cannot be part of a database transaction (objects live in Storage) and would need either the service key for an ordinary user action or a second upload pipeline. Instead:

- `media_asset_shares (media_id, profile_id, workspace_id)` says "this page may also reference this asset". It is a **permission**, not a reference: whether a page still uses an image is still computed from its draft and its retained publications (`private.media_page_references`). A stale share costs one extra check and nothing else, so the second-source-of-truth objection in ADR 0009 does not apply.
- `private.is_ready_media` accepts an asset the page owns or has a share of. `private.media_is_referenced` is true while the owner page **or any sharing page** references the asset.
- **Deleting or archiving one page never breaks the other's images.** Archiving changes nothing for media. A soft-deleted owner page keeps its row for 30 days. When its `purge_after` passes, `claim_media_cleanup` first **re-homes** each asset a live sharing page still references (the asset's `profile_id` moves to that page and the share row is dropped), then claims what nobody uses. The owner page can then be purged (`media_assets → profiles` is `ON DELETE RESTRICT`).
- **`storage_mb`:** a shared asset is one row and is counted once. Duplication consumes no storage. Space is freed only when no page uses the image any more.
- Shares never cross workspaces: `duplicate_profile` only reads assets of the source's workspace.

Duplication across workspaces and moving a page to another workspace are **out of scope**. "Template" in this sprint means duplicating an existing page; there is no shared template library.

### Invitations

**Model.** `workspace_invitations (id, workspace_id, email, role, token_hash, invited_by, created_at, expires_at, revoked_at, revoked_by, accepted_at, accepted_by)`.

- `role` is `admin` or `editor` (check constraint). **Ownership is never granted by invitation**, not even by an owner; it is granted with `change_member_role` to someone who is already a member.
- `email` is stored normalized (trimmed, lowercase); the same function exists in SQL (`private.normalize_email`) and TypeScript.
- **One source of truth for "pending".** A pending invitation exists only in this table. A membership row is created `active` at acceptance (or reactivated, for someone removed before). `workspace_memberships.status = 'invited'` is not written; the enum value stays for compatibility and the seat trigger still counts it.
- One open invitation per address per workspace (partial unique index). Inviting the same address again closes the open one, so the earlier link stops working.

**Token.** 32 bytes from `crypto.getRandomValues` (256 bits), base64url, 43 characters. It is shown **once**, on the screen that created it; a lost link means a new invitation.

- `create_workspace_invitation` receives only the **SHA-256 hash**, so the token never reaches the database when it is created.
- `accept_workspace_invitation` and `get_workspace_invitation` receive the token and hash it in the database. A stolen hash is therefore useless.
- `token_hash` has no column grant: no client role can read it.
- The token travels in a path segment, `/app/convite/<token>`, because it must survive the sign-in redirect (`/entrar?next=…`, which a URL fragment would not). It therefore appears in the hosting platform's request log; the application's structured logs never contain it (the logger drops keys named `token` and no invitation event logs a path). The page sets `Referrer-Policy: no-referrer` and has no outbound link. The exposure is bounded: single use, seven days, and useless without a session whose confirmed e-mail is the invited one.

**Expiry and revocation.** Seven days (`private.invitation_ttl()`, *provisional*, UX-053). Owners and admins revoke (`invitations.revoke`). Both take effect on the next request: every read goes to the database.

**Acceptance rule.** The person must be signed in, with a **confirmed e-mail equal to the invited one** after normalization (*provisional*, UX-054). The link is meant to be pasted into chat apps, where it can be forwarded or read by someone else; requiring the address means a leaked link cannot be used by another account.

| Situation | Answer (`state`) | What the person sees |
|---|---|---|
| Valid, for this account | `valid` → `accepted` | Workspace name, role, who invited; then the workspace |
| Signed out | (proxy redirects to sign-in with `next`) | "Entre ou crie seu acesso com o e-mail que recebeu o convite" |
| Valid, but for another address | `wrong_account` | That the invitation is for another e-mail, with no detail about the workspace, and how to switch accounts |
| Already an active member | `already_member` | A link to the workspace. The invitation is closed and the role is **not** changed |
| `team_members` reached | `limit_reached` | That the account is full and the inviter must free a seat |
| Unknown, malformed, expired, revoked, already used, or the workspace is deleted or suspended | `invalid` | One generic screen, the same row from the database in every case |

`wrong_account` reveals that a token is valid to someone who holds it; it reveals nothing about the workspace. That is accepted because the alternative (the generic screen) leaves a person with two accounts with no way to understand what happened.

**Surviving sign-in and sign-up.** `/app/convite/<token>` is under `/app`, so the existing proxy sends a signed-out visitor to `/entrar?next=/app/convite/<token>` and `safeNextPath` already allows it. Sign-up needs an e-mail confirmation whose link template carries a fixed `next=/app`; to keep the invitation across it without touching the hosted e-mail templates, sign-up stores the validated path in an `HttpOnly`, `SameSite=Lax` cookie scoped to `/auth` for one hour (`lnk_after_confirm`), and `/auth/confirm` honors it only if it is an invitation path. On another device the person opens the invitation link again after confirming; the link is still valid.

**Seats.** Open, unexpired invitations **count toward `team_members`** together with members that are not revoked (`private.workspace_seats_in_use`), so the limit cannot be exceeded at acceptance. It is checked again at acceptance anyway, because the plan can change in between; the existing membership trigger stays as a backstop. Creation and acceptance both lock the workspace row, in the same order.

**Limits (*provisional*).** 20 invitations per workspace and 30 per inviter in 24 hours (`LK082`). An invitation to an address that already belongs to an active member is refused (`LK081`); this tells an owner or admin something about their own workspace only.

**Retention.** The invited address is personal data about someone who may never sign up. A finished invitation (accepted, revoked or expired) is deleted 30 days after it ended, when the next invitation is created in that workspace. A scheduled purge for workspaces that never invite again is listed for Sprint 9 with the other purges.

**Audit.** `invitation.created` (`role`, `superseded`), `invitation.revoked` (`role`), `invitation.accepted` (`role`, `membershipId`). No event contains the address or anything derived from the token. Failed attempts are not audited; they are in the structured log as an outcome.

**E-mail.** None is sent. The inviter copies the link and sends it through their own channel (*provisional*, UX-055). No mail vendor and no Supabase Auth admin API.

### Roles and members

New actions, in both `modules/identity/permissions.ts` and the database:

| Action | owner | admin | editor | Enforced by |
|---|:-:|:-:|:-:|---|
| `profile.archive` (archive and unarchive) | ✓ | ✓ | – | `archive_profile`, `unarchive_profile` |
| `profile.duplicate` | ✓ | ✓ | – | `duplicate_profile` + `max_profiles` trigger |
| `members.invite` | ✓ | ✓ (admin or editor only, like an owner) | – | `create_workspace_invitation` |
| `invitations.view` | ✓ | ✓ | – | RLS select on `workspace_invitations` |
| `invitations.revoke` | ✓ | ✓ | – | `revoke_workspace_invitation` |
| `members.view` | ✓ | ✓ | ✓ (names and roles; no e-mail addresses but their own) | `list_workspace_members` |

An editor edits and publishes but does not archive, duplicate, invite or manage members (UX-017): duplication consumes a paid entitlement and archiving takes a client's page off the air.

**Ownership transfer** is what `change_member_role` already allows: an owner promotes another member to owner and may then step down. The last-owner guard is unchanged.

**A removed or demoted person's open sessions.** Nothing is cached per session: `requireWorkspaceAccess` re-reads the membership on every Server Action, Route Handler and page, and RLS evaluates it on every statement. The next request after a removal is refused (an editor's autosave gets `not_found`); the JWT stays valid, but it no longer grants anything in that workspace.

**Leaving.** Any member may leave (`remove_workspace_member` on their own row), except the last owner.

### Workspace switching

- The current workspace is **the `workspaceId` in the URL of the request**, and nothing else. No action takes its workspace from a cookie, a header, client state or "the last one used". Actions that receive a membership, invitation or page id derive the workspace from that row in the database and compare it with the URL's.
- The switcher lists the active memberships in live workspaces, personal first, and each entry is a plain navigation. A workspace the person was just removed from disappears on the next render and its URL answers 404.
- `/app` goes to the personal workspace. **Remembering the last-used workspace was cut** (first item of the cut list).

### Page list queries

`list_workspace_profiles(workspace, search, slug_search, status, order, limit, offset)` returns one row: totals for the whole workspace (all, draft, published, archived), the number of matches, and the page of items with the publication status and whether there are unpublished changes. **One query** per list render, whatever the number of pages.

- It is `security invoker`: RLS on `profiles` and `profile_publications` keeps other workspaces out whatever the arguments. A non-member gets zeros and an empty list.
- **Search** matches the name (`ilike`, case-insensitive) or the address (`like`, against the search string normalized the way slugs are, so "Café" finds `cafe-ipe`). The string is cut to 80 characters and `%`, `_` and `\` are escaped: it is always literal text.
- **Filter** by status (all, draft, published, archived). **Order:** newest first (default) or name. **Page size** 20, at most 50; offset pagination.
- **Indexes.** `profiles_workspace_live_created_idx (workspace_id, created_at desc) where deleted_at is null` (Sprint 2) serves the workspace scan and the default order; the join to the live snapshot is a primary-key lookup. No index on `updated_at` (it would be rewritten by every autosave) and no trigram index.
- With at most a few dozen pages per workspace the match runs over rows already in memory. **Threshold:** beyond about 500 pages in one workspace, move to keyset pagination and a `pg_trgm` index; that is 50 times the largest plan.

### AC1 — server-side authorization of every action in this part

"Not found" means the caller gets the same answer as for an id that does not exist. Each row has a Vitest case on the application side and a pgTAP case on the database side; the direct-call column names the check made without the interface.

| Surface | owner | admin | editor | member of another workspace | signed-in non-member | `anon` | Direct-call check |
|---|---|---|---|---|---|---|---|
| RPC `list_workspace_profiles` / page list | ✓ | ✓ | ✓ | empty | empty | no execute | pgTAP 150: outsider with hostile search strings gets `[]` |
| Server Action `archiveProfileAction` → RPC `archive_profile` | ✓ | ✓ | forbidden (`42501`) | not found (`P0002`) | not found | no execute | pgTAP 150; Vitest: service refuses before the repository is called |
| Server Action `unarchiveProfileAction` → RPC `unarchive_profile` | ✓ | ✓ | forbidden | not found | not found | no execute | same |
| Server Action `duplicateProfileAction` → RPC `duplicate_profile` | ✓ | ✓ | forbidden | not found | not found | no execute | same; at `max_profiles` → `LK010` |
| Draft save on an archived page (`saveDraftAction`) | refused | refused | refused | not found | not found | no privilege | pgTAP 150: update matches no row |
| RPC `list_workspace_members` / members screen | ✓ | ✓ | ✓ (no addresses) | not found | not found | no execute | pgTAP 150 |
| Table `workspace_invitations` (select) | own workspace | own workspace | no rows | no rows | no rows | no privilege | pgTAP 150; `token_hash` unreadable by any client role (pgTAP 010) |
| Server Action `inviteMemberAction` → RPC `create_workspace_invitation` | ✓ (admin/editor) | ✓ (admin/editor) | forbidden | not found | not found | no execute | pgTAP 150: role `owner` refused for every caller |
| Server Action `revokeInvitationAction` → RPC `revoke_workspace_invitation` | ✓ | ✓ | forbidden | not found | not found | no execute | pgTAP 150 |
| Page `/app/convite/[token]` → RPC `get_workspace_invitation` | by address | by address | by address | by address | by address | no execute (proxy: sign-in) | pgTAP 150: another account gets `wrong_account` with no detail |
| Server Action `acceptInvitationAction` → RPC `accept_workspace_invitation` | by address | by address | by address | by address | by address | no execute | pgTAP 150: wrong account, replay, expired, revoked |
| Server Action `changeMemberRoleAction` → RPC `change_member_role` (Sprint 2, now exposed) | ✓ | non-owners; never to owner | forbidden | not found | not found | no execute | pgTAP 040 and 150; Vitest |
| Server Action `removeMemberAction` → RPC `remove_workspace_member` (Sprint 2, now exposed) | ✓ | non-owners | self only | not found | not found | no execute | pgTAP 040 and 150; Vitest |

Every Server Action re-derives the role with `requireWorkspaceAccess` before calling the database; the RPC checks it again; a hidden button is presentation only.

## Error contract (extends ADR 0004)

`LK070` the page is archived; `LK081` the address already belongs to an active member; `LK082` too many invitations; `LK010` with detail `team_members`. Invitation acceptance and lookup return a `state` instead of raising, so each refusal maps to exactly one screen (`modules/identity/invitations.ts`).

## Fail-safe before the migration is applied

`main` reaches staging before the migrations. Until then:

- the page list falls back to the Sprint 2 query (no search, filter or pagination) when `list_workspace_profiles` does not exist;
- the editor, publishing, uploads, leads and analytics do not read anything this part added;
- archive, duplicate and the members screen answer "ainda não disponível nesta conta" instead of failing;
- an invitation link shows the generic invalid screen.

## Alternatives considered

- **Copying media objects on duplication.** Needs the service key for a user action or a second attested upload per image, cannot be transactional with the page copy, and doubles storage for identical bytes.
- **Widening the reference rule to "any page of the workspace".** No table, but the quota and cleanup checks would scan every page and every retained publication of the workspace for every asset.
- **A `pending` membership row instead of an invitations table.** Impossible for people without an account (the common case) and it would give two places where "pending" lives.
- **Sending the invitation by e-mail through Supabase Auth's admin API.** Needs the secret key on a user path, the default mailer is rate-limited to a few messages per hour, and it would create `auth.users` rows for people who never asked for an account.
- **Not requiring the invited e-mail.** Simpler for the person, but anyone who sees the link in a group chat joins the workspace.
- **Archived pages not counting toward the limit.** Rejected for the business reason above.

## Consequences

- Adding a role or an action still means changing `permissions.ts`, the RPCs or policies, and both test suites together.
- `private.media_is_referenced` now costs one extra existence check per share of an asset.
- The Sprint 9 purge of soft-deleted pages must run `claim_media_cleanup` before deleting page rows, as before; re-homing happens there.
- Account deletion and export (Sprint 9) must reach `workspace_invitations` by `email`, `invited_by` and `accepted_by`.
- Sprint 8 decides what happens to members and open invitations above `team_members`, and to pages above `max_profiles`, after a downgrade. Today nothing is removed: existing members keep access and new invitations and pages are refused.
- Part 2 reads analytics per workspace: archived pages keep their aggregates and their `profile_id`; a duplicated page starts with none.
