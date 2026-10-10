import "server-only";
import { getSupabase } from "@/modules/identity/session";

export interface PrivacyRequest {
  id: string;
  kind: "account_deletion" | "data_access";
  status: "received" | "needs_action" | "processing" | "completed" | "rejected";
  reason: string | null;
  createdAt: string;
  updatedAt: string;
  reviewedAt: string | null;
}

export interface LegalHistoryItem {
  kind: string;
  version: string;
  sha256: string;
  acceptedAt: string;
  status: string;
}

export async function myPrivacyRequests(): Promise<PrivacyRequest[]> {
  const supabase = await getSupabase();
  const { data, error } = await supabase.rpc("get_my_privacy_requests");
  if (error?.code === "PGRST202" || error?.code === "42883") return [];
  if (error) throw new Error("Privacy requests unavailable");
  return Array.isArray(data) ? data as unknown as PrivacyRequest[] : [];
}

export async function myLegalHistory(): Promise<LegalHistoryItem[]> {
  const supabase = await getSupabase();
  const { data, error } = await supabase.rpc("get_my_legal_history");
  if (error?.code === "PGRST202" || error?.code === "42883") return [];
  if (error) throw new Error("Legal history unavailable");
  return Array.isArray(data) ? data as unknown as LegalHistoryItem[] : [];
}
