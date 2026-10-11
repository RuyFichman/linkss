import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MODERATION_COPY } from "@/content/pt-BR";
import { formatDateTime } from "@/lib/format-date";
import { isUuid } from "@/modules/identity/guard";
import { authorizeWorkspacePage } from "@/modules/identity/page-guard";
import { submitAppealAction } from "@/modules/moderation/actions";
import { canSendAppeal } from "@/modules/moderation/appeals";
import { readPageModeration } from "@/modules/moderation/appeals-server";
import { AppealForm } from "@/modules/moderation/components/appeal-form";
import { Badge, EmptyState, Notice } from "@/ui";

export const metadata: Metadata = { title: "Suspensão da página" };
export const dynamic = "force-dynamic";

/**
 * Why a page is off the air by moderation, and the appeal (ADR 0019). Every member of the
 * workspace reads it; owners and admins appeal. The database answers "not found" to anyone else.
 */
export default async function PageModerationScreen({ params }: { params: Promise<{ workspaceId: string; profileId: string }> }) {
  const { workspaceId, profileId } = await params;
  const access = await authorizeWorkspacePage(workspaceId, "moderation.view");
  if (!access || !isUuid(profileId)) notFound();
  const read = await readPageModeration(profileId);
  if (read.kind === "not_found") notFound();

  const copy = MODERATION_COPY;
  const back = <Link className="ui-button ui-button-secondary" href={`/app/w/${workspaceId}`}>{copy.back}</Link>;
  if (read.kind !== "ok") return <EmptyState title={copy.unavailable.title} description={copy.unavailable.description} action={back} />;
  const { moderation } = read;

  return (
    <section className="grid max-w-3xl gap-6">
      <header className="grid gap-2">
        <p className="m-0 text-sm text-app-muted">{moderation.title}</p>
        <h1 className="m-0 text-3xl font-bold">{copy.heading}</h1>
      </header>

      {moderation.status === "active" ? (
        <>
          <Notice tone="success">{copy.active}</Notice>
          <div>{back}</div>
        </>
      ) : (
        <>
          <div className="surface-card grid gap-3 p-5">
            <h2 className="m-0 text-xl font-bold">{copy.what.title}</h2>
            <p className="m-0">{copy.what.body}</p>
            <dl className="m-0 grid gap-2">
              <div><dt className="text-sm text-app-muted">{copy.what.category}</dt><dd className="m-0 font-bold">{copy.categories[moderation.category ?? "other"]}</dd></div>
              {moderation.suspendedAt ? <div><dt className="text-sm text-app-muted">{copy.what.since}</dt><dd className="m-0 font-bold">{formatDateTime(moderation.suspendedAt)}</dd></div> : null}
            </dl>
            <p className="m-0 text-app-muted">{copy.what.kept}</p>
          </div>

          <div className="surface-card grid gap-4 p-5">
            <h2 className="m-0 text-xl font-bold">{copy.appeal.title}</h2>
            {canSendAppeal(moderation) ? (
              <>
                <p className="m-0">{copy.appeal.lead(moderation.appealsLeft)}</p>
                <AppealForm action={submitAppealAction.bind(null, workspaceId, profileId)} />
              </>
            ) : (
              <p className="m-0">{!moderation.canAppeal ? copy.appeal.editors : moderation.appeals.some((appeal) => appeal.status === "open") ? copy.appeal.waiting : copy.appeal.exhausted}</p>
            )}
          </div>

          {moderation.appeals.length > 0 ? (
            <div className="grid gap-3">
              <h2 className="m-0 text-xl font-bold">{copy.history.title}</h2>
              <ul className="m-0 grid list-none gap-3 p-0">
                {moderation.appeals.map((appeal) => (
                  <li key={appeal.createdAt} className="surface-card grid gap-2 p-5">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={appeal.status === "accepted" ? "success" : appeal.status === "denied" ? "danger" : "warning"}>{copy.history.status[appeal.status]}</Badge>
                      <span className="text-sm text-app-muted">{copy.history.sent(formatDateTime(appeal.createdAt))}</span>
                    </div>
                    {/* Text typed by a member of this workspace and by the platform: rendered as text. */}
                    {appeal.message ? <p className="m-0 whitespace-pre-wrap break-words">{appeal.message}</p> : null}
                    {appeal.response ? <p className="m-0 whitespace-pre-wrap break-words"><b>{copy.history.response}</b> {appeal.response}</p> : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <div>{back}</div>
        </>
      )}
    </section>
  );
}
