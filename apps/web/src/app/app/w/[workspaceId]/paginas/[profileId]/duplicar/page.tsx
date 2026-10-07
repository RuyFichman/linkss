import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { APP_COPY } from "@/content/pt-BR";
import { limitUsage } from "@/modules/entitlements";
import { isUuid } from "@/modules/identity/guard";
import { authorizeWorkspacePage } from "@/modules/identity/page-guard";
import { can } from "@/modules/identity/permissions";
import { duplicateProfileAction } from "@/modules/profiles/actions";
import { DuplicateProfileForm } from "@/modules/profiles/components/duplicate-profile-form";
import { copySlug, copyTitle } from "@/modules/profiles/duplicate-naming";
import { fetchWorkspaceSlugs } from "@/modules/profiles/page-list-server";
import { getProfileRepository } from "@/modules/profiles/server";
import { Notice } from "@/ui";

export const metadata: Metadata = { title: "Duplicar página" };

/**
 * Duplication form: what is and is not copied, and the name and address of the new page. The
 * action re-authorizes; this page only decides what to show. A fixed number of queries (page,
 * entitlements, count, addresses) whatever the size of the workspace.
 */
export default async function DuplicateProfilePage({ params }: { params: Promise<{ workspaceId: string; profileId: string }> }) {
  const { workspaceId, profileId } = await params;
  const access = await authorizeWorkspacePage(workspaceId, "profile.view");
  if (!access || !isUuid(profileId)) notFound();

  const repository = await getProfileRepository();
  const source = await repository.findById(profileId);
  if (!source || source.workspaceId !== workspaceId) notFound();

  const back = <p className="mt-6"><Link className="inline-flex min-h-11 items-center font-bold text-app-accent underline" href={`/app/w/${workspaceId}`}>← {APP_COPY.pages.listTitle}</Link></p>;
  const heading = <h1 className="mb-2 text-3xl font-bold">{APP_COPY.duplicate.pageTitle}</h1>;
  if (!can(access.role, "profile.duplicate")) {
    return <div className="mx-auto max-w-2xl">{heading}<Notice tone="warning">{APP_COPY.duplicate.forbidden}</Notice>{back}</div>;
  }

  const [count, entitlements, slugs] = await Promise.all([repository.countLive(workspaceId), repository.entitlements(workspaceId), fetchWorkspaceSlugs(workspaceId)]);
  const usage = limitUsage(entitlements, "max_profiles", count);
  const copy = APP_COPY.duplicate;

  return (
    <div className="mx-auto max-w-2xl">
      {heading}
      <p className="mb-6 text-app-muted">{copy.lead(source.title)}</p>
      {usage.reached ? <Notice tone="warning">{APP_COPY.pages.limitReached(usage.limit)}</Notice> : (
        <div className="grid gap-6">
          <section className="surface-card grid gap-4 p-5 sm:grid-cols-2 sm:p-8" aria-label={copy.pageTitle}>
            <div>
              <h2 className="text-base font-bold">{copy.copiesTitle}</h2>
              <ul className="mt-2 grid list-disc gap-1 pl-5 text-app-muted">{copy.copies.map((item) => <li key={item}>{item}</li>)}</ul>
            </div>
            <div>
              <h2 className="text-base font-bold">{copy.notCopiedTitle}</h2>
              <ul className="mt-2 grid list-disc gap-1 pl-5 text-app-muted">{copy.notCopied.map((item) => <li key={item}>{item}</li>)}</ul>
            </div>
          </section>
          <section className="surface-card p-5 sm:p-8">
            <DuplicateProfileForm action={duplicateProfileAction.bind(null, source.id)} workspaceId={workspaceId} suggestedTitle={copyTitle(source.title)} suggestedSlug={copySlug(source.slug, slugs)} />
          </section>
        </div>
      )}
      {back}
    </div>
  );
}
