import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { WaitlistStore } from "./types";

export function createSupabaseWaitlistStore(): WaitlistStore {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL; const secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secret) throw new Error("Waitlist storage is not configured.");
  const client = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
  return { async create(signup) { const { error } = await client.from("waitlist_signups").insert({ name: signup.name, email: signup.email, whatsapp: signup.whatsapp, segment: signup.segment, managed_profiles: signup.managedProfiles, current_tool: signup.currentTool, willingness_to_pay: signup.willingnessToPay, pilot_interest: signup.pilotInterest, consent_at: new Date().toISOString(), variant: signup.variant, utm_source: signup.utmSource, utm_medium: signup.utmMedium, utm_campaign: signup.utmCampaign, referrer: signup.referrer }); if (error?.code === "23505") return "duplicate"; if (error) throw new Error("Waitlist write failed."); return "created"; } };
}
