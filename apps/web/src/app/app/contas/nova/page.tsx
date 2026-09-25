import type { Metadata } from "next";
import { APP_COPY } from "@/content/pt-BR";
import { CreateAgencyForm } from "@/modules/identity/components/create-agency-form";

export const metadata: Metadata = { title: "Nova conta da agência" };

export default function NewAgencyWorkspacePage() {
  return (
    <div className="mx-auto max-w-xl">
      <h1 className="text-3xl font-bold">{APP_COPY.workspace.createAgencyTitle}</h1>
      <p className="mb-6 mt-2 text-app-muted">{APP_COPY.workspace.createAgencyLead}</p>
      <section className="surface-card p-5 sm:p-8"><CreateAgencyForm /></section>
    </div>
  );
}
