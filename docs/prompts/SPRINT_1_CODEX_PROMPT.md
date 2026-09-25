# Sprint 1 — Flows, clickable prototype and product language (Projeto LNK)

## Your role

You are the senior product engineer and product designer on **Projeto LNK**, working on your own in this repository. Sprint 0 is done: the foundation, CI, ADRs and backlog exist. Your job is to carry out **Sprint 1: "definir a experiência antes de implementar o editor inteiro"** (define the experience before building the full editor). Deliver working, demonstrable artifacts, not a plan of what someone could build.

Work without stopping to ask questions. When a decision is ambiguous, pick the option that best fits the documents, log it as *provisional — founder to confirm* in `docs/ux/UX_DECISIONS.md`, and continue.

## 1. Read first (mandatory)

Before you write anything, read these files in full:

- `PLANO_DE_EXECUCAO.md`: §2 premises, §4 technical principles, §5 Definition of Ready, §6 Definition of Done, **Sprint 1**, and also Sprints 2–8. The prototype must anticipate their requirements.
- `PLANO_DE_NEGOCIO.md`: §1–3 (positioning, ICP, jobs to be done, differentiation), §5 (plans), §7 (go-to-market and messages to test), §8 (Experiments A/B/C), §9 (North Star and funnel), §13 (MVP scope and non-goals).
- `BACKLOG.md`, `README.md`, `docs/SPRINT_0_REPORT.md`, `docs/PRODUCT_BRIEF.md`, `docs/ARCHITECTURE.md`, `docs/adr/*`, `docs/DATA_MAP.md`, `docs/THREAT_MODEL.md`, `docs/OBSERVABILITY.md`, `docs/ENVIRONMENTS.md`.
- All of `apps/web` (configs and `src/`).

### Facts you must not get wrong

- **Product:** a Brazilian *mobile conversion hub*, not "a Brazilian Linktree". The differentiators are **multi-profile operation plus results the client can understand** (visit → value action) and Brazilian localization (BRL, Pix, WhatsApp, pt-BR).
- **ICP is a hypothesis.** The primary buyer is social media managers and small agencies with 5–50 client profiles. The secondary group is creators, independent professionals and small local businesses. **No screen, copy or landing page may claim the product is exclusively for agencies.**
- **Value action:** a WhatsApp click, a form submission, opening a schedule, a Pix or payment link, or any other CTA the owner marks. **North Star:** published profiles that generated at least one value action in the last 30 days.
- **Core promise:** publish a professional page in **under 10 minutes**.
- **Plan hypotheses** (live in `apps/web/src/lib/product.ts`): Free (1 profile, platform badge, 7-day analytics), Pro R$ 14,90/month (custom domain, pixels, 90 days, no badge), Agência R$ 57,90/month (10 profiles, team, templates, shareable report), extra profile R$ 6,90/month. Prices are hypotheses. Do not publish them as commitments.
- **Not in the MVP:** own checkout or wallet (Pix means showing a key or linking to a third party; we never hold money), marketplace, CRM, email marketing, native apps, AI as the core pitch, full white-label, public API, real-time collaboration.
- **Stack:** npm workspaces, Next.js 16 App Router, React 19, TypeScript strict, Tailwind CSS v4 (`@import "tailwindcss"` in `globals.css`), Vitest (node environment, `src/**/*.test.ts`), Node 24. Path alias `@/*` → `apps/web/src/*`. `npm run check` runs lint + typecheck + test + build, the same sequence as CI.
- **Codename:** "Projeto LNK" is not an approved brand. Read the display name from `PRODUCT.codename` and never hardcode a brand. Do not copy names, text, visual identity, templates or assets from Liinks, Linktree, Beacons or any competitor.

## 2. Sprint goal and gate

**Goal:** make the critical flows understandable and testable **before** the real editor, schema and renderer exist. The Sprint 0 report says tenant-schema work (Sprint 2) starts only after **signup → publish** and **agency → duplicate → report** are visually defined. Structural UX changes belong in this sprint, not after the editor is built.

**Acceptance criteria (from the execution plan):**

1. Five people can publish a page in the prototype with no verbal instructions.
2. At least four of them finish in under 10 minutes.
3. The prototype includes the **empty, error, saving, saved, preview and published** states.
4. The messaging never claims the product is exclusive to agencies.

