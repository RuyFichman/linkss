import { getCopy } from "@/modules/identity/locale";
import { Skeleton } from "@/ui";

export default async function WorkspaceAnalyticsLoading() {
  const { ANALYTICS_COPY } = await getCopy();
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
