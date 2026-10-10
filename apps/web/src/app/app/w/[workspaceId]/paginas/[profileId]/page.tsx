import { resolveBillingMode } from "@/modules/billing/mode";
import { upgradeHref } from "@/modules/billing/presentation";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ANALYTICS_COPY, APP_COPY, EDITOR_COPY, LEADS_COPY, PUBLISHING_COPY } from "@/content/pt-BR";
import { publicAddressLabel, publicPageUrl } from "@/lib/app-url";
import { DomainSection } from "@/modules/domains/components/domain-section";
import { BlockEditor } from "@/modules/editor/components/block-editor";
import { PixelsSection } from "@/modules/pixels/components/pixels-section";
import { isUuid } from "@/modules/identity/guard";
import { authorizeWorkspacePage } from "@/modules/identity/page-guard";
import { can } from "@/modules/identity/permissions";
import { changeProfileSlugAction, deleteProfileAction } from "@/modules/profiles/actions";
import { ArchiveControl } from "@/modules/profiles/components/archive-controls";
import { ChangeSlugDialog } from "@/modules/profiles/components/change-slug-dialog";
import { DeleteProfileDialog } from "@/modules/profiles/components/delete-profile-dialog";
import { ProfileAvatar } from "@/modules/profiles/components/profile-avatar";
import { copyReviewKinds, needsCopyReview } from "@/modules/profiles/copy-review";
import { fetchDuplicatedFrom } from "@/modules/profiles/page-list-server";
import { getProfileRepository } from "@/modules/profiles/server";
import { publishProfileAction } from "@/modules/publishing/actions";
import { PublishPanel } from "@/modules/publishing/components/publish-panel";
import { documentFromDraft } from "@/modules/publishing/document";
import { PublicPageView } from "@/modules/publishing/render/public-page-view";
import { getPublishingRepository } from "@/modules/publishing/server";
import { PUBLICATION_HISTORY_LIMIT } from "@/modules/publishing/service";
import { Badge, Notice } from "@/ui";

export const metadata: Metadata = { title: "Editar página" };

const STATUS_TONE = { draft: "neutral", published: "success", archived: "warning" } as const;

/**
 * Page editor. Who can edit gets the editor workspace (UX-072): block editor with autosave, uploads,
 * appearance and live preview, with publishing history, address and deletion in its "Página" tab.
 * Everyone else (and archived pages) gets a read-only preview above the same settings. Every command
 * re-authorizes on the server; this page only decides what to show for the caller's role.
 */
