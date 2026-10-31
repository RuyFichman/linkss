import type { Metadata } from "next";
import Link from "next/link";
import { getCopy } from "@/modules/identity/locale";
import { NewPasswordForm } from "@/modules/identity/components/new-password-form";
import { getCurrentUserId } from "@/modules/identity/session";
import { Notice } from "@/ui";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getCopy()).PAGE_TITLES.newPassword };
}

/** Reached from the recovery link, which signs the person in with a short recovery session. */
export default async function ResetPasswordPage() {
  const { AUTH_COPY } = await getCopy();
  const userId = await getCurrentUserId();
  if (!userId) {
    return (
      <>
        <h1 className="text-3xl font-bold">{AUTH_COPY.link.expiredTitle}</h1>
        <div className="my-5"><Notice tone="warning">{AUTH_COPY.resetPassword.sessionExpired}</Notice></div>
        <Link className="ui-button ui-button-primary w-full" href="/recuperar-acesso">{AUTH_COPY.link.requestNewRecovery}</Link>
      </>
    );
  }
  return (
    <>
      <h1 className="text-3xl font-bold">{AUTH_COPY.resetPassword.title}</h1>
      <p className="mb-6 mt-2 text-app-muted">{AUTH_COPY.resetPassword.lead}</p>
      <NewPasswordForm />
    </>
  );
}
