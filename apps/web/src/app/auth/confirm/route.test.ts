import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verifyOtp: vi.fn(),
  exchangeCodeForSession: vi.fn(),
  ensurePersonalWorkspace: vi.fn(),
  recordAuthEvent: vi.fn(),
}));

class RedirectSignal extends Error {
  constructor(readonly location: string) { super(location); }
}

vi.mock("next/navigation", () => ({ redirect: (location: string) => { throw new RedirectSignal(location); } }));
vi.mock("@/modules/identity/session", () => ({
  getSupabase: async () => ({ auth: { verifyOtp: mocks.verifyOtp, exchangeCodeForSession: mocks.exchangeCodeForSession } }),
  ensurePersonalWorkspace: mocks.ensurePersonalWorkspace,
}));
vi.mock("@/modules/audit/record", () => ({ recordAuthEvent: mocks.recordAuthEvent }));

const { GET } = await import("./route");

async function landing(query: string): Promise<string> {
  try {
    await GET(new NextRequest(`https://exemplo.test/auth/confirm?${query}`));
  } catch (error) {
    if (error instanceof RedirectSignal) return error.location;
    throw error;
  }
  throw new Error("expected a redirect");
}

describe("/auth/confirm", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    for (const mock of Object.values(mocks)) mock.mockReset();
    mocks.verifyOtp.mockResolvedValue({ error: null });
    mocks.exchangeCodeForSession.mockResolvedValue({ error: null });
    mocks.ensurePersonalWorkspace.mockResolvedValue("workspace-id");
  });

  it("signs in and goes to the app when the PKCE code is exchanged", async () => {
    expect(await landing("code=abc&next=/app")).toBe("/app");
    expect(mocks.ensurePersonalWorkspace).toHaveBeenCalledTimes(1);
  });

  // Regression (staging, 2026-10-02): a resend in the same browser replaced the code-verifier cookie.
  // The email was already confirmed by /verify; "link expired" was wrong and led to useless resends.
  for (const code of ["bad_code_verifier", "pkce_code_verifier_not_found", "flow_state_not_found"]) {
    it(`sends a confirmation whose code exchange fails (${code}) to sign-in, without a session`, async () => {
      mocks.exchangeCodeForSession.mockResolvedValue({ error: { code } });
      expect(await landing("code=abc&next=/app")).toBe("/entrar?email=confirmado");
      expect(mocks.ensurePersonalWorkspace).not.toHaveBeenCalled();
      expect(mocks.recordAuthEvent).not.toHaveBeenCalled();
    });
  }

  it("keeps 'link expired' for a dead token_hash link and for a link with nothing to verify", async () => {
    mocks.verifyOtp.mockResolvedValue({ error: { code: "otp_expired" } });
    expect(await landing("token_hash=t&type=signup&next=/app")).toBe("/confirmar-email?erro=link-expirado");
    expect(await landing("next=/app")).toBe("/confirmar-email?erro=link-expirado");
  });

  it("asks for a new recovery link when a recovery code cannot be exchanged", async () => {
    mocks.exchangeCodeForSession.mockResolvedValue({ error: { code: "bad_code_verifier" } });
    expect(await landing("code=abc&next=/redefinir-senha")).toBe("/recuperar-acesso?erro=link-expirado");
  });
});
