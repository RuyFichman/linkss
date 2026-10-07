import { REPORTS_COPY } from "@/content/pt-BR";
import { formatDateTime } from "@/lib/format-date";
import type { WorkspaceRole } from "@/modules/identity/permissions";
import { can } from "@/modules/identity/permissions";
import { getProfileRepository } from "@/modules/profiles/server";
import { Badge, Notice } from "@/ui";
import { ConfirmDialog } from "@/ui/confirm-dialog";
import { createReportLinkAction, revokeReportLinkAction } from "../actions";
import { availableReportPeriods, sortReportLinks } from "../links";
import { getReportLinksService } from "../server";
import { ReportLinkForm } from "./report-link-form";

const STATUS_TONE = { active: "success", expired: "neutral", revoked: "warning" } as const;

/**
 * Report links of one page, on its results screen (ADR 0013). Owners and admins create, list and
 * revoke; an editor is told who can. What is shown here is only a convenience: every command
 * re-authorizes on the server and in the database. Two queries (the plan and the links).
 */
export async function ReportLinksSection({ workspaceId, profileId, role }: { workspaceId: string; profileId: string; role: WorkspaceRole }) {
  const copy = REPORTS_COPY;
  const frame = (children: React.ReactNode) => (
    <section className="surface-card grid grid-cols-[minmax(0,1fr)] content-start gap-4 p-5 sm:p-6" aria-labelledby="report-links-title">
      <h2 id="report-links-title" className="text-xl font-bold">{copy.title}</h2>
      <p className="m-0 text-app-muted">{copy.lead}</p>
      {children}
    </section>
  );
  if (!can(role, "reports.view")) return frame(<p className="m-0 text-app-muted">{copy.viewOnly}</p>);

  let entitlements: Awaited<ReturnType<Awaited<ReturnType<typeof getProfileRepository>>["entitlements"]>>;
  let links: Awaited<ReturnType<Awaited<ReturnType<typeof getReportLinksService>>["list"]>>;
  try {
    [entitlements, links] = await Promise.all([(await getProfileRepository()).entitlements(workspaceId), (await getReportLinksService()).list(profileId)]);
  } catch {
    return frame(<Notice tone="danger">{copy.loadError}</Notice>);
  }
  if (!links.ok) return frame(<Notice tone={links.error === "not_deployed" ? "neutral" : "danger"}>{links.error === "not_deployed" ? copy.notDeployed : links.error === "forbidden" ? copy.errors.forbidden : copy.loadError}</Notice>);

  const inPlan = entitlements.features.shareable_reports;
  const periods = availableReportPeriods(entitlements.limits.analytics_days);
  const sorted = sortReportLinks(links.value, new Date());
  const hasActive = sorted.some((link) => link.status === "active");

  return frame(
    <>
      {inPlan && periods.length > 0 && can(role, "reports.create") ? (
        <ReportLinkForm action={createReportLinkAction.bind(null, profileId, entitlements.limits.analytics_days)} periods={periods} />
      ) : (
        // The reason in words, with no upgrade flow: plans are assigned by the product until billing exists.
        <Notice>{copy.notInPlan}</Notice>
      )}

      <div className="grid gap-3">
        <h3 className="text-base font-bold">{copy.list.title}</h3>
        {!inPlan && hasActive ? <Notice tone="warning">{copy.list.suspendedByPlan}</Notice> : null}
        {sorted.length === 0 ? <p className="m-0 text-app-muted">{copy.list.empty}</p> : (
          <>
            <ul className="m-0 grid list-none gap-3 p-0">
              {sorted.map((link) => {
                const name = link.label ?? copy.list.unlabeled;
                const when = formatDateTime(link.status === "revoked" ? link.revokedAt : link.expiresAt);
                return (
                  <li key={link.id} className="grid gap-3 rounded-2xl border border-app-border p-4 sm:flex sm:flex-wrap sm:items-center sm:justify-between">
                    <div className="grid min-w-0 gap-1">
                      {/* Owner-supplied text: rendered as text. */}
                      <b className="break-words">{name}</b>
                      <span className="flex flex-wrap items-center gap-2 text-sm text-app-muted">
                        <Badge tone={STATUS_TONE[link.status]}>{copy.list.status[link.status](when)}</Badge>
                        <span>{copy.list.period(link.periodDays)}</span>
                        <span>{copy.list.created(formatDateTime(link.createdAt))}</span>
                      </span>
                    </div>
                    {link.status === "active" && can(role, "reports.revoke") ? (
                      <ConfirmDialog action={revokeReportLinkAction.bind(null, link.id)} openLabel={copy.revoke.open} openAriaLabel={copy.revoke.openFor(name)} openVariant="danger" title={copy.revoke.title} confirmLabel={copy.revoke.confirm} confirmVariant="danger" cancelLabel={copy.revoke.keep}>
                        <p className="m-0 text-app-muted">{copy.revoke.warning}</p>
                      </ConfirmDialog>
                    ) : null}
                  </li>
                );
              })}
            </ul>
            <p className="m-0 text-sm text-app-muted">{copy.list.noLinkAgain}</p>
          </>
        )}
      </div>
    </>,
  );
}
