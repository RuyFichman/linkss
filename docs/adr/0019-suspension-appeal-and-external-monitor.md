# ADR 0019 — Suspension notice and appeal; job heartbeat and external monitor

- **Status:** accepted for implementation on 2026-10-11. Verified on the local stack only. **The migrations are not applied to production, the monitor's secret does not exist, and the workflow has never run against production.**
- **Sprint:** 9 (continuation)
- **Related:** ADR 0015 (moderation, privacy queue), ADR 0018 (retention, erasure), ADR 0014 (billing)

## Context

Two gaps from the Sprint 9 report.

**A suspended page left its owner in the dark.** Moderation could take a page off the air, and the workspace learned of it only by trying to publish ("fale com o suporte", with no support channel). There was no statement of the cause and no way to answer.

**Nothing told anyone when something stopped.** Four scheduled jobs and a payment webhook ran with logs as their only trace, on a hosting plan whose logs are short-lived and have no alerting. `docs/OBSERVABILITY.md` lists thresholds that nobody and nothing was watching. The database runs on the Supabase Free plan, which pauses an idle project: the whole product can stop with no signal.

Constraints: no transactional e-mail exists (SMTP is chosen, not contracted); no monitoring vendor is contracted and none may be added without a decision; `/api/health` must stay cheap, public and secret-free.

## Decision

### 1. The workspace is told, in the product, and may appeal

- `moderation_suspensions` records each suspension with a **category** (the reason of the report it came from, or `other`). `set_profile_moderation` writes it. Pages already suspended get a row by backfill.
- **The notice is in the product**, on every workspace screen (`SuspendedPagesNotice` in the workspace layout): which pages are off the air, with a link to the reason and the appeal. It is the only notice, because the product cannot send e-mail yet; it is shown to every member.
- The screen `/app/w/<workspace>/paginas/<page>/moderacao` (`get_page_moderation`) shows the category, the date, that nothing was deleted and that the draft can still be edited. **It never shows the administrator's justification**, which may describe who reported the page; that stays in the audit trail.
- **Appeal:** an owner or admin sends a text of 20 to 1,000 characters (`submit_moderation_appeal`). One appeal at a time, at most three per suspension. Editors see that an appeal exists and its answer, not its text.
- **Decision:** a platform administrator answers from the reports queue (`decide_moderation_appeal`) with a text of 10 to 500 characters **written for the workspace**. Accepting reactivates the page in the same transaction. Lifting a suspension from the reports queue answers an appeal that was waiting. A decided appeal cannot be reversed; the owner sends another.
- No client role reads the two tables; both sides are served by security-definer functions. Another tenant gets "not found".

*Rejected:* showing the administrator's free text to the owner (leaks reporter details, and was not written for them); an e-mail notice (no mail service yet; it should be added when SMTP exists); a public appeal form without a session (the appeal must come from someone who may speak for the workspace).

### 2. A heartbeat per job, a status route, and GitHub Actions as the monitor

- **Heartbeat.** `job_runs` holds one row per scheduled job, written by the job's own route after each run (`record_job_run`). The migration seeds a baseline, so staleness is measured from the deploy. Writing the heartbeat never changes a job's answer.
- **Status route.** `GET /api/ops/status`, behind `OPS_STATUS_SECRET` (a secret of its own: the monitor only reads and never holds the secret that runs jobs). It reads `get_ops_status` (counts and timestamps, service role only) and evaluates the checks in `modules/ops/status.ts`:
  - *critical* (fails every run): each job's last good run older than 36 hours; billing asked for in the environment but resolved to off; a billing event stuck in `processing` for more than an hour; a billing event with an unknown customer, a mismatch or a conflict in the last 24 hours. An unreachable database fails the route itself.
  - *attention* (fails only the daily run): abuse reports not looked at for 72 hours; appeals waiting for 72 hours; privacy requests open for more than 10 days; pages or workspaces more than 3 days past their purge date.
  The body carries counts, durations and reason codes. Nothing in it names a person, a page or a workspace, so it is safe in the log of a public repository.
- **Monitor.** `.github/workflows/monitor.yml` runs hourly (and once a day with `?attention=1`): the health endpoint, the home page, optionally one published page, and the status route. **A failed run makes GitHub e-mail the person who last changed the schedule; that e-mail is the alert.** No new vendor, no new cost.
- Every check names its runbook; `docs/runbooks/MONITORING.md` lists owner, severity and response for each.

*Rejected:* a monitoring vendor (Sentry, Better Stack, UptimeRobot): a decision the founder has not made, and a subprocessor; they remain the better answer once there is revenue. Putting these checks in `/api/health`: it must stay public and database-free. Reusing `CRON_SECRET` for the monitor: it would put the secret that triggers jobs in a second system.

## Consequences

- The four job routes make one more database call per run. The workspace layout makes one more read per request (suspended pages of that workspace, partial index).
- **The monitor is a safety net, not a guarantee.** GitHub may delay or skip scheduled runs and disables them after 60 days without repository activity; alerts are e-mails to one person; detection takes up to an hour (a missed job, up to 36 hours).
- **Not covered:** error rates and latency of the public renderer (they need a log pipeline); Web Vitals; `rate_limited` spikes; a webhook that never arrives while the daily job also fails silently for less than 36 hours; anything on a customer's custom domain.
- **Open:** e-mail to the owner when a page is suspended or an appeal is answered (after SMTP); retention of lifted suspensions and their appeals (they leave with the page; no purge of their own); a second reviewer for appeals (the administrator who suspended may also decide the appeal); legal review of the notice wording and of the response times in the runbook.
