import { describe, expect, it } from "vitest";
import { STATUS_COPY } from "@/content/pt-BR";
import { DATABASE_SLOW_AFTER_MS, publicStatus } from "./public-status";

const AT = new Date("2026-10-13T12:00:00.000Z");

describe("public status page", () => {
  it("is operational when the database answers in time", () => {
    expect(publicStatus({ databaseOk: true, databaseMs: 120 }, AT)).toEqual({
      overall: "operational",
      components: [{ key: "application", state: "operational" }, { key: "database", state: "operational" }],
      checkedAt: "2026-10-13T12:00:00.000Z",
    });
    expect(publicStatus({ databaseOk: true, databaseMs: DATABASE_SLOW_AFTER_MS }, AT).overall).toBe("operational");
  });

  it("reports instability when the database fails or is slow, and still says the application answers", () => {
    for (const probe of [{ databaseOk: false, databaseMs: 40 }, { databaseOk: true, databaseMs: DATABASE_SLOW_AFTER_MS + 1 }]) {
      const status = publicStatus(probe, AT);
      expect(status.overall).toBe("degraded");
      expect(status.components).toEqual([{ key: "application", state: "operational" }, { key: "database", state: "degraded" }]);
    }
  });

  it("has words for every component and state, and nothing but the two components", () => {
    const status = publicStatus({ databaseOk: true, databaseMs: 1 }, AT);
    for (const component of status.components) expect(STATUS_COPY.components[component.key].name.length).toBeGreaterThan(0);
    expect(Object.keys(STATUS_COPY.state).sort()).toEqual(["degraded", "operational"]);
    expect(Object.keys(status).sort()).toEqual(["checkedAt", "components", "overall"]);
  });
});