export default async function ProfileEditorPage({ params, searchParams }: { params: Promise<{ workspaceId: string; profileId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { workspaceId, profileId } = await params;
  const query = await searchParams;
  const justDuplicated = typeof query.duplicada === "string";
  const access = await authorizeWorkspacePage(workspaceId, "profile.view");
  if (!access || !isUuid(profileId)) notFound();

  // RLS returns only pages of the caller's workspaces; the URL's workspace must also match.
  const profiles = await getProfileRepository();
  const profile = await profiles.findById(profileId);
  if (!profile || profile.workspaceId !== workspaceId) notFound();
  const [publications, entitlements, duplicatedFrom] = await Promise.all([
    (await getPublishingRepository()).listPublications(profile.id, PUBLICATION_HISTORY_LIMIT),
    profiles.entitlements(workspaceId),
    fetchDuplicatedFrom(profile.id),
  ]);

  // An archived page is frozen (ADR 0012): no editor and no publishing until it is unarchived.
  const archived = profile.status === "archived";
  const canEdit = can(access.role, "profile.edit_content") && !archived;
  const canArchive = can(access.role, "profile.archive");
  const canDuplicate = can(access.role, "profile.duplicate");
  const reviewKinds = needsCopyReview({ duplicatedFrom, publicationCount: publications.length }) ? copyReviewKinds(profile.blocks) : null;
  const canChangeSlug = can(access.role, "profile.change_slug");
  const canDelete = can(access.role, "profile.delete");
  const canPublish = can(access.role, "profile.publish") && !archived;
  const showBadge = !entitlements.features.remove_badge;
  const basePath = `/app/w/${workspaceId}/paginas/${profile.id}`;
  const live = profile.livePublicationId !== null;

  const copyReview = reviewKinds && !archived ? (
    <section className="grid gap-2 rounded-2xl border border-app-warning/40 bg-app-warning/10 p-4 sm:p-5" aria-labelledby="copy-review-title">
      <h2 id="copy-review-title" className="text-lg font-bold">{APP_COPY.duplicate.review.title}</h2>
      {reviewKinds.length > 0 ? (
        <>
          <p className="m-0">{APP_COPY.duplicate.review.lead}</p>
          <ul className="m-0 grid list-disc gap-1 pl-5 font-bold">{reviewKinds.map((kind) => <li key={kind}>{APP_COPY.duplicate.review.items[kind]}</li>)}</ul>
        </>
      ) : <p className="m-0">{APP_COPY.duplicate.review.generic}</p>}
      <p className="m-0 text-sm text-app-muted">{APP_COPY.duplicate.review.until}</p>
    </section>
  ) : null;

  const settings = (
    <>
      {archived ? null : (
        <PublishPanel
          target={{ id: profile.id, workspaceId: profile.workspaceId, slug: profile.slug, draftRevision: profile.draftRevision, livePublicationId: profile.livePublicationId, publishedAt: profile.publishedAt }}
          publications={publications}
          previewHref={`${basePath}/previa`}
          canPublish={canPublish}
          editorManaged={canEdit}
        />
      )}

      <section className="surface-card grid gap-3 p-5 sm:p-8" aria-labelledby="results-title">
        <h2 id="results-title" className="text-xl font-bold">{ANALYTICS_COPY.title}</h2>
        <p className="m-0 text-app-muted">{ANALYTICS_COPY.lead}</p>
        <div><Link className="ui-button ui-button-secondary" href={`${basePath}/resultados`}>{ANALYTICS_COPY.open}</Link></div>
      </section>

      <section className="surface-card grid gap-3 p-5 sm:p-8" aria-labelledby="leads-title">
        <h2 id="leads-title" className="text-xl font-bold">{LEADS_COPY.title}</h2>
        <p className="m-0 text-app-muted">{LEADS_COPY.lead}</p>
        <div><Link className="ui-button ui-button-secondary" href={`${basePath}/contatos`}>{LEADS_COPY.open}</Link></div>
      </section>

      <section className="surface-card grid gap-3 p-5 sm:p-8" aria-labelledby="address-title">
        <h2 id="address-title" className="text-xl font-bold">{APP_COPY.profileForm.slug}</h2>
        <p className="m-0 break-all font-bold">{publicAddressLabel(profile.slug)}</p>
        {canChangeSlug ? <div><ChangeSlugDialog action={changeProfileSlugAction.bind(null, profile.id)} currentSlug={profile.slug} workspaceId={workspaceId} /></div> : <p className="m-0 text-app-muted">{APP_COPY.slugChange.forbidden}</p>}
      </section>

      <DomainSection workspaceId={workspaceId} profileId={profile.id} role={access.role} inPlan={entitlements.features.custom_domain} />
      <PixelsSection workspaceId={workspaceId} profileId={profile.id} role={access.role} inPlan={entitlements.features.tracking_pixels} />

      {canDuplicate || (canArchive && !archived) ? (
        <section className="surface-card grid gap-3 p-5 sm:p-8" aria-labelledby="manage-title">
          <h2 id="manage-title" className="text-xl font-bold">{APP_COPY.manage.title}</h2>
          <p className="m-0 text-app-muted">{APP_COPY.manage.lead}</p>
          <div className="flex flex-wrap gap-2">
            {canDuplicate ? <Link className="ui-button ui-button-secondary" href={`${basePath}/duplicar`}>{APP_COPY.duplicate.open}</Link> : null}
            {canArchive && !archived ? <ArchiveControl page={profile} /> : null}
          </div>
        </section>
      ) : null}

      {canDelete ? (
        <section className="grid gap-3 rounded-2xl border border-app-danger/30 p-5 sm:p-8" aria-labelledby="danger-title">
          <h2 id="danger-title" className="text-xl font-bold">{APP_COPY.deletePage.open}</h2>
          <p className="m-0 text-app-muted">{APP_COPY.deletePage.warning}</p>
          <div><DeleteProfileDialog action={deleteProfileAction.bind(null, profile.id)} title={profile.title} /></div>
        </section>
      ) : null}
    </>
  );

  if (canEdit) {
    return (
      <BlockEditor
        profileId={profile.id}
        initial={{ title: profile.title, bio: profile.bio, avatarPath: profile.avatarPath, theme: profile.theme, blocks: profile.blocks, revision: profile.draftRevision }}
        livePublicationId={profile.livePublicationId}
        publications={publications}
        canPublish={canPublish}
        publishAction={publishProfileAction.bind(null, profile.id)}
        showBadge={showBadge}
        plansHref={upgradeHref(resolveBillingMode().mode, access.role, workspaceId)}
        address={publicAddressLabel(profile.slug)}
        nav={{
          backHref: `/app/w/${workspaceId}`,
          backLabel: EDITOR_COPY.studio.backToPages,
          links: [
            { href: `${basePath}/resultados`, label: ANALYTICS_COPY.open, icon: "results" },
            { href: `${basePath}/contatos`, label: LEADS_COPY.open, icon: "contacts" },
            { href: `${basePath}/previa`, label: PUBLISHING_COPY.preview, icon: "preview" },
            ...(live ? [{ href: publicPageUrl(profile.slug), label: `${PUBLISHING_COPY.openPublic} (${PUBLISHING_COPY.openPublicHint})`, icon: "external", newTab: true } as const] : []),
          ],
        }}
        notices={
          <>
            {justDuplicated ? <Notice tone="success">{APP_COPY.duplicate.created}</Notice> : null}
            {copyReview}
            <p className="studio-lead">{APP_COPY.draft.notice}</p>
          </>
        }
        settings={settings}
        startOnSettings={query.aba === "pagina"}
      />
    );
  }

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
      <Link className="inline-flex min-h-11 w-fit items-center font-bold text-app-accent underline" href={`/app/w/${workspaceId}`}>← {APP_COPY.pages.listTitle}</Link>
      <header className="flex flex-wrap items-center gap-4">
        <ProfileAvatar title={profile.title} avatarPath={profile.avatarPath} size="lg" />
        <div className="min-w-0">
          <h1 className="text-3xl font-bold break-words">{profile.title}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-app-muted">
            <Badge tone={STATUS_TONE[profile.status]}>{APP_COPY.pages.status[profile.status]}</Badge>
            <span className="break-all">{publicAddressLabel(profile.slug)}</span>
          </p>
        </div>
      </header>

      {justDuplicated ? <Notice tone="success">{APP_COPY.duplicate.created}</Notice> : null}

      {archived ? (
        <section className="grid gap-3 rounded-2xl border border-app-warning/40 bg-app-warning/10 p-4 sm:p-5" aria-labelledby="archived-title">
          <h2 id="archived-title" className="text-lg font-bold">{APP_COPY.pages.status.archived}</h2>
          <p className="m-0">{APP_COPY.archive.notice}</p>
          {canArchive ? <div><ArchiveControl page={profile} /></div> : <p className="m-0 text-app-muted">{APP_COPY.archive.noticeEditor}</p>}
        </section>
      ) : null}

      {copyReview}

      <section className="grid gap-3" aria-label={EDITOR_COPY.preview.title}>
        {archived ? null : <p className="m-0 text-app-muted">{EDITOR_COPY.readOnly}</p>}
        <div className="page-canvas overflow-hidden rounded-2xl border border-app-border">
          <PublicPageView as="div" document={documentFromDraft(profile)} showBadge={showBadge} interactive={false} />
        </div>
      </section>

      <div className="mx-auto grid w-full max-w-3xl gap-6">
        {settings}
      </div>
    </div>
  );
}
