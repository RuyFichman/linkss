import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { RESERVED_SLUGS } from "./reserved-slugs";
import { fromAvailabilityStatus, normalizeSlug, validateSlug } from "./slug";

const APP_DIR = fileURLToPath(new URL("../../app/", import.meta.url));
const MIGRATIONS_DIR = fileURLToPath(new URL("../../../../../supabase/migrations/", import.meta.url));

/** Top-level URL segments: children of src/app, descending into route groups like (marketing). */
function topLevelSegments(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (!statSync(full).isDirectory() || entry.startsWith("_")) return [];
    if (entry.startsWith("(") && entry.endsWith(")")) return topLevelSegments(full);
    return [entry];
  });
}

function reservedInMigrations(): string[] {
  const sql = readdirSync(MIGRATIONS_DIR).filter((file) => file.endsWith(".sql")).map((file) => readFileSync(join(MIGRATIONS_DIR, file), "utf8")).join("\n");
  // Seed rows only (indented value tuples), not the CHECK (reason in (...)) clause.
  return [...sql.matchAll(/^\s+\('([a-z0-9-]+)', '(?:route|platform)'\)/gm)].map((match) => match[1] ?? "");
}

describe("slug normalization (parity with private.normalize_slug)", () => {
  it.each([
    ["  Café da Júlia ", "cafe-da-julia"],
    ["São  Paulo--Ipê-", "sao-paulo-ipe"],
    ["ÇÃO ÑANDU", "cao-nandu"],
    ["Loja 24h", "loja-24h"],
  ])("normalizes %j to %j", (input, expected) => expect(normalizeSlug(input)).toBe(expected));
});

describe("slug validation", () => {
  it("covers empty, invalid, length, reserved, taken and available", () => {
    expect(validateSlug("   ").status).toBe("empty");
    expect(validateSlug("cafe@ipe").status).toBe("invalid");
    expect(validateSlug("ab").status).toBe("too-short");
    expect(validateSlug("a".repeat(41)).status).toBe("too-long");
    expect(validateSlug("Entrar").status).toBe("reserved");
    expect(validateSlug("Café Ipê", ["cafe-ipe"]).status).toBe("taken");
    expect(validateSlug("cafe-ipe")).toMatchObject({ status: "available", valid: true });
  });

  it("gives every rejection an actionable pt-BR message", () => {
    for (const value of ["", "cafe@ipe", "ab", "admin"]) {
      const result = validateSlug(value);
      expect(result.valid).toBe(false);
      expect(result.message.length).toBeGreaterThan(10);
    }
    expect(fromAvailabilityStatus("cafe-ipe", "held").message).toContain("protegido");
  });

  it("maps unknown server statuses to a local rejection, never to available", () => {
    expect(fromAvailabilityStatus("cafe-ipe", "surprise").valid).toBe(false);
    expect(fromAvailabilityStatus("ab", "invalid").status).toBe("too-short");
  });
});

describe("reserved slugs", () => {
  it("TypeScript list equals the database seed (drift guard)", () => {
    expect([...reservedInMigrations()].sort()).toEqual([...RESERVED_SLUGS].sort());
  });

  it("reserves every top-level route segment", () => {
    const missing = topLevelSegments(APP_DIR).filter((segment) => !(RESERVED_SLUGS as readonly string[]).includes(segment));
    expect(missing).toEqual([]);
  });
});
