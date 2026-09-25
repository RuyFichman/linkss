import Link from "next/link";
import { APP_COPY } from "@/content/pt-BR";
import { EmptyState } from "@/ui";

export default function AppNotFound() {
  return <EmptyState title={APP_COPY.pages.notFoundTitle} description={APP_COPY.errors.notFound} action={<Link className="ui-button ui-button-primary" href="/app">{APP_COPY.nav.home}</Link>} />;
}
