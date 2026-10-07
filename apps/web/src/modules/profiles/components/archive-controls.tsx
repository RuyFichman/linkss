import { APP_COPY } from "@/content/pt-BR";
import { publicAddressLabel } from "@/lib/app-url";
import { ConfirmDialog } from "@/ui/confirm-dialog";
import { archiveProfileAction, unarchiveProfileAction } from "../actions";

interface ArchiveTarget {
  id: string;
  title: string;
  slug: string;
  status: "draft" | "published" | "archived";
}

/**
 * "Arquivar" or "Desarquivar" for one page, with a confirmation that says what happens to the
 * public address. Rendered only for roles that may archive; the action re-checks on the server.
 */
export function ArchiveControl({ page }: { page: ArchiveTarget }) {
  if (page.status === "archived") {
    const copy = APP_COPY.archive.unarchive;
    return (
      <ConfirmDialog action={unarchiveProfileAction.bind(null, page.id)} openLabel={copy.open} openAriaLabel={copy.openFor(page.title)} title={copy.title} confirmLabel={copy.confirm} cancelLabel={APP_COPY.archive.cancel}>
        <p className="m-0"><b>{page.title}</b></p>
        <p className="m-0 text-app-muted">{copy.warning}</p>
      </ConfirmDialog>
    );
  }
  const copy = APP_COPY.archive;
  return (
    <ConfirmDialog action={archiveProfileAction.bind(null, page.id)} openLabel={copy.open} openAriaLabel={copy.openFor(page.title)} title={copy.title} confirmLabel={copy.confirm} confirmVariant="danger" cancelLabel={copy.cancel}>
      <p className="m-0"><b>{page.title}</b></p>
      <p className="m-0">{page.status === "published" ? copy.warningPublished(publicAddressLabel(page.slug)) : copy.warningDraft}</p>
      <p className="m-0 text-app-muted">{copy.keeps}</p>
    </ConfirmDialog>
  );
}
