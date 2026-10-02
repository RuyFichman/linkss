"use client";

import { useEffect, useState } from "react";
import { MEDIA_COPY } from "@/content/pt-BR";
import { storageUsageAction, type StorageUsageResult } from "@/modules/media/actions";
import { formatBytes } from "@/modules/media/messages";

/**
 * "Espaço usado" (ADR 0009): bytes that count against the workspace quota. Re-read after every
 * finished upload (`refreshKey`). The number is informative: the database enforces the quota.
 */
export function StorageUsage({ profileId, refreshKey }: { profileId: string; refreshKey: number }) {
  const [result, setResult] = useState<StorageUsageResult | null>(null);

  useEffect(() => {
    let current = true;
    storageUsageAction(profileId).then((next) => { if (current) setResult(next); }, () => { if (current) setResult({ ok: false }); });
    return () => { current = false; };
  }, [profileId, refreshKey]);

  if (result === null) return <p className="ui-hint" role="status">{MEDIA_COPY.usage.label}: …</p>;
  if (!result.ok) return <p className="ui-hint" role="status">{MEDIA_COPY.usage.unavailable}</p>;
  const { usedBytes, limitBytes } = result.usage;
  const reached = limitBytes > 0 && usedBytes >= limitBytes;
  return (
    <div className="grid gap-1" role="status">
      <p className="m-0 text-sm"><span className="font-bold">{MEDIA_COPY.usage.label}:</span> {MEDIA_COPY.usage.value(formatBytes(usedBytes), formatBytes(limitBytes))}</p>
      <progress className="h-2 w-full max-w-xs" max={Math.max(1, limitBytes)} value={Math.min(usedBytes, limitBytes)} aria-label={MEDIA_COPY.usage.label} />
      {reached ? <p className="m-0 text-sm font-bold text-app-danger">{MEDIA_COPY.usage.reached}</p> : <p className="ui-hint">{MEDIA_COPY.usage.note}</p>}
    </div>
  );
}
