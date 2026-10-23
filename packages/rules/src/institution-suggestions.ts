import type { DateOnly } from "@super-gongik/domain";

import { COMPENSATION_RULE_BUNDLES } from "./bundles";
import {
  lookupInstitutionRules,
  type InstitutionKnownFact,
  type InstitutionRuleField,
  type InstitutionSource,
} from "./institutions";
import { selectRuleByDate } from "./selector";

/**
 * 2026 병무청 지급 기준: 1일 중식비 9,000원은 최소 기준이다. 기관이 더 줄 수
 * 있지만 더 낮게는 줄 수 없으므로, 이보다 낮은 기관 근거는 적용하지 않는다.
 */
export const MEAL_MINIMUM_DAILY_AMOUNT = 9000;

export type InstitutionAmountSuggestion = {
  amount: number;
  valueKind: InstitutionKnownFact["valueKind"];
  effectiveYear: number;
  confidence: InstitutionKnownFact["confidence"];
  /** The fact is for the requested year. */
  currentYear: boolean;
  sourceTitle: string;
  publisher: string;
  locator: string;
  quote: string;
  /** Whether the app may prefill this amount without contradicting a source. */
  applicable: boolean;
  /** Why it is shown but not applicable, or a caution that still applies. */
  caution: string | null;
};

export type InstitutionNote = {
  field: InstitutionRuleField;
  text: string;
  valueKind: InstitutionKnownFact["valueKind"];
  effectiveYear: number;
  confidence: InstitutionKnownFact["confidence"];
  sourceTitle: string;
  locator: string;
};

export type InstitutionSuggestions =
  | {
      status: "MATCHED";
      institution: { id: string; name: string; scopeNote: string };
      meal: InstitutionAmountSuggestion | null;
      transport: InstitutionAmountSuggestion | null;
      /** Everything else the registry knows, cited, for the user to read. */
      notes: InstitutionNote[];
      /** 병무청 공통 규정, when the institution has no meal amount of its own. */
      common: CommonRulesFallback | null;
      warnings: string[];
    }
  | {
      status: "UNKNOWN_INSTITUTION";
      query: string;
      suggestions: Array<{ id: string; name: string }>;
      /** No institution evidence: the 병무청 공통 규정 apply (users can report more). */
      common: CommonRulesFallback | null;
      warnings: string[];
    };

/**
 * What applies when an institution has no cited rule of its own: the 병무청
 * national standard. The meal amount is the official 2026 minimum, which every
 * institution must at least pay; the day rules are the registry's cited
 * 「병무청 (전국 공통)」 facts. Transport has no national amount (it follows the
 * bus fare), so only its basis is given.
 */
export type CommonRulesFallback = {
  label: string;
  year: number;
  meal: { amount: number; basis: string; institutionMayPayMore: boolean };
  transportNote: string | null;
  notes: InstitutionNote[];
};

const COMMON_RULES_NAME = "병무청 (전국 공통)";

const NOTE_FIELDS: readonly InstitutionRuleField[] = [
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
];

type FactWithSources = InstitutionKnownFact & {
  sources: InstitutionSource[];
  yearMatches: boolean;
};

/** Payment rules beat budget unit prices; then HIGH confidence; then newest. */
function rank(fact: FactWithSources): number[] {
  return [
    Number(fact.yearMatches),
    Number(fact.valueKind === "PAYMENT_RULE"),
    Number(fact.confidence === "HIGH"),
    fact.effectiveYear,
  ];
}

function better(a: FactWithSources, b: FactWithSources): boolean {
  const left = rank(a);
  const right = rank(b);
  for (let i = 0; i < left.length; i += 1) {
    if (left[i] !== right[i]) return left[i]! > right[i]!;
  }
  return false;
}

function notesOf(
  known: (field: InstitutionRuleField) => FactWithSources[],
): InstitutionNote[] {
  const notes: InstitutionNote[] = [];
  for (const field of NOTE_FIELDS) {
    for (const fact of known(field)) {
      const evidence = fact.evidence[0]!;
      const source = fact.sources.find((s) => s.id === evidence.sourceId);
      notes.push({
        field,
        text: String(fact.value),
        valueKind: fact.valueKind,
        effectiveYear: fact.effectiveYear,
        confidence: fact.confidence,
        sourceTitle: source?.title ?? evidence.sourceId,
        locator: evidence.locator,
      });
    }
  }
  return notes;
}

