import { describe, expect, it, vi } from "vitest";
import { AUTH_COPY } from "@/content/pt-BR";
import { passwordUpdateOutcome, parseLinkType, recoveryOutcome, signInOutcome, signUpOutcome } from "./auth-outcomes";
import { passwordError, validateNewPassword, validateSignIn, validateSignUp } from "./auth-validation";
import { AuthorizationError, requireWorkspaceAccess, type IdentityPort } from "./guard";
import { PERMISSIONS, WORKSPACE_ROLES, can, canChangeRole, canRemoveMember, type WorkspaceRole } from "./permissions";
import { safeNextPath } from "./redirects";
import { withMinimumDuration } from "./timing";

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

describe("permission matrix (mirrors docs/adr/0004 and RLS)", () => {
  it("matches the documented matrix exactly", () => {
    const matrix = Object.fromEntries(Object.keys(PERMISSIONS).map((action) => [action, WORKSPACE_ROLES.filter((role) => can(role, action as keyof typeof PERMISSIONS))]));
    expect(matrix).toEqual({
      "workspace.view": ["owner", "admin", "editor"],
      "workspace.rename": ["owner", "admin"],
      "workspace.delete": ["owner"],
      "members.view": ["owner", "admin", "editor"],
      "members.change_role": ["owner", "admin"],
      "members.remove": ["owner", "admin"],
      "profile.view": ["owner", "admin", "editor"],
      "profile.create": ["owner", "admin"],
      "profile.edit_content": ["owner", "admin", "editor"],
      "profile.change_slug": ["owner", "admin"],
      "profile.delete": ["owner", "admin"],
      "profile.publish": ["owner", "admin", "editor"],
      "audit.view": ["owner", "admin"],
    });
  });

  it("denies everything without a role", () => {
    expect(can(null, "profile.view")).toBe(false);
    expect(can(undefined, "workspace.view")).toBe(false);
  });

  it("limits admins to non-owner role changes and removals", () => {
    expect(canChangeRole("owner", "owner", "admin")).toBe(true);
    expect(canChangeRole("admin", "editor", "admin")).toBe(true);
    expect(canChangeRole("admin", "editor", "owner")).toBe(false);
    expect(canChangeRole("admin", "owner", "editor")).toBe(false);
    expect(canChangeRole("editor", "editor", "admin")).toBe(false);
    expect(canRemoveMember("admin", "owner", false)).toBe(false);
    expect(canRemoveMember("admin", "editor", false)).toBe(true);
    expect(canRemoveMember("editor", "admin", false)).toBe(false);
    expect(canRemoveMember("editor", "editor", true)).toBe(true);
  });
});

describe("redirect allowlist", () => {
  it.each([
    ["/app", "/app"],
    ["/app/w/123?aba=paginas", "/app/w/123?aba=paginas"],
    ["/redefinir-senha", "/redefinir-senha"],
  ])("accepts internal path %j", (input, expected) => expect(safeNextPath(input)).toBe(expected));

  it.each([
    null,
    "",
    "https://evil.example/app",
    "//evil.example/app",
    "/\\evil.example",
    "/app\\..\\evil",
    "javascript:alert(1)",
    "/%2F%2Fevil.example",
    "/app%2f..%2f..",
    "/entrar",
    "/apps",
    "/proto",
    "app",
    `/app/${"a".repeat(600)}`,
    "/app\n/evil",
  ])("rejects %j", (input) => expect(safeNextPath(input)).toBe("/app"));

  it("normalizes dot segments before checking the allowlist", () => {
    expect(safeNextPath("/app/../proto")).toBe("/app");
    expect(safeNextPath("/app/./w")).toBe("/app/w");
  });

  it("uses the provided fallback", () => expect(safeNextPath("https://evil.example", "/redefinir-senha")).toBe("/redefinir-senha"));
});

