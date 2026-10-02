import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LEADS_COPY } from "@/content/pt-BR";
import { formatDateTime } from "@/lib/format-date";
import { FORM_FIELDS } from "@/modules/blocks/form";
import { isUuid } from "@/modules/identity/guard";
import { authorizeWorkspacePage } from "@/modules/identity/page-guard";
import { can } from "@/modules/identity/permissions";
import { deleteLeadAction } from "@/modules/leads/actions";
import { DeleteLeadDialog } from "@/modules/leads/components/delete-lead-dialog";
import { getLeadsService } from "@/modules/leads/server";
import type { Lead } from "@/modules/leads/service";
import { getProfileRepository } from "@/modules/profiles/server";
import { EmptyState, Notice } from "@/ui";

export const metadata: Metadata = { title: "Contatos recebidos" };

function leadName(lead: Lead): string {
  return lead.values.name ?? lead.values.email ?? lead.values.phone ?? LEADS_COPY.notProvided;
}

/**
 * Leads received by the forms of one page (Sprint 5, ADR 0010): a plain list, newest first. Not a
 * CRM. Every member of the workspace reads; owners and admins delete and export, and both are
 * re-authorized on the server and in the database.
 */
export default async function LeadsPage({ params }: { params: Promise<{ workspaceId: string; profileId: string }> }) {
  const { workspaceId, profileId } = await params;
  const access = await authorizeWorkspacePage(workspaceId, "leads.view");
  if (!access || !isUuid(profileId)) notFound();
  const profile = await (await getProfileRepository()).findById(profileId);
  if (!profile || profile.workspaceId !== workspaceId) notFound();

  const basePath = `/app/w/${workspaceId}/paginas/${profile.id}`;
  const canManage = can(access.role, "leads.delete");
  let result: Awaited<ReturnType<Awaited<ReturnType<typeof getLeadsService>>["list"]>> | null = null;
  try {
    result = await (await getLeadsService()).list(profile.id);
  } catch {
    result = null;
  }
  const loaded = result?.ok ? result.value : null;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
      <Link className="inline-flex min-h-11 w-fit items-center font-bold text-app-accent underline" href={basePath}>← {LEADS_COPY.back}</Link>
      <header className="grid gap-2">
        <h1 className="text-3xl font-bold break-words">{LEADS_COPY.title}</h1>
        <p className="m-0 font-bold break-words">{profile.title}</p>
        <p className="m-0 text-app-muted">{LEADS_COPY.lead}</p>
        <p className="m-0 text-app-muted">{LEADS_COPY.privacy}</p>
      </header>

      {!loaded ? (
        <Notice tone="danger">{LEADS_COPY.loadError}</Notice>
      ) : loaded.leads.length === 0 ? (
        <EmptyState title={LEADS_COPY.emptyTitle} description={LEADS_COPY.emptyDescription} />
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="m-0 font-bold">{LEADS_COPY.count(loaded.leads.length, loaded.total)}</p>
            {canManage ? (
              // A plain form post: the file downloads without JavaScript, and a POST cannot be triggered by a link.
              <form method="post" action={`${basePath}/contatos/exportar`} className="grid gap-1">
                <button type="submit" className="ui-button ui-button-secondary" aria-describedby="leads-export-hint">{LEADS_COPY.export}</button>
                <span id="leads-export-hint" className="ui-hint">{LEADS_COPY.exportHint}</span>
              </form>
            ) : <p className="m-0 text-sm text-app-muted">{LEADS_COPY.deleteForbidden}</p>}
          </div>
          <ul className="m-0 grid list-none grid-cols-[minmax(0,1fr)] gap-3 p-0">
            {loaded.leads.map((lead) => (
              <li key={lead.id} className="surface-card grid grid-cols-[minmax(0,1fr)] gap-3 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <p className="m-0 text-sm text-app-muted">{LEADS_COPY.received} {formatDateTime(lead.createdAt)}</p>
                  {canManage ? <DeleteLeadDialog action={deleteLeadAction.bind(null, profile.id, lead.id)} name={leadName(lead)} /> : null}
                </div>
                <dl className="m-0 grid gap-2">
                  {FORM_FIELDS.filter((field) => lead.values[field]).map((field) => (
                    <div key={field} className="grid gap-0.5">
                      <dt className="text-sm font-bold text-app-muted">{LEADS_COPY.fields[field]}</dt>
                      {/* Visitor-supplied text: rendered as text, never as markup or as a link. */}
                      <dd className="m-0 whitespace-pre-line break-words">{lead.values[field]}</dd>
                    </div>
                  ))}
                </dl>
                <details className="text-sm">
                  <summary className="min-h-11 cursor-pointer content-center font-bold">{lead.consentGiven ? LEADS_COPY.consent.given(formatDateTime(lead.consentedAt)) : LEADS_COPY.consent.notGiven}</summary>
                  <p className="m-0 text-app-muted">{LEADS_COPY.consent.text}: “{lead.consentText}”</p>
                </details>
                <p className="m-0 text-sm text-app-muted">{LEADS_COPY.expires(formatDateTime(lead.purgeAfter))}</p>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
