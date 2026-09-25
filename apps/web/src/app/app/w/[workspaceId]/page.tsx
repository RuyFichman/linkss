import type { Metadata } from "next";
import Link from "next/link";
import { APP_COPY } from "@/content/pt-BR";
import { limitUsage } from "@/modules/entitlements";
import { authorizeWorkspacePage } from "@/modules/identity/page-guard";
import { can } from "@/modules/identity/permissions";
import { ProfileAvatar } from "@/modules/profiles/components/profile-avatar";
import { getProfileRepository } from "@/modules/profiles/server";
import { Badge, EmptyState, Notice } from "@/ui";

export const metadata: Metadata = { title: "Páginas" };

const STATUS_TONE = { draft: "neutral", published: "success", archived: "warning" } as const;

export default async function WorkspaceHomePage({ params, searchParams }: { params: Promise<{ workspaceId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { workspaceId } = await params;
  const query = await searchParams;
  const access = await authorizeWorkspacePage(workspaceId, "profile.view");
  if (!access) return null;

  const repository = await getProfileRepository();
  const [profiles, entitlements] = await Promise.all([repository.listByWorkspace(workspaceId), repository.entitlements(workspaceId)]);
  const usage = limitUsage(entitlements, "max_profiles", profiles.length);
  const mayCreate = can(access.role, "profile.create");
  const notice = query.criada ? APP_COPY.profileForm.created : query.excluida ? APP_COPY.deletePage.deleted : null;

  return (
    <div className="grid gap-6">
      {notice ? <Notice tone="success">{notice}</Notice> : null}
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">{APP_COPY.pages.listTitle}</h1>
          <p className="mt-2 text-app-muted"><Badge tone={usage.reached ? "warning" : "accent"}>{APP_COPY.pages.usage(usage.used, usage.limit)}</Badge></p>
        </div>
        {mayCreate && !usage.reached ? <Link className="ui-button ui-button-primary" href={`/app/w/${workspaceId}/paginas/nova`}>+ {APP_COPY.pages.create}</Link> : null}
      </header>

      {mayCreate && usage.reached ? <Notice tone="warning">{APP_COPY.pages.limitReached(usage.limit)}</Notice> : null}
      {!mayCreate ? <p className="m-0 text-app-muted">{APP_COPY.pages.createForbidden}</p> : null}

      {profiles.length === 0 ? (
        <EmptyState title={APP_COPY.pages.emptyTitle} description={APP_COPY.pages.emptyDescription} action={mayCreate && !usage.reached ? <Link className="ui-button ui-button-primary" href={`/app/w/${workspaceId}/paginas/nova`}>{APP_COPY.pages.create}</Link> : undefined} />
      ) : (
        <ul className="m-0 grid list-none gap-3 p-0">
          {profiles.map((profile) => (
            <li key={profile.id} className="surface-card flex flex-wrap items-center justify-between gap-4 p-4 sm:p-5">
              <div className="flex min-w-0 items-center gap-4">
                <ProfileAvatar title={profile.title} />
                <div className="min-w-0">
                  <h2 className="truncate text-lg font-bold">{profile.title}</h2>
                  <p className="m-0 truncate text-sm text-app-muted">{APP_COPY.pages.publicAddressPrefix}{profile.slug}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Badge tone={STATUS_TONE[profile.status]}>{APP_COPY.pages.status[profile.status]}</Badge>
                <Link className="ui-button ui-button-secondary" href={`/app/w/${workspaceId}/paginas/${profile.id}`} aria-label={`${APP_COPY.pages.settings}: ${profile.title}`}>{APP_COPY.pages.settings}</Link>
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="m-0 text-sm text-app-muted">Páginas em rascunho ainda não ficam visíveis para visitantes. A publicação chega na próxima etapa do produto.</p>
    </div>
  );
}
