import type { Metadata } from "next";
import Link from "next/link";
import { AUTH_COPY } from "@/content/pt-BR";
import { EmailRequestForm } from "@/modules/identity/components/email-request-form";
import { Notice } from "@/ui";

export const metadata: Metadata = { title: "Recuperar acesso" };

export default async function RecoveryPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const expired = (await searchParams).erro === "link-expirado";
  return (
    <>
      <h1 className="text-3xl font-bold">{expired ? AUTH_COPY.link.expiredTitle : AUTH_COPY.recovery.title}</h1>
      <p className="mb-6 mt-2 text-app-muted">{AUTH_COPY.recovery.lead}</p>
      {expired ? <div className="mb-5"><Notice tone="warning">{AUTH_COPY.link.expired}</Notice></div> : null}
      <EmailRequestForm purpose="recovery" submitLabel={AUTH_COPY.recovery.submit} />
      <p className="mb-0 mt-5"><Link className="font-bold text-app-accent underline" href="/entrar">{AUTH_COPY.recovery.backToSignIn}</Link></p>
    </>
  );
}
