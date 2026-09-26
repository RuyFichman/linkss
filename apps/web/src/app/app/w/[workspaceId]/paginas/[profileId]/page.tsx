import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { APP_COPY } from "@/content/pt-BR";
import { isUuid } from "@/modules/identity/guard";
import { authorizeWorkspacePage } from "@/modules/identity/page-guard";
import { can } from "@/modules/identity/permissions";
import { changeProfileSlugAction, deleteProfileAction, updateProfileContentAction } from "@/modules/profiles/actions";
import { ChangeSlugDialog } from "@/modules/profiles/components/change-slug-dialog";
import { DeleteProfileDialog } from "@/modules/profiles/components/delete-profile-dialog";
import { ProfileAvatar } from "@/modules/profiles/components/profile-avatar";
import { ProfileContentForm } from "@/modules/profiles/components/profile-content-form";
import { getProfileRepository } from "@/modules/profiles/server";
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

  const canEdit = can(access.role, "profile.edit_content");
  const canChangeSlug = can(access.role, "profile.change_slug");
  const canDelete = can(access.role, "profile.delete");

  return (
    <div className="mx-auto grid max-w-3xl gap-6">
      <Link className="inline-flex min-h-11 w-fit items-center font-bold text-app-accent underline" href={`/app/w/${workspaceId}`}>← {APP_COPY.pages.listTitle}</Link>
      <header className="flex flex-wrap items-center gap-4">
        <ProfileAvatar title={profile.title} size="lg" />
        <div className="min-w-0">
          <h1 className="text-3xl font-bold">{profile.title}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-app-muted">
            <Badge tone={STATUS_TONE[profile.status]}>{APP_COPY.pages.status[profile.status]}</Badge>
            <span>{APP_COPY.pages.publicAddressPrefix}{profile.slug}</span>
          </p>
        </div>
      </header>

      <section className="surface-card grid gap-4 p-5 sm:p-8" aria-labelledby="content-title">
        <h2 id="content-title" className="text-xl font-bold">Conteúdo básico</h2>
        {canEdit ? <ProfileContentForm action={updateProfileContentAction.bind(null, profile.id)} title={profile.title} bio={profile.bio} /> : <p className="m-0 text-app-muted">{APP_COPY.errors.forbidden}</p>}
      </section>

      <section className="surface-card grid gap-3 p-5 sm:p-8" aria-labelledby="address-title">
        <h2 id="address-title" className="text-xl font-bold">{APP_COPY.profileForm.slug}</h2>
        <p className="m-0 break-all font-bold">{APP_COPY.pages.publicAddressPrefix}{profile.slug}</p>
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
