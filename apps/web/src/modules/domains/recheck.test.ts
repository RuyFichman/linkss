import { describe, expect, it, vi } from "vitest";
import { DnsUnavailableError } from "./dns";
import { recheckText, runDomainRecheck, type RecheckDomain, type RecheckPorts, type RecheckStatus } from "./recheck";

const A: RecheckDomain = { id: "0b6f5f0a-58c4-4e0f-9d7e-2a1c0c1d2e3f", hostname: "www.loja.com.br", challenge: "linkfav-verify=" + "a".repeat(32) };
const B: RecheckDomain = { id: "1b6f5f0a-58c4-4e0f-9d7e-2a1c0c1d2e3f", hostname: "links.outra.com.br", challenge: "linkfav-verify=" + "b".repeat(32) };
const NOW = new Date("2026-10-11T08:00:00Z");

function ports(options: { domains?: RecheckDomain[]; dns?: Record<string, string[] | Error>; status?: Record<string, RecheckStatus | Error>; detach?: RecheckPorts["detach"] } = {}) {
  const recorded: Array<{ domainId: string; found: boolean; hostname: string }> = [];
  const value: RecheckPorts = {
    list: vi.fn(async () => options.domains ?? [A, B]),
    record: vi.fn(async (text: string, signature: string) => {
      expect(signature).toBe(`signed:${text}`);
      const payload = JSON.parse(text) as { domainId: string; found: boolean; hostname: string };
      recorded.push({ domainId: payload.domainId, found: payload.found, hostname: payload.hostname });
      const status = options.status?.[payload.domainId] ?? (payload.found ? "ok" : "missing");
      if (status instanceof Error) throw status;
      return { status, slug: status === "lapsed" ? "loja" : null };
    }),
    dns: { resolveChallenges: vi.fn(async (name: string) => {
      const answer = options.dns?.[name] ?? [];
      if (answer instanceof Error) throw answer;
      return answer;
    }) },
    sign: (text) => `signed:${text}`,
    revalidate: vi.fn(),
    detach: options.detach === undefined ? vi.fn(async () => undefined) : options.detach,
    now: () => NOW,
  };
  return { ports: value, recorded };
}

describe("domain re-verification", () => {
  it("signs exactly the key set the database accepts", () => {
    expect(recheckText({ at: 1, domainId: A.id, found: true, hostname: A.hostname })).toBe(`{"at":1,"domainId":"${A.id}","found":true,"hostname":"${A.hostname}","kind":"recheck","v":1}`);
  });

  it("reads the proof at the challenge name and records found or missing", async () => {
    const { ports: p, recorded } = ports({ dns: { [`_linkfav.${A.hostname}`]: ["linkfav-verify=" + "f".repeat(32), A.challenge], [`_linkfav.${B.hostname}`]: ["linkfav-verify=" + "f".repeat(32)] } });
    expect(await runDomainRecheck(p)).toEqual({ checked: 2, found: 1, missing: 1, lapsed: 0, dnsUnavailable: 0, failed: 0 });
    expect(recorded).toEqual([{ domainId: A.id, found: true, hostname: A.hostname }, { domainId: B.id, found: false, hostname: B.hostname }]);
    expect(p.revalidate).not.toHaveBeenCalled();
    expect(p.detach).not.toHaveBeenCalled();
  });

  it("records nothing for a domain whose DNS could not be asked", async () => {
    const { ports: p, recorded } = ports({ dns: { [`_linkfav.${A.hostname}`]: new DnsUnavailableError("ETIMEOUT"), [`_linkfav.${B.hostname}`]: [B.challenge] } });
    expect(await runDomainRecheck(p)).toEqual({ checked: 2, found: 1, missing: 0, lapsed: 0, dnsUnavailable: 1, failed: 0 });
    expect(recorded.map((item) => item.domainId)).toEqual([B.id]);
  });

  it("refreshes the page and detaches the hostname when a domain lapses", async () => {
    const { ports: p } = ports({ domains: [A], status: { [A.id]: "lapsed" } });
    expect(await runDomainRecheck(p)).toMatchObject({ checked: 1, lapsed: 1 });
    expect(p.revalidate).toHaveBeenCalledExactlyOnceWith("loja");
    expect(p.detach).toHaveBeenCalledExactlyOnceWith(A.hostname);
  });

  it("does not fail the run when the provider cannot detach, or when there is no provider", async () => {
    const failing = ports({ domains: [A], status: { [A.id]: "lapsed" }, detach: vi.fn(async () => { throw new Error("provider"); }) });
    expect(await runDomainRecheck(failing.ports)).toMatchObject({ lapsed: 1, failed: 0 });
    const none = ports({ domains: [A], status: { [A.id]: "lapsed" }, detach: null });
    expect(await runDomainRecheck(none.ports)).toMatchObject({ lapsed: 1, failed: 0 });
  });

  it("counts a refused or failed record as failed and goes on", async () => {
    const { ports: p } = ports({ dns: { [`_linkfav.${B.hostname}`]: [B.challenge] }, status: { [A.id]: new Error("db"), [B.id]: "invalid" } });
    expect(await runDomainRecheck(p)).toEqual({ checked: 2, found: 0, missing: 0, lapsed: 0, dnsUnavailable: 0, failed: 2 });
  });

  it("treats a domain removed or verified again meanwhile as nothing to do", async () => {
    const { ports: p } = ports({ status: { [A.id]: "skipped", [B.id]: "not_found" } });
    expect(await runDomainRecheck(p)).toEqual({ checked: 2, found: 0, missing: 0, lapsed: 0, dnsUnavailable: 0, failed: 0 });
  });

  it("asks for at most the batch it was given", async () => {
    const { ports: p } = ports({ domains: [] });
    await runDomainRecheck(p, 50);
    expect(p.list).toHaveBeenCalledWith(50);
  });
});
