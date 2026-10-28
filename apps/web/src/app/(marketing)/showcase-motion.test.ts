import { describe, expect, it } from "vitest";
import { advanceShowcase, dragIntent, loopOffset } from "./showcase-motion";

describe("continuous showcase", () => {
  it("crosses either seam without changing the visible place in the repeated sequence", () => {
    for (const offset of [-6025, -25, 0, 25, 2975, 3000, 3025, 5975, 6000, 9025]) {
      const wrapped = loopOffset(offset, 3000);
      expect(wrapped).toBeGreaterThanOrEqual(3000);
      expect(wrapped).toBeLessThan(6000);
      expect(Math.abs((wrapped - offset) % 3000)).toBe(0);
    }
  });

  it("advances at the same speed at different refresh rates", () => {
    const travel = (frames: number) => {
      let offset = 3000;
      for (let frame = 0; frame < frames; frame++) offset = advanceShowcase(offset, 1000 / frames, 3000);
      return offset;
    };
    expect(travel(60)).toBeCloseTo(3032);
    expect(travel(120)).toBeCloseTo(travel(60));
  });

  it("continues smoothly from the last card to the first", () => {
    expect(advanceShowcase(5999, 50, 3000)).toBeCloseTo(3000.6);
  });

  it("does not jump after a backgrounded tab or move backwards on an invalid frame", () => {
    expect(advanceShowcase(3200, 60000, 3000)).toBeCloseTo(3202.048);
    expect(advanceShowcase(3200, -100, 3000)).toBe(3200);
    expect(loopOffset(123, 0)).toBe(0);
  });

  it.each([[0, 0], [7, 3], [-3, -7]])("keeps a small pointer movement available for clicking: %s, %s", (x, y) => {
    expect(dragIntent(x, y)).toBe("pending");
  });

  it.each([[12, 2], [-30, 4], [8, 0]])("recognises a horizontal mouse or touch drag: %s, %s", (x, y) => {
    expect(dragIntent(x, y)).toBe("horizontal");
  });

  it.each([[2, 12], [-4, -30], [8, 8]])("leaves vertical scrolling to the browser: %s, %s", (x, y) => {
    expect(dragIntent(x, y)).toBe("vertical");
  });
});
