# ADR 0022 — Spanish marketing home and the account's language

- **Status:** accepted for implementation on 2026-10-30. Verified on the local stack only. Migration `202610300001` is not applied to production. Nothing in it charges in euros.
- **Related:** ADR 0014 (billing and the price catalogue), ADR 0021 (transactional e-mail)

## Context

The founder will run the first campaigns in Spain and wants the site in Spanish without losing the Portuguese one (2026-10-30). The founder set the prices for that market the same day: Pro 4 € a month or 39 € a year, Agency 10 € a month or 99 € a year.

The product speaks only Brazilian Portuguese. Copy is centralized in `content/pt-BR.ts`, the price catalogue is BRL-only (ADR 0014), and `user_accounts.locale` has existed since Sprint 2 with the value `pt-BR` and nothing that sets it.

Three ways to serve a second language were considered:

- **Language chosen by geolocation:** rejected. Search engines crawl from the United States, a Portuguese speaker in Spain would be stuck with Spanish, and the page could no longer be cached as one document per address.
- **A subdomain (`es.linkfav.com`):** rejected. `next.config.ts` treats every host that is not the product's own as a customer's custom domain (ADR 0016), so it would serve a 404 until the routing changed. The session cookie, the Supabase redirect URLs and the Stripe return addresses would also need a second origin.
- **A path on the same origin (`/es`):** chosen. It keeps one origin and one session, and needs no routing change.

## Decision

### 1. `/es` for the marketing home; the language in the copy, not in the components

`app/(marketing)/es/page.tsx` renders the same `Home` component as `/` with `locale="es-ES"`.

- **Languages:** `lib/locale.ts` lists them (`pt-BR`, `es-ES`), along with the address of each home and of each sign-up form.
- **Copy files:** `content/es-ES.ts` holds the Spanish copy for the home, the gallery, the billing words the home reads and the sign-up form. `content/types.ts` derives each shape from its pt-BR counterpart (`Widen`), so a key missing in Spanish is a type error. `content/marketing.ts` picks the copy for a language.
- **Shared components:** `PlanComparisonTable`, `planHighlightText` and `Dialog` accept their words as an optional argument. The default is the pt-BR copy, so the account area is unchanged.
- **Gallery:** the client component no longer imports copy and receives plain strings. The fifteen example pages stay in English in both languages, as before.
- **Footer:** the Spanish home leaves out the pages that exist only in Portuguese (`/agencias`, `/profissionais`, `/recuperar-acesso`, `/precos`). It still links to `/privacidade` and `/ajuda`, labelled "en portugués" and marked with `hrefLang`. Each home links to the other in the footer.
- **Search engines:** `hreflang` alternates on both homes (`pt-BR`, `es`, `x-default` = `/`), with a canonical address for each.
- **Address:** `es` is in `reserved_slugs` like every top-level route, although an address needs at least three characters.

The document element stays `lang="pt-BR"`, because there is one root layout and moving the language into a dynamic root segment would touch every route. The Spanish home sets `lang="es"` on its own subtree instead. That is valid HTML, screen readers honour it, and search engines read the content and the `hreflang` links. Revisit this when the account area is translated.

### 2. Euro prices are shown, not charged

`MARKET_PRICES["es-ES"]` in `lib/product.ts` holds the founder's amounts. `modules/billing/price-list.ts` gives the home one interface for both markets: amounts, savings, the free-months label and formatting.

- **Brazil:** reads the catalogue unchanged.
- **Spain:** reads `MARKET_PRICES`, formatted the Spanish way ("4 €", no cents on whole amounts).
- **Free-months label:** absent on the Spanish home. The euro yearly prices save 2.25 and 2.1 months, and the existing rule shows the label only when every plan saves the same whole number.

**Nothing charges euros.** Checkout, `plan_prices`, `planForCharge` and the plan screen still use the BRL catalogue. A person who signs up from `/es` and subscribes today is charged in reais on a screen in Portuguese. **Campaigns must not start before euro checkout exists.** That change has to decide:

- how a workspace gets its market;
- how `plan_prices` and the "plan granted is the one whose price was charged" rule handle two currencies;
- whether the Brazilian Stripe account can sell euro subscriptions;
- VAT on digital services to EU consumers.

### 3. The account's language is chosen at sign-up

`/cadastro?idioma=es` shows the form, its validation and its answers in Spanish. Sign-up stays one route, so the proxy, the guest-only redirect and the CAPTCHA CSP need no change.

- **Form and action:** the form sends `locale`. The action accepts only a value from `LOCALES` and passes it to Supabase Auth as user metadata, next to `display_name`.
- **Account row:** `ensure_personal_workspace()` copies it into `user_accounts.locale` when it creates the row. Anything else becomes `pt-BR`, and an existing row is never changed by it.
- **Table check:** `user_accounts_locale_supported` limits the column to the supported values, including the person's own updates.

Nothing reads `user_accounts.locale` yet. It is recorded now so that accounts created from the first campaign already carry their language when the account area and the e-mails are translated.

## Consequences

