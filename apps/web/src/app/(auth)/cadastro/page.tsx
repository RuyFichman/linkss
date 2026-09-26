import type { Metadata } from "next";
import { AUTH_COPY } from "@/content/pt-BR";
import { SignUpForm } from "@/modules/identity/components/sign-up-form";

export const metadata: Metadata = { title: "Criar acesso" };

export default function SignUpPage() {
  return (
    <>
      <h1 className="text-3xl font-bold">{AUTH_COPY.signUp.title}</h1>
      <p className="mb-6 mt-2 text-app-muted">{AUTH_COPY.signUp.lead}</p>
      <SignUpForm />
    </>
  );
}
