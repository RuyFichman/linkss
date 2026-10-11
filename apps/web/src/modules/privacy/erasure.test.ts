import { describe, expect, it, vi } from "vitest";
import { eraseAccount, erasureRefusal, parseErasureBegin, parseErasureCounts, type ErasurePorts } from "./erasure";

const REQUEST = "2f1c1f0e-6f0a-4a57-9a58-0d5c2a1b7e10";
const counts = { workspaces: 2, invitations: 1, waitlist: 0, account: 1 };

function ports(overrides: Partial<ErasurePorts> = {}) {
  const calls: string[] = [];
  const base: ErasurePorts = {
    begin: vi.fn(async () => { calls.push("begin"); return { ok: true as const, value: { slugs: ["ana", "cliente"], hostnames: ["links.cliente.example"], mediaPending: 3 } }; }),
    finish: vi.fn(async () => { calls.push("finish"); return { ok: true as const, value: counts }; }),
    revalidate: vi.fn((slug: string) => { calls.push(`revalidate:${slug}`); }),
    detach: vi.fn(async (hostname: string) => { calls.push(`detach:${hostname}`); }),
    cleanMedia: vi.fn(async () => { calls.push("media"); return { failed: 0 }; }),
  };
  return { calls, ports: { ...base, ...overrides } };
}

describe("account erasure", () => {
  it("takes the pages off the cache, detaches hostnames, removes files and only then deletes", async () => {
    const { calls, ports: p } = ports();
    expect(await eraseAccount(p, REQUEST, "  DOSSIE-0007  ")).toEqual({ outcome: "erased", pages: 2, hostnames: 1, counts });
    expect(calls).toEqual(["begin", "revalidate:ana", "revalidate:cliente", "detach:links.cliente.example", "media", "finish"]);
    expect(p.finish).toHaveBeenCalledWith(REQUEST, "DOSSIE-0007");
  });

  it("refuses a missing, short or oversized evidence reference before touching anything", async () => {
    for (const evidence of ["", "  x ", "x".repeat(121)]) {
      const { ports: p } = ports();
      expect((await eraseAccount(p, REQUEST, evidence)).outcome).toBe("invalid_evidence");
      expect(p.begin).not.toHaveBeenCalled();
    }
  });

  it("stops at the first step when the database refuses, and changes nothing outside it", async () => {
    for (const reason of ["forbidden", "not_found", "not_processing", "active_subscription", "shared_workspace", "not_deployed", "unavailable"] as const) {
      const { ports: p } = ports({ begin: vi.fn(async () => ({ ok: false as const, reason })) });
      expect(await eraseAccount(p, REQUEST, "DOSSIE-0007")).toEqual({ outcome: reason, pages: 0, hostnames: 0 });
      expect(p.revalidate).not.toHaveBeenCalled();
      expect(p.detach).not.toHaveBeenCalled();
      expect(p.cleanMedia).not.toHaveBeenCalled();
      expect(p.finish).not.toHaveBeenCalled();
    }
  });

  it("does not delete when a hostname could not be detached", async () => {
    const { ports: p } = ports({ detach: vi.fn(async () => { throw new Error("provider"); }) });
    expect((await eraseAccount(p, REQUEST, "DOSSIE-0007")).outcome).toBe("domain_failed");
    expect(p.finish).not.toHaveBeenCalled();
  });

  it("skips the provider where none is configured (no hostname was ever attached there)", async () => {
    const { calls, ports: p } = ports({ detach: null });
    expect((await eraseAccount(p, REQUEST, "DOSSIE-0007")).outcome).toBe("erased");
    expect(calls).not.toContain("detach:links.cliente.example");
  });

  it("does not delete while image files remain or the media job is not configured", async () => {
    const failing = ports({ cleanMedia: vi.fn(async () => ({ failed: 2 })) });
    expect((await eraseAccount(failing.ports, REQUEST, "DOSSIE-0007")).outcome).toBe("media_pending");
    expect(failing.ports.finish).not.toHaveBeenCalled();
    const missing = ports({ cleanMedia: vi.fn(async () => null) });
    expect((await eraseAccount(missing.ports, REQUEST, "DOSSIE-0007")).outcome).toBe("media_not_configured");
    expect(missing.ports.finish).not.toHaveBeenCalled();
  });

  it("does not run the media job when there is no file to remove", async () => {
    const { ports: p } = ports({ begin: vi.fn(async () => ({ ok: true as const, value: { slugs: [], hostnames: [], mediaPending: 0 } })) });
    expect(await eraseAccount(p, REQUEST, "DOSSIE-0007")).toEqual({ outcome: "erased", pages: 0, hostnames: 0, counts });
    expect(p.cleanMedia).not.toHaveBeenCalled();
  });

  it("reports the last step's refusal (files claimed by another run, request closed meanwhile)", async () => {
    for (const reason of ["media_pending", "not_processing"] as const) {
      const { ports: p } = ports({ finish: vi.fn(async () => ({ ok: false as const, reason })) });
      expect((await eraseAccount(p, REQUEST, "DOSSIE-0007")).outcome).toBe(reason);
    }
  });
});

describe("erasure answers from the database", () => {
  it("maps each error code to its reason", () => {
    expect([["42501"], ["P0002"], ["LK122"], ["LK123"], ["LK124"], ["LK125"], ["22023"], ["57014"], [null]].map(([code]) => erasureRefusal(code, false)))
      .toEqual(["forbidden", "not_found", "not_processing", "active_subscription", "shared_workspace", "media_pending", "invalid_evidence", "unavailable", "unavailable"]);
    expect(erasureRefusal("PGRST202", true)).toBe("not_deployed");
  });

  it("reads only well-formed fields", () => {
    expect(parseErasureBegin({ slugs: ["a", 1, null], hostnames: "x", mediaPending: 2 })).toEqual({ slugs: ["a"], hostnames: [], mediaPending: 2 });
    expect(parseErasureBegin(null)).toEqual({ slugs: [], hostnames: [], mediaPending: 0 });
    expect(parseErasureCounts({ workspaces: 2, invitations: -1, account: "1" })).toEqual({ workspaces: 2, invitations: 0, waitlist: 0, account: 0 });
  });
});
