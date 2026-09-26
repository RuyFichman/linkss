// Public Supabase settings (safe for the browser). The secret key is never read here.
export interface SupabasePublicConfig {
  url: string;
  publishableKey: string;
}

export function supabasePublicConfig(): SupabasePublicConfig {
  // Referenced statically so Next.js can inline NEXT_PUBLIC_* values in browser bundles.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishableKey) throw new Error("Supabase is not configured: set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.");
  return { url, publishableKey };
}
