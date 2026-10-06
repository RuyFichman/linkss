import type { Metadata } from "next";
import { AUTH_COPY, TEAM_COPY } from "@/content/pt-BR";
import { SignUpForm } from "@/modules/identity/components/sign-up-form";
import { isInvitationPath } from "@/modules/identity/invitations";
import { Notice } from "@/ui";

export const metadata: Metadata = { title: "Criar acesso" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function SignUpPage({ searchParams }: { searchParams: SearchParams }) {
  const raw = (await searchParams).next;
  // Only an invitation path is carried through sign-up; everything else starts at the app home.
  const next = isInvitationPath(raw) ? raw : "";
  return (
    <>
      <h1 className="text-3xl font-bold">{AUTH_COPY.signUp.title}</h1>
      <p className="mb-6 mt-2 text-app-muted">{AUTH_COPY.signUp.lead}</p>
      {next ? <div className="mb-5"><Notice>{TEAM_COPY.accept.signUpNotice}</Notice></div> : null}
      <SignUpForm next={next} />
    </>
  );
}
