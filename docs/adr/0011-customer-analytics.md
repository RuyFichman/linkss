# ADR 0011 — Customer analytics: event contract and pipeline

- **Status:** accepted for the MVP (items marked *provisional* await founder confirmation)
- **Date:** 2026-10-02
- **Builds on:** ADR 0003 (published snapshots), ADR 0004 (tenancy and authorization), ADR 0007 (public renderer), ADR 0008 and ADR 0010 (`data-block-id` / `data-block-type` hooks, form leads), ADR 0009 (attestation with a Vault secret, job pattern)

## Context

Sprint 6 delivers the product's first measurable differentiator: the owner of a page sees visits, actions of value, traffic sources and which blocks are used. Two things are new and carry most of the risk:

- it is the first data collected about **visitors who never signed up**;
- it is the first write path that grows with public traffic instead of with the number of customers, on a database limited to 500 MB (`docs/SUPABASE_CAPACITY.md`).

The public page is static HTML served by ISR, so a view cannot be counted while rendering. Analytics must never sit in a visitor's path (AGENTS.md §6.7, `docs/ARCHITECTURE.md` rule 2), raw events must be short-lived, and the numbers shown must be defensible: a dashboard that looks precise and is wrong is worse than none. Customer analytics (this ADR) stays separate from product analytics (AGENTS.md §12).

## Decision

### Event contract (version 1)

A closed set of types (`public.analytics_event_type`, mirrored by `modules/analytics/contract.ts`):

| Type | Emitted when | Block | Funnel role |
|---|---|---|---|
| `page_view` | the page is shown (load, or restore from the back/forward cache) | — | visit (after the visit rule below) |
| `link_click` | click on a link block | `link` | navigation |
| `social_click` | click on an icon of a social block | `social` | navigation |
| `embed_load` | click on a video/music card | `embed` | engagement |
| `whatsapp_click` | click on a WhatsApp block | `whatsapp` | **action of value** |
| `pix_copy` | click on "Copiar chave" | `pix` | **action of value** |
| `pix_pay_click` | click on the payment link of a Pix block | `pix` | **action of value** |
| `form_submit` | a lead is stored (server side only) | `form` | **action of value** |
| `badge_click` | click on "Criado com Projeto LNK" (UX-025) | — | not shown to the owner |

- **Actions of value** (*provisional*, UX-043) are the four contact/payment actions. Link clicks are reported next to them but separately, so the owner can tell "contact" from "navigation". The catalog is `VALUE_ACTION_TYPES` in the contract module; the database stores types, not the classification, so changing it does not need a migration.
- **Image clicks are not in the contract:** an image block has no link (ADR 0010), so there is nothing to count. The type is added when the block gains a link.
- **`badge_click`** is a visitor interaction on a customer's page, so it travels through this pipeline, but it answers a product question (UX-025: does the badge bring people?). It is aggregated like any other type and is not shown on the owner's dashboard. No other product-analytics event exists here. The product events named in `docs/ux/JOURNEYS.md` (`signup_completed`, `publish_succeeded`, …) remain a documented list for a later sprint.
- **Versioning.** The client batch carries `v: 1`; the server payload carries `v: 1`. A change follows expand/contract (ADR 0008): the database and the Route Handler accept version N+1 one release before the collector sends it. A new event type is a forward-only `alter type … add value` in its own migration, shipped before the client emits it. An unknown version or type is dropped, never stored.

### Form submission is recorded by the database

The form works without JavaScript and the server already knows when a lead is accepted. `submit_form_lead` therefore inserts the `form_submit` event itself, in the same transaction that stores the lead. The collector never sends this type and the ingestion RPC refuses it, so there is exactly one source and no double count. A repeated submission (stored once by the lead dedupe) produces no second event. The insert is wrapped so that an analytics failure can never fail the lead. `form_leads` is not read to count anything.

### Client collector

`modules/analytics/collector.ts`, started by one client component that only the public route `app/[slug]/page.tsx` mounts. `PublicPageView` (shared with the preview and the editor) does not contain it, so the preview, the editor and every `/app` surface emit nothing. As a second line, the collector refuses to start on `/app` and `/proto` paths.

