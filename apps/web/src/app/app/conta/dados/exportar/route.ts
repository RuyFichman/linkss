import { NextResponse, type NextRequest } from "next/server";
import { isSameOriginRequest } from "@/lib/same-origin";
import { isUuid, requireWorkspaceAccess, AuthorizationError } from "@/modules/identity/guard";
import { getCurrentUserId, getSupabase, supabaseIdentity } from "@/modules/identity/session";
import { exportMediaFiles } from "@/modules/privacy/media-export";
import { readPublicMedia } from "@/modules/media/storage/public-reader";
import { allowRequest } from "@/lib/security/rate-limit";
import { logEvent, correlationIdFrom, CORRELATION_HEADER } from "@/lib/observability/logger";

export const dynamic = "force-dynamic";
const MAX_EXPORT_BYTES = 8 * 1024 * 1024;

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!isSameOriginRequest(request.headers)) return new NextResponse("Requisição recusada.", { status: 403 });
  const userId = await getCurrentUserId();
  if (!userId) return new NextResponse("Entre na sua conta.", { status: 401 });
  if (!allowRequest({ name: "privacy.export", limit: 60, windowMs: 60_000 }, userId)) {
    return new NextResponse("Muitos downloads. Aguarde um minuto e tente novamente.", { status: 429, headers: { "Retry-After": "60", "Cache-Control": "private, no-store" } });
  }
  const workspaceId = request.nextUrl.searchParams.get("workspace");
  if (workspaceId !== null && !isUuid(workspaceId)) return new NextResponse("Conta não encontrada.", { status: 404 });
  const mediaId = request.nextUrl.searchParams.get("media");
  const width = request.nextUrl.searchParams.get("width");
  if ((mediaId !== null || width !== null) && (!workspaceId || !isUuid(mediaId) || !width || !/^\d{1,4}$/.test(width))) {
    return new NextResponse("Arquivo não encontrado.", { status: 404 });
  }

  const supabase = await getSupabase();
  if (workspaceId !== null) {
    try {
      const access = await requireWorkspaceAccess(supabaseIdentity(supabase), workspaceId, "workspace.view");
      if (access.role !== "owner") return new NextResponse("Apenas o proprietário pode exportar esta conta.", { status: 403 });
    } catch (error) {
      return new NextResponse("Conta indisponível.", { status: error instanceof AuthorizationError ? 404 : 503 });
    }
  }
  const { data, error } = workspaceId === null
    ? await supabase.rpc("export_my_data")
    : await supabase.rpc("export_workspace_data", { p_workspace_id: workspaceId });
  if (error) {
    if (error.code === "P0002") return new NextResponse("Conta não encontrada.", { status: 404 });
    if (error.code === "42501") return new NextResponse("Apenas o proprietário pode exportar esta conta.", { status: 403 });
    return new NextResponse("Exportação temporariamente indisponível.", { status: 503 });
  }
  if (mediaId !== null && workspaceId !== null) {
    const correlationId = correlationIdFrom(request.headers.get(CORRELATION_HEADER));
    try {
      const file = exportMediaFiles(data, workspaceId).find((item) => item.mediaId === mediaId && item.width === Number(width));
      if (!file) return new NextResponse("Arquivo não encontrado.", { status: 404 });
      const bytes = await readPublicMedia(file.key, file.bytes);
      logEvent("info", "privacy.media_export", { correlationId, outcome: "ok", bytes: bytes.byteLength });
      return new NextResponse(new Uint8Array(bytes).buffer, { headers: {
        "Content-Type": "image/webp", "Content-Disposition": `attachment; filename="${file.mediaId}-${file.width}.webp"`,
        "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer",
        [CORRELATION_HEADER]: correlationId,
      } });
    } catch {
      logEvent("error", "privacy.media_export", { correlationId, outcome: "unavailable" });
      return new NextResponse("Não foi possível baixar a imagem. Tente novamente ou solicite o pacote completo em Meus dados.", { status: 503, headers: { "Cache-Control": "private, no-store" } });
    }
  }
  const body = JSON.stringify(data, null, 2);
  if (Buffer.byteLength(body, "utf8") > MAX_EXPORT_BYTES) {
    return new NextResponse("O pacote ultrapassou o limite do download. Solicite o pacote completo na tela de dados.", { status: 413 });
  }
  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": "attachment; filename=linkfav-dados.json",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    },
  });
}
