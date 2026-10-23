import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { COMPENSATION_RULE_BUNDLES } from "../src";
import {
  INSTITUTION_REGISTRY,
  INSTITUTION_RULE_FIELDS,
  type InstitutionRegistry,
  lookupInstitutionRules,
  normalizeInstitutionName,
  parseInstitutionRegistry,
} from "../src/institutions";

const repoRoot = resolve(__dirname, "../../..");
const sourcesDir = resolve(repoRoot, "docs/sources/institutions");

function sha256(path: string) {
  return createHash("sha256")
    .update(readFileSync(resolve(repoRoot, path)))
    .digest("hex");
}

const squash = (text: string) => text.replace(/\s+/g, "");

function knownFacts(registry: InstitutionRegistry) {
  return registry.institutions.flatMap((institution) =>
    INSTITUTION_RULE_FIELDS.flatMap((field) => {
      const entry = institution.rules[field];
      return Array.isArray(entry)
        ? entry.map((fact) => ({ institution, field, fact }))
        : [];
    }),
  );
}

describe("institution registry provenance", () => {
  const sources = new Map(INSTITUTION_REGISTRY.sources.map((s) => [s.id, s]));

  it("re-hashes every stored extract and original", () => {
    for (const source of INSTITUTION_REGISTRY.sources) {
      expect(sha256(source.extract.file), source.id).toBe(
        source.extract.sha256,
      );
      if (source.original.file !== null) {
        expect(sha256(source.original.file), source.id).toBe(
          source.original.sha256,
        );
      }
    }
  });

  it("matches SHA256SUMS for every file under docs/sources/institutions", () => {
    const sums = readFileSync(resolve(sourcesDir, "SHA256SUMS"), "utf8")
      .trim()
      .split("\n")
      .map((line) => line.split(/\s{2}/) as [string, string]);
    const listed = new Set(sums.map(([, file]) => file));
    for (const [hash, file] of sums) {
      expect(sha256(`docs/sources/institutions/${file}`), file).toBe(hash);
    }
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const path = resolve(dir, name);
        return statSync(path).isDirectory() ? walk(path) : [path];
      });
    const onDisk = walk(sourcesDir)
      .map((path) => relative(sourcesDir, path))
      .filter((file) => file !== "SHA256SUMS");
    expect(new Set(onDisk)).toEqual(listed);
  });

  it("finds every quote verbatim (ignoring whitespace) in its stored extract", () => {
    const facts = knownFacts(INSTITUTION_REGISTRY);
    expect(facts.length).toBeGreaterThan(0);
    const squashed = new Map<string, string>();
    for (const { institution, field, fact } of facts) {
      for (const evidence of fact.evidence) {
        const source = sources.get(evidence.sourceId)!;
        let text = squashed.get(source.extract.file);
        if (text === undefined) {
          text = squash(
            readFileSync(resolve(repoRoot, source.extract.file), "utf8"),
          );
          squashed.set(source.extract.file, text);
        }
        expect(
          text.includes(squash(evidence.quote)),
          `${institution.id}.${field} quote not in ${source.extract.file}`,
        ).toBe(true);
      }
    }
  });

  it("only records amounts that are written in the quoted text", () => {
    for (const { institution, field, fact } of knownFacts(
      INSTITUTION_REGISTRY,
    )) {
      if (typeof fact.value !== "number") continue;
      const written = [fact.value.toLocaleString("en-US"), String(fact.value)];
      expect(
        fact.evidence.some((e) =>
          written.some((form) => squash(e.quote).includes(form)),
        ),
        `${institution.id}.${field}=${fact.value}`,
      ).toBe(true);
    }
  });

  it("cites official domains only", () => {
    // Public bodies whose own site is not under go/or/re/ac.kr:
    // 서울교통공사, 경상북도교육청 and 부산광역시교육청's school-site platform.
    const officialOtherHosts = new Set([
      "www.seoulmetro.co.kr",
      "www.gbe.kr",
      "school.busanedu.net",
    ]);
    for (const source of INSTITUTION_REGISTRY.sources) {
      const host = new URL(source.url).hostname;
      expect(
        /\.(go|or|re|ac)\.kr$/.test(host) || officialOtherHosts.has(host),
        `${source.id}: ${host}`,
      ).toBe(true);
    }
  });

  it("never records a 2026 meal amount below the MMA minimum without flagging it", () => {
    const minimum = COMPENSATION_RULE_BUNDLES[0]!.meal.minimumDailyAmount;
    for (const { institution, field, fact } of knownFacts(
      INSTITUTION_REGISTRY,
    )) {
      if (field !== "MEAL_DAILY_AMOUNT" || fact.effectiveYear !== 2026) {
        continue;
      }
      if (typeof fact.value === "number" && fact.value < minimum) {
        expect(fact.note, institution.id).toMatch(/최소기준/);
      }
    }
  });

  it("keeps every source file it names on disk", () => {
    for (const source of INSTITUTION_REGISTRY.sources) {
      expect(existsSync(resolve(repoRoot, source.extract.file))).toBe(true);
    }
  });
});

