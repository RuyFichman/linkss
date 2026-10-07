import { SHARED_REPORT_COPY } from "@/content/shared-report";

/**
 * The one state for every link that does not open a report (ADR 0013): unknown, malformed, expired,
 * revoked, page deleted, workspace suspended, plan without shared reports, or the database not
 * answering. Same status (404), same text, no link into the product and nothing about the cause.
 */
export default function SharedReportUnavailable() {
  return (
    <main className="grid min-h-screen place-items-center bg-app-bg px-4 text-center text-app-text">
      <div className="grid max-w-md justify-items-center gap-3">
        <h1 className="m-0 text-2xl font-bold">{SHARED_REPORT_COPY.unavailable.title}</h1>
        <p className="m-0 text-app-muted">{SHARED_REPORT_COPY.unavailable.description}</p>
      </div>
    </main>
  );
}
