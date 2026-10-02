import type { DayRow } from "../dashboard";

/**
 * Server-rendered charts for the analytics dashboard (ADR 0011: no chart library). Each chart is
 * an illustration of numbers that are also on the page as text or in a table; meaning is carried by
 * shape and labels, not by color alone.
 */
const CHART_HEIGHT = 120;
const SLOT = 12;

/**
 * Visits (wide bar) and results (narrow dark bar) per day. Days before collection started get a
 * striped band, so "no data" does not look like "zero".
 */
export function DailyChart({ rows, label }: { rows: readonly DayRow[]; label: string }) {
  const peak = Math.max(1, ...rows.map((row) => Math.max(row.visits, row.results)));
  const width = Math.max(rows.length * SLOT, SLOT * 7);
  const scale = (value: number) => (value / peak) * (CHART_HEIGHT - 4);
  return (
    <svg className="block h-40 w-full" viewBox={`0 0 ${width} ${CHART_HEIGHT}`} preserveAspectRatio="none" role="img" aria-label={label}>
      <defs>
        <pattern id="analytics-no-data" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="3" height="6" className="fill-app-border" />
        </pattern>
      </defs>
      <line x1="0" y1={CHART_HEIGHT - 0.5} x2={width} y2={CHART_HEIGHT - 0.5} className="stroke-app-border" strokeWidth="1" vectorEffect="non-scaling-stroke" />
      {rows.map((row, index) => {
        const x = index * SLOT;
        if (row.status === "before_collection") return <rect key={row.day} x={x} y="0" width={SLOT} height={CHART_HEIGHT} fill="url(#analytics-no-data)" opacity="0.6" />;
        const visits = scale(row.visits);
        const results = scale(row.results);
        return (
          <g key={row.day}>
            <rect x={x + 1.5} y={CHART_HEIGHT - visits} width={SLOT - 3} height={visits} className="fill-app-accent" opacity={row.partial ? 0.55 : 0.85} />
            <rect x={x + 4} y={CHART_HEIGHT - results} width={SLOT - 8} height={results} className="fill-app-text" />
          </g>
        );
      })}
    </svg>
  );
}

/** A labelled horizontal bar: the value is always written next to it. */
export function Bar({ ratio, tone = "accent" }: { ratio: number; tone?: "accent" | "success" }) {
  const width = Math.max(0, Math.min(100, Math.round(ratio * 100)));
  return (
    <span className="block h-3 overflow-hidden rounded-full bg-app-surface-soft" aria-hidden="true">
      <span className={`block h-full rounded-full ${tone === "success" ? "bg-app-success" : "bg-app-accent"}`} style={{ width: `${width}%` }} />
    </span>
  );
}
