# ADR 0010 — Themes, templates and the image, embed, Pix and form blocks

- **Status:** accepted for the MVP (items marked *provisional* await founder confirmation)
- **Date:** 2026-10-01
- **Builds on:** ADR 0007 (publishing), ADR 0008 (block model), ADR 0009 (media)
- **Extended by:** ADR 0011 (`submit_form_lead` also records a `form_submit` analytics event when a lead is stored, with the same signature and answers; the analytics visitor hashes reuse `VISITOR_HASH_SALT` with their own message prefixes)

## Context

Sprint 5 must make a page look good enough to replace what a person uses today: four new block types, a theme, and the five Sprint 1 templates as production data. The same rules as ADR 0008 apply: exact keys per block, the database rejects what the application rejects, the preview is the published page, and no user-supplied HTML, CSS or JavaScript exists anywhere. The form block is the first place where the product stores personal data typed by **visitors**.

## Decision

### Block schemas (new members of the `profiles.blocks` union)

| Type | Fields | Rules (named constants in `modules/blocks/limits.ts`, mirrored in SQL) |
|---|---|---|
| `image` | `mediaId`, `width`, `height`, `alt`, `decorative` | `mediaId` is a `ready` image asset **of the same page** whose master dimensions equal `width`/`height`; `alt` 1–200 characters unless `decorative` is true (then it must be empty) |
| `embed` | `provider`, `ref`, `title` | provider in the allowlist; `ref` matches the provider's id pattern; title 1–80 |
| `pix` | `label`, `keyType`, `key`, `paymentUrl` | label 1–80; key valid for its type, in normalized form; `paymentUrl` empty or an **https** destination accepted by the URL policy |
| `form` | `title`, `fields`, `buttonLabel`, `consentText`, `consentRequired` | title 1–80; 1–4 distinct fields from `name`, `email`, `phone`, `message`, in catalog order, with at least `email` or `phone`; button 1–40; consent text 1–300 |

Nothing in the Sprint 4 types changes and no stored draft is rewritten.

### Embeds

- A block stores a **provider id and a resource id**, never a URL and never markup. The editor field accepts a pasted address; a per-provider parser (`modules/blocks/embed.ts`) first runs it through the URL policy, then matches the exact host list and extracts only the id. Query strings, fragments and anything else in the pasted address are discarded.
- Allowlist: `youtube` (rendered on `www.youtube-nocookie.com`), `vimeo` (`player.vimeo.com`, `dnt=1`), `spotify` (`open.spotify.com/embed`). All three work as a plain iframe. Providers that need their own script (Instagram, TikTok, X) are out.
- The iframe `src` is built by `embedFrameSrc(provider, ref)` from constants plus the validated id.
- **Click-to-load facade:** the public page renders a box with the block title, the provider name and a link to the provider's own page. No request goes to the provider on first load (LCP and visitor privacy). With JavaScript, the first click replaces the box with the iframe; without JavaScript, the link opens the provider. The box reserves the final size (16:9 for video, 152 or 352 px for Spotify), so there is no layout shift.
- Iframe attributes: `sandbox="allow-scripts allow-same-origin allow-presentation allow-popups allow-popups-to-escape-sandbox"`, `allow="autoplay; encrypted-media; picture-in-picture; fullscreen"`, `referrerpolicy="strict-origin-when-cross-origin"` (YouTube refuses embeds that send no referrer; only the origin is sent, never the page path), `loading="lazy"`, and `title` from the block.

### Pix / payment

- No checkout, no stored value, no payment status (AGENTS.md §18). The block shows a label, the key as selectable text, a copy button, and optionally a button to an external payment link. The page says the payment happens outside the product and asks the payer to check the recipient's name in the bank app.
- Key types: `cpf`, `cnpj` (numeric, with check digits), `phone` (`+55` and 10–11 digits), `email` (lowercase, up to 77 characters), `random` (UUID). The stored form is normalized; the type is detected from what was typed and can be chosen explicitly.
- A key may be a CPF, a phone or an e-mail: it is **personal data the owner chooses to publish**. The editor says so and suggests a random key.
- **Not in this sprint:** the static "copia e cola" BR Code and the QR code. A BR Code needs the recipient's name and city (two more fields) and is mostly useful as a QR code, which needs an encoder (a dependency or several hundred lines). The QR code is the first item of the sprint's cut list; the BR Code goes with it.

### Form and leads

