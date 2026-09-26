import type { Metadata } from "next";
import Link from "next/link";
import { APP_COPY } from "@/content/pt-BR";
import { limitUsage } from "@/modules/entitlements";
import { authorizeWorkspacePage } from "@/modules/identity/page-guard";
import { createProfileAction } from "@/modules/profiles/actions";
import { CreateProfileForm } from "@/modules/profiles/components/create-profile-form";
import { getProfileRepository } from "@/modules/profiles/server";
import { Notice } from "@/ui";

export const metadata: Metadata = { title: "Nova página" };

export default async function NewProfilePage({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  const back = <p className="mt-6"><Link className="inline-flex min-h-11 items-center font-bold text-app-accent underline" href={`/app/w/${workspaceId}`}>← {APP_COPY.pages.listTitle}</Link></p>;
  const access = await authorizeWorkspacePage(workspaceId, "profile.create");
  if (!access) return <><Notice tone="warning">{APP_COPY.pages.createForbidden}</Notice>{back}</>;

  const repository = await getProfileRepository();
  const [count, entitlements] = await Promise.all([repository.countLive(workspaceId), repository.entitlements(workspaceId)]);
  const usage = limitUsage(entitlements, "max_profiles", count);

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-6 text-3xl font-bold">{APP_COPY.pages.create}</h1>
      {usage.reached ? <Notice tone="warning">{APP_COPY.pages.limitReached(usage.limit)}</Notice> : (
        <section className="surface-card p-5 sm:p-8">
          <CreateProfileForm action={createProfileAction.bind(null, workspaceId)} workspaceId={workspaceId} submitLabel={APP_COPY.pages.create} />
        </section>
      )}
      {back}
    </div>
  );
}
