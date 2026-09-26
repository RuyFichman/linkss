import type { Metadata } from "next";
import { AUTH_COPY } from "@/content/pt-BR";
import { SignInForm } from "@/modules/identity/components/sign-in-form";
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
    : single(params.erro) === "indisponivel" ? { tone: "danger" as const, text: AUTH_COPY.unavailable }
    : null;

  return (
    <>
      <h1 className="text-3xl font-bold">{AUTH_COPY.signIn.title}</h1>
      <p className="mb-6 mt-2 text-app-muted">{AUTH_COPY.signIn.lead}</p>
      {notice ? <div className="mb-5"><Notice tone={notice.tone}>{notice.text}</Notice></div> : null}
      <SignInForm next={next} />
    </>
  );
}
