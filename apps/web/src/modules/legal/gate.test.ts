import { describe, expect, it } from "vitest";
import { acceptancePending } from "./gate";

const doc = (kind: string, accepted: boolean) => ({ kind, accepted });

describe("legal acceptance gate", () => {
  it("stays open while no text is active", () => {
    expect(acceptancePending([])).toBe(false);
  });

  it("stays open with a single active text, which /aceite cannot record", () => {
    expect(acceptancePending([doc("terms", false)])).toBe(false);
    expect(acceptancePending([doc("privacy", false), doc("cookies", false)])).toBe(false);
  });

  it("closes while either of the two texts is unaccepted", () => {
    expect(acceptancePending([doc("terms", false), doc("privacy", false)])).toBe(true);
    expect(acceptancePending([doc("terms", true), doc("privacy", false)])).toBe(true);
    expect(acceptancePending([doc("terms", false), doc("privacy", true)])).toBe(true);
  });

  it("opens once both are accepted and ignores the cookies text", () => {
    expect(acceptancePending([doc("terms", true), doc("privacy", true), doc("cookies", false)])).toBe(false);
  });
});
