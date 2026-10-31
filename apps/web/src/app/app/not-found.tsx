import Link from "next/link";
import { getCopy } from "@/modules/identity/locale";
import { EmptyState } from "@/ui";

export default async function AppNotFound() {
  const { APP_COPY } = await getCopy();
  return <EmptyState title={APP_COPY.pages.notFoundTitle} description={APP_COPY.errors.notFound} action={<Link className="ui-button ui-button-primary" href="/app">{APP_COPY.nav.home}</Link>} />;
}
