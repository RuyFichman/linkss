import { describe, expect, it } from "vitest";
import { validateWaitlist } from "./validation";

function validForm(startedAt = 1_000): FormData { const form = new FormData(); form.set("name", "Ana Lima"); form.set("email", "ana@example.com"); form.set("segment", "freelancer"); form.set("managedProfiles", "2-5"); form.set("willingnessToPay", "15-30"); form.set("pilotInterest", "yes"); form.set("consent", "yes"); form.set("variant", "neutral"); form.set("startedAt", String(startedAt)); return form; }

describe("waitlist validation", () => {
  it("accepts a complete submission", () => expect(validateWaitlist(validForm(), 4_000).ok).toBe(true));
  it("rejects honeypot and submissions that are too fast", () => { const trap = validForm(); trap.set("companyWebsite", "spam.test"); expect(validateWaitlist(trap, 4_000)).toMatchObject({ ok: false, bot: true }); expect(validateWaitlist(validForm(3_500), 4_000)).toMatchObject({ ok: false, bot: true }); });
  it("requires consent and valid fields", () => { const form = validForm(); form.delete("consent"); form.set("email", "invalid"); const result = validateWaitlist(form, 4_000); expect(result.ok).toBe(false); if (!result.ok) { expect(result.errors.email).toBeTruthy(); expect(result.errors.consent).toBeTruthy(); } });
});