describe("auth input validation", () => {
  it("validates sign-up fields with field-level messages", () => {
    const result = validateSignUp(form({ name: "A", email: "nope", password: "short" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors).toEqual({ name: AUTH_COPY.validation.name, email: AUTH_COPY.validation.email, password: AUTH_COPY.validation.passwordTooShort });
  });

  it("normalizes a valid sign-up", () => {
    const result = validateSignUp(form({ name: "  Ana   Lima ", email: " Ana@Example.COM ", password: "senha1234" }));
    expect(result).toEqual({ ok: true, value: { name: "Ana Lima", email: "ana@example.com", password: "senha1234" } });
  });

  it("enforces the password policy of config.toml", () => {
    expect(passwordError("abcdefgh")).toBe(AUTH_COPY.validation.passwordLettersDigits);
    expect(passwordError("12345678")).toBe(AUTH_COPY.validation.passwordLettersDigits);
    expect(passwordError("senha123")).toBeUndefined();
    expect(passwordError("çãõáéí12")).toBeUndefined();
    expect(passwordError(`a1${"x".repeat(71)}`)).toBe(AUTH_COPY.validation.passwordTooLong);
  });

  it("requires sign-in fields and matching new passwords", () => {
    expect(validateSignIn(form({ email: "ana@example.com", password: "" })).ok).toBe(false);
    const mismatch = validateNewPassword(form({ password: "senha1234", confirmation: "senha12345" }));
    expect(mismatch.ok === false && mismatch.errors.confirmation).toBe(AUTH_COPY.validation.passwordMismatch);
    expect(validateNewPassword(form({ password: "senha1234", confirmation: "senha1234" })).ok).toBe(true);
  });
});

describe("neutral auth outcomes (anti-enumeration)", () => {
  it("sign-up for new and existing emails yields the same outcome", () => {
    expect(signUpOutcome(null)).toBe("check-email");
    expect(signUpOutcome({ code: "user_already_exists", status: 422 })).toBe("check-email");
    expect(signUpOutcome({ code: "email_exists", status: 422 })).toBe("check-email");
    expect(signUpOutcome({ code: "over_email_send_rate_limit", status: 429 })).toBe("check-email");
  });

  it("sign-up surfaces only existence-independent problems", () => {
    expect(signUpOutcome({ code: "weak_password", status: 422 })).toBe("weak-password");
    expect(signUpOutcome({ code: "over_request_rate_limit", status: 429 })).toBe("rate-limited");
    expect(signUpOutcome({ code: "unexpected_failure", status: 500 })).toBe("unavailable");
  });

  it("recovery answers the same for known, unknown and throttled emails", () => {
    expect(recoveryOutcome(null)).toBe("check-email");
    expect(recoveryOutcome({ code: "user_not_found", status: 400 })).toBe("check-email");
    expect(recoveryOutcome({ code: "over_email_send_rate_limit", status: 429 })).toBe("check-email");
    expect(recoveryOutcome({ code: "over_request_rate_limit", status: 429 })).toBe("rate-limited");
    expect(recoveryOutcome({ status: 503 })).toBe("unavailable");
    expect(recoveryOutcome({})).toBe("unavailable");
  });

  it("sign-in never distinguishes unknown email from wrong password", () => {
    expect(signInOutcome({ code: "invalid_credentials", status: 400 })).toBe("invalid-credentials");
    expect(signInOutcome({ code: "user_not_found", status: 400 })).toBe("invalid-credentials");
    expect(signInOutcome({ code: "email_not_confirmed", status: 400 })).toBe("email-not-confirmed");
    expect(signInOutcome({ status: 502 })).toBe("unavailable");
  });

  it("maps password update failures", () => {
    expect(passwordUpdateOutcome({ code: "same_password", status: 422 })).toBe("same-password");
    expect(passwordUpdateOutcome({ code: "session_not_found", status: 403 })).toBe("session-expired");
    expect(passwordUpdateOutcome(null)).toBe("updated");
  });

  it("uses one message for both sign-up paths", () => {
    const outcomes = [signUpOutcome(null), signUpOutcome({ code: "user_already_exists", status: 422 })];
    expect(new Set(outcomes).size).toBe(1);
    expect(AUTH_COPY.signUp.checkEmail).not.toMatch(/já existe|cadastrado|encontrad/i);
    expect(AUTH_COPY.recovery.sent).toMatch(/^Se existir/);
  });

  it("accepts only the email-link types we send", () => {
    expect(parseLinkType("recovery")).toBe("recovery");
    expect(parseLinkType("email")).toBe("email");
    expect(parseLinkType("invite")).toBeNull();
    expect(parseLinkType(null)).toBeNull();
  });
});

describe("minimum response duration", () => {
  it("pads fast work up to the floor and preserves results", async () => {
    let now = 0;
    const sleep = vi.fn(async (ms: number) => { now += ms; });
    const value = await withMinimumDuration(async () => { now += 100; return "ok"; }, 900, () => now, sleep);
    expect(value).toBe("ok");
    expect(sleep).toHaveBeenCalledWith(800);
  });

  it("pads failures too and does not delay slow work", async () => {
    let now = 0;
    const sleep = vi.fn(async (ms: number) => { now += ms; });
    await expect(withMinimumDuration(async () => { now += 50; throw new Error("boom"); }, 900, () => now, sleep)).rejects.toThrow("boom");
    expect(sleep).toHaveBeenCalledWith(850);
    sleep.mockClear();
    await withMinimumDuration(async () => { now += 1200; }, 900, () => now, sleep);
    expect(sleep).not.toHaveBeenCalled();
  });
});

describe("workspace authorization guard", () => {
  const WS_A = "11111111-1111-4111-8111-111111111111";
  const WS_B = "22222222-2222-4222-8222-222222222222";
  const identity = (userId: string | null, roles: Record<string, WorkspaceRole>): IdentityPort => ({
    currentUserId: async () => userId,
    roleIn: vi.fn(async (_user: string, workspaceId: string) => roles[workspaceId] ?? null),
  });

  it("returns access for a member with permission", async () => {
    await expect(requireWorkspaceAccess(identity("u1", { [WS_A]: "admin" }), WS_A, "profile.create")).resolves.toEqual({ userId: "u1", workspaceId: WS_A, role: "admin" });
  });

  it("rejects anonymous callers", async () => {
    await expect(requireWorkspaceAccess(identity(null, {}), WS_A, "profile.view")).rejects.toMatchObject({ reason: "unauthenticated" });
  });

  it("answers not_found for a forged workspace id, never forbidden", async () => {
    await expect(requireWorkspaceAccess(identity("u1", { [WS_A]: "owner" }), WS_B, "profile.view")).rejects.toMatchObject({ reason: "not_found" });
  });

  it("answers not_found for malformed ids without querying", async () => {
    const port = identity("u1", { [WS_A]: "owner" });
    for (const forged of ["../w", "1 or 1=1", 42, null, { id: WS_A }]) {
      await expect(requireWorkspaceAccess(port, forged, "profile.view")).rejects.toBeInstanceOf(AuthorizationError);
    }
    expect(port.roleIn).not.toHaveBeenCalled();
  });

  it("answers forbidden when the role lacks the capability", async () => {
    await expect(requireWorkspaceAccess(identity("u1", { [WS_A]: "editor" }), WS_A, "profile.change_slug")).rejects.toMatchObject({ reason: "forbidden" });
  });
});

describe("agency workspace name", () => {
  it("mirrors create_agency_workspace (2–80 characters after trimming)", async () => {
    const { validateAgencyName } = await import("./workspace-validation");
    expect(validateAgencyName("  Agência   Aurora ")).toEqual({ ok: true, value: "Agência Aurora" });
    expect(validateAgencyName(" A ").ok).toBe(false);
    expect(validateAgencyName("x".repeat(81)).ok).toBe(false);
  });
});
