import type { DnsRecord, DomainRouting, DomainsAdapter } from "./adapter";

/**
 * In-memory DomainsAdapter for tests. A hostname attaches as "pending" with one CNAME to create
 * and becomes "ok" when the test says its DNS points here.
 */
export function createFakeDomainsAdapter(options: { conflicts?: readonly string[] } = {}) {
  const attached = new Map<string, { pointing: boolean }>();
  const calls: string[] = [];
  const records = (hostname: string): DnsRecord[] => [{ type: "CNAME", name: hostname, value: "cname.fake-provider.test" }];
  const routing = (hostname: string): DomainRouting => (attached.get(hostname)?.pointing ? { state: "ok" } : { state: "pending", records: records(hostname) });

  const adapter: DomainsAdapter = {
    async ensure(hostname) {
      calls.push(`ensure:${hostname}`);
      if (options.conflicts?.includes(hostname)) return { state: "conflict" };
      if (!attached.has(hostname)) attached.set(hostname, { pointing: false });
      return routing(hostname);
    },
    async inspect(hostname) {
      calls.push(`inspect:${hostname}`);
      return attached.has(hostname) ? routing(hostname) : null;
    },
    async detach(hostname) {
      calls.push(`detach:${hostname}`);
      attached.delete(hostname);
    },
  };
  return {
    adapter,
    calls,
    isAttached: (hostname: string) => attached.has(hostname),
    pointDns: (hostname: string) => {
      const entry = attached.get(hostname);
      if (entry) entry.pointing = true;
    },
  };
}
