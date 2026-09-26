import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { APP_COPY } from "@/content/pt-BR";
import { publicAddressLabel } from "@/lib/app-url";
import { isUuid } from "@/modules/identity/guard";
import { authorizeWorkspacePage } from "@/modules/identity/page-guard";
import { can } from "@/modules/identity/permissions";
import { changeProfileSlugAction, deleteProfileAction, updateProfileContentAction, updateSocialLinksAction } from "@/modules/profiles/actions";
import { ChangeSlugDialog } from "@/modules/profiles/components/change-slug-dialog";
import { DeleteProfileDialog } from "@/modules/profiles/components/delete-profile-dialog";
import { LinkListEditor } from "@/modules/profiles/components/link-list-editor";
import { ProfileAvatar } from "@/modules/profiles/components/profile-avatar";
import { ProfileContentForm } from "@/modules/profiles/components/profile-content-form";
import { SocialLinksForm } from "@/modules/profiles/components/social-links-form";
import { getProfileRepository } from "@/modules/profiles/server";
import { PublishPanel } from "@/modules/publishing/components/publish-panel";
import { getPublishingRepository } from "@/modules/publishing/server";
import { PUBLICATION_HISTORY_LIMIT } from "@/modules/publishing/service";
import { Badge } from "@/ui";

export const metadata: Metadata = { title: "Configurações da página" };

const STATUS_TONE = { draft: "neutral", published: "success", archived: "warning" } as const;

export default async function ProfileSettingsPage({ params }: { params: Promise<{ workspaceId: string; profileId: string }> }) {
  const { workspaceId, profileId } = await params;
  const access = await authorizeWorkspacePage(workspaceId, "profile.view");
  if (!access || !isUuid(profileId)) notFound();

  // RLS returns only pages of the caller's workspaces; the URL's workspace must also match.
  const profile = await (await getProfileRepository()).findById(profileId);
  if (!profile || profile.workspaceId !== workspaceId) notFound();
  const publications = await (await getPublishingRepository()).listPublications(profile.id, PUBLICATION_HISTORY_LIMIT);

  const canEdit = can(access.role, "profile.edit_content");
  const canChangeSlug = can(access.role, "profile.change_slug");
  const canDelete = can(access.role, "profile.delete");
  const canPublish = can(access.role, "profile.publish");
  const basePath = `/app/w/${workspaceId}/paginas/${profile.id}`;

  return (
    <div className="mx-auto grid max-w-3xl gap-6">
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

      <PublishPanel
        target={{ id: profile.id, workspaceId: profile.workspaceId, slug: profile.slug, draftRevision: profile.draftRevision, livePublicationId: profile.livePublicationId, publishedAt: profile.publishedAt }}
        publications={publications}
        previewHref={`${basePath}/previa`}
        canPublish={canPublish}
      />

      {canEdit ? <p className="m-0 rounded-xl border border-app-border bg-app-surface-soft p-3 font-bold">{APP_COPY.draft.notice}</p> : null}

      <section className="surface-card grid gap-4 p-5 sm:p-8" aria-labelledby="content-title">
        <h2 id="content-title" className="text-xl font-bold">Conteúdo básico</h2>
        {canEdit ? <ProfileContentForm action={updateProfileContentAction.bind(null, profile.id)} title={profile.title} bio={profile.bio} /> : <p className="m-0 text-app-muted">{APP_COPY.errors.forbidden}</p>}
      </section>

      <section className="surface-card grid gap-4 p-5 sm:p-8" aria-labelledby="social-title">
        <div className="grid gap-1">
          <h2 id="social-title" className="text-xl font-bold">{APP_COPY.social.title}</h2>
          <p className="m-0 text-app-muted">{APP_COPY.social.lead}</p>
        </div>
        {canEdit ? <SocialLinksForm action={updateSocialLinksAction.bind(null, profile.id)} links={profile.socialLinks} /> : <p className="m-0 text-app-muted">{APP_COPY.errors.forbidden}</p>}
      </section>

      <section className="surface-card grid gap-4 p-5 sm:p-8" aria-labelledby="links-title">
        <div className="grid gap-1">
          <h2 id="links-title" className="text-xl font-bold">{APP_COPY.links.title}</h2>
          <p className="m-0 text-app-muted">{APP_COPY.links.lead}</p>
        </div>
        {canEdit ? <LinkListEditor profileId={profile.id} links={profile.blocks} /> : <p className="m-0 text-app-muted">{APP_COPY.errors.forbidden}</p>}
      </section>

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
  );
}