- **Delegation:** one `click` and one `auxclick` listener on `document`, registered as `capture` and `passive`. A passive listener cannot call `preventDefault`; the handler does nothing but read `data-block-id` / `data-block-type` from the closest block and queue an event. Nothing is awaited, no link is rewritten, there is no redirect URL.
- **Transport:** `navigator.sendBeacon` with a `text/plain` body; if it is missing or returns `false`, `fetch` with `keepalive: true`. Both are fire-and-forget. Every error is swallowed.
- **Batching:** events that keep the visitor on the page (Pix copy, embed load) wait up to 1 second and go together; a click that may leave the page flushes at once, and so do `pagehide` and `visibilitychange → hidden`. At most 10 events per batch.
- **Event id:** a UUID generated in the browser (`crypto.randomUUID`, with a `getRandomValues` fallback). It is the deduplication key.
- **Retry:** only the `fetch` path can observe a failure. A network error is retried once after 2 seconds with the same ids; an HTTP response of any status is final. A `sendBeacon` that the browser accepted is never retried.
- **Page view:** once per page load. A prerendered page waits for `prerenderingchange`. A restore from the back/forward cache (`pageshow` with `persisted`) sends a new view, which the visit rule below collapses when it is the same visitor within 30 minutes.
- **In-app browsers** (Instagram, TikTok, WhatsApp custom tabs): the page is torn down as soon as the destination opens. `sendBeacon` is designed for that and is queued by the browser before the navigation; some WebViews drop it. The loss is not measurable from the server and is a documented undercount.
- **What it reads:** the three UTM parameters from `location.search`, the **host** of `document.referrer` (the path and query never leave the browser), and whether the referrer is one of the product's own `/app` pages. It sets no cookie and writes nothing to `localStorage`, `sessionStorage` or IndexedDB.
- **Size budget:** at most 3 KB transferred on top of the Sprint 5 public route. Measured value in `docs/SPRINT_6_REPORT.md`.
- Visitors without JavaScript, with the script blocked, or behind a blocker that drops the request are **not counted**. The dashboard says so in "Como contamos".

### Ingestion endpoint

`POST /api/events` (under the reserved `/api` prefix; no new top-level route).

1. Refuses cross-site requests (`Sec-Fetch-Site`, `Origin`), bodies over 4 KiB and content types other than `text/plain` / `application/json`.
2. Parses and normalizes the batch with the contract module. Anything malformed is dropped.
3. Derives the server-side dimensions (below) and the visitor hashes.
4. Answers **204 with no body before touching the database**. The write runs in `after()`, so a slow or unavailable database cannot delay the response, and the client never depends on the answer.
5. Calls the anonymous RPC with a 2-second timeout. On timeout or error the batch is dropped and logged as `unavailable`; there is no server-side queue or retry (a queue is an extraction signal, not an MVP need).

Logs carry the correlation id and outcome counts only: never the payload, the hash, the referrer or the user agent. The route is never cached and never redirects.

### Write path: an attested anonymous RPC

`public.ingest_analytics_events(p_payload text, p_signature text)`, `security definer`, fixed `search_path`, granted to `anon`. No secret or service key is involved; the Route Handler uses the publishable key like `submit_form_lead`.

- **Attestation.** The server signs the exact payload text with HMAC-SHA256 (`ANALYTICS_SIGNING_SECRET`); the database verifies it with the same value from Supabase Vault (`analytics_signing_secret`), as ADR 0009 does for uploads. Without it, anyone holding the publishable key could call the RPC directly and choose the visitor hash, the country and the source, which would make the per-address limits meaningless. With it, every stored event went through the Route Handler, where the IP address comes from the platform and cannot be spoofed. The secret attests; it grants no access to data.
- **Validation against the live snapshot.** The page must exist, be published and belong to an active workspace. A block event must name a block that is in the **live** publication with the type that matches the event (`link_click` → `link`, and so on). The version-1 legacy social row is accepted under its fixed id. An event for a block that a new publication just removed is rejected: block ids are stable across publications, so this only loses clicks on a block that no longer exists. The publication version is **not** stored (no report uses it and it costs 4 bytes per row).
- **Closed values.** Types, sources and device classes are enums; the country is two capital letters or `ZZ`; UTM values match `^[a-z0-9_.-]{1,40}$`. Nothing else can be written, so there is no free text in the events table.
- **Bounded batch:** 1 to 10 events, payload up to 8 KiB.
- **Answer:** a JSON object with counts (`accepted`, `duplicate`, `repeat`, `rejected`, `rate_limited`) and a status (`ok`, `not_configured`, `forbidden`, `invalid`, `unsupported`, `unavailable`, `shedding`). The Route Handler logs it; the browser never sees it. The signature is checked before anything else, so an unsigned caller learns nothing about pages or limits.

