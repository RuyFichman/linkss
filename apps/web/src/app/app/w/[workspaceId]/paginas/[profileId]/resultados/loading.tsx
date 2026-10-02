import { ANALYTICS_COPY } from "@/content/pt-BR";
import { Skeleton } from "@/ui";

export default function AnalyticsLoading() {
  return (
    <div className="grid gap-4" role="status" aria-live="polite">
      <span className="sr-only">{ANALYTICS_COPY.loading}</span>
      <Skeleton height={36} width="40%" />
      <Skeleton height={44} width="60%" />
      <Skeleton height={110} />
      <Skeleton height={240} />
    </div>
  );
}
