import { NextResponse, type NextRequest } from "next/server";
import { CORRELATION_HEADER, correlationIdFrom, logEvent } from "@/lib/observability/logger";
import { refreshSession } from "@/lib/supabase/proxy";
import { safeNextPath } from "@/modules/identity/redirects";

const SIGN_IN_PATH = "/entrar";
const GUEST_ONLY_PATHS = new Set(["/entrar", "/cadastro"]);

function isProtected(pathname: string): boolean {
  return pathname === "/app" || pathname.startsWith("/app/");
}

function redirectKeepingCookies(url: URL, from: NextResponse, correlationId: string): NextResponse {
  const redirect = NextResponse.redirect(url);
  for (const cookie of from.cookies.getAll()) redirect.cookies.set(cookie);
  redirect.headers.set(CORRELATION_HEADER, correlationId);
  return redirect;
}

/**
 * Refreshes the Supabase session and redirects anonymous visitors away from /app. This is a
 * convenience layer: every page, Server Action and route handler re-checks identity and membership.
 */
export async function proxy(request: NextRequest) {
  const correlationId = correlationIdFrom(request.headers.get(CORRELATION_HEADER));
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(CORRELATION_HEADER, correlationId);
  const { pathname, search } = request.nextUrl;

  let session: Awaited<ReturnType<typeof refreshSession>>;
  try {
    session = await refreshSession(request, requestHeaders);
  } catch (error) {
    logEvent("error", "auth.session_refresh_failed", { correlationId, path: pathname, error: error instanceof Error ? error.name : "unknown" });
    if (!isProtected(pathname)) return NextResponse.next({ request: { headers: requestHeaders } });
    const url = new URL(SIGN_IN_PATH, request.url);
    url.searchParams.set("erro", "indisponivel");
    return NextResponse.redirect(url);
  }

  if (!session.userId && isProtected(pathname)) {
    const url = new URL(SIGN_IN_PATH, request.url);
    url.searchParams.set("next", safeNextPath(`${pathname}${search}`));
    return redirectKeepingCookies(url, session.response, correlationId);
  }

  if (session.userId && GUEST_ONLY_PATHS.has(pathname)) {
    const url = new URL(safeNextPath(request.nextUrl.searchParams.get("next")), request.url);
    return redirectKeepingCookies(url, session.response, correlationId);
  }

  session.response.headers.set(CORRELATION_HEADER, correlationId);
  return session.response;
}

export const config = {
  // Only routes that need a session. Marketing, prototype, health and future public pages stay
  // free of auth work so they remain fast and cacheable.
  matcher: ["/app/:path*", "/entrar", "/cadastro", "/confirmar-email", "/recuperar-acesso", "/redefinir-senha", "/auth/:path*"],
};