const fixture = (): InstitutionRegistry => {
  const unknown = { status: "UNKNOWN" as const };
  const rules = Object.fromEntries(
    INSTITUTION_RULE_FIELDS.map((field) => [field, unknown]),
  ) as InstitutionRegistry["institutions"][number]["rules"];
  const source = INSTITUTION_REGISTRY.sources[0]!;
  return parseInstitutionRegistry({
    schemaVersion: "1.0.0",
    registryId: "kr.social-service.institution-rules",
    retrievedFrom: "2026-10-22",
    retrievedUntil: "2026-10-22",
    sources: [{ ...source, sourceType: "BUDGET_GUIDELINE" }],
    institutions: [
      {
        id: "test-edu",
        name: "가나도교육청",
        type: "EDUCATION_OFFICE",
        region: "가나",
        aliases: ["가나교육청"],
        scopeNote: "test",
        rules: {
          ...rules,
          MEAL_DAILY_AMOUNT: [
            {
              status: "KNOWN",
              value: 9000,
              valueKind: "BUDGET_UNIT_PRICE",
              effectiveYear: 2025,
              confidence: "MEDIUM",
              evidence: [{ sourceId: source.id, locator: "p.1", quote: "x9" }],
            },
          ],
        },
      },
      {
        id: "test-metro",
        name: "가나도",
        type: "METRO_GOV",
        region: "가나",
        aliases: ["가나도청"],
        scopeNote: "test",
        rules,
      },
    ],
  });
};

describe("lookupInstitutionRules", () => {
  it("matches the official name and aliases after normalization", () => {
    const registry = fixture();
    const byName = lookupInstitutionRules(" 가나도 교육청 ", { registry });
    expect(byName).toMatchObject({
      status: "MATCHED",
      matchedBy: "NAME",
      institution: { id: "test-edu" },
    });
    expect(lookupInstitutionRules("가나교육청", { registry })).toMatchObject({
      status: "MATCHED",
      matchedBy: "ALIAS",
      institution: { id: "test-edu" },
    });
    expect(normalizeInstitutionName("Ｓeoul (본청)")).toBe("seoul본청");
  });

  it("does not apply a partial match; it only suggests", () => {
    const result = lookupInstitutionRules("가나", { registry: fixture() });
    expect(result.status).toBe("UNKNOWN_INSTITUTION");
    if (result.status !== "UNKNOWN_INSTITUTION") return;
    expect(result.suggestions.map((s) => s.id).sort()).toEqual([
      "test-edu",
      "test-metro",
    ]);
  });

  it("returns every field, with UNKNOWN where nothing is cited", () => {
    const result = lookupInstitutionRules("가나도", { registry: fixture() });
    if (result.status !== "MATCHED") throw new Error("expected a match");
    expect(Object.keys(result.fields).sort()).toEqual(
      [...INSTITUTION_RULE_FIELDS].sort(),
    );
    expect(
      Object.values(result.fields).every((f) => f.status === "UNKNOWN"),
    ).toBe(true);
  });

  it("flags a budget unit price and a year mismatch instead of hiding them", () => {
    const result = lookupInstitutionRules("가나도교육청", {
      registry: fixture(),
      year: 2026,
    });
    if (result.status !== "MATCHED") throw new Error("expected a match");
    const meal = result.fields.MEAL_DAILY_AMOUNT;
    expect(meal.status).toBe("KNOWN");
    if (meal.status !== "KNOWN") return;
    expect(meal.facts[0]).toMatchObject({ value: 9000, yearMatches: false });
    expect(meal.facts[0]!.sources[0]!.id).toBe(
      INSTITUTION_REGISTRY.sources[0]!.id,
    );
    expect(result.warnings.join(" ")).toContain("2026년 근거가 없고");
    expect(result.warnings.join(" ")).toContain("예산편성 기준단가");
  });

  it("returns UNKNOWN_INSTITUTION for an unregistered or empty name", () => {
    expect(lookupInstitutionRules("없는구청").status).toBe(
      "UNKNOWN_INSTITUTION",
    );
    expect(lookupInstitutionRules("   ").status).toBe("UNKNOWN_INSTITUTION");
  });

  it("rejects an alias shared by two institutions", () => {
    const registry = fixture();
    registry.institutions[1]!.aliases.push("가나교육청");
    expect(() => parseInstitutionRegistry(registry)).toThrow(/aliases/);
  });

  it("rejects a hand-set confidence that the source type does not support", () => {
    const registry = fixture();
    const meal = registry.institutions[0]!.rules.MEAL_DAILY_AMOUNT;
    if (!Array.isArray(meal)) throw new Error("fixture");
    meal[0]!.confidence = "HIGH";
    expect(() => parseInstitutionRegistry(registry)).toThrow(/Confidence/);
  });

  it("resolves every real registry name to itself", () => {
    for (const institution of INSTITUTION_REGISTRY.institutions) {
      for (const name of [institution.name, ...institution.aliases]) {
        const result = lookupInstitutionRules(name);
        expect(result.status, name).toBe("MATCHED");
        if (result.status === "MATCHED") {
          expect(result.institution.id).toBe(institution.id);
        }
      }
    }
  });
});