Criteria 1 and 2 need real people, so you cannot run them. You **must** ship everything that makes them runnable and measurable: a self-explanatory prototype, built-in timing and event capture, and a test plan. In the report, mark them **"preparado"**, never "atendido".

## 3. Out of scope for this sprint

- No Supabase Auth, and no migrations for users, workspaces, memberships, profiles or blocks (that is Sprint 2).
- No real publishing, snapshots or cache (Sprint 3). No real analytics ingestion (Sprint 6). No billing, custom domains or pixels (Sprint 8). No media upload (Sprint 5).
- **Only exception:** waitlist storage for the landing page (D7).
- Do not build the production editor. The prototype editor is an interaction model with mocked persistence. Write it cleanly anyway, because some parts will graduate (see §5).

## 4. Deliverables

### D1 — User journeys → `docs/ux/JOURNEYS.md`

Cover two journeys as Mermaid flowcharts, including branches for errors, empty states and abandonment:

- **J1 (individual):** signup → onboarding (goal + template + slug) → editing → preview → publish → share link → analytics.
- **J2 (agency):** workspace switch → client list → new profile (blank, from a template, or by duplicating an existing profile) → editing → publish → create a read-only report link for the client → client views the report.

For each step, include a table with: user goal, route or screen, primary action, possible failure, state shown, **product event name** (for the Sprint 6 taxonomy and the Definition of Ready), and a time budget. The J1 budgets must add up to less than 10 minutes.

### D2 — Wireframes → `docs/ux/WIREFRAMES.md`

Do this **before** the high-fidelity work, so layout decisions are made on purpose. Draw an annotated low-fidelity ASCII wireframe for each key screen, in both **mobile (~390 px)** and **desktop (~1280 px)** widths. Annotate the hierarchy, the primary action, where every required state appears, and what changes between breakpoints. Put each wireframe inside a fenced code block.

### D3 — High-fidelity clickable prototype → `apps/web/src/app/proto/**`

This is the main deliverable. Write all UI text in pt-BR, keep it navigable end to end, and make it responsive.

**Prototype mechanics**

- Keep state in `localStorage` under a versioned key (`lnk-proto:v1`). It must be SSR-safe: hydrate after mount, with no hydration errors. Provide a visible "Reiniciar protótipo" action.
- Provide two seed scenarios, selectable at `/proto`:
  - "Novo usuário" (empty).
  - "Agência com 3 clientes": fictional pt-BR businesses with realistic data. No real people or brands.
