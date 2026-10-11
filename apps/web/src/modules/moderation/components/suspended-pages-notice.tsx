import Link from "next/link";
import { MODERATION_COPY } from "@/content/pt-BR";
import { suspendedPages } from "../appeals-server";

/**
 * Tells every member of a workspace that moderation took a page of theirs off the air, on every
 * workspace screen, with the way to the reason and the appeal (ADR 0019). The product sends no
 * e-mail, so this is the only notice: it must be hard to miss. Hidden while the editor fills the
 * viewport (`data-app-chrome`); the page settings there link to the same screen.
 */
export async function SuspendedPagesNotice({ workspaceId }: { workspaceId: string }) {
  const pages = await suspendedPages(workspaceId);
  if (pages.length === 0) return null;
  const copy = MODERATION_COPY.notice;
  return (
    <div data-app-chrome="" role="alert" className="mb-6 grid gap-2 rounded-xl border border-app-danger/30 bg-app-danger/10 p-4 text-app-danger">
      <p className="m-0 font-bold">{copy.title(pages.length)}</p>
      <ul className="m-0 grid list-none gap-1 p-0">
        {pages.map((page) => (
          <li key={page.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-bold break-words">{page.title}</span>
            <Link className="inline-flex min-h-11 items-center font-bold underline underline-offset-4" href={`/app/w/${workspaceId}/paginas/${page.id}/moderacao`}>{copy.link}</Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
