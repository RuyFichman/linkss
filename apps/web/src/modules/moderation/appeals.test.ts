import { describe, expect, it } from "vitest";
import { MODERATION_COPY } from "@/content/pt-BR";
import { APPEAL_MAX_LENGTH, appealOutcome, canSendAppeal, parseAppealMessage, parsePageModeration, SUSPENSION_CATEGORIES, type PageModeration } from "./appeals";

const suspended: PageModeration = { status: "suspended", title: "Página", slug: "pagina", category: "spam", suspendedAt: "2026-10-11T10:00:00Z", canAppeal: true, appealsLeft: 3, appeals: [] };

describe("appeal message", () => {
  it("trims and accepts a message within the limits, keeping line breaks", () => {
    expect(parseAppealMessage("  Somos a própria marca.\nSegue o registro.  ")).toEqual({ ok: true, message: "Somos a própria marca.\nSegue o registro." });
    expect(parseAppealMessage("x".repeat(APPEAL_MAX_LENGTH))).toMatchObject({ ok: true });
  });

  it("says what is wrong with the others", () => {
    expect(parseAppealMessage("curto")).toEqual({ ok: false, problem: "too_short" });
    expect(parseAppealMessage(`   ${"x".repeat(19)}   `)).toEqual({ ok: false, problem: "too_short" });
    expect(parseAppealMessage("x".repeat(APPEAL_MAX_LENGTH + 1))).toEqual({ ok: false, problem: "too_long" });
    expect(parseAppealMessage(`Mensagem com controle \u0007 no meio dela.`)).toEqual({ ok: false, problem: "invalid" });
    for (const value of [null, undefined, 42, new Blob(["x"])]) expect(parseAppealMessage(value)).toEqual({ ok: false, problem: "invalid" });
  });
});

describe("appeal answers from the database", () => {
  it("maps each error code to an outcome that has a message", () => {
    const outcomes = [["22023"], ["42501"], ["P0002"], ["LK126"], ["LK127"], ["LK128"], ["57014"], [null]].map(([code]) => appealOutcome(code, false));
    expect(outcomes).toEqual(["invalid", "forbidden", "not_found", "not_suspended", "already_open", "limit_reached", "unavailable", "unavailable"]);
    expect(appealOutcome("PGRST202", true)).toBe("not_deployed");
    for (const outcome of [...outcomes, "not_deployed" as const]) expect(MODERATION_COPY.appeal.errors[outcome].length).toBeGreaterThan(10);
  });
});

describe("page moderation read", () => {
  it("reads a suspended page with its appeals", () => {
    expect(parsePageModeration({ status: "suspended", title: "Página", slug: "pagina", category: "impersonation", suspendedAt: "2026-10-11T10:00:00Z", canAppeal: true, appealsLeft: 2, appeals: [
      { status: "denied", createdAt: "2026-10-11T11:00:00Z", decidedAt: "2026-10-11T12:00:00Z", response: "Não se aplica.", message: "Texto da contestação." },
      { status: "weird", createdAt: "2026-10-11T11:00:00Z" }, null,
    ] })).toEqual({ status: "suspended", title: "Página", slug: "pagina", category: "impersonation", suspendedAt: "2026-10-11T10:00:00Z", canAppeal: true, appealsLeft: 2, appeals: [
      { status: "denied", createdAt: "2026-10-11T11:00:00Z", decidedAt: "2026-10-11T12:00:00Z", response: "Não se aplica.", message: "Texto da contestação." },
    ] });
  });

  it("falls back safely on unknown values and refuses a malformed answer", () => {
    expect(parsePageModeration({ status: "active", title: "P", slug: "p", category: "made-up", canAppeal: "yes", appealsLeft: -1, appeals: "x" })).toEqual({ status: "active", title: "P", slug: "p", category: null, suspendedAt: null, canAppeal: false, appealsLeft: 0, appeals: [] });
    for (const value of [null, "x", {}, { status: "banned", title: "P", slug: "p" }, { status: "active" }]) expect(parsePageModeration(value)).toBeNull();
  });

  it("has a label for every category", () => {
    for (const category of SUSPENSION_CATEGORIES) expect(MODERATION_COPY.categories[category].length).toBeGreaterThan(3);
  });
});

describe("when the appeal form is offered", () => {
  it("only for a suspended page, to who may appeal, with none waiting and some left", () => {
    expect(canSendAppeal(suspended)).toBe(true);
    expect(canSendAppeal({ ...suspended, status: "active" })).toBe(false);
    expect(canSendAppeal({ ...suspended, canAppeal: false })).toBe(false);
    expect(canSendAppeal({ ...suspended, appealsLeft: 0 })).toBe(false);
    expect(canSendAppeal({ ...suspended, appeals: [{ status: "open", createdAt: "2026-10-11T11:00:00Z", decidedAt: null, response: null, message: null }] })).toBe(false);
    expect(canSendAppeal({ ...suspended, appeals: [{ status: "denied", createdAt: "2026-10-11T11:00:00Z", decidedAt: "2026-10-11T12:00:00Z", response: "Não.", message: null }] })).toBe(true);
  });
});
