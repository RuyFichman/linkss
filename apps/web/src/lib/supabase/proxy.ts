import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/lib/database.types";
import { supabasePublicConfig } from "./config";

/**
 * Refreshes the auth session inside proxy.ts and returns the verified user id (or null).
 * `getClaims()` validates the JWT; a stale cookie never counts as a session.
 */
export async function refreshSession(request: NextRequest, requestHeaders: Headers): Promise<{ response: NextResponse; userId: string | null }> {
  let response = NextResponse.next({ request: { headers: requestHeaders } });
  const { url, publishableKey } = supabasePublicConfig();
  const supabase = createServerClient<Database>(url, publishableKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet) => {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request: { headers: requestHeaders } });
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
      },
    },
  });

  // Do not run code between creating the client and getClaims(): it refreshes the session.
  const { data } = await supabase.auth.getClaims();
  const sub = data?.claims?.sub;
  return { response, userId: typeof sub === "string" ? sub : null };
}
