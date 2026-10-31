import type { Metadata } from "next";
import { SIGN_UP_COPY } from "@/content/sign-up";
import { copyFor } from "@/content/copy";
import { getRequestLocale } from "@/modules/identity/locale";
import { langAttribute } from "@/lib/locale";
import { SignUpForm } from "@/modules/identity/components/sign-up-form";
import { isInvitationPath } from "@/modules/identity/invitations";
import { Notice } from "@/ui";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export async function generateMetadata(): Promise<Metadata> {
  return { title: SIGN_UP_COPY[await getRequestLocale()].signUp.submit };
}

/**
 * Sign-up. The language of the request (`?idioma=es`, remembered in a cookie) shows the form in Spanish and records `es-ES` as the account's language
 * (ADR 0022). A signed-in Spanish account then sees the whole product in Spanish.
 */
export default async function SignUpPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const raw = params.next;
  // Only an invitation path is carried through sign-up; everything else starts at the app home.
  const next = isInvitationPath(raw) ? raw : "";
  const locale = await getRequestLocale();
  const copy = SIGN_UP_COPY[locale];
  const { TEAM_COPY } = copyFor(locale);
  return (
    <div lang={langAttribute(locale)}>
      <h1 className="text-3xl font-bold">{copy.signUp.title}</h1>
      <p className="mb-6 mt-2 text-app-muted">{copy.signUp.lead}</p>
      {next ? <div className="mb-5"><Notice>{TEAM_COPY.accept.signUpNotice}</Notice></div> : null}
      <SignUpForm next={next} locale={locale} />
    </div>
  );
}
