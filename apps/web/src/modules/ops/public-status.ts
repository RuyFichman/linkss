/**
 * What the public status page (`/status`) says. Two components, checked from inside the
 * application itself: the application answering at all, and the database behind public pages and
 * the panel. It is deliberately small: it names no job, queue, customer or number (those are in
 * the secret-protected `/api/ops/status`, ADR 0019), and it cannot report an outage of the hosting
 * platform, because then this page does not open either. The page says so.
 */
export type ComponentState = "operational" | "degraded";

export interface PublicStatus {
  overall: ComponentState;
  components: { key: "application" | "database"; state: ComponentState }[];
  checkedAt: string;
}

/** A database probe slower than this is reported as instability even when it answers. */
export const DATABASE_SLOW_AFTER_MS = 3000;

export function publicStatus(probe: { databaseOk: boolean; databaseMs: number }, checkedAt: Date): PublicStatus {
  const database: ComponentState = probe.databaseOk && probe.databaseMs <= DATABASE_SLOW_AFTER_MS ? "operational" : "degraded";
  return {
    overall: database,
    // Rendering this answer is the evidence for the first component.
    components: [{ key: "application", state: "operational" }, { key: "database", state: database }],
    checkedAt: checkedAt.toISOString(),
  };
}
