import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSupabase, resolveAccount } from "@/modules/identity/session";
import { exportMediaFiles } from "@/modules/privacy/media-export";

export const metadata: Metadata = { title: "Exportar imagens" };
export const dynamic = "force-dynamic";
const PAGE_SIZE = 30;

export default async function MediaExportPage({ searchParams }: { searchParams: Promise<{ workspace?: string; pagina?: string }> }) {
  const { workspace, pagina } = await searchParams;
  const account = await resolveAccount();
  if (account.status === "anonymous") redirect("/entrar?next=/app/conta/dados");
  if (account.status !== "ready") return null;
  const owned = account.workspaces.find((item) => item.workspaceId === workspace && item.role === "owner");
  if (!owned) notFound();
  const supabase = await getSupabase();
  const { data, error } = await supabase.rpc("export_workspace_data", { p_workspace_id: owned.workspaceId });
  if (error?.code === "P0002" || error?.code === "42501") notFound();
  let files;
  try { files = error ? null : exportMediaFiles(data, owned.workspaceId); } catch { files = null; }
  const pages = Math.max(1, Math.ceil((files?.length ?? 0) / PAGE_SIZE));
  const page = Math.min(pages, Math.max(1, /^\d{1,6}$/.test(pagina ?? "") ? Number(pagina) : 1));
  const href = (value: number) => `/app/conta/dados/midia?workspace=${owned.workspaceId}&pagina=${value}`;
  return <section className="app-shell max-w-4xl">
    <Link href="/app/conta/dados" className="inline-flex min-h-6 items-center underline underline-offset-4">Voltar para Meus dados</Link>
    <h1 className="mt-4 text-3xl font-bold">Exportar imagens</h1>
    <p className="mt-3 text-app-muted">Conta: {owned.name}. Baixe cada tamanho armazenado em WebP. Os originais enviados não são guardados. Inclui imagens prontas, mesmo fora da publicação atual; uploads incompletos e arquivos em remoção não estão disponíveis.</p>
    <p className="mt-2 text-sm text-app-muted">Os downloads são individuais. Para receber um pacote único ou conferir arquivos ausentes, solicite o pacote completo em Meus dados.</p>
    {files === null ? <p role="alert" className="mt-5">Exportação temporariamente indisponível. Tente recarregar a página ou solicite o pacote completo.</p>
      : files.length === 0 ? <p className="mt-5">Nenhuma imagem pronta para baixar nesta conta.</p>
        : <>
          <p className="mt-5 text-sm">{files.length} arquivos. Página {page} de {pages}.</p>
          <ul className="mt-4 grid gap-3">{files.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map((file) => <li key={file.key} className="surface-card p-4">
            <p className="break-all text-sm">Imagem {file.mediaId} — {file.width} × {file.height} px</p>
            <form className="mt-3" action={`/app/conta/dados/exportar?workspace=${owned.workspaceId}&media=${file.mediaId}&width=${file.width}`} method="post">
              <button type="submit" className="ui-button ui-button-secondary">Baixar WebP de {file.width} px</button>
            </form>
          </li>)}</ul>
          <nav aria-label="Páginas de arquivos" className="mt-5 flex flex-wrap gap-4">
            {page > 1 ? <Link className="inline-flex min-h-6 items-center underline underline-offset-4" href={href(page - 1)}>Anterior</Link> : null}
            {page < pages ? <Link className="inline-flex min-h-6 items-center underline underline-offset-4" href={href(page + 1)}>Próxima</Link> : null}
          </nav>
        </>}
  </section>;
}
