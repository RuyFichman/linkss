import { describe, expect, it } from "vitest";
import { classifyAnalytics, timeToFirstPublish } from "./metrics";

describe("prototype metrics", () => {
  it("distinguishes no history from zero in a period", () => { expect(classifyAnalytics(false, 0)).toBe("no-data"); expect(classifyAnalytics(true, 0)).toBe("zero"); expect(classifyAnalytics(true, 3)).toBe("data"); });
  it("calculates time from session start to first publish", () => { expect(timeToFirstPublish([{ name: "session_started", at: "2026-09-25T10:00:00.000Z" }, { name: "publish_succeeded", at: "2026-09-25T10:04:30.000Z" }])).toBe(270_000); expect(timeToFirstPublish([])).toBeNull(); });
});
