import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { MailError, type MailAdapter } from "./adapter";
import { resolveMailConfig } from "./config";
import { drainOutbox, type ClaimedMail, type CompletionOutcome, type OutboxPort } from "./outbox";
import { createResendAdapter } from "./resend-adapter";
import { MAIL_KINDS, escapeHtml, renderMail, type MailContext } from "./templates";

const MIGRATIONS_DIR = fileURLToPath(new URL("../../../../../supabase/migrations/", import.meta.url));
const WORKSPACE = "11111111-1111-4111-8111-111111111111";
const PROFILE = "22222222-2222-4222-8222-222222222222";
const KEY = "re_" + "k".repeat(30);

const context: MailContext = {
  appUrl: (path) => `https://linkfav.example${path}`,
  publicAddress: (slug) => `linkfav.example/${slug}`,
  recipientName: "Ana",
  replyReachesSomeone: true,
  billingIsTest: false,
};

const payloads: Record<(typeof MAIL_KINDS)[number], Record<string, unknown>> = {
  new_lead: { profileId: PROFILE, title: "Café <b>Central</b>", slug: "cafe-central" },
  page_suspended: { profileId: PROFILE, title: "Café Central", slug: "cafe-central", category: "impersonation" },
  appeal_decided: { profileId: PROFILE, title: "Café Central", slug: "cafe-central", accepted: false, response: "A página usa o <script>logo</script> de outra empresa." },
  payment_failed: { planId: "pro", graceUntil: "2026-10-21T12:00:00.000Z" },
  renewal_upcoming: { planId: "agency", renewsAt: "2026-10-20T12:00:00.000Z", amountCents: 57900 },
};

describe("mail configuration", () => {
  it("is off, with a reason, until a key and a sender are set", () => {
    expect(resolveMailConfig({})).toEqual({ mode: "off", reason: "missing_api_key" });
    expect(resolveMailConfig({ RESEND_API_KEY: "sk_live_x" })).toEqual({ mode: "off", reason: "missing_api_key" });
    expect(resolveMailConfig({ RESEND_API_KEY: KEY })).toEqual({ mode: "off", reason: "missing_from" });
    expect(resolveMailConfig({ RESEND_API_KEY: KEY, MAIL_FROM: "Linkfav <avisos>" })).toEqual({ mode: "off", reason: "invalid_from" });
    expect(resolveMailConfig({ RESEND_API_KEY: KEY, MAIL_FROM: "x\r\nBcc: a@b.co <a@b.co>" })).toEqual({ mode: "off", reason: "invalid_from" });
  });

  it("takes the reply address from MAIL_REPLY_TO, then SUPPORT_EMAIL", () => {
    expect(resolveMailConfig({ RESEND_API_KEY: KEY, MAIL_FROM: "Linkfav <avisos@linkfav.com>" })).toEqual({ mode: "on", apiKey: KEY, from: "Linkfav <avisos@linkfav.com>", replyTo: null, apiBaseUrl: null });
    expect(resolveMailConfig({ RESEND_API_KEY: KEY, MAIL_FROM: "avisos@linkfav.com", SUPPORT_EMAIL: "Ajuda@Linkfav.com" })).toMatchObject({ mode: "on", replyTo: "ajuda@linkfav.com" });
    expect(resolveMailConfig({ RESEND_API_KEY: KEY, MAIL_FROM: "avisos@linkfav.com", SUPPORT_EMAIL: "ajuda@linkfav.com", MAIL_REPLY_TO: "oi@linkfav.com" })).toMatchObject({ replyTo: "oi@linkfav.com" });
  });

  it("accepts a local stand-in only on loopback and never in production", () => {
    const base = { RESEND_API_KEY: KEY, MAIL_FROM: "avisos@linkfav.com" };
    expect(resolveMailConfig({ ...base, RESEND_API_BASE_URL: "http://127.0.0.1:4800" })).toMatchObject({ mode: "on", apiBaseUrl: "http://127.0.0.1:4800" });
    expect(resolveMailConfig({ ...base, RESEND_API_BASE_URL: "https://evil.test" })).toEqual({ mode: "off", reason: "base_url_not_allowed" });
    expect(resolveMailConfig({ ...base, RESEND_API_BASE_URL: "http://127.0.0.1:4800", VERCEL_ENV: "production" })).toEqual({ mode: "off", reason: "base_url_not_allowed" });
  });
});

