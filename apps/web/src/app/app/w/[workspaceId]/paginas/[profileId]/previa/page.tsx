import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getCopy } from "@/modules/identity/locale";
import { isUuid } from "@/modules/identity/guard";
import { authorizeWorkspacePage } from "@/modules/identity/page-guard";
import { getProfileRepository } from "@/modules/profiles/server";
import { documentFromDraft } from "@/modules/publishing/document";
import { PublicPageView } from "@/modules/publishing/render/public-page-view";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getCopy()).PAGE_TITLES.draftPreview, robots: { index: false, follow: false } };
}

/**
 * Draft preview: the same renderer as the public page, fed from the draft instead of the snapshot.
 * Lives under /app (session required, members only) and is never cached publicly.
 */
export default async function DraftPreviewPage({ params }: { params: Promise<{ workspaceId: string; profileId: string }> }) {
  const { PUBLISHING_COPY } = await getCopy();
  const { workspaceId, profileId } = await params;
  const access = await authorizeWorkspacePage(workspaceId, "profile.view");
  if (!access || !isUuid(profileId)) notFound();
  const profiles = await getProfileRepository();
  const profile = await profiles.findById(profileId);
  if (!profile || profile.workspaceId !== workspaceId) notFound();
  const pageLocale = await profiles.locale(profile.id);

  return (
    <div className="-mx-4 grid gap-0 sm:mx-0">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-app-warning/30 bg-app-warning/10 p-3 font-bold text-app-warning" role="note">
        <span>{PUBLISHING_COPY.previewBanner}</span>
        <Link className="underline" href={`/app/w/${workspaceId}/paginas/${profile.id}`}>{PUBLISHING_COPY.previewBack}</Link>
      </div>
      <div className="page-canvas overflow-hidden rounded-2xl">
        <PublicPageView as="div" document={documentFromDraft(profile)} showBadge={false} locale={pageLocale} />
      </div>
    </div>
  );
}
