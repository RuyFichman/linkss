import { ANALYTICS_COPY } from "@/content/pt-BR";
import { Skeleton } from "@/ui";

export default function WorkspaceAnalyticsLoading() {
  return (
    <div className="grid gap-4" role="status" aria-live="polite">
      <span className="sr-only">{ANALYTICS_COPY.loading}</span>
      <Skeleton height={36} width="50%" />
      <Skeleton height={44} width="60%" />
      <Skeleton height={110} />
      <Skeleton height={320} />
    </div>
  );
}