describe("Resend adapter", () => {
  const mail = { to: "ana@example.test", subject: "Assunto", text: "Texto", html: "<p>Texto</p>", idempotencyKey: "lnk-mail-1", tag: "new_lead" };
  const answer = (status: number, body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));

  it("sends one request with the key, the idempotency key and nothing it was not given", async () => {
    const fetch = answer(200, { id: "re_msg_1" });
    const adapter = createResendAdapter({ apiKey: KEY, from: "Linkfav <avisos@linkfav.com>", replyTo: "ajuda@linkfav.com", fetch });
    expect(await adapter.send(mail)).toEqual({ id: "re_msg_1" });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.headers).toMatchObject({ Authorization: `Bearer ${KEY}`, "Idempotency-Key": "lnk-mail-1" });
    expect(JSON.parse(String(init.body))).toEqual({ from: "Linkfav <avisos@linkfav.com>", to: ["ana@example.test"], subject: "Assunto", text: "Texto", html: "<p>Texto</p>", reply_to: "ajuda@linkfav.com", tags: [{ name: "kind", value: "new_lead" }] });
  });

  it("asks to try later on a rate limit, a server error, a conflict or no answer, and refuses the rest", async () => {
    const kind = async (fetch: typeof globalThis.fetch) => createResendAdapter({ apiKey: KEY, from: "a@linkfav.com", replyTo: null, fetch }).send(mail).then(() => "sent", (error: unknown) => error instanceof MailError ? `${error.kind}:${error.providerCode}` : "other");
    expect(await kind(answer(429, { name: "rate_limit_exceeded", message: "ana@example.test" }))).toBe("unavailable:rate_limit_exceeded");
    expect(await kind(answer(500, {}))).toBe("unavailable:null");
    expect(await kind(answer(409, { name: "concurrent_idempotent_requests" }))).toBe("unavailable:concurrent_idempotent_requests");
    expect(await kind(answer(422, { name: "validation_error", message: "Invalid `to` field: ana@example.test" }))).toBe("rejected:validation_error");
    expect(await kind(answer(403, { name: "invalid_from_address" }))).toBe("rejected:invalid_from_address");
    expect(await kind(vi.fn(async () => { throw new TypeError("network"); }))).toBe("unavailable:null");
  });
});

describe("the e-mails", () => {
  it("writes every kind, with a link to the screen that acts on it", () => {
    const links: Record<string, string> = {
      new_lead: `/app/w/${WORKSPACE}/paginas/${PROFILE}/contatos`,
      page_suspended: `/app/w/${WORKSPACE}/paginas/${PROFILE}/moderacao`,
      appeal_decided: `/app/w/${WORKSPACE}/paginas/${PROFILE}/moderacao`,
      payment_failed: `/app/w/${WORKSPACE}/plano`,
      renewal_upcoming: `/app/w/${WORKSPACE}/plano`,
    };
    for (const kind of MAIL_KINDS) {
      const mail = renderMail(kind, WORKSPACE, payloads[kind], context);
      expect(mail?.tag).toBe(kind);
      expect(mail?.text).toContain(`https://linkfav.example${links[kind]}`);
      expect(mail?.html).toContain(`href="https://linkfav.example${links[kind]}"`);
      expect(mail?.text.startsWith("Olá, Ana.")).toBe(true);
    }
  });

  it("escapes what people wrote in the HTML and keeps it readable in the text", () => {
    const lead = renderMail("new_lead", WORKSPACE, payloads.new_lead, context);
    expect(lead?.subject).toBe("Novo contato na página Café <b>Central</b>");
    expect(lead?.html).toContain("Café &lt;b&gt;Central&lt;/b&gt;");
    expect(lead?.html).not.toContain("<b>Central</b>");
    const appeal = renderMail("appeal_decided", WORKSPACE, payloads.appeal_decided, context);
    expect(appeal?.html).not.toContain("<script>");
    expect(appeal?.text).toContain("> A página usa o <script>logo</script> de outra empresa.");
    expect(escapeHtml(`"'&<>`)).toBe("&quot;&#39;&amp;&lt;&gt;");
  });

  it("says what the notice is about, in words", () => {
    expect(renderMail("page_suspended", WORKSPACE, payloads.page_suspended, context)?.text).toContain("Motivo: Suspeita de imitação de outra pessoa ou marca.");
    expect(renderMail("payment_failed", WORKSPACE, payloads.payment_failed, context)?.text).toMatch(/plano Pro não foi aprovado\. O plano continua valendo até 21\/10\/2026\./);
    expect(renderMail("renewal_upcoming", WORKSPACE, payloads.renewal_upcoming, context)?.text).toContain("R$ 579,00");
    expect(renderMail("appeal_decided", WORKSPACE, { ...payloads.appeal_decided, accepted: true }, context)?.subject).toBe("Contestação aceita: a página Café Central voltou ao ar");
  });

  it("marks billing notices from the test environment", () => {
    const mail = renderMail("payment_failed", WORKSPACE, payloads.payment_failed, { ...context, billingIsTest: true });
    expect(mail?.subject.startsWith("[Teste] ")).toBe(true);
    expect(mail?.text).toContain("nenhum valor real foi cobrado");
    expect(renderMail("new_lead", WORKSPACE, payloads.new_lead, { ...context, billingIsTest: true })?.subject.startsWith("[Teste]")).toBe(false);
  });

  it("tells whether a reply reaches someone, and greets without a name when there is none", () => {
    const silent = renderMail("new_lead", WORKSPACE, payloads.new_lead, { ...context, replyReachesSomeone: false, recipientName: null });
    expect(silent?.text).toContain("respostas a este endereço não são lidas");
    expect(silent?.text.startsWith("Olá.")).toBe(true);
    expect(renderMail("new_lead", WORKSPACE, payloads.new_lead, context)?.text).toContain("responda a este e-mail");
  });

  it("writes nothing half-filled: a message without the shape its kind needs is not an e-mail", () => {
    expect(renderMail("new_lead", WORKSPACE, { ...payloads.new_lead, slug: "../x" }, context)).toBeNull();
    expect(renderMail("page_suspended", WORKSPACE, { ...payloads.page_suspended, category: "made_up" }, context)).toBeNull();
    expect(renderMail("appeal_decided", WORKSPACE, { ...payloads.appeal_decided, response: "" }, context)).toBeNull();
    expect(renderMail("payment_failed", WORKSPACE, { planId: "gold", graceUntil: "x" }, context)).toBeNull();
    expect(renderMail("renewal_upcoming", WORKSPACE, { ...payloads.renewal_upcoming, amountCents: -1 }, context)).toBeNull();
    expect(renderMail("new_lead", null, payloads.new_lead, context)).toBeNull();
    expect(renderMail("newsletter", WORKSPACE, {}, context)).toBeNull();
  });

  it("has the kinds the database enqueues", () => {
    const sql = readdirSync(MIGRATIONS_DIR).filter((file) => file.endsWith(".sql")).map((file) => readFileSync(MIGRATIONS_DIR + file, "utf8")).join("\n");
    expect(sql).toContain(`kind in (${MAIL_KINDS.map((kind) => `'${kind}'`).join(", ")})`);
  });
});

