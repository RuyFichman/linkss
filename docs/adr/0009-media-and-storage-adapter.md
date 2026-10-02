# ADR 0009 — Media and the `StorageAdapter`

- **Status:** accepted for the MVP (items marked *provisional* await founder confirmation)
- **Date:** 2026-10-01
- **Builds on:** ADR 0002 (Supabase), ADR 0004 (tenancy and authorization), ADR 0007 (publishing), ADR 0008 (block model)

## Context

Sprint 5 adds the first user-uploaded files: an avatar per page and images inside image blocks. Uploads are the classic entry point for malware, decompression bombs, storage abuse and privacy leaks (EXIF/GPS). Published snapshots are immutable and the last 10 versions can be restored, so a file referenced by a retained snapshot must outlive its removal from the draft. The Supabase Free plan gives 1 GB of storage and 5 GB of egress per month and has **no image transformation** (it is a Pro feature; the pinned CLI's `config.toml` says so and the local stack has no `imgproxy` enabled). Vercel functions accept at most 4.5 MB per request. AGENTS.md requires that the service key is not used to bypass RLS for ordinary user actions and that media stays portable to Cloudflare R2.

## Decision

### Where optimization happens

| Option | Verdict |
|---|---|
| Resize and re-encode in the browser, server only verifies | Rejected as the only step: canvas cannot encode WebP in every browser (Safari falls back to PNG), and a server that does not decode cannot prove the bytes are a valid image or that metadata is gone. |
| **Server-side processing at upload time, after a browser pre-pass** | **Chosen.** |
| Platform optimizer at delivery time (Vercel Image Optimization, Supabase transformations) | Rejected: Supabase transformations are not on Free, Vercel's optimizer is metered per source image and ties delivery to one host. It would also keep multi-megabyte originals in the bucket. |

Pipeline:

1. **Browser pre-pass** (`modules/media/client-prepare.ts`): decodes the chosen file, applies the crop, scales the result down to at most 2048 px on the long edge and encodes it (WebP where the browser can, otherwise JPEG at quality 0.9). This keeps the request under the 4.5 MB platform limit even for 12 MP phone photos and is where the crop is applied. Nothing from this step is trusted.
2. **Server processing** (`POST /api/media`, `modules/media/process.ts`): validates the real content, decodes with `sharp`, re-encodes every variant as WebP and never stores the bytes it received. Re-encoding from decoded pixels is what removes EXIF/XMP/ICC metadata (including GPS) and neutralizes polyglot files.
3. **Variants are produced synchronously before the asset exists for the editor.** There is no "variant not ready" state on a public page: a draft can only reference an asset in state `ready`, and an asset becomes `ready` only after all its variants are in the bucket. While an upload is running the editor shows progress and blocks publishing.

Variants (all WebP, quality 80, never enlarged for image blocks):

| Kind | Stored variants | Rendered as |
|---|---|---|
| `avatar` | 96, 192 and 288 px squares | `width=96`, `srcset` 1x/2x/3x |
| `image` | widths 448, 896 and 1344 px, limited to the cropped source width (the largest stored width is the *master*) | `srcset` with `w` descriptors, `sizes="(max-width: 480px) calc(100vw - 2rem), 448px"` |

The widths follow the public column (448 px wide on desktop, the viewport minus 32 px on phones): 448 covers 1x, 896 covers 2x and 1344 covers 3x. The set of widths is a pure function of the master width (`imageVariantWidths`), so the snapshot only needs the media id and the master dimensions.

### Validation of real content

`modules/media/policy.ts` is the single upload policy (pure, shared by the browser pre-check, the server and the tests). The file name and the browser MIME type are never consulted.

- Format from magic bytes: JPEG, PNG and WebP only. SVG, GIF, HTML, AVIF/HEIC and everything else are refused. Animated WebP (VP8X animation flag) and APNG (`acTL`) are refused.
- Byte caps: 15 MiB for the file picked in the browser (before the pre-pass), **4 MiB** for the request body the server accepts. Zero-byte files are refused.
- Dimensions are read from the header **before decoding**: at most 4096 px per side and 16,777,216 pixels (pixel-bomb guard), repeated as `limitInputPixels` in the decoder.
- Minimum size: 96 px for avatars; 200 × 100 px for images. Image aspect ratio between 1:3 and 3:1.
- The decoder must succeed and report a single frame; any decoder error is a rejection.

### Bucket, keys and access

- One **public** bucket, `media`, created by migration with `allowed_mime_types = {image/webp}` and a 2 MiB per-object limit. Public pages are static HTML served to anonymous visitors, so signed URLs would have to be regenerated per render and would defeat the CDN.
- Object key: `<media id>/<width>.webp`. The media id is a random UUID generated on the server, so keys are unguessable and nothing can be listed (there is no `select` policy on `storage.objects`).
- **Deviation from the recommended "workspace/profile prefix":** public pages must not expose workspace or page identifiers (ADR 0007). Ownership lives in the `media_assets` table instead, which is what the policies, quota and cleanup read. A purge never needs to list a prefix because the table knows every key.
- Keys are immutable: replacing an image creates a new asset and a new key. Objects are uploaded with a one-year `Cache-Control` (`max-age=31536000`).
- Drafts and snapshots store only the media id and dimensions. The URL is built at render time by `publicMediaUrl()` from `NEXT_PUBLIC_MEDIA_BASE_URL` (or, by default, the Supabase public object path), so moving to R2 is a copy of the bucket plus one configuration value.

### Who may write: attested uploads without the service key

Uploads run as the signed-in user. Because that same JWT could call the Storage API directly, the database has to tell "bytes our server validated" from "bytes someone posted with a valid session". The server therefore signs what it validated:

1. `register_media_asset(media id, page, kind, width, height, variants, signature)` — called as the user. The database checks membership and role (owner, admin, editor), that the workspace is writable, the upload rate limit and the storage quota, and verifies an HMAC-SHA256 signature over those exact values with a secret it reads from Supabase Vault (`media_signing_secret`). The row is created as `pending`.
2. The server uploads each variant with the user's session. The only `insert` policy on `storage.objects` accepts an object in `media` when its name is a variant of a `pending` asset created by the caller. Nothing else can be written, by anyone, with a user token.
3. `activate_media_asset(media id, signature)` — a second signature; the database also checks that every registered variant object exists. The asset becomes `ready`.

A forged direct upload has no `pending` row to match and is rejected by RLS. A forged `register` call has no valid signature (`LK060`). The signing secret (`MEDIA_SIGNING_SECRET` on the server, the same value in Vault) can only attest uploads; it grants no access to data. `fail_media_asset` lets the uploader mark its own pending asset as failed. There is no `update` or `delete` policy on `storage.objects` for user tokens.

*Alternative rejected:* writing objects with the secret/service key after authorizing the user in the application. It is simpler, but it bypasses RLS for an ordinary user action, which AGENTS.md §11 forbids.

### `StorageAdapter`

```ts
interface StorageAdapter {
  put(key, body, { contentType, cacheControl }): Promise<"created" | "exists">; // never overwrites
  remove(keys): Promise<void>;        // idempotent
  list(prefix): Promise<string[]>;    // cleanup and audits
  publicUrl(key): string;
}
```

`createSupabaseStorageAdapter(client)` is the only implementation and the only place that calls the Storage SDK; an in-memory implementation backs the contract test. The uploader gets an adapter bound to the user's session; the cleanup job gets one bound to the secret key (an administrative job, not a user action).

### Lifecycle and cleanup

- An asset belongs to one page. It is **referenced** while the page's draft (avatar or an image block) or any retained publication of that page points at it. References are computed from the documents (`private.media_is_referenced`), never stored, so they cannot drift.
- Removing or replacing an image in the draft deletes nothing. A snapshot that still references the old image keeps working, including after a rollback.
- An asset is a **cleanup candidate** when it is `pending` or `failed` for more than 1 hour, when it is `ready`, unreferenced and older than 24 hours (the grace period covers an uploaded image not yet saved in the draft and the undo window), or when its page was soft-deleted and its `purge_after` has passed.
- `claim_media_cleanup(limit)` (service role only) locks the page row, re-checks the references and moves candidates to `deleting`; `runMediaCleanup()` removes the objects through the adapter; `finish_media_cleanup(ids)` deletes the rows. Every step can be repeated.
- `media_assets` references the page with `on delete restrict`: a page cannot be purged while it still owns objects.
- **Trigger:** `/api/jobs/media-cleanup` with `Authorization: Bearer <CRON_SECRET>`: `GET` for Vercel Cron, `POST` for manual runs. GET is the only state-changing GET route in the product and is gated by the same secret. One run processes up to 10 batches of 50 assets, stopping early when the backlog is empty or a batch has a failure. No queue was added.
- **Scheduler (decided 2026-10-02):** Vercel Cron, once a day (the Hobby plan limit; enough, since orphans become candidates only after 24 hours). Vercel Cron calls with `GET` and sends `Authorization: Bearer <CRON_SECRET>` when that variable is set, so the route will also accept `GET` with the same secret check, and `vercel.json` will declare the daily cron. The alternatives were rejected:
  - GitHub Actions on a schedule would put the secret in a second place and spend the free private-repository minutes that CI already uses.
  - `pg_cron` + `pg_net` would need the secret in the Vault and an HTTP call back to the application, because objects cannot be deleted from SQL.

  **Implemented on 2026-10-02:** `apps/web/vercel.json` schedules `0 6 * * *` (06:00 UTC, 03:00 in Brasília; Hobby runs it at some point within that hour).

### Quota

- New entitlement `storage_mb` (Free 20, Pro 100, Agency 500 — *provisional*, commercial hypotheses in `lib/product.ts`). Resolved through `modules/entitlements` in the application and `private.entitlement_int` in the database; no plan name is compared anywhere.
- Usage = bytes of `pending` and `ready` assets that are referenced or younger than the 24-hour grace period. Orphans stop counting once they are cleanup candidates, so removing images frees space without waiting for the job.
- `register_media_asset` locks the workspace row and rejects an upload that would exceed the quota (`LK010`, detail `storage_mb`) or the rate of 60 uploads per workspace per hour (`LK061`).
- The editor shows "espaço usado" and the quota-reached state.

### Crop

Applied in the browser before upload: fixed 1:1 for the avatar; original, 1:1, 4:3, 16:9 or 4:5 for image blocks. The crop dialog is operated with three range inputs (zoom, horizontal, vertical), which work with keyboard, touch and pointer; dragging the image is an enhancement. The geometry is a pure function (`cropRect`). No image-editing dependency.

### Dependency: `sharp`

- **Need:** decode and re-encode on the server (validity, metadata stripping, consistent WebP output).
- **Maintenance and license:** actively maintained, Apache-2.0; prebuilt binaries (libvips, LGPL, dynamically linked).
- **Cost:** it was already installed as an optional dependency of Next.js 16 (`sharp@^0.35.4`); declaring it (`^0.35.5`) adds no package. Server only, never in a browser bundle. Around 40–120 ms per upload.
- **Security posture:** input is bounded before decoding (bytes, dimensions, pixels) and the decoder runs with `limitInputPixels` and `failOn: "error"`.
- **Exit path:** it is used in one file (`modules/media/process.ts`) behind a function that takes bytes and returns variants.

## Alternatives considered

- **Private bucket with signed URLs:** needed only for private content; public pages are public.
- **Reference-counting table (`media_references`) maintained by triggers:** faster lookups but a second source of truth that can drift from the documents. The computed check is bounded (one draft and at most 10 snapshots per page).
- **Keeping the original file:** would allow re-cropping later but multiplies storage and keeps metadata at rest. Not kept.
- **AVIF variants:** better compression, much slower encoding on a serverless request. Deferred.

## Consequences

- Deploying needs three operational steps besides the migration: the Vault secret `media_signing_secret`, `MEDIA_SIGNING_SECRET` on the server with the same value, and (for cleanup) `CRON_SECRET` plus the existing `SUPABASE_SECRET_KEY`. Without the signing secret uploads fail visibly ("unavailable"); nothing else is affected.
- Transparent PNG logos keep their transparency only in browsers that can encode WebP in canvas; elsewhere the pre-pass flattens them onto white.
- Page duplication (Sprint 7) must copy assets or widen the "same page" rule for references.
- The variant plan is part of the storage contract: the renderer derives the file names from the master width. Changing the widths later needs the old files to be produced again (or the plan to be versioned per asset) before the constants change.
- Egress grows with visits: see `docs/SUPABASE_CAPACITY.md` for the measured bytes per variant.
