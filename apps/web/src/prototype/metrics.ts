import type { PrototypeEvent } from "./types";

export type AnalyticsDisplayState = "no-data" | "zero" | "data";
export function classifyAnalytics(hasHistoricalData: boolean, visitsInPeriod: number): AnalyticsDisplayState {
  if (!hasHistoricalData) return "no-data";
  return visitsInPeriod === 0 ? "zero" : "data";
}

export function timeToFirstPublish(events: readonly PrototypeEvent[]): number | null {
  const start = events.find((event) => event.name === "session_started");
  const published = events.find((event) => event.name === "publish_succeeded");
  if (!start || !published) return null;
  return Math.max(0, new Date(published.at).getTime() - new Date(start.at).getTime());
}
