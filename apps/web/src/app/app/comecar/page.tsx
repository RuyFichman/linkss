import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { APP_COPY } from "@/content/pt-BR";
import { resolveAccount } from "@/modules/identity/session";
import { createProfileAction } from "@/modules/profiles/actions";
import { CreateProfileForm } from "@/modules/profiles/components/create-profile-form";
import { getProfileRepository } from "@/modules/profiles/server";

export const metadata: Metadata = { title: "Primeiros passos" };

/** Onboarding step after the personal workspace exists: create the first page (draft). */
export default async function OnboardingPage() {
  const account = await resolveAccount();
  if (account.status === "anonymous") redirect("/entrar?next=/app/comecar");
  if (account.status !== "ready") return null;

  const workspaceId = account.personal.workspaceId;
  if ((await (await getProfileRepository()).countLive(workspaceId)) > 0) redirect(`/app/w/${workspaceId}`);

  return (
    <div className="mx-auto max-w-2xl">
      <p className="text-sm font-bold uppercase tracking-[0.16em] text-app-accent">{APP_COPY.onboarding.eyebrow}</p>
      <h1 className="mt-2 text-3xl font-bold sm:text-4xl">{APP_COPY.onboarding.title}</h1>
      <p className="mb-8 mt-3 text-app-muted">{APP_COPY.onboarding.lead}</p>
      <section className="surface-card p-5 sm:p-8">
        <CreateProfileForm action={createProfileAction.bind(null, workspaceId)} workspaceId={workspaceId} />
      </section>
      <p className="mt-6"><Link className="inline-flex min-h-11 items-center font-bold text-app-accent underline" href={`/app/w/${workspaceId}`}>{APP_COPY.onboarding.skip}</Link></p>
    </div>
  );
}