- Add a **debug panel** (open with `?debug=1` or a keyboard shortcut; hidden by default, so participants don't see it). It must be able to force a save error, a slow save, a publish error, analytics with no data, and analytics with zero in the period. Every required state must be demonstrable on demand.
- Add **usability-test instrumentation**, stored only in the browser, with no third-party analytics. Record timestamped events: `session_started`, `signup_completed`, `template_selected`, `slug_chosen`, `block_added`, `block_edited`, `preview_opened`, `publish_clicked`, `publish_succeeded`, `publish_failed`, `error_shown`, `report_link_created`. Compute **time from session start to first publish**. The debug panel shows the timeline and lets the facilitator copy it as JSON.
- Every `/proto` route gets `robots: { index: false, follow: false }` and a small, persistent "Protótipo" badge. Do not link the prototype from the landing page.

**Required screens and routes** (you may rename, but document the final routes in the README)

1. `/proto`: index with scenario selection, reset, and entry points for J1 and J2.
2. `/proto/cadastro`: name, email and password. Show inline validation, loading and error states. Simulate a Google sign-in button as a disabled "em breve" option only if it helps; don't fake an OAuth flow.
3. `/proto/onboarding`:
   - Page goal: e.g. "vender pelo WhatsApp", "captar contatos", "divulgar conteúdo", "receber agendamentos".
   - Template suggestions based on that goal.
   - **Slug selection with live validation:** normalization (lowercase, accents removed, hyphens), invalid characters, length, reserved words (`admin`, `api`, `proto`, `app`, `login`, …), taken, and available. Each message must be clear and say what to do next.
4. **Editor** `/proto/editor/[profileId]`, the core of the sprint:
   - **Desktop:** block list and editing on the left, a **persistent live phone preview** on the right, and a theme panel.
   - **Mobile:** one column with an "Editar | Visualizar" toggle and a sticky bottom bar showing save status and the Publish action.
   - **Block types:** link, text, social icons, WhatsApp, Pix/payment link, simple form, image, video/embed, separator.
     - Fully interactive: link, text, social, WhatsApp, Pix and separator.
     - Simplified fields are fine for the rest: image comes from a gallery of sample images (no upload), video/embed takes a YouTube/Vimeo URL and renders a placeholder, and the form has a fixed set of fields plus configurable consent text.
   - **Block operations:** add, using a picker grouped by intent ("Converter", "Conteúdo", "Redes"); edit; **reorder with accessible "move up/down" buttons** (pointer drag is optional and needs no library); duplicate; show/hide; delete with an "Desfazer" toast.
   - **Value action:** WhatsApp, Pix and form blocks count as value actions by default. A link block can be marked "contar como conversão/ação de valor". Make this visible in the editor, because analytics depends on it.
   - **URL handling:** normalize URLs (add `https://` when the scheme is missing). **Block** `javascript:`, `data:`, `vbscript:` and `file:`.
   - **WhatsApp:** Brazilian number with `+55`, optional prefilled message, generates a correctly encoded `https://wa.me/` link.
   - **Pix:** key type plus key and a "copiar chave" action, and/or a third-party payment link. Never imply the platform processes payments.
   - **Save status** (a single shared component): `Salvando…` → `Salvo`, or `Não foi possível salvar — tentar novamente`. **There must never be a false success.** "Alterações não publicadas" is a separate state from "salvo".
   - **Theme:** template presets, accent color, font pairing chosen from **system font stacks**, button style (filled, outline, soft; radius), and background. **Switching templates must never delete blocks or content**, and the UI must say so.
5. **Preview and publish:**
   - A full-screen preview.
   - A pre-publish checklist: valid slug, at least one visible block, and a value action present. A missing value action warns but doesn't block.
   - A confirmation step, a publishing state, and publish error and success states.
   - The success screen shows the public URL, a copy action and share suggestions.
   - The profile status distinguishes **rascunho**, **publicado**, and **publicado com alterações pendentes**.
6. **Public page** `/proto/p/[slug]`: rendered by the provisional `BioPage` renderer (see §5). The Free plan shows a discreet "Criado com {PRODUCT.codename}" badge. If the slug hasn't been published, show a "página não publicada" state. Unknown slugs get their own 404 state.
7. **Analytics** `/proto/analytics/[profileId]` (mock data):
   - Period selector (7/30/90 days). On Free, anything beyond 7 days shows an explanatory lock, not a hard sell.
   - KPIs: visits, value actions, conversion rate.
   - **Funnel:** visit → click → value action.
   - Ranking of blocks.
   - Traffic sources: Instagram, TikTok, WhatsApp, direto, outros, plus UTM.
   - The page must **visibly distinguish "no data yet"** ("Sem dados ainda — compartilhe seu link") **from "zero in the period"**. Include loading and error states.
   - Show a timezone label (America/Sao_Paulo) and pt-BR number and date formatting.
8. **Agency workspace**, e.g. `/proto/w/[workspaceId]/perfis`:
   - Workspace switcher ("Pessoal" ↔ an agency workspace).
   - Profile list with search, status chips, 30-day visits and actions per profile (a basic consolidated view), plan usage ("3 de 10 perfis"), archive, and an empty state.
   - New profile via three options: blank, from a template, or **duplicate an existing profile**. The duplicate dialog must say what gets copied (blocks, theme) and what doesn't (analytics, custom domain, pixels, report links).
9. **Client report:**
   - The agency creates a read-only link for one profile and period, with an expiration date and a **revoke** action. The list of active links shows each link's status.
   - `/proto/r/[token]` is the page the client sees. It uses plain language, e.g. "Sua página recebeu 1.240 visitas e gerou 87 conversas no WhatsApp". It shows the agency name and period, and **no internal settings and no data from other profiles**.
   - Include expired and revoked states.
10. `/proto/tokens`: a reference page showing the design tokens and every component state (see D4).
11. *(Stretch — only if everything above is complete)* "Equipe" screen with Owner/Admin/Editor roles and an invitation that expires or can be revoked.

### D4 — Minimal design tokens and states

- Implement the tokens in `apps/web/src/app/globals.css` with Tailwind v4 `@theme`, replacing the Sprint 0 variables (`--background`, `--accent`, and so on) without leaving broken references.
- Cover color, typography (scale and weights), spacing, radius, shadow, motion (durations and easing), and **semantic** tokens: surface, text, muted, border, accent, success, warning, danger, focus ring.
- **Keep two layers separate:**
  - **App tokens** for the product chrome.
  - **Bio-page theme tokens**, which users customize (e.g. `--page-bg`, `--page-text`, `--page-font`, `--btn-bg`, `--btn-text`, `--btn-radius`, `--btn-style`). The renderer consumes only this second layer.
- Define interaction states for every interactive primitive: default, hover, **focus-visible**, active, disabled, loading, error, success.
- Build the accessible primitives under `apps/web/src/ui/`: Button, IconButton, TextField/Field (label + hint + error), Select, Switch, Dialog/Sheet, Toast (with an action), Badge/StatusChip, SaveStatus, EmptyState, Skeleton.
- Document everything in `docs/ux/DESIGN_TOKENS.md`, including **measured contrast ratios** for each text/background pair. WCAG AA is the minimum for app chrome, and for the default theme of every template.
- Dark mode is **not** required.

### D5 — Five provisional templates → `apps/web/src/modules/editor/templates/`

Store the templates as typed data (theme + seed blocks + intended value action + target use case). Each one must be clearly different, not a recolor, and use only theme tokens the model supports. Suggested set (adjust with a recorded justification):

1. **Local business via WhatsApp** (salon, barbershop, restaurant): WhatsApp, schedule link, address/map.
2. **Creator / infoprodutor**: video, lead form or checkout link, social.
3. **Independent service professional** (photographer, personal trainer, nutritionist): booking link + WhatsApp. No regulated or result-guarantee claims.
4. **Small shop / e-commerce**: catalog link, Pix/payment link, WhatsApp.
5. **Event / artist / launch**: tickets link, VIP-list form, social.

All sample content is fictional pt-BR. Applying a template to an existing profile follows the rule "never delete the user's blocks": decide whether it changes only the theme or merges seed blocks, and log the decision.

### D6 — Product language → `docs/ux/CONTENT_GUIDE.md`

- **Voice and tone:** pt-BR, second person ("você"), direct, no technical jargon, action verbs on CTAs.
- **Glossary:** decide on and justify the user-facing term for each concept: página vs. perfil, bloco, publicar, rascunho, ação de valor (user-facing: "conversão"? "resultado"? — choose, justify and apply consistently), workspace (user-facing: "espaço"? "conta da agência"?), relatório.
- **Microcopy for every state:** empty, loading, saving, saved, save error, publishing, published, pending changes, publish error, no data, zero, expired, revoked.
- **Error message pattern:** what happened + what to do next. Never blame the user, and never reveal whether an email already exists.
- **Formatting:** currency, numbers, dates, timezone.
- **Forbidden claims:** "exclusivo para agências"; guaranteed results; features outside the MVP scope; fake social proof.
- Centralize **shared** microcopy (save/publish states, generic errors) in one module, e.g. `apps/web/src/content/pt-BR.ts`. Screen-specific copy can stay inline.

### D7 — Waitlist landing page with an open ICP

- **Routes:** `/` (neutral message; replaces the Sprint 0 page), `/agencias` and `/profissionais`. The two segment variants follow Experiment B in the business plan and share components. Use the message hypotheses from business plan §7, adapted per segment.
- **Rules:**
  - No fake testimonials, logos or metrics.
  - No prices shown as commitments. "Planos em reais" is fine.
  - Every feature mentioned must be in the MVP scope, with launch-status language ("em construção", "piloto").
  - Primary CTA: "Entrar na lista" / "Quero participar do piloto".
- **Form fields:** name, email, optional WhatsApp, segment (agency/social media, freelancer, creator/infoprodutor, local business, other), how many profiles/clients they manage (ranges), current tool, how much they would pay per month (ranges), interest in a pilot, and **LGPD consent that is unchecked by default**, linking to `/privacidade` (a provisional notice clearly marked "versão provisória").
- **Hidden fields:** variant, UTM parameters and referrer.
- **Server Action:**
  - Server-side validation.
  - Honeypot plus a minimum time-to-submit.
  - **A duplicate email returns the same success response** (no enumeration).
  - Success, validation error and unavailable states.
  - **Never log personal data.**
- **Storage** behind a `WaitlistStore` interface in `apps/web/src/modules/waitlist/`:
  - `memory` implementation: dev and test.
  - `supabase` implementation: server-only, using `SUPABASE_SECRET_KEY`; never import it from client code.
  - If the store is not configured in production, **fail closed** with a visible error. Never show success for data that wasn't saved.
  - Selection through a new env var (e.g. `WAITLIST_STORE=memory|supabase`), documented in `.env.example`.
- **Migration:** add `supabase/migrations/<timestamp>_waitlist_signups.sql` with the table, a unique index on `lower(email)`, created_at, variant/UTM columns, **RLS enabled with no anon/authenticated policies** (only the server writes), and a comment on retention. Do not run the migration and do not provision anything.
- **Docs and metadata:** add the waitlist row to `docs/DATA_MAP.md`. Add metadata/Open Graph for the landing pages. Keep them light: static rendering except the action, no heavy images, no external font fetch.

### D8 — Research kit → `docs/research/`

- **`INTERVIEW_SCRIPT.md`**:
  - Scripts for the business plan's Experiment A: 20 agency/social media interviews and 10 individual-professional interviews.
  - A screener and a consent-to-record script.
  - **Questions about past behavior only** (current tool, cost, update process, number of clients, how they report results to clients). **Never "você usaria?"**
  - A note-taking template.
  - pt-BR recruitment messages for Instagram DM, LinkedIn and WhatsApp.
  - The green-light signals (10 of 20 describe recurring pain, 6 accept a pilot, 3 would pay or leave a deposit).
  - Pilot recruiting starts now (execution plan §8). The interviews run in parallel and do not block the build.
- **`USABILITY_TEST_PLAN.md`**:
  - 5 participants: at least 3 from the agency/social media ICP and at least 1 individual.
  - **T1:** sign up and publish your own page.
  - **T2 (agency participants):** create a client profile from a template or by duplicating, publish it, and create a report link.
  - Rules: no verbal instructions; think-aloud; a facilitator script with neutral prompts.
  - How to reset the prototype and export the debug-panel JSON.
  - Metrics: success, time to publish, errors, points of hesitation. Success criteria: 5/5 publish and at least 4 in under 10 minutes.
  - A severity scale and a results table template.
  - **Decision rules:** which findings trigger structural changes before Sprint 2.

### D9 — Sprint report and handoff

- **`docs/SPRINT_1_REPORT.md`**, in the same format as `SPRINT_0_REPORT.md`: decisions, an acceptance-criteria table (status + evidence, honest), deliverables, pending items, and:
  - **"Implicações para a Sprint 2+":** the entities and fields the UX now requires. At minimum:
    - workspace, and membership with roles;
    - profile with status draft/published/pending changes/archived;
    - slug rules and the reserved list;
    - block types and their fields, including the value-action flag;
    - the theme model;
    - template and duplication (a deep copy with no shared mutable content);
    - report link with expiration and revocation;
    - plan usage and entitlements that appear in the UI.
  - **"Perguntas para o founder":** the provisional decisions that need confirmation.
- **`docs/ux/UX_DECISIONS.md`**: a log with ID, decision, alternatives considered, rationale, how it will be validated, and status.
- **`BACKLOG.md`:** check only the Sprint 1 items that are actually done. **"Testar o protótipo com cinco pessoas" stays unchecked.**
- **`README.md`:** add the routes (landing pages, prototype, debug panel) and how to run a usability session.

## 5. Code architecture rules

| Location | Contents | Future |
|---|---|---|
| `src/app/(marketing)/` | landing pages and `/privacidade` | stays |
| `src/app/proto/` | prototype routes and layout (noindex, badge, debug panel) | throwaway |
| `src/prototype/` | mock store, seeds, simulated auth, failure injection, test instrumentation | throwaway |
| `src/ui/` | token-driven accessible primitives | graduates |
| `src/content/` | shared pt-BR microcopy | graduates |
| `src/modules/editor/model/` | **provisional** types for Block, Theme, PageDocument; pure functions: reducer (add/edit/move/duplicate/toggle/delete/undo), URL normalization, WhatsApp link builder, slug validation, template application and duplication | graduates in Sprint 4 |
| `src/modules/editor/templates/` | the 5 templates as typed data | graduates in Sprint 5 |
| `src/modules/publishing/render/` | `BioPage`: **a pure, server-renderable component** that receives a `PageDocument` + theme and has no dependency on the prototype store, the editor or `localStorage` | graduates in Sprint 3 |
| `src/modules/waitlist/` | validation, `WaitlistStore`, implementations | stays |

- `src/modules/**` and `src/ui/**` **must never import** from `src/prototype/**` or `src/app/proto/**`.
- Keep the domain logic in pure `.ts` files so Vitest (node environment) can test it.
- Use Server Components by default. Add `"use client"` only where interaction needs it.
- **Dependencies:** assume **no network access**. Add no new runtime dependencies. Do not use `next/font/google` (it downloads at build time); use system font stacks. No drag-and-drop, chart or form libraries: draw the funnel and simple bars with HTML/CSS/SVG. If something truly needs a new dependency, don't add it; record it as a recommendation in the report.
- **Do not:** use `any`, `@ts-ignore` or `eslint-disable` to get past a check; change `tsconfig`, the ESLint config or the CI to relax rules; delete Sprint 0 content (except replacing the `/` placeholder); touch `.npm-cache/`.
- **Git:** this folder currently has **no initialized repository**. In Sprint 0, `git init` inside the Codex sandbox hit an ownership conflict. **Do not run `git init`, and do not change git configuration.** Leave the changes in the working tree.

## 6. Quality bar (Definition of Done, applied to the prototype)

- **Breakpoints:** mobile 360–430 px and desktop ≥ 1280 px, with no horizontal scroll. Also check ~768 px.
- **Accessibility:** complete keyboard navigation (including editor block operations and dialogs), visible focus, focus that returns after closing dialogs and sheets, labels on every field, errors linked via `aria-describedby`, save and publish status announced through `aria-live`, AA contrast, `prefers-reduced-motion` respected, touch targets ≥ 44 px, `lang="pt-BR"`.
- No hydration errors or React warnings in the console on the main routes.
- The `BioPage` renderer is light: no client JS needed to show content, and no layout shift from images (fixed dimensions/aspect-ratio).
- **Vitest tests (minimum):**
  - editor reducer: every operation plus undo of a deletion;
  - URL normalization and blocking of dangerous schemes;
  - WhatsApp link builder: BR numbers with and without formatting, message encoding;
  - slug validation: normalization, reserved, taken, length and characters;
  - integrity of the 5 templates: they validate against the types, have unique IDs, and each has at least one value action;
  - duplication with a **deep copy** (no shared references);
  - applying a template without losing blocks;
  - waitlist validation, including the honeypot and minimum time;
  - telling "no data" from "zero" in the analytics mock;
  - time-to-publish calculation.
- `npm run check` passes at the end, with zero warnings (`--max-warnings=0`).

## 7. Work order

1. Read everything in §1. In your first reply, write a short execution plan (a checklist with the files you will create), then **continue without waiting for approval**.
2. D1 journeys + D6 glossary (draft) → D2 wireframes.
3. D4 tokens + `src/ui` primitives + `/proto/tokens`.
4. Model (`modules/editor/model`) + templates (D5) + `BioPage` renderer, **with tests**.
5. Prototype J1 with every state and the debug panel/instrumentation → J2 (workspace, duplication, report).
6. D7 landing + waitlist.
7. D8 research kit.
8. D9 report, decisions, backlog and README.
9. Run `npm run check` at the end of steps 3, 4, 5, 6 and 8, and fix everything before moving on.

**If you're running short on time, cut breadth, never states or accessibility.** Cut order:

1. Stretch "Equipe" screen.
2. Secondary analytics widgets.
3. Simplified blocks (video, image, form).
4. The `/agencias` and `/profissionais` variants (keep `/`).
5. Templates 4 and 5.

J1 with every required state, J2 through the report, the tokens, and D1/D2/D8/D9 are non-negotiable.

## 8. Final response format

1. **Summary** (5 lines at most).
2. **How to run:** commands, the URL of each route, how to open the debug panel, how to switch scenarios and reset.
3. **Deliverable → file map** (D1–D9).
4. **Acceptance-criteria table:** criterion | status (atendido / preparado / parcial / não atendido) | evidence.
5. **Provisional decisions** awaiting the founder's confirmation.
6. **Known gaps and risks**, including anything cut and why.
7. **Result of the last `npm run check`:** lint, typecheck, number of tests, build.

Do not claim that a check, test or tool ran unless it did. If something failed, show the relevant output.
