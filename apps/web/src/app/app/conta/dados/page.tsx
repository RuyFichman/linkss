import { formatDateTime } from "@/lib/format-date";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requestAccountDeletionAction, requestDataAccessAction } from "@/modules/privacy/actions";
import { myLegalHistory, myPrivacyRequests } from "@/modules/privacy/server";
import { getSupabase, resolveAccount } from "@/modules/identity/session";
import { getCopy } from "@/modules/identity/locale";
import { isMissingSchemaError } from "@/lib/supabase/missing-schema";
import { AccountLocaleForm } from "@/modules/identity/components/account-locale-form";
import { MailPreferencesForm } from "@/modules/mail/components/mail-preferences-form";
import { resolveMailConfig } from "@/modules/mail/config";
import Link from "next/link";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getCopy()).MY_DATA_COPY.title };
}
export const dynamic = "force-dynamic";


export default async function MyDataPage({ searchParams }: {
  searchParams: Promise<{ erro?: string }>;
}) {
  const { MAIL_PREFERENCES_COPY, MY_DATA_COPY } = await getCopy();
  const copy = MY_DATA_COPY;
  const status: Record<string, string> = copy.requests.status;
  const reasons: Record<string, string> = copy.requests.reasons;
  const account = await resolveAccount();
  if (account.status === "anonymous") redirect("/entrar?next=/app/conta/dados");
  if (account.status !== "ready") return null;
  const supabase = await getSupabase();
  const [requests, history, preference] = await Promise.all([
    myPrivacyRequests(), myLegalHistory(),
    supabase.from("user_accounts").select("notify_new_leads").eq("id", account.userId).maybeSingle(),
  ]);
  // Before the e-mail migration the column does not exist: the section says so instead of failing.
  const mailDeployed = !(preference.error && isMissingSchemaError(preference.error));
  const notifyNewLeads = preference.data?.notify_new_leads ?? true;
  const { erro } = await searchParams;
  const owned = account.workspaces.filter((workspace) => workspace.role === "owner");

  return (
    <section className="app-shell max-w-4xl">
      <h1 className="text-3xl font-bold">{copy.title}</h1>
      <p className="mt-3 text-app-muted">{copy.lead}</p>
      {erro ? <p role="alert" className="mt-4 text-red-700">{copy.requestFailed}</p> : null}

      <div className="mt-6 grid gap-5">
        <section id="idioma" className="surface-card scroll-mt-4 p-5" aria-labelledby="idioma-titulo">
          <h2 id="idioma-titulo" className="text-xl font-bold">{copy.locale.title}</h2>
          <p className="mt-2 text-sm text-app-muted">{copy.locale.lead}</p>
          <AccountLocaleForm />
        </section>
        <section id="avisos" className="surface-card scroll-mt-4 p-5" aria-labelledby="avisos-titulo">
          <h2 id="avisos-titulo" className="text-xl font-bold">{MAIL_PREFERENCES_COPY.title}</h2>
          <p className="mt-2 text-sm text-app-muted">{MAIL_PREFERENCES_COPY.lead}</p>
          {!mailDeployed ? <p className="mt-3 text-sm">{MAIL_PREFERENCES_COPY.notDeployed}</p> : (
            <>
              {resolveMailConfig().mode === "off" ? <p className="mt-3 text-sm">{MAIL_PREFERENCES_COPY.off}</p> : null}
              <MailPreferencesForm newLeads={notifyNewLeads} />
            </>
          )}
        </section>
        <section className="surface-card p-5">
          <h2 className="text-xl font-bold">{copy.personal.title}</h2>
          <p className="mt-2 text-sm text-app-muted">{copy.personal.lead}</p>
          <form action="/app/conta/dados/exportar" method="post" className="mt-4">
            <button className="ui-button ui-button-secondary" type="submit">{copy.personal.download}</button>
          </form>
        </section>
        <section className="surface-card p-5">
          <h2 className="text-xl font-bold">{copy.workspaces.title}</h2>
          <p className="mt-2 text-sm text-app-muted">{copy.workspaces.lead}</p>
          {owned.length === 0 ? <p className="mt-3 text-sm">{copy.workspaces.none}</p> : (
            <ul className="mt-4 grid gap-3">
              {owned.map((workspace) => (
                <li key={workspace.workspaceId} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-app-border p-3">
                  <span>{workspace.name}</span>
                  <Link className="inline-flex min-h-6 items-center underline underline-offset-4" href={`/app/conta/dados/midia?workspace=${workspace.workspaceId}`}>{copy.workspaces.images}</Link>
                  <form action={"/app/conta/dados/exportar?workspace=" + encodeURIComponent(workspace.workspaceId)} method="post">
                    <button className="ui-button ui-button-secondary" type="submit">{copy.workspaces.download}</button>
                  </form>
                </li>
              ))}
            </ul>
          )}
          <form action={requestDataAccessAction} className="mt-4">
            <button className="ui-button ui-button-secondary" type="submit">{copy.workspaces.requestFull}</button>
          </form>
        </section>
        <section className="surface-card p-5">
          <h2 className="text-xl font-bold">{copy.deletion.title}</h2>
          <p className="mt-2 text-sm text-app-muted">{copy.deletion.lead}</p>
          <form action={requestAccountDeletionAction} className="mt-4">
            <button className="ui-button ui-button-secondary" type="submit">{copy.deletion.submit}</button>
          </form>
        </section>
        <section className="surface-card p-5">
          <h2 className="text-xl font-bold">{copy.requests.title}</h2>
          {requests.length === 0 ? <p className="mt-2 text-app-muted">{copy.requests.empty}</p> : (
            <ul className="mt-3 grid gap-3">
              {requests.map((request) => (
                <li key={request.id} className="rounded-xl border border-app-border p-3">
                  <b>{request.kind === "account_deletion" ? copy.requests.kinds.account_deletion : copy.requests.kinds.data_access} — {status[request.status] ?? request.status}</b>
                  <p className="text-sm text-app-muted">{formatDateTime(request.createdAt)}</p>
                  {request.reason ? <p className="mt-1 text-sm">{reasons[request.reason] ?? copy.requests.reasonFallback}</p> : null}
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="surface-card p-5">
          <h2 className="text-xl font-bold">{copy.acceptances.title}</h2>
          {history.length === 0 ? <p className="mt-2 text-app-muted">{copy.acceptances.empty}</p> : (
            <ul className="mt-3 grid gap-2 text-sm">
              {history.map((item) => <li key={item.kind + item.version + item.acceptedAt}>{item.kind} {item.version} — {formatDateTime(item.acceptedAt)} — hash {item.sha256.slice(0, 12)}…</li>)}
            </ul>
          )}
        </section>
      </div>
    </section>
  );
}
