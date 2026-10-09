"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

const INTERVAL_MS = 3000;
const MAX_CHECKS = 40;

/**
 * Waiting for the provider's confirmation (ADR 0014). The return page shows what the database
 * says; while the webhook has not arrived this asks the server again every few seconds, so the
 * state resolves by itself. It grants nothing: it only re-renders the page. After a bounded number
 * of checks it stops and says so, without promising a time. Without JavaScript the page still has
 * a "verificar agora" link.
 */
export function BillingRefresher({ waiting, stillWaiting }: { waiting: string; stillWaiting: string }) {
  const router = useRouter();
  const [checks, setChecks] = useState(0);
  const done = checks >= MAX_CHECKS;

  useEffect(() => {
    if (done) return;
    const timer = window.setTimeout(() => {
      setChecks((value) => value + 1);
      router.refresh();
    }, INTERVAL_MS);
    return () => window.clearTimeout(timer);
  }, [checks, done, router]);

  return <p className="m-0 text-app-muted" role="status" aria-live="polite">{done ? stillWaiting : waiting}</p>;
}
