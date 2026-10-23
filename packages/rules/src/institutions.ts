import { isDateOnly } from "@super-gongik/domain";
import { z } from "zod";

import institutionRegistryJson from "../institutions/registry.json";

/**
 * Institution-level (복무기관별) payroll evidence.
 *
 * The nationwide compensation bundle fixes base pay, the 2026 meal minimum and
 * the transport fare basis. Everything an individual institution decides on
 * top of that (its meal amount, which days earn allowances, rounding, pay day)
 * lives here, one cited fact at a time. A field that no retrieved official
 * document states is `UNKNOWN`: the registry never fills it with a national
 * default, a neighbouring institution's value or a guess.
 */

export const institutionRuleFieldSchema = z.enum([
  "MEAL_DAILY_AMOUNT",
  "TRANSPORT_DAILY_AMOUNT",
  "TRANSPORT_METHOD",
  "MEAL_ON_LEAVE",
  "TRANSPORT_ON_LEAVE",
  "MEAL_ON_ABSENCE",
  "TRANSPORT_ON_ABSENCE",
  "MEAL_ON_PARTIAL_DAY",
  "ROUNDING",
  "PAY_DAY",
  "WORK_DAYS_RULE",
  "OTHER",
]);

export type InstitutionRuleField = z.infer<typeof institutionRuleFieldSchema>;

export const INSTITUTION_RULE_FIELDS = institutionRuleFieldSchema.options;

const AMOUNT_FIELDS: readonly InstitutionRuleField[] = [
  "MEAL_DAILY_AMOUNT",
  "TRANSPORT_DAILY_AMOUNT",
];

const DAY_ELIGIBILITY_FIELDS: readonly InstitutionRuleField[] = [
  "MEAL_ON_LEAVE",
  "TRANSPORT_ON_LEAVE",
  "MEAL_ON_ABSENCE",
  "TRANSPORT_ON_ABSENCE",
];

export const institutionTypeSchema = z.enum([
  "EDUCATION_OFFICE",
  "METRO_GOV",
  "LOCAL_GOV",
  "CENTRAL_AGENCY",
  "PUBLIC_INSTITUTION",
  "OTHER",
]);

export type InstitutionType = z.infer<typeof institutionTypeSchema>;

/**
 * `PAYMENT_RULE`: the document states what the agent is paid.
 * `BUDGET_UNIT_PRICE`: a 예산편성 기준단가 — the planning number the payer
 * budgets with. It is evidence, not proof of the amount actually paid.
 */
export const institutionValueKindSchema = z.enum([
  "PAYMENT_RULE",
  "BUDGET_UNIT_PRICE",
]);

export type InstitutionValueKind = z.infer<typeof institutionValueKindSchema>;

export const institutionSourceTypeSchema = z.enum([
  "STATUTE_OR_ORDINANCE",
  "ADMINISTRATIVE_RULE",
  "INSTITUTION_GUIDELINE",
  "PAYMENT_RECORD",
  "BUDGET_GUIDELINE",
  "OFFICIAL_WEB_PAGE",
  "OFFICIAL_QNA",
]);

export type InstitutionSourceType = z.infer<typeof institutionSourceTypeSchema>;

/**
 * Derived from the source type and value kind, never set by hand:
 * - `HIGH`: a rule, ordinance, institution guideline or payment approval
 *   (지급 결재문서) states the payment.
 * - `MEDIUM`: a budget guideline's unit price, an official explanatory web
 *   page or an official Q&A answer.
 */
export const institutionConfidenceSchema = z.enum(["HIGH", "MEDIUM"]);

export type InstitutionConfidence = z.infer<typeof institutionConfidenceSchema>;

const dateOnlySchema = z
  .string()
  .refine(isDateOnly, "Dates must use a valid YYYY-MM-DD value.");

const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);

/**
 * zod's .url() builds a \`URL\`, which JavaScriptCore (the iOS bundle) does
 * not provide, so the registry would fail to parse there. A plain http(s)
 * prefix check stands in for it (some stored links carry download hints
 * after the address).
 */
const httpUrlSchema = z.string().regex(/^https?:\/\/\S/, "Invalid URL");

