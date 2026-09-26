import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PUBLISHING_COPY } from "@/content/pt-BR";
import { isUuid } from "@/modules/identity/guard";
import { authorizeWorkspacePage } from "@/modules/identity/page-guard";
import { getProfileRepository } from "@/modules/profiles/server";
import { documentFromDraft } from "@/modules/publishing/document";
import { PublicPageView } from "@/modules/publishing/render/public-page-view";

export const metadata: Metadata = { title: "Prévia do rascunho", robots: { index: false, follow: false } };

/**
 * Draft preview: the same renderer as the public page, fed from the draft instead of the snapshot.
 * Lives under /app (session required, members only) and is never cached publicly.
 */
export default async function DraftPreviewPage({ params }: { params: Promise<{ workspaceId: string; profileId: string }> }) {
  const { workspaceId, profileId } = await params;
  const access = await authorizeWorkspacePage(workspaceId, "profile.view");
  if (!access || !isUuid(profileId)) notFound();
  const profile = await (await getProfileRepository()).findById(profileId);
  if (!profile || profile.workspaceId !== workspaceId) notFound();

  return (
    <div className="-mx-4 grid gap-0 sm:mx-0">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-app-warning/30 bg-app-warning/10 p-3 font-bold text-app-warning" role="note">
        <span>{PUBLISHING_COPY.previewBanner}</span>
        <Link className="underline" href={`/app/w/${workspaceId}/paginas/${profile.id}`}>{PUBLISHING_COPY.previewBack}</Link>
      </div>
      <div className="overflow-hidden rounded-2xl">
        <PublicPageView as="div" document={documentFromDraft(profile)} showBadge={false} />
      </div>
    </div>
  );
}
