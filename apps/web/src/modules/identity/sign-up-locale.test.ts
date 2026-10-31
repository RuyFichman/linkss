import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ signUp: vi.fn(), cookieSet: vi.fn() }));

vi.mock("next/headers", () => ({ headers: async () => new Headers(), cookies: async () => ({ set: mocks.cookieSet }) }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("./session", () => ({ getSupabase: async () => ({ auth: { signUp: mocks.signUp } }), ensurePersonalWorkspace: vi.fn(), getCurrentUserId: vi.fn() }));
vi.mock("./timing", () => ({ NEUTRAL_RESPONSE_MIN_MS: 0, withMinimumDuration: (work: () => Promise<unknown>) => work() }));
vi.mock("@/modules/audit/record", () => ({ recordAuthEvent: vi.fn() }));
vi.mock("@/lib/observability/logger", async (original) => ({ ...(await original<typeof import("@/lib/observability/logger")>()), logEvent: vi.fn() }));

const { signUpAction } = await import("./actions");
const { AUTH_COPY: PORTUGUESE } = await import("@/content/pt-BR");
const { AUTH_COPY: SPANISH } = await import("@/content/es-ES");

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

const VALID = { name: "Lucía Molina", email: "lucia@example.test", password: "clave1234" };
const sentLocale = () => (mocks.signUp.mock.calls[0]?.[0] as { options: { data: { locale: string } } }).options.data.locale;

describe("sign-up language (ADR 0022)", () => {
  beforeEach(() => {
    mocks.signUp.mockReset().mockResolvedValue({ error: null });
  });

  it("records the language of a Spanish form and answers in Spanish", async () => {
    const state = await signUpAction({ status: "idle" }, form({ ...VALID, locale: "es-ES" }));
    expect(sentLocale()).toBe("es-ES");
    expect(state).toEqual({ status: "success", message: SPANISH.signUp.checkEmail });
  });

  it("validates in Spanish without asking Auth", async () => {
    const state = await signUpAction({ status: "idle" }, form({ name: "L", email: "nope", password: "short", locale: "es-ES" }));
    expect(mocks.signUp).not.toHaveBeenCalled();
    expect(state.message).toBe(SPANISH.validation.summary);
    expect(state.fieldErrors).toEqual({ name: SPANISH.validation.name, email: SPANISH.validation.email, password: SPANISH.validation.passwordTooShort });
  });

  it("answers an Auth refusal in the form's language", async () => {
    mocks.signUp.mockResolvedValue({ error: { code: "over_request_rate_limit", status: 429, message: "rate limited" } });
    const state = await signUpAction({ status: "idle" }, form({ ...VALID, locale: "es-ES" }));
    expect(state.message).toBe(SPANISH.rateLimited);
  });

  it("keeps the Portuguese form as before", async () => {
    const state = await signUpAction({ status: "idle" }, form(VALID));
    expect(sentLocale()).toBe("pt-BR");
    expect(state).toEqual({ status: "success", message: PORTUGUESE.signUp.checkEmail });
  });

  it("never sends an unsupported language", async () => {
    for (const locale of ["fr-FR", "es", "ES-es", "pt-BR' or 1=1"]) {
      mocks.signUp.mockClear();
      await signUpAction({ status: "idle" }, form({ ...VALID, locale }));
      expect(sentLocale()).toBe("pt-BR");
    }
  });
});
