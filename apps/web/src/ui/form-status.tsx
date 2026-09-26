import type { FormState } from "@/lib/form-state";

/**
 * Form-level result. Errors use role="alert"; success uses a polite live region. The text itself
 * carries the meaning, so state never depends on color alone.
 */
export function FormStatus({ state, id }: { state: Pick<FormState, "status" | "message">; id?: string }) {
  if (!state.message || state.status === "idle") return <div id={id} role="status" aria-live="polite" className="sr-only" />;
  if (state.status === "error") {
    return <p id={id} role="alert" className="m-0 rounded-xl border border-app-danger/30 bg-app-danger/10 p-3 font-bold text-app-danger">{state.message}</p>;
  }
  return <p id={id} role="status" aria-live="polite" className="m-0 rounded-xl border border-app-success/30 bg-app-success/10 p-3 font-bold text-app-success">{state.message}</p>;
}

export function Notice({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "success" | "warning" | "danger" }) {
  const tones = {
    neutral: "border-app-border bg-app-surface-soft text-app-text",
    success: "border-app-success/30 bg-app-success/10 text-app-success",
    warning: "border-app-warning/30 bg-app-warning/10 text-app-warning",
    danger: "border-app-danger/30 bg-app-danger/10 text-app-danger",
  } as const;
  return <div role={tone === "danger" ? "alert" : "status"} className={`rounded-xl border p-3 font-bold ${tones[tone]}`}>{children}</div>;
}
