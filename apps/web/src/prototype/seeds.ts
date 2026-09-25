import { TEMPLATES } from "@/modules/editor/templates";
import type { PageDocument } from "@/modules/editor/model";
import type { ProtoState, Scenario } from "./types";

function profile(overrides: Partial<PageDocument> & Pick<PageDocument, "id" | "title" | "slug">, templateIndex = 0): PageDocument {
  const template = TEMPLATES[templateIndex] ?? TEMPLATES[0];
  return { id: overrides.id, workspaceId: overrides.workspaceId ?? "agency-aurora", title: overrides.title, bio: overrides.bio ?? "Uma página fictícia criada para testar a experiência.", slug: overrides.slug, status: overrides.status ?? "draft", plan: overrides.plan ?? "agency", blocks: structuredClone(template.seedBlocks), theme: structuredClone(template.theme), publishedAt: overrides.publishedAt };
}

export function seedState(scenario: Scenario): ProtoState {
  const now = new Date().toISOString();
  const base = { version: 1 as const, scenario, sessionStartedAt: now, reports: [], events: [{ name: "session_started" as const, at: now, detail: scenario }], debug: { forceSaveError: false, slowSave: false, forcePublishError: false, analyticsMode: "data" as const } };
  if (scenario === "new-user") return { ...base, profiles: [] };
  const reports = [{ token: "aurora-cafe-setembro", profileId: "cafe-ipe", workspaceName: "Agência Aurora", period: "1–30 set 2026", expiresAt: "2027-01-30", status: "active" as const, createdAt: now }, { token: "aurora-estudio-expirado", profileId: "estudio-norte", workspaceName: "Agência Aurora", period: "1–31 ago 2026", expiresAt: "2026-08-31", status: "expired" as const, createdAt: now }, { token: "aurora-feira-revogado", profileId: "feira-miuda", workspaceName: "Agência Aurora", period: "1–30 set 2026", expiresAt: "2027-02-01", status: "revoked" as const, createdAt: now }];
  return { ...base, reports, profiles: [
    profile({ id: "cafe-ipe", title: "Café Ipê", slug: "cafe-ipe", status: "published", publishedAt: "2026-09-20T12:00:00.000Z", bio: "Café, almoço e encontros no centro." }, 0),
    profile({ id: "estudio-norte", title: "Estúdio Norte", slug: "estudio-norte", status: "pending", publishedAt: "2026-09-18T15:00:00.000Z", bio: "Fotografia para marcas e pessoas." }, 2),
    profile({ id: "feira-miuda", title: "Feira Miúda", slug: "feira-miuda", status: "draft", bio: "Produtos feitos em pequena escala." }, 3),
  ] };
}
