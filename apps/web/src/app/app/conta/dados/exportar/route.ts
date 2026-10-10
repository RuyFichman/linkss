import { NextResponse, type NextRequest } from "next/server";
import { isSameOriginRequest } from "@/lib/same-origin";
import { isUuid } from "@/modules/identity/guard";
import { getCurrentUserId, getSupabase } from "@/modules/identity/session";

export const dynamic = "force-dynamic";
const MAX_EXPORT_BYTES = 8 * 1024 * 1024;

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!isSameOriginRequest(request.headers)) return new NextResponse("Requisição recusada.", { status: 403 });
  if (!(await getCurrentUserId())) return new NextResponse("Entre na sua conta.", { status: 401 });
  const workspaceId = request.nextUrl.searchParams.get("workspace");
  if (workspaceId !== null && !isUuid(workspaceId)) return new NextResponse("Conta não encontrada.", { status: 404 });

  const supabase = await getSupabase();
  const { data, error } = workspaceId === null
    ? await supabase.rpc("export_my_data")
    : await supabase.rpc("export_workspace_data", { p_workspace_id: workspaceId });
  if (error) {
    if (error.code === "P0002") return new NextResponse("Conta não encontrada.", { status: 404 });
    if (error.code === "42501") return new NextResponse("Apenas o proprietário pode exportar esta conta.", { status: 403 });
    return new NextResponse("Exportação temporariamente indisponível.", { status: 503 });
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
