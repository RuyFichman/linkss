import type { Metadata } from "next";
import { AUTH_COPY, TEAM_COPY } from "@/content/pt-BR";
import { SignInForm } from "@/modules/identity/components/sign-in-form";
import { isInvitationPath } from "@/modules/identity/invitations";
import { safeNextPath } from "@/modules/identity/redirects";
import { Notice } from "@/ui";

export const metadata: Metadata = { title: "Entrar" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function single(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export default async function SignInPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const next = safeNextPath(single(params.next));
  const notice = single(params.saiu) ? { tone: "success" as const, text: AUTH_COPY.signIn.signedOut }
    : single(params.senha) === "atualizada" ? { tone: "success" as const, text: AUTH_COPY.signIn.passwordUpdated }
    : single(params.email) === "confirmado" ? { tone: "warning" as const, text: AUTH_COPY.signIn.emailLinkNoSession }
    : single(params.erro) === "indisponivel" ? { tone: "danger" as const, text: AUTH_COPY.unavailable }
    : isInvitationPath(next) ? { tone: "neutral" as const, text: TEAM_COPY.accept.signInNotice }
    : null;

  return (
    <>
      <h1 className="text-3xl font-bold">{AUTH_COPY.signIn.title}</h1>
      <p className="mb-6 mt-2 text-app-muted">{AUTH_COPY.signIn.lead}</p>
      {notice ? <div className="mb-5"><Notice tone={notice.tone}>{notice.text}</Notice></div> : null}
      <SignInForm next={next} signUpHref={isInvitationPath(next) ? `/cadastro?next=${encodeURIComponent(next)}` : "/cadastro"} />
    </>
  );
}