describe("draining the outbox", () => {
  function world(messages: ClaimedMail[], send: MailAdapter["send"]) {
    const queue = [...messages];
    const completions: Array<[string, CompletionOutcome, string | null]> = [];
    const outbox: OutboxPort = {
      claim: vi.fn(async (limit: number) => queue.splice(0, limit)),
      complete: vi.fn(async (id, outcome, error) => { completions.push([id, outcome, error]); }),
    };
    const adapter: MailAdapter = { provider: "resend", send: vi.fn(send) };
    const render = (mail: ClaimedMail) => renderMail(mail.kind, mail.workspaceId, mail.payload, context);
    return { outbox, adapter, render, completions };
  }
  const message = (id: string, overrides: Partial<ClaimedMail> = {}): ClaimedMail => ({ id, kind: "new_lead", workspaceId: WORKSPACE, payload: payloads.new_lead, attempts: 1, email: "ana@example.test", displayName: "Ana", ...overrides });

  it("claims nothing with mail off, so no attempt is spent", async () => {
    const w = world([message("m1")], async () => ({ id: "x" }));
    expect(await drainOutbox({ outbox: w.outbox, adapter: null, render: w.render, batchSize: 10, maxBatches: 1 })).toEqual({ claimed: 0, sent: 0, retried: 0, failed: 0, skipped: 0 });
    expect(w.outbox.claim).not.toHaveBeenCalled();
  });

  it("ends every claimed message in exactly one completion", async () => {
    const w = world([
      message("sent"),
      message("unconfirmed", { email: null }),
      message("broken", { payload: { title: "" } }),
      message("refused", { email: "refuse@example.test" }),
      message("down", { email: "down@example.test" }),
    ], async (mail) => {
      if (mail.to === "refuse@example.test") throw new MailError("rejected", "validation_error");
      if (mail.to === "down@example.test") throw new MailError("unavailable");
      return { id: `re_${mail.idempotencyKey}` };
    });
    expect(await drainOutbox({ outbox: w.outbox, adapter: w.adapter, render: w.render, batchSize: 10, maxBatches: 3 })).toEqual({ claimed: 5, sent: 1, retried: 1, failed: 2, skipped: 1 });
    expect(w.completions).toEqual([
      ["sent", "sent", null],
      ["unconfirmed", "skipped", "no_confirmed_address"],
      ["broken", "failed", "invalid_payload"],
      ["refused", "failed", "rejected:validation_error"],
      ["down", "retry", "unavailable"],
    ]);
    // The outbox id is the idempotency key: a retry of the same message is the same e-mail.
    expect(w.adapter.send).toHaveBeenCalledWith(expect.objectContaining({ idempotencyKey: "lnk-mail-sent", to: "ana@example.test", tag: "new_lead" }));
    expect(w.adapter.send).toHaveBeenCalledTimes(3);
  });

  it("keeps claiming while batches come full, up to its bound", async () => {
    const w = world(Array.from({ length: 7 }, (_, index) => message(`m${index}`)), async () => ({ id: "x" }));
    expect((await drainOutbox({ outbox: w.outbox, adapter: w.adapter, render: w.render, batchSize: 3, maxBatches: 2 })).sent).toBe(6);
    expect((await drainOutbox({ outbox: w.outbox, adapter: w.adapter, render: w.render, batchSize: 3, maxBatches: 2 })).sent).toBe(1);
  });
});