### Deduplication

- **Key:** `(profile_id, event_id)`, the primary key of the raw table. **Window:** as long as the row exists, that is, the raw retention (7 days plus the current day).
- A duplicate is ignored without error (`insert … on conflict do nothing`) and counted as `duplicate` in the answer. Sending the same batch twice stores it once.
- Events that were not stored (a repeat visit, a rate-limited or rejected event) are evaluated again on retry and get the same answer.

### Visit and visitor

- **Visit** (*provisional*, UX-044): a page view from a visitor hash that has no stored page view for the same page in the previous **30 minutes**. A reload, a back/forward restore or a second tab inside the window does not count. Repeat views are not stored at all, which also bounds the table. The window starts at the stored view, so a person who stays active is counted again after 30 minutes.
- **"Unique visitors" is not shown.** A daily hash can only estimate uniques per day, and adding days would count the same person again. The dashboard shows visits and says they are estimates.
- **Hashes** (`modules/analytics/visitor-hash.ts`). All are HMAC-SHA256 keyed by `VISITOR_HASH_SALT`; the IP address and the user agent are inputs only and are never stored.
  - **`visitor_hash`**, stored on events, is two halves of 16 hexadecimal characters. The first is computed from the reporting day, the page address and the IP address: it is the **per-page rate-limit bucket**. The second also includes the user agent: the whole value is the **visit key**, so two devices behind one address (a home network, a mobile carrier's shared address) are two visitors. Because the bucket ignores the user agent, a sender cannot open a new bucket by changing it.
  - **`client_hash`**, 32 characters from the reporting day and the IP address only, is the bucket for the limit **across pages**. It is stored only in `analytics_rate_hits`, a table of counters that has no page, workspace or event column, so it cannot show where anybody went.
  - They **reuse `VISITOR_HASH_SALT`** (ADR 0010) with their own message prefixes. HMAC outputs for different messages are independent: these values cannot be matched with each other or with the lead rate-limit hash of the same person. One secret means one rotation procedure and no extra deploy step.
  - The **day** is in every message: the values of the same person change every day, so nobody can be followed across days.
  - The **page address** is in `visitor_hash`: the same person has unrelated values on two pages, of the same or of different workspaces.
  - Without the salt, or without an address (the local stack sends none), both are absent: every view counts as a visit and all visitors of a page share one rate-limit bucket. Numbers are then inflated and tightly bounded; the Route Handler logs `hashed=false`.

### Dimensions

Stored on `page_view` events only (they describe how the visit arrived). Action events carry the type and the block.

| Dimension | Values | How |
|---|---|---|
| Source | `direct`, `instagram`, `facebook`, `whatsapp`, `tiktok`, `youtube`, `x`, `linkedin`, `telegram`, `google`, `search`, `other` | host of the referrer, classified by `modules/analytics/sources.ts`; when the referrer is empty or unknown, a recognized `utm_source` decides. The host itself is **not stored** |
| UTM `source`, `medium`, `campaign` | `^[a-z0-9_.-]{1,40}$` after lowercasing; anything else becomes absent | at most **20 distinct UTM triples per page per day**; beyond that the view is stored without UTM, so a hostile sender cannot explode cardinality |
| Device | `mobile`, `tablet`, `desktop`, `unknown` | derived from the user agent on the server; the user agent is not stored |
| Country | ISO 3166-1 alpha-2 or `ZZ` (unknown) | `x-vercel-ip-country`; absent on the local stack, where everything is `ZZ` |

**Region is cut** (first item of the sprint's cut list): the `x-vercel-ip-country-region` header is not read.

### Bots, preview and internal traffic

Filtered events are **dropped** by the Route Handler (not stored with a flag) and counted in the log line.

- **Bots and link previews:** an empty user agent, or one matching the list in `modules/analytics/device.ts`: generic `bot`/`crawler`/`spider`, the preview fetchers of WhatsApp, Facebook/Instagram (`facebookexternalhit`, `Facebot`, `meta-externalagent`), Telegram, X, Slack, Discord and LinkedIn, search engines, headless and automation browsers (`HeadlessChrome`, PhantomJS, Puppeteer, Playwright, Selenium), Lighthouse / PageSpeed / GTmetrix, monitors and HTTP libraries. The collector also stays silent when `navigator.webdriver` is true. No dependency: the list is a regular expression with a test table.
- **Preview and editor:** they do not mount the collector (see above).
- **The owner and other signed-in people:** the beacon is a same-origin request, so it carries the product's session cookie. The Route Handler drops the batch when a Supabase session cookie is present. This needs no database round trip and keeps the public page static. It also drops a signed-in person looking at somebody else's page, which is correct for "internal traffic".
- A referrer that is one of the product's own `/app` pages (the "ver página" link of the editor) is dropped too.
- **Known limits:** an owner who opens the page signed out, in another browser or inside an in-app browser is counted. A bot that runs JavaScript with a normal browser user agent is counted until it hits the rate limit. The user-agent list needs maintenance.

### Storage model

- **`analytics_events`** (raw, append-only): `profile_id`, `event_id` (primary key together), `workspace_id`, `event_type`, `block_id`, `occurred_at` (server clock; the client's clock is never trusted), `day` (the reporting day of `occurred_at`), `visitor_hash`, and the four page-view dimensions. Indexes: the primary key (deduplication and the page foreign key), `(workspace_id, profile_id, occurred_at)` (rate limits, the visit rule, live reads and the workspace foreign key) and `(day)` (aggregation and purge). No client role can read or write it.
- **Purge by plain `DELETE`, not time partitioning.** At the measured row size (see Capacity) the table stays in the tens of megabytes at the private-MVP scale. Partitioning would force the partition key into the primary key and add partition maintenance for no benefit at this size. It is the first step to take if the table passes about 5 million live rows.
- **`analytics_daily`** (aggregate): one row per `(profile_id, day, dimension, key, event_type)` with a count, where `dimension` is `total`, `block`, `source`, `utm`, `device` or `country`. One narrow table instead of five, because every dashboard query is "sum the counts of one page (or one workspace) between two days for one dimension". No client role reads it directly: members read through `get_profile_analytics`, which applies the plan's history depth; nobody writes it except the job.
- **`analytics_day_status`**: the watermark. One row per reporting day with when it was aggregated and whether it is final.
- **`analytics_rate_hits`**: counters for the cross-page limit: `client_hash`, a 10-minute window and a count. Deleted after two days.
- **`analytics_settings`**: one row with the reporting timezone, the day collection started and the capacity guard (`max_raw_events`).
- **Sprint 7 (resolved in ADR 0013):** the consolidated dashboard reads `get_workspace_analytics`, which sums `analytics_daily` by `workspace_id` and day (index `(workspace_id, day)`); the read-only report link reads `get_shared_report`, which calls `private.profile_analytics`, the body `get_profile_analytics` now delegates to. Both read raw events only for days that are not final yet, exactly like the per-page read.

### Aggregation and freshness

The scheduler is Vercel Cron on the Hobby plan: up to 100 cron jobs per project, each at most **once a day**, started at some minute within the scheduled hour (checked in the Vercel documentation on 2026-10-02). Hourly aggregation is therefore not available.

- **The job** (`GET /api/jobs/analytics` for the cron at 04:00 UTC, `POST` for manual runs, `CRON_SECRET`, the secret key only inside the job) calls `run_analytics_maintenance()`. It re-aggregates every day that is not final, up to today, marks days before today as **final**, then purges.
- **Idempotent by replacement:** aggregating a day deletes that day's aggregate rows and inserts them again from the raw events in one transaction. Running it twice gives identical rows.
- **Late events do not exist** in the usual sense: an event is stamped when it arrives, with the server clock, so a day that ended cannot receive more events. The job runs at least an hour after São Paulo midnight. An event stored after an aggregation of the *current* day is picked up by the next run, and by the dashboard at once (next item).
- **The dashboard is not delayed by the daily job.** `get_profile_analytics` reads `analytics_daily` for final days and computes the remaining days (normally only today) from the raw events of that one page, which the raw retention and the rate limit keep bounded. "Hoje" is therefore supported, and the maximum delay an owner sees is the time the write takes after the response (seconds). The dashboard shows "atualizado em" with the time of the read.
- **Delayed state:** when the last final day is older than the day before yesterday, the job has missed at least one run. Numbers are still complete (they come from raw events, which are never purged before they are aggregated), and the dashboard says that consolidation is late. If the job stays down for longer than the raw window, the raw table grows; that is the alert in `docs/OBSERVABILITY.md`.
- **Re-aggregating a day by hand** is possible while its raw events exist (`POST /api/jobs/analytics?day=YYYY-MM-DD`); it is refused for a day whose raw events were purged.

### Timezone

One reporting timezone, **`America/Sao_Paulo`**, for every page (*provisional*, UX-045). It is a value in `analytics_settings`, read by `private.analytics_timezone()`; no query has it as a literal.

- **Day:** a calendar day in the reporting timezone. **Today:** the reporting day of the server clock. **Last N days:** the N reporting days that end today, today included (today is partial). The dashboard and the CSV state the timezone and use the same windows.
- An event is assigned to its day when it is stored, and the day is kept in the row and in the aggregates.
- **To support another timezone:** per-workspace timezones need the day computed with the workspace's setting at ingestion and a `timezone` column on the aggregates; days already aggregated cannot be re-bucketed once their raw events are purged, so a change applies from the day it is made. Hourly aggregates would remove that limit at 24 times the rows.

### Rate limiting and abuse

Enforced in the database, counting stored events (rejected events are not stored and do not count):

| Limit (*provisional*) | Value | What it bounds |
|---|---|---|
| Per address, per page | 60 events per 10 minutes | one sender inflating one page; requests without a hash share one bucket per page |
| Per address, all pages | 200 events per 10-minute window and 2,000 per day | one sender spreading a flood over many pages |
| Per page | 2,000 events per hour | many senders inflating one page: at most 48,000 events a day |
| Whole table | ingestion **sheds everything** while the raw table holds about 500,000 events (`analytics_settings.max_raw_events`) | the database itself: about 165 MB of raw events at most |
| Per request | 10 events per batch, 8 KiB per payload at the database, 4 KiB at the Route Handler | the cost of one request |

- An advisory lock per page serializes the per-page counters. The cross-page counter is one upsert per accepted batch; two pages receiving from the same address at the same instant can overshoot it by one batch.
- The capacity guard reads the planner's row estimate (`pg_class.reltuples`), so the check costs nothing. It lags the real count by the autovacuum threshold (about 10%), which is acceptable for a ceiling. When it trips, the Route Handler logs `shedding` at error level: that is an alert, not a normal state (`docs/runbooks/ANALYTICS.md`).
- The per-address limit is by address, not by person: many people behind one shared address (a carrier) visiting the same page within ten minutes share its 60 events. A page that popular is also the page whose numbers matter most; the limit is the first value to revisit with real traffic.

The page keeps working under any of these: the public page is static, and the endpoint answers 204 before the database is involved.

**Still exposed until Sprint 9** (global rate limiting and firewall): a flood of requests to `/api/events` costs function invocations and one short transaction each, even when everything is rejected; a distributed sender with many IP addresses can add fake visits up to the per-page limit, and can fill the raw table up to the capacity guard, at which point real events are shed too until the purge catches up.

### Retention

- **Raw events:** 7 full reporting days plus the current day. The job deletes events older than that, only for days that are final, at most 50,000 rows per run.
- **Aggregates:** 100 days (*provisional*): the largest history any plan shows (90) plus a margin. The **visible** history is the `analytics_days` entitlement that already exists (Free 7, Pro and Agency 90), enforced by `get_profile_analytics` through `private.entitlement_int`; no plan name is compared. Every workspace keeps the 100 days whatever its plan, so an upgrade shows the history at once. Keeping more than any plan can show would only cost space: an active page writes about 6 KB of aggregates a day.
- **Rate-limit counters:** two days.
- **Page soft delete:** ingestion stops (the page is not published) and RLS hides the aggregates. The purge of the page (Sprint 9) cascades to events, aggregates and nothing else is needed.
- **Workspace deletion:** cascade.
- **Sprint 9 export and deletion:** an account export includes `analytics_daily` of its workspaces (aggregates only, no personal data). Raw events hold no identifier that maps to a person once the day's salted hash rotates; a visitor's deletion request cannot be matched to rows and is answered by the 7-day retention. Recorded in `docs/DATA_MAP.md`.

### Capacity

Measured on the local stack with 200,000 synthetic events and 234,000 aggregate rows (`docs/SUPABASE_CAPACITY.md`, "Medido na Sprint 6"): **329 bytes per raw event** (158 of table, 172 of indexes) and **241 bytes per aggregate row** (97 + 144), about 6.3 KB per active page per day. A page with 3,300 events a month holds about 0.3 MB of raw events (8 days) and 0.6 MB of aggregates (100 days); 100 such pages are about 90 MB. The capacity guard caps raw events at about 165 MB whatever the traffic. The upgrade or extraction signal is unchanged: the database at 60% of its quota, or the extraction signals in `docs/ARCHITECTURE.md` (analytics dominating CPU or I/O, tens of millions of events).

### Audit

- `analytics.exported` is written when a CSV is produced (page, window, row count), following `lead.exported`.
- Ingestion, aggregation and reads write no audit event: they are not actions of a person on somebody's data, and the job logs its own outcome.

### Permissions

`analytics.view` and `analytics.export`: owner, admin and editor (ADR 0004 matrix, `modules/identity/permissions.ts`). The numbers are aggregates about the page that every member operates; they contain no visitor data, so there is no reason to restrict the export as leads are restricted.

### Dependencies

None added. Charts are server-rendered SVG and CSS; dates use `Intl`; the user-agent and referrer classification are small tested functions.

## Alternatives considered

- **Counting views in the server render or in `proxy.ts`:** makes the public page dynamic or puts a database write in front of every visit. Rejected by ADR 0007 and by the rule that analytics never sits in the visitor's path.
- **Redirect-through tracking links** (`/r/<id>` that logs and redirects): exact click counts, but the click then depends on our server. Forbidden by `docs/ARCHITECTURE.md`.
- **A first-party cookie or `localStorage` id:** better visit and unique counts. It is a persistent identifier on people who never signed up, and needs consent handling. Rejected; the daily hash is enough for an estimate.
- **Unattested anonymous RPC, limited per page only:** simpler (no secret), but the per-address limits and every server-derived dimension could be forged with the publishable key.
- **One hash of address and user agent for both the visit rule and the rate limit:** the first design. A sender then gets a fresh bucket, and a fresh visit, by changing the user agent on every request. Splitting the hash keeps the visit rule per device and the limit per address.
- **A cross-page limit keyed by a column on the events table:** would need a page-independent identifier next to each event, which is exactly what would let somebody be followed across pages. The separate counter table stores no page.
- **Writing with the secret key from the Route Handler:** removes the attestation, and puts a key that bypasses RLS in a public, anonymous request path. Rejected (AGENTS.md §11).
- **Storing filtered traffic with a flag:** keeps evidence for tuning the filter but doubles the rows that the Free plan has to hold. The log line counts them instead.
- **Storing the referrer host:** more detail for "other" sources, and one more unbounded text column that a sender controls. Deferred.
- **Incremental aggregation on every insert** (counters updated by the ingestion RPC): no job needed, but every visit would update hot rows and deduplication would need its own table. Rejected.
- **`pg_cron` for the job:** would remove the dependency on the hosting scheduler. It is a new moving part on the hosted project and a second pattern next to the media cleanup job. Revisit if the daily cron proves unreliable.
- **An external analytics database (ClickHouse, Tinybird):** the documented scale path, not an MVP need.

## Consequences

- Deploying needs, in order: the migrations, the Vault secret `analytics_signing_secret`, `ANALYTICS_SIGNING_SECRET` on the server with the same value, then the merge. Until all are present the public page works, events are dropped and the dashboard says that results are not available yet.
- The event contract, the SQL enums and validators, the collector and both test suites change together. A new block type that should be counted needs a row in the type-to-block map on both sides.
- Numbers are estimates and are labeled as such: visitors without JavaScript, blocked requests and in-app browsers that drop beacons are missing; an owner who is signed out and a bot with a browser user agent are included.
- The Sprint 5 `submit_form_lead` is replaced by a version that also records the event. Its signature and answers are unchanged, so the Sprint 5 application keeps working against the new schema.
- `VISITOR_HASH_SALT` now protects the lead hash and the analytics hashes; rotating it resets the current day's visit deduplication and rate-limit buckets, and nothing else.
