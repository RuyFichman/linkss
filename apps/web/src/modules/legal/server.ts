import "server-only";
import { getSupabase } from "@/modules/identity/session";

export interface ActiveLegalDocument {
  id: string;
  kind: "terms" | "privacy" | "cookies";
  version: string;
  body: string;
  sha256: string;
  activatedAt: string;
  accepted: boolean;
}

interface LegalStatus {
  documents: ActiveLegalDocument[];
}

export async function currentLegalDocuments(): Promise<ActiveLegalDocument[]> {
  const supabase = await getSupabase();
  const { data, error } = await supabase.rpc("get_legal_status");
  if (error) {
    if (error.code === "PGRST202" || error.code === "42883") return [];
    throw new Error("Legal status is unavailable");
  }
  const status = data as unknown as LegalStatus | null;
  return Array.isArray(status?.documents) ? status.documents : [];
}

export async function legalAcceptanceRequired(): Promise<boolean> {
  const documents = await currentLegalDocuments();
  return documents.some((document) => (document.kind === "terms" || document.kind === "privacy") && !document.accepted);
}