export function commonRulesFallback(year: number): CommonRulesFallback | null {
  const selection = selectRuleByDate(
    "COMPENSATION",
    COMPENSATION_RULE_BUNDLES,
    `${year}-07-01` as DateOnly,
  );
  if (selection.status !== "SUPPORTED") return null;
  const common = lookupInstitutionRules(COMMON_RULES_NAME, { year });
  if (common.status !== "MATCHED") return null;
  const notes = notesOf((field) => {
    const entry = common.fields[field];
    return entry.status === "KNOWN" ? entry.facts : [];
  });
  return {
    label: "병무청 공통 규정",
    year,
    meal: {
      amount: selection.rule.meal.minimumDailyAmount,
      basis: selection.rule.meal.minimumSource,
      institutionMayPayMore: selection.rule.meal.institutionMayPayMore,
    },
    transportNote:
      notes.find((note) => note.field === "TRANSPORT_METHOD")?.text ?? null,
    notes,
  };
}

function amountSuggestion(
  facts: FactWithSources[],
  minimum: number | null,
): InstitutionAmountSuggestion | null {
  let best: FactWithSources | null = null;
  for (const fact of facts) {
    if (typeof fact.value !== "number") continue;
    if (best === null || better(fact, best)) best = fact;
  }
  if (best === null || typeof best.value !== "number") return null;
  const evidence = best.evidence[0]!;
  const source = best.sources.find((s) => s.id === evidence.sourceId);
  const cautions: string[] = [];
  let applicable = true;
  if (minimum !== null && best.value < minimum) {
    applicable = false;
    cautions.push(
      `2026년 최소 기준 ${minimum.toLocaleString("en-US")}원보다 낮아 적용하지 않아요.`,
    );
  }
  if (best.valueKind === "BUDGET_UNIT_PRICE") {
    cautions.push("예산편성 기준단가라 실제 지급액과 다를 수 있어요.");
  }
  if (!best.yearMatches) {
    cautions.push(
      `${best.effectiveYear}년 자료예요. 올해 기준과 다를 수 있어요.`,
    );
  }
  return {
    amount: best.value,
    valueKind: best.valueKind,
    effectiveYear: best.effectiveYear,
    confidence: best.confidence,
    currentYear: best.yearMatches,
    sourceTitle: source?.title ?? evidence.sourceId,
    publisher: source?.publisher ?? "",
    locator: evidence.locator,
    quote: evidence.quote,
    applicable,
    caution: cautions.length === 0 ? null : cautions.join(" "),
  };
}

/**
 * Institution name → what the app may prefill (meal and transport per day)
 * plus every other cited rule as read-only notes. Nothing here is a
 * calculation: the user still confirms the amounts, and an unknown value is
 * left empty, never guessed.
 */
export function suggestInstitutionRates(
  query: string,
  options: { year: number },
): InstitutionSuggestions {
  const result = lookupInstitutionRules(query, { year: options.year });
  if (result.status !== "MATCHED") {
    return {
      status: "UNKNOWN_INSTITUTION",
      query: result.query,
      suggestions: result.suggestions,
      common: commonRulesFallback(options.year),
      warnings: result.warnings,
    };
  }
  const known = (field: InstitutionRuleField): FactWithSources[] => {
    const entry = result.fields[field];
    return entry.status === "KNOWN" ? entry.facts : [];
  };
  const notes = notesOf(known);
  return {
    status: "MATCHED",
    institution: {
      id: result.institution.id,
      name: result.institution.name,
      scopeNote: result.institution.scopeNote,
    },
    meal: amountSuggestion(
      known("MEAL_DAILY_AMOUNT"),
      MEAL_MINIMUM_DAILY_AMOUNT,
    ),
    transport: amountSuggestion(known("TRANSPORT_DAILY_AMOUNT"), null),
    notes,
    common:
      known("MEAL_DAILY_AMOUNT").length === 0
        ? commonRulesFallback(options.year)
        : null,
    warnings: result.warnings,
  };
}
