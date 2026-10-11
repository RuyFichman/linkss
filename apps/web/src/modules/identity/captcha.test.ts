import { describe, expect, it } from "vitest";
import { CAPTCHA_ROUTE_SOURCE, contentSecurityPolicy } from "@/lib/security/response-headers";
import { recoveryOutcome, signInOutcome, signUpOutcome } from "./auth-outcomes";
import { CAPTCHA_FIELD, CAPTCHA_SCRIPT_ORIGIN, CAPTCHA_SCRIPT_URL, captchaSiteKey, captchaToken } from "./captcha";

function form(value?: string | Blob): FormData {
  const data = new FormData();
  if (value !== undefined) data.set(CAPTCHA_FIELD, value);
  return data;
}

describe("captcha site key", () => {
  it("accepts a key and ignores what is not one", () => {
    expect(captchaSiteKey("0x4AAAAAAAexample_KEY-1")).toBe("0x4AAAAAAAexample_KEY-1");
    expect(captchaSiteKey("  0x4AAAAAAAexample  ")).toBe("0x4AAAAAAAexample");
    for (const value of [undefined, "", "short", "has space in it", "<script>alert(1)</script>", "x".repeat(65)]) expect(captchaSiteKey(value)).toBeNull();
  });
});

describe("captcha token from a form", () => {
  it("forwards the widget's token and nothing else", () => {
    expect(captchaToken(form("token-value"))).toBe("token-value");
    expect(captchaToken(form())).toBeUndefined();
    expect(captchaToken(form(""))).toBeUndefined();
    expect(captchaToken(form("x".repeat(2049)))).toBeUndefined();
    expect(captchaToken(form(new Blob(["x"])))).toBeUndefined();
  });
});

describe("a refused captcha is told apart from every account answer", () => {
  const refused = { code: "captcha_failed", status: 400 };

  it("is never reported as wrong credentials, as a sent e-mail or as an outage", () => {
    expect(signInOutcome(refused)).toBe("captcha");
    expect(signUpOutcome(refused)).toBe("captcha");
    expect(recoveryOutcome(refused)).toBe("captcha");
  });

  it("leaves the existing outcomes as they were", () => {
    expect(signInOutcome({ code: "invalid_credentials", status: 400 })).toBe("invalid-credentials");
    expect(signUpOutcome({ code: "user_already_exists", status: 422 })).toBe("check-email");
    expect(recoveryOutcome({ code: "user_not_found", status: 400 })).toBe("check-email");
  });
});

describe("content security policy for the captcha", () => {
  const directive = (policy: string, name: string) => policy.split("; ").find((part) => part.startsWith(`${name} `)) ?? "";

  it("allows the vendor only where asked, for its script and its frame", () => {
    const policy = contentSecurityPolicy("https://example.supabase.co", false, undefined, { captcha: true });
    expect(directive(policy, "script-src")).toContain(CAPTCHA_SCRIPT_ORIGIN);
    expect(directive(policy, "frame-src")).toContain(CAPTCHA_SCRIPT_ORIGIN);
    expect(directive(policy, "connect-src")).not.toContain(CAPTCHA_SCRIPT_ORIGIN);
    expect(CAPTCHA_SCRIPT_URL.startsWith(`${CAPTCHA_SCRIPT_ORIGIN}/`)).toBe(true);
  });

  it("keeps the baseline and the public page free of it", () => {
    expect(contentSecurityPolicy("https://example.supabase.co", false)).not.toContain(CAPTCHA_SCRIPT_ORIGIN);
    expect(contentSecurityPolicy("https://example.supabase.co", false, undefined, { publicPage: true })).not.toContain(CAPTCHA_SCRIPT_ORIGIN);
  });

  it("names exactly the four form routes", () => {
    expect(CAPTCHA_ROUTE_SOURCE).toBe("/:path(entrar|cadastro|confirmar-email|recuperar-acesso)");
  });
});
