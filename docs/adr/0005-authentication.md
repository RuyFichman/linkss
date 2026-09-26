# ADR 0005 — Authentication

- **Status:** accepted for the MVP
- **Date:** 2026-09-25

## Context

Sprint 2 needs sign-up, email verification, sign-in, sign-out and access recovery for individuals and agency members. ADR 0002 selected Supabase Auth. Recovery must expire and must not reveal whether an email exists (AC3). The app is Next.js 16 (App Router, `proxy.ts`, Server Actions) and must keep secrets out of the browser.

## Decision

### Method

- Supabase Auth with **email + password**. Email confirmation is **mandatory** (`enable_confirmations = true`); an unconfirmed user gets no session, and `ensure_personal_workspace()` additionally refuses unconfirmed callers.
- Password policy: minimum 8 characters with letters and digits (`minimum_password_length = 8`, `password_requirements = "letters_digits"`), mirrored by boundary validation in `modules/identity/auth-validation.ts`; maximum 72 characters (bcrypt input limit).
- `secure_password_change = true`; the recovery session counts as a recent login.
- **Deferred:** OAuth/social login and MFA (TOTP). Both are out of the MVP's Sprint 2 scope; MFA is a Sprint 9+ hardening candidate for owners of agency workspaces.

### Email links: `token_hash` confirmation route

- Confirmation, recovery and email-change emails link to `/auth/confirm?token_hash=…&type=…&next=…` (templates in `supabase/templates/`). The route handler calls `verifyOtp({ type, token_hash })`, which works across devices (no PKCE verifier cookie).
- As a fallback for projects that cannot customize templates, the same route accepts `?code=` and calls `exchangeCodeForSession` (same-browser only).
- Links expire after one hour (`otp_expiry = 3600`) and are single-use. Expired or invalid links redirect to a pt-BR "link expirado" state with a way to request a new one.
- Hosted Free projects on the default SMTP cannot customize templates (Supabase change of 2026-06-03). Staging/production therefore require custom SMTP before external users; the vendor decision (Resend is the candidate) goes through a `MailAdapter` ADR and a data-map update. Until then, only the local mail catcher (Mailpit) is used.
- Known risk: corporate link scanners may pre-fetch GET links and consume the token. Mitigation if observed: turn `/auth/confirm` into a confirmation page whose button POSTs the token.

### Sessions

- Cookie sessions via `@supabase/ssr` with the **publishable** key. Cookies are set only in the Proxy, Route Handlers and Server Actions.
- `apps/web/src/proxy.ts` refreshes the session on every matched request, adds an `x-correlation-id` request header, and redirects unauthenticated requests for `/app/**` to `/entrar?next=<path>`.
- Server identity comes from `supabase.auth.getClaims()` (JWT verified with the project's signing keys) — **never** from `getSession()`, whose cookie contents are not trusted on the server. Every Server Action and Route Handler re-resolves identity; Proxy redirects are a convenience, not the authorization boundary.
- Sign-out is a POST-only Server Action (`signOut`), which clears the cookie session and records `auth.sign_out` beforehand.

### Redirect allowlist

`next` is accepted only if it is a same-origin absolute path under an allowlisted prefix (`/app`, `/redefinir-senha`), contains no scheme, protocol-relative `//`, backslash, control or encoded-slash tricks, and is re-parsed against a fixed dummy origin. Anything else falls back to `/app`. Implemented and tested in `modules/identity/redirects.ts`.

### Neutral responses (anti-enumeration)

- Sign-up with an existing email and recovery for an unknown email return the **same** pt-BR message as success. Supabase already returns an obfuscated success for existing confirmed emails; the app also maps `user_already_exists`, `email_exists` and per-email send throttling to the neutral message.
- Every sign-up and recovery response is padded to a minimum duration (`withMinimumDuration`, 900 ms) so the fast "no email sent" path is in the same timing class as the "email sent" path.
- Sign-in failures always say "E-mail ou senha incorretos". `email_not_confirmed` is only reachable with a correct password, so it may show the "confirme seu e-mail" hint with a neutral resend form.

### Rate limits

Local `config.toml` sets per-IP limits for sign-in/sign-up (30 per 5 minutes), token verification (30 per 5 minutes) and a 60-second minimum between emails to the same address. Hosted projects must be configured to equal or stricter values (checklist in `docs/ENVIRONMENTS.md`). CAPTCHA (Turnstile) is the next control if abuse appears, and app-level rate limiting for Server Actions is part of Sprint 9 hardening.

### Audit and logging

`auth.sign_in`, `auth.sign_out` and `auth.password_reset_completed` are written through the `record_auth_event` RPC (actor is always `auth.uid()`; metadata passes the redaction policy in `modules/audit`). Structured logs carry a correlation ID and an event name, never emails, tokens, passwords or cookies.

### Path to a MailAdapter

Auth emails are sent by Supabase Auth itself (SMTP configuration), so no application mail code exists in Sprint 2. Product emails later go through `MailAdapter`; switching Auth SMTP to the same provider is a configuration change documented in the runbook.

## Consequences

- One provider for identity and data access keeps RLS and JWT claims aligned.
- Changing the password policy requires updating `config.toml`, the hosted settings and the TypeScript validator together.
- Hosted email delivery depends on configuring custom SMTP, which is a new subprocessor decision requiring founder approval.