- A fixed set of four field types, not a form builder. `name`, `email` and `phone` are required when present; `message` is optional.
- **Table `form_leads`:** `workspace_id`, `profile_id`, `block_id`, `publication_version`, the four values, `consent_given`, `consent_required`, `consent_text` (the exact text shown), `consent_version` (MD5 of that text), `consented_at`, `created_at`, `purge_after`.
- **Submission:** `submit_form_lead(slug, block id, fields, consent, honeypot, client hash)`, `security definer`, granted to `anon`. It validates against the form definition in the **live snapshot** (not the draft), so a form that was removed or never published accepts nothing. It returns a status (`ok`, `invalid`, `consent_required`, `rate_limited`, `unavailable`) and never reveals anything else.
- **Consent:** the owner sets the text and whether it is required. A submission without required consent is rejected by the database. Each lead stores the text, its version and the timestamp.
- **Spam controls (no client JavaScript needed):** a hidden honeypot field (a filled honeypot answers `ok` and stores nothing); at most 5 accepted submissions per visitor hash per page per 10 minutes and 60 per page per hour; identical content from the same form within 10 minutes is stored once (which also makes retries safe); 4 KiB payload cap.
- **Visitor identifier:** the Server Action sends `sha256(VISITOR_HASH_SALT, day, IP)`. The raw IP is never stored. The hash lives in `form_submission_hits` for at most 24 hours and rotates daily. A direct call to the RPC without a hash shares one bucket (`direct`).
- **Retention:** 90 days (*provisional*). Expired leads are hidden by RLS at once and deleted on the next submission to the page or by the Sprint 9 purge job.
- **Reading:** members of the workspace (owner, admin, editor) read leads; owners and admins delete and export. `anon` has no table privilege. Deletion and CSV export go through audited RPCs (`lead.deleted`, `lead.exported`); uploads, theme changes and submissions write no audit event.
- No e-mail notification (no SMTP is chosen) and no CRM features.

### Theme

A closed token set stored in `profiles.theme` (`null` = the classic look every page had until Sprint 4) and copied into the snapshot:

| Token | Values |
|---|---|
| `background` | `#rrggbb` |
| `button` | `#rrggbb` |
| `buttonStyle` | `filled`, `outline`, `soft` |
| `corners` | `square` (4 px), `rounded` (16 px), `pill` (28 px) |
| `spacing` | `compact` (8 px), `regular` (12 px), `relaxed` (20 px) |
| `font` | `system`, `serif`, `poppins`, `lora` |

- **Contrast is derived, not chosen.** Text colors are computed from the background (`modules/themes/resolve.ts`): the page text is the candidate (near-black, white, black) with the highest contrast, which is never below 4.5:1 for any background; secondary text and button labels are derived the same way. A person cannot produce an unreadable page. When the button color is hard to tell from the background (below 3:1) the editor says so in text; it does not block.
- The renderer turns tokens into CSS custom properties. Values come from the resolver's output (hex colors and catalog constants), never from stored strings.
- **Fonts:** two system stacks (0 KB) and two self-hosted families under the SIL Open Font License, latin subset: Poppins 400 + 700 (15.7 KB) and Lora variable (37.8 KB). Loaded with `next/font/local`, `display: swap`, not preloaded, with a metric-adjusted fallback so the swap does not shift the layout. No font URL is ever accepted.
- **Background image: not in scope.** It would become the LCP element of most pages. Solid colors only.

### Templates

The five Sprint 1 templates graduate to `modules/themes/templates.ts`: a theme plus example blocks. `applyTemplate()` is a pure function:

- on a page with content it changes the theme and nothing else;
- on a page with no blocks it may also add the example blocks, only when the person asks for them. Examples never contain fake contact data: phone numbers, keys and addresses are left empty and the block is flagged until filled;
- title, bio, avatar and blocks (content, order, visibility) are otherwise untouched; applying can be undone until the next template is applied or the page is reloaded.

### Snapshot format: additive, still schema version 2

The document gains an optional `theme` key, block types `image`, `embed`, `pix`, `form`, and a non-null `avatarPath` (a media id). **`schemaVersion` stays 2.** The version now changes only for a change an existing reader cannot safely ignore. The Sprint 4 reader already drops unknown block types and ignores unknown keys, so:

- version 1 and 2 snapshots published before this sprint render exactly as before (classic theme, no media);
- a Sprint 4 build reading a Sprint 5 snapshot shows the page without the new blocks and with the classic look, instead of failing. This is the expand step of expand/contract: the application can be rolled back one version after the migration.

*Rollback caveat:* a Sprint 4 **editor** drops block types it does not know when it loads a draft, so saving from a rolled-back editor removes the new blocks from that draft.

### Draft persistence

Theme and avatar are part of the draft: `saveDraft` writes title, bio, blocks, theme and avatar in the same conditional `UPDATE … WHERE draft_revision = expected` (ADR 0008). There is no second save mechanism. `bump_draft_revision` includes `theme`.

## Alternatives considered

- **Free color for text with a validation error under AA:** more freedom, but it puts the burden of contrast on the person. Deriving is always correct.
- **Bumping to schema version 3:** an older reader would fail on every newly published page, turning an application rollback into an outage for no gain.
- **Leads validated against the draft:** a visitor could submit to a form that was never published.
- **Generic "payment link" block:** a link block already does this; the Pix block carries the optional link so the value action is identifiable in Sprint 6.

## Consequences

- Adding a provider, a font, a template or a token value is a catalog change plus its SQL mirror; none of them changes the snapshot format.
- Leads make the product an operator of visitors' personal data on behalf of the page owner (controller). `docs/DATA_MAP.md` records it; the privacy notice and the processing terms are due before external users (Sprint 9).
- Sprint 6 gets stable hooks: `data-block-id` / `data-block-type` on every new block, and form submission and Pix copy as identifiable actions.