const repoPathSchema = z.string().regex(/^docs\/sources\/institutions\//);

export const institutionSourceSchema = z
  .object({
    id: z.string().regex(/^src-[a-z0-9-]+$/),
    title: z.string().min(1),
    publisher: z.string().min(1),
    sourceType: institutionSourceTypeSchema,
    url: httpUrlSchema,
    pageUrl: httpUrlSchema.nullable(),
    publishedDate: dateOnlySchema.nullable(),
    retrievedAt: dateOnlySchema,
    documentYear: z.number().int().min(2000).max(2100),
    original: z
      .object({
        sha256: sha256Schema,
        bytes: z.number().int().positive(),
        /** Repo path when the original is small enough to keep; else null. */
        file: repoPathSchema.nullable(),
      })
      .strict(),
    /** Deterministic text extract (the cited pages at least). */
    extract: z
      .object({
        file: repoPathSchema,
        sha256: sha256Schema,
        pages: z.string().min(1),
      })
      .strict(),
  })
  .strict();

export type InstitutionSource = z.infer<typeof institutionSourceSchema>;

export const institutionEvidenceSchema = z
  .object({
    sourceId: z.string().min(1),
    locator: z.string().min(1),
    /** Verbatim substring of the extract (compared without whitespace). */
    quote: z.string().min(2).max(400),
  })
  .strict();

export type InstitutionEvidence = z.infer<typeof institutionEvidenceSchema>;

const knownFactSchema = z
  .object({
    status: z.literal("KNOWN"),
    value: z.union([z.number().int().nonnegative(), z.string().min(1)]),
    valueKind: institutionValueKindSchema,
    effectiveYear: z.number().int().min(2000).max(2100),
    confidence: institutionConfidenceSchema,
    note: z.string().min(1).optional(),
    evidence: z.array(institutionEvidenceSchema).min(1),
  })
  .strict();

const unknownFactSchema = z
  .object({
    status: z.literal("UNKNOWN"),
  })
  .strict();

export const institutionFactSchema = z.discriminatedUnion("status", [
  knownFactSchema,
  unknownFactSchema,
]);

export type InstitutionKnownFact = z.infer<typeof knownFactSchema>;
export type InstitutionFact = z.infer<typeof institutionFactSchema>;

const rulesSchema = z
  .object(
    Object.fromEntries(
      INSTITUTION_RULE_FIELDS.map((field) => [
        field,
        z.array(knownFactSchema).min(1).or(unknownFactSchema),
      ]),
    ) as Record<
      InstitutionRuleField,
      z.ZodUnion<[z.ZodArray<typeof knownFactSchema>, typeof unknownFactSchema]>
    >,
  )
  .strict();

export const institutionRecordSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    name: z.string().min(1),
    type: institutionTypeSchema,
    region: z.string().min(1).nullable(),
    aliases: z.array(z.string().min(1)),
    scopeNote: z.string().min(1),
    rules: rulesSchema,
  })
  .strict();

export type InstitutionRecord = z.infer<typeof institutionRecordSchema>;

export const institutionRegistrySchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    registryId: z.literal("kr.social-service.institution-rules"),
    retrievedFrom: dateOnlySchema,
    retrievedUntil: dateOnlySchema,
    sources: z.array(institutionSourceSchema).min(1),
    institutions: z.array(institutionRecordSchema).min(1),
  })
  .strict()
  .superRefine((registry, context) => {
    const sources = new Map(registry.sources.map((s) => [s.id, s]));
    if (sources.size !== registry.sources.length) {
      context.addIssue({ code: "custom", message: "Duplicate source id." });
    }
    const ids = new Set<string>();
    const keys = new Map<string, string>();
    for (const [index, institution] of registry.institutions.entries()) {
      if (ids.has(institution.id)) {
        context.addIssue({
          code: "custom",
          path: ["institutions", index, "id"],
          message: `Duplicate institution id ${institution.id}.`,
        });
      }
      ids.add(institution.id);
      for (const name of [institution.name, ...institution.aliases]) {
        const key = normalizeInstitutionName(name);
        const owner = keys.get(key);
        if (owner !== undefined && owner !== institution.id) {
          context.addIssue({
            code: "custom",
            path: ["institutions", index, "aliases"],
            message: `"${name}" also names ${owner}; aliases must be unambiguous.`,
          });
        }
        keys.set(key, institution.id);
      }
      for (const field of INSTITUTION_RULE_FIELDS) {
        const entry = institution.rules[field];
        if (!Array.isArray(entry)) continue;
        for (const fact of entry) {
          const path = ["institutions", index, "rules", field];
          if (AMOUNT_FIELDS.includes(field) && typeof fact.value !== "number") {
            context.addIssue({
              code: "custom",
              path,
              message: "Amounts are integer KRW.",
            });
          }
          if (
            DAY_ELIGIBILITY_FIELDS.includes(field) &&
            !["PAID", "NOT_PAID", "CONDITIONAL"].includes(String(fact.value))
          ) {
            context.addIssue({
              code: "custom",
              path,
              message: "Day eligibility is PAID, NOT_PAID or CONDITIONAL.",
            });
          }
          for (const evidence of fact.evidence) {
            const source = sources.get(evidence.sourceId);
            if (!source) {
              context.addIssue({
                code: "custom",
                path,
                message: `Unknown source ${evidence.sourceId}.`,
              });
              continue;
            }
            const expected = deriveConfidence(
              source.sourceType,
              fact.valueKind,
            );
            if (fact.confidence !== expected) {
              context.addIssue({
                code: "custom",
                path,
                message: `Confidence must be ${expected} for ${source.sourceType}/${fact.valueKind}.`,
              });
            }
          }
        }
      }
    }
  });

export type InstitutionRegistry = z.infer<typeof institutionRegistrySchema>;

