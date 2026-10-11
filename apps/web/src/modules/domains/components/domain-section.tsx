import { DOMAINS_COPY } from "@/content/pt-BR";
import { formatDateTime } from "@/lib/format-date";
import { UpgradeLink } from "@/modules/billing/components/upgrade-link";
import type { WorkspaceRole } from "@/modules/identity/permissions";
import { can } from "@/modules/identity/permissions";
import { Badge, Notice } from "@/ui";
import { ConfirmDialog } from "@/ui/confirm-dialog";
import { claimDomainAction, removeDomainAction, verifyDomainAction } from "../actions";
import type { DomainRouting } from "../adapter";
import { challengeRecordName, customDomainUrl } from "../hostname";
import { getDomainsAdapter, getDomainsService } from "../server";
import { DOMAIN_RECHECK_LIMIT, type DomainSummary } from "../service";
import { DnsRecordCard, DomainClaimForm, DomainVerifyForm } from "./domain-forms";

const STATUS_TONE = { pending: "neutral", active: "success", lapsed: "warning" } as const;

/**
 * Custom domain of one page, in the page settings (ADR 0016). Every member sees the state; owners
 * and admins change it. What is shown here is only a convenience: every command re-authorizes on
 * the server and in the database, and control of the hostname is decided by the DNS read alone.
 */
export async function DomainSection({ workspaceId, profileId, role, inPlan }: { workspaceId: string; profileId: string; role: WorkspaceRole; inPlan: boolean }) {
  const copy = DOMAINS_COPY;
  const frame = (children: React.ReactNode) => (
    <section className="surface-card grid grid-cols-[minmax(0,1fr)] content-start gap-4 p-5 sm:p-8" aria-labelledby="domain-title">
      <h2 id="domain-title" className="text-xl font-bold">{copy.title}</h2>
      <p className="m-0 text-app-muted">{copy.lead}</p>
      {children}
    </section>
  );

  let found: Awaited<ReturnType<Awaited<ReturnType<typeof getDomainsService>>["get"]>>;
  let service: Awaited<ReturnType<typeof getDomainsService>>;
  try {
    service = await getDomainsService();
    found = await service.get(profileId);
  } catch {
    return frame(<Notice tone="danger">{copy.loadError}</Notice>);
  }
  if (!found.ok) return frame(<Notice tone={found.error === "not_deployed" ? "neutral" : "danger"}>{found.error === "not_deployed" ? copy.notDeployed : copy.loadError}</Notice>);

  const domain = found.value;
  const canManage = can(role, "domains.manage");

  if (!domain) {
    if (!inPlan) return frame(<><Notice>{copy.notInPlan}</Notice><UpgradeLink workspaceId={workspaceId} role={role} reason="custom_domain" /></>);
    return frame(canManage ? <DomainClaimForm action={claimDomainAction.bind(null, profileId)} /> : <p className="m-0 text-app-muted">{copy.viewOnly}</p>);
  }

  const remove = canManage ? (
    <div>
      <ConfirmDialog action={removeDomainAction.bind(null, domain.id)} openLabel={copy.remove.open} openVariant="danger" title={copy.remove.title} confirmLabel={copy.remove.confirm} confirmVariant="danger" cancelLabel={copy.remove.keep}>
        <p className="m-0 text-app-muted">{copy.remove.warning(domain.hostname)}</p>
      </ConfirmDialog>
    </div>
  ) : null;

  // Asked only for a proven domain that does not reach the application yet: what to create in DNS.
  let routing: DomainRouting | null = null;
  if (domain.status === "active" && domain.routing !== "ok" && inPlan) routing = await service.routing(domain.id);

  return frame(
    <>
      <p className="m-0 flex flex-wrap items-center gap-2">
        <b className="break-all">{domain.hostname}</b>
        <Badge tone={STATUS_TONE[domain.status]}>{copy.status[domain.status]}</Badge>
      </p>
      {!inPlan ? <><Notice tone="warning">{copy.suspendedByPlan}</Notice><UpgradeLink workspaceId={workspaceId} role={role} reason="custom_domain" /></> : null}
      {inPlan ? <DomainState domain={domain} routing={routing} hasProvider={getDomainsAdapter() !== null} /> : null}
      {/* One form at one place for every state, so the result of a check stays on screen when the state changes. */}
      {inPlan && canManage && (domain.status !== "lapsed" || domain.lapseReason === "recheck") ? <DomainVerifyForm action={verifyDomainAction.bind(null, domain.id)} label={domain.status === "pending" ? copy.verify.submit : copy.verify.again} /> : null}
      {canManage ? null : <p className="m-0 text-app-muted">{copy.viewOnly}</p>}
      {remove}
    </>,
  );
}

/** What the domain is doing now and what its owner does next. The check itself is the form rendered after this. */
function DomainState({ domain, routing, hasProvider }: { domain: DomainSummary; routing: DomainRouting | null; hasProvider: boolean }) {
  const copy = DOMAINS_COPY;

  if (domain.status === "lapsed") {
    return (
      <div className="grid gap-2">
        <h3 className="text-base font-bold">{copy.lapsed.title}</h3>
        <p className="m-0 text-app-muted">{domain.lapseReason === "recheck" ? copy.lapsed.recheck : copy.lapsed.lead}</p>
      </div>
    );
  }

  if (domain.status === "pending") {
    return (
      <div className="grid gap-3">
        <h3 className="text-base font-bold">{copy.pending.title}</h3>
        <p className="m-0 text-app-muted">{copy.pending.lead}</p>
        <DnsRecordCard record={{ type: "TXT", name: challengeRecordName(domain.hostname), value: domain.challenge }} />
        <p className="m-0 text-sm text-app-muted">{copy.pending.why}</p>
      </div>
    );
  }

  if (domain.routing === "ok") {
    const url = customDomainUrl(domain.hostname);
    return (
      <div className="grid gap-3">
        <h3 className="text-base font-bold">{copy.live.title}</h3>
        <p className="m-0">{copy.live.lead(url)}</p>
        {domain.recheckMisses > 0 ? <Notice tone="warning">{copy.live.proofMissing(Math.max(DOMAIN_RECHECK_LIMIT - domain.recheckMisses, 1))}</Notice> : null}
        {domain.lastCheckedAt ? <p className="m-0 text-sm text-app-muted">{copy.live.checkedAt(formatDateTime(domain.lastCheckedAt))}</p> : null}
        <div><a className="ui-button ui-button-secondary" href={url} target="_blank" rel="noopener noreferrer">{copy.live.open}</a></div>
      </div>
    );
  }

  const records = routing?.state === "pending" ? routing.records : [];
  return (
    <div className="grid gap-3">
      <h3 className="text-base font-bold">{copy.routing.title}</h3>
      {!hasProvider ? <Notice>{copy.routing.noProvider}</Notice> : routing?.state === "conflict" ? <Notice tone="warning">{copy.verify.provenConflict}</Notice> : (
        <>
          <p className="m-0 text-app-muted">{copy.routing.lead}</p>
          {records.length > 0 ? records.map((record) => <DnsRecordCard key={`${record.type}:${record.name}:${record.value}`} record={record} />) : <Notice>{copy.routing.noRecords}</Notice>}
        </>
      )}
      <p className="m-0 text-sm text-app-muted">{copy.routing.keepTxt}</p>
    </div>
  );
}
