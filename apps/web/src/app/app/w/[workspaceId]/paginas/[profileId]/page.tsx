import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { APP_COPY, EDITOR_COPY } from "@/content/pt-BR";
import { publicAddressLabel } from "@/lib/app-url";
import { BlockEditor } from "@/modules/editor/components/block-editor";
import { isUuid } from "@/modules/identity/guard";
import { authorizeWorkspacePage } from "@/modules/identity/page-guard";
import { can } from "@/modules/identity/permissions";
import { changeProfileSlugAction, deleteProfileAction } from "@/modules/profiles/actions";
import { ChangeSlugDialog } from "@/modules/profiles/components/change-slug-dialog";
import { DeleteProfileDialog } from "@/modules/profiles/components/delete-profile-dialog";
import { ProfileAvatar } from "@/modules/profiles/components/profile-avatar";
import { getProfileRepository } from "@/modules/profiles/server";
import { publishProfileAction } from "@/modules/publishing/actions";
import { PublishPanel } from "@/modules/publishing/components/publish-panel";
import { documentFromDraft } from "@/modules/publishing/document";
import { PublicPageView } from "@/modules/publishing/render/public-page-view";
import { getPublishingRepository } from "@/modules/publishing/server";
import { PUBLICATION_HISTORY_LIMIT } from "@/modules/publishing/service";
import { Badge } from "@/ui";

export const metadata: Metadata = { title: "Editar página" };

const STATUS_TONE = { draft: "neutral", published: "success", archived: "warning" } as const;

/**
 * Page editor (Sprint 4): block editor with autosave and live preview, then publishing history,
 * address and deletion. Every command re-authorizes on the server; this page only decides what to
 * show for the caller's role.
 */
export default async function ProfileEditorPage({ params }: { params: Promise<{ workspaceId: string; profileId: string }> }) {
  const { workspaceId, profileId } = await params;
  const access = await authorizeWorkspacePage(workspaceId, "profile.view");
  if (!access || !isUuid(profileId)) notFound();

  // RLS returns only pages of the caller's workspaces; the URL's workspace must also match.
  const profiles = await getProfileRepository();
  const profile = await profiles.findById(profileId);
  if (!profile || profile.workspaceId !== workspaceId) notFound();
  const [publications, entitlements] = await Promise.all([
    (await getPublishingRepository()).listPublications(profile.id, PUBLICATION_HISTORY_LIMIT),
    profiles.entitlements(workspaceId),
  ]);

  const canEdit = can(access.role, "profile.edit_content");
  const canChangeSlug = can(access.role, "profile.change_slug");
  const canDelete = can(access.role, "profile.delete");
  const canPublish = can(access.role, "profile.publish");
  const showBadge = !entitlements.features.remove_badge;
  const basePath = `/app/w/${workspaceId}/paginas/${profile.id}`;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
      <Link className="inline-flex min-h-11 w-fit items-center font-bold text-app-accent underline" href={`/app/w/${workspaceId}`}>← {APP_COPY.pages.listTitle}</Link>
      <header className="flex flex-wrap items-center gap-4">
        <ProfileAvatar title={profile.title} size="lg" />
        <div className="min-w-0">
          <h1 className="text-3xl font-bold break-words">{profile.title}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-app-muted">
            <Badge tone={STATUS_TONE[profile.status]}>{APP_COPY.pages.status[profile.status]}</Badge>
            <span className="break-all">{publicAddressLabel(profile.slug)}</span>
          </p>
        </div>
      </header>

      {canEdit ? (
        <>
          <p className="m-0 rounded-xl border border-app-border bg-app-surface-soft p-3 font-bold">{APP_COPY.draft.notice}</p>
          <BlockEditor
            profileId={profile.id}
            initial={{ title: profile.title, bio: profile.bio, blocks: profile.blocks, revision: profile.draftRevision }}
            livePublicationId={profile.livePublicationId}
            publications={publications}
            canPublish={canPublish}
            publishAction={publishProfileAction.bind(null, profile.id)}
            showBadge={showBadge}
          />
        </>
      ) : (
        <section className="grid gap-3" aria-label={EDITOR_COPY.preview.title}>
          <p className="m-0 text-app-muted">{EDITOR_COPY.readOnly}</p>
          <div className="overflow-hidden rounded-2xl border border-app-border">
            <PublicPageView as="div" document={documentFromDraft(profile)} showBadge={showBadge} interactive={false} />
          </div>
        </section>
      )}

      <div className="mx-auto grid w-full max-w-3xl gap-6">
        <PublishPanel
          target={{ id: profile.id, workspaceId: profile.workspaceId, slug: profile.slug, draftRevision: profile.draftRevision, livePublicationId: profile.livePublicationId, publishedAt: profile.publishedAt }}
          publications={publications}
          previewHref={`${basePath}/previa`}
          canPublish={canPublish}
          editorManaged={canEdit}
        />

        <section className="surface-card grid gap-3 p-5 sm:p-8" aria-labelledby="address-title">
          <h2 id="address-title" className="text-xl font-bold">{APP_COPY.profileForm.slug}</h2>
          <p className="m-0 break-all font-bold">{publicAddressLabel(profile.slug)}</p>
          {canChangeSlug ? <div><ChangeSlugDialog action={changeProfileSlugAction.bind(null, profile.id)} currentSlug={profile.slug} workspaceId={workspaceId} /></div> : <p className="m-0 text-app-muted">{APP_COPY.slugChange.forbidden}</p>}
        </section>

        {canDelete ? (
          <section className="grid gap-3 rounded-2xl border border-app-danger/30 p-5 sm:p-8" aria-labelledby="danger-title">
            <h2 id="danger-title" className="text-xl font-bold">{APP_COPY.deletePage.open}</h2>
            <p className="m-0 text-app-muted">{APP_COPY.deletePage.warning}</p>
            <div><DeleteProfileDialog action={deleteProfileAction.bind(null, profile.id)} title={profile.title} /></div>
          </section>
        ) : null}
      </div>
    </div>
  );
}