export function deriveConfidence(
  sourceType: InstitutionSourceType,
  valueKind: InstitutionValueKind,
): InstitutionConfidence {
  if (valueKind === "BUDGET_UNIT_PRICE") return "MEDIUM";
  return sourceType === "STATUTE_OR_ORDINANCE" ||
    sourceType === "ADMINISTRATIVE_RULE" ||
    sourceType === "INSTITUTION_GUIDELINE" ||
    sourceType === "PAYMENT_RECORD"
    ? "HIGH"
    : "MEDIUM";
}

/**
 * Canonical comparison key for an institution name: NFKC, no whitespace or
 * punctuation, lower-case Latin. It never drops words, so "경기도교육청" and
 * "경기도청" stay different keys; shortened names are listed as aliases.
 */
export function normalizeInstitutionName(name: string): string {
  return name
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, "");
}

export function parseInstitutionRegistry(value: unknown): InstitutionRegistry {
  return institutionRegistrySchema.parse(value);
}

export const INSTITUTION_REGISTRY = parseInstitutionRegistry(
  institutionRegistryJson,
);

export type InstitutionFieldResult =
  | {
      status: "KNOWN";
      /** Facts for the requested year first; other years follow, flagged. */
      facts: Array<
        InstitutionKnownFact & {
          sources: InstitutionSource[];
          yearMatches: boolean;
        }
      >;
    }
  | { status: "UNKNOWN" };

export type InstitutionLookupResult =
  | {
      status: "MATCHED";
      query: string;
      matchedBy: "NAME" | "ALIAS";
      institution: Pick<
        InstitutionRecord,
        "id" | "name" | "type" | "region" | "scopeNote"
      >;
      fields: Record<InstitutionRuleField, InstitutionFieldResult>;
      warnings: string[];
    }
  | {
      status: "UNKNOWN_INSTITUTION";
      query: string;
      /** Registry names that contain the query, for a picker; never applied. */
      suggestions: Array<{ id: string; name: string }>;
      warnings: string[];
    };

/**
 * Institution name → cited rules, or an explicit unknown.
 *
 * Matching is exact on the normalized name or a listed alias. A partial match
 * is only returned as a suggestion: applying, say, 경기도교육청 rules to a
 * user who typed "경기도" would put the wrong payer's rules on their pay.
 */
export function lookupInstitutionRules(
  query: string,
  options: { year?: number; registry?: InstitutionRegistry } = {},
): InstitutionLookupResult {
  const registry = options.registry ?? INSTITUTION_REGISTRY;
  const key = normalizeInstitutionName(query);
  const unknownWarning =
    "등록된 기관 근거가 없습니다. 기관 규칙은 직접 입력하거나 기관에 확인해야 합니다.";
  if (key.length === 0) {
    return {
      status: "UNKNOWN_INSTITUTION",
      query,
      suggestions: [],
      warnings: [unknownWarning],
    };
  }

  for (const institution of registry.institutions) {
    const byName = normalizeInstitutionName(institution.name) === key;
    const byAlias =
      !byName &&
      institution.aliases.some(
        (alias) => normalizeInstitutionName(alias) === key,
      );
    if (!byName && !byAlias) continue;

    const sources = new Map(registry.sources.map((s) => [s.id, s]));
    const warnings: string[] = [];
    const fields = Object.fromEntries(
      INSTITUTION_RULE_FIELDS.map((field) => {
        const entry = institution.rules[field];
        if (!Array.isArray(entry)) return [field, { status: "UNKNOWN" }];
        const facts = entry
          .map((fact) => ({
            ...fact,
            sources: fact.evidence.map((e) => sources.get(e.sourceId)!),
            yearMatches:
              options.year === undefined || fact.effectiveYear === options.year,
          }))
          .sort(
            (a, b) =>
              Number(b.yearMatches) - Number(a.yearMatches) ||
              b.effectiveYear - a.effectiveYear,
          );
        if (options.year !== undefined && !facts.some((f) => f.yearMatches)) {
          warnings.push(
            `${field}: ${options.year}년 근거가 없고 다른 연도 근거만 있습니다.`,
          );
        }
        if (facts.some((f) => f.valueKind === "BUDGET_UNIT_PRICE")) {
          warnings.push(
            `${field}: 예산편성 기준단가이며 실제 지급액과 다를 수 있습니다.`,
          );
        }
        return [field, { status: "KNOWN", facts }];
      }),
    ) as Record<InstitutionRuleField, InstitutionFieldResult>;

    return {
      status: "MATCHED",
      query,
      matchedBy: byName ? "NAME" : "ALIAS",
      institution: {
        id: institution.id,
        name: institution.name,
        type: institution.type,
        region: institution.region,
        scopeNote: institution.scopeNote,
      },
      fields,
      warnings,
    };
  }

  return {
    status: "UNKNOWN_INSTITUTION",
    query,
    suggestions: registry.institutions
      .filter((institution) =>
        [institution.name, ...institution.aliases].some((name) =>
          normalizeInstitutionName(name).includes(key),
        ),
      )
      .map(({ id, name }) => ({ id, name })),
    warnings: [unknownWarning],
  };
}
