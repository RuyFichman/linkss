const PIXELS_PER_SECOND = 32;
const DRAG_THRESHOLD = 8;

/** Keep the viewport in the middle copy, where either drag direction has identical neighbours. */
export function loopOffset(offset: number, cycle: number): number {
  if (cycle <= 0) return 0;
  return cycle + ((offset - cycle) % cycle + cycle) % cycle;
}

export function advanceShowcase(offset: number, elapsedMs: number, cycle: number): number {
  // A restored tab or a slow frame must not fast-forward the gallery.
  return loopOffset(offset + PIXELS_PER_SECOND * Math.max(0, Math.min(elapsedMs, 64)) / 1000, cycle);
}

export function dragIntent(x: number, y: number): "pending" | "horizontal" | "vertical" {
  if (Math.max(Math.abs(x), Math.abs(y)) < DRAG_THRESHOLD) return "pending";
  return Math.abs(x) > Math.abs(y) ? "horizontal" : "vertical";
}
