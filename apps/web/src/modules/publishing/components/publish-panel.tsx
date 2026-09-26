import Link from "next/link";
import { PUBLISHING_COPY } from "@/content/pt-BR";
import { publicAddressLabel, publicPageUrl } from "@/lib/app-url";
import { formatDateTime } from "@/lib/format-date";
import { publishProfileAction, restorePublicationAction, unpublishProfileAction } from "../actions";
import { publicationState, type PublicationSummary, type PublishTarget } from "../service";
import { Badge } from "@/ui";
import { PublishForm } from "./publish-form";
import { RestoreVersionForm } from "./restore-version-form";
import { UnpublishDialog } from "./unpublish-dialog";

const STATE_TONE = { never: "neutral", live_current: "success", live_outdated: "warning", offline: "warning" } as const;

interface PublishPanelProps {
  target: PublishTarget;
  publications: PublicationSummary[];
  previewHref: string;
  canPublish: boolean;
}

/** Publication status, publish/unpublish controls and version history for one page. */
export function PublishPanel({ target, publications, previewHref, canPublish }: PublishPanelProps) {
  const state = publicationState(target, publications);
  const live = target.livePublicationId !== null;

  return (
    <section className="surface-card grid gap-5 p-5 sm:p-8" aria-labelledby="publishing-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="publishing-title" className="text-xl font-bold">{PUBLISHING_COPY.title}</h2>
        <Badge tone={STATE_TONE[state]}>{PUBLISHING_COPY.badge[state]}</Badge>
      </div>
      <p className="m-0">{PUBLISHING_COPY.state[state]}{live && target.publishedAt ? ` ${PUBLISHING_COPY.liveSince(formatDateTime(target.publishedAt))}` : ""}</p>

      <div className="flex flex-wrap gap-3">
        <Link className="ui-button ui-button-secondary" href={previewHref}>{PUBLISHING_COPY.preview}</Link>
        {live ? (
          <a className="ui-button ui-button-secondary" href={publicPageUrl(target.slug)} target="_blank" rel="noopener" aria-describedby="open-public-hint">
            {PUBLISHING_COPY.openPublic}
          </a>
        ) : null}
      </div>
      {live ? <p id="open-public-hint" className="m-0 -mt-3 break-all text-sm text-app-muted">{publicAddressLabel(target.slug)} · {PUBLISHING_COPY.openPublicHint}</p> : null}

      {canPublish ? (
        <div className="flex flex-wrap items-start gap-3">
          <PublishForm action={publishProfileAction.bind(null, target.id)} draftRevision={target.draftRevision} upToDate={state === "live_current"} hasPublished={publications.length > 0} />
          {live ? <UnpublishDialog action={unpublishProfileAction.bind(null, target.id)} /> : null}
        </div>
      ) : (
        <p className="m-0 text-app-muted">{PUBLISHING_COPY.forbidden}</p>
      )}

      {publications.length > 0 ? (
        <div className="grid gap-3 border-t border-app-border pt-5">
          <h3 className="m-0 text-lg font-bold">{PUBLISHING_COPY.versionsTitle}</h3>
          <p className="m-0 text-sm text-app-muted">{PUBLISHING_COPY.versionsLead}</p>
          <ol className="m-0 grid list-none gap-2 p-0">
            {publications.map((publication) => {
              const isLive = publication.id === target.livePublicationId;
              return (
                <li key={publication.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-app-border p-3">
                  <span className="grid gap-1">
                    <span className="flex flex-wrap items-center gap-2 font-bold">
                      {PUBLISHING_COPY.versionLabel(publication.version)}
                      {isLive ? <Badge tone="success">{PUBLISHING_COPY.versionLive}</Badge> : null}
                    </span>
                    <span className="text-sm text-app-muted">{formatDateTime(publication.createdAt)}</span>
                  </span>
                  {canPublish && !isLive ? <RestoreVersionForm action={restorePublicationAction.bind(null, target.id, publication.id)} version={publication.version} /> : null}
                </li>
              );
            })}
          </ol>
        </div>
      ) : null}
    </section>
  );
}