- A new language means:
  - a value in `LOCALES`, together with the table check;
  - a copy file that satisfies the types in `content/types.ts`;
  - its prices in `MARKET_PRICES`;
  - a page under `app/(marketing)/<code>`, an entry in `HOME_ALTERNATES` and a reserved slug.
- A change to the home's copy, the plan cards or the comparison rows needs its Spanish words in `content/es-ES.ts`, or the typecheck fails.
- The Spanish copy must stay true of the deployed product, like the Portuguese copy (AGENTS.md §10). It leaves Pix out of the highlights but keeps it in the comparison table ("Clave Pix para cobros en Brasil"), because the table is generated from every block type.

### Still in Portuguese for someone who arrives through `/es`

- The confirmation and recovery e-mails. Supabase has one set of templates per project; a `{{ if eq .Data.locale "es-ES" }}` branch can read the new metadata.
- The notices sent through Resend (ADR 0021).
- The sign-in, recovery, confirmation, terms and privacy pages.
- The whole account area, and the visitor-facing words of public pages (copy button, consent notice, report form).
- The "Pular para o conteúdo" link of the auth layout.

### Not done

- Euro checkout.
- A Spanish privacy notice and terms under the GDPR.
- A legal review for selling in Spain.
- Showing the account in Spanish.
- A setting to change the language after sign-up.
- A per-page language for public pages.

## Addendum, 2026-10-30: the account area, the e-mails and a language per public page

Status: accepted, implemented and verified on the local stack only. Migrations `202610300002_page_locale` and `202610300003_mail_locale` are **not applied to production**.

### The language of a request

`modules/identity/locale.ts` (server only) resolves one language per request, in this order:

1. `user_accounts.locale` of the signed-in person;
2. the `x-lnk-locale` header, which `proxy.ts` sets from `?idioma=es` (or `?idioma=pt`) on `/app`, the auth pages and `/auth`;
3. the `lnk_locale` cookie, which `proxy.ts` sets at the same time (httpOnly, one year);
4. `pt-BR`.

`getCopy()` returns the whole copy of that language (`content/copy.ts`, `copyFor`). `content/es-ES.ts` mirrors every export of `content/pt-BR.ts`, and the `Copy` type makes the typecheck fail when one is missing or has another shape.

- Client components read their words with `useCopy(<RECORD>)`. The records are in `content/localized.ts` and `content/public-page-localized.ts`; the latter is the only copy the public page ships to the browser. The language comes from `LocaleProvider`, which the app and auth layouts mount.
- Pure modules take the words as their last parameter, with the Portuguese words as the default.
- **Server Actions never take words from the client.** They call `getCopy()` themselves.
- The app and auth subtrees carry `lang`. The document stays `lang="pt-BR"`.
- Numbers and money keep the pt-BR format (the amounts are still in reais). Country names and long dates follow the language.

The person changes the account language in *Meus dados* (`setAccountLocaleAction`). It writes `user_accounts.locale` and the Auth metadata `locale`, which the confirmation, recovery and e-mail change templates read through `{{ if eq .Data.locale "es-ES" }}`. Their subjects in `config.toml` carry both languages, because Supabase has one subject per template.

### E-mails

`claim_mail_outbox` also returns the recipient's `user_accounts.locale`, and `renderMail` writes in that language (`MAIL_COPY`). The language is read at claim time, like the address.

### A language per public page

- **Column:** `profiles.locale` (`pt-BR` or `es-ES`, check `profiles_locale_supported`).
- **Default:** a new page starts in the language of the account that creates it. The trigger `private.profiles_default_locale` sets it, so no client role executes a function in `private`; without a session the page starts in `pt-BR`.
- **Who changes it:** whoever can edit the page, in the editor's "Página" tab, through the same update policy as the draft. An archived page is frozen.
- **Outside the snapshot:** a change shows without a new publication, and the snapshot format is unchanged. `get_public_page`, `get_public_page_by_domain` and `get_shared_report` return it.
- **What it changes:** only the words the product puts on the page and the shared report: the footer, the report link, the copy button, the form messages, the consent notice, the Open Graph locale and `lang`. What the owner writes is never translated.

### Static on purpose

- **Help center:** `/ajuda` is in Portuguese and `/es/ajuda` in Spanish (`HELP_PATH`).
- **`/precos`:** stays the Portuguese, BRL page. Spain has its prices on `/es`.
- **Root not-found page:** stays Portuguese. Reading the request there would make every static route dynamic, and an address with no page has no language.

### Still in Portuguese

- The platform administration screens.
- The legal texts, `/aceite`, `/denunciar` and `/cookies`.
- The waitlist landings (`/agencias`, `/profissionais`) and `/proto`.
- The error pages of `/[slug]` and `/r`.
- The CSV exports.
- A few editor templates, and the text of the image export screen.

### Change together

- A new copy key needs its words in both copy files.
- A new client component that shows words reads them with `useCopy`.
- A new language means `LOCALES`, the checks on `user_accounts.locale` and `profiles.locale`, a copy file, the Auth templates and the `APP_COPY.pageLocale.options`.
