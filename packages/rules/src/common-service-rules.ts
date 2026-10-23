import { COMPENSATION_RULE_BUNDLES } from "./bundles";
import {
  INSTITUTION_REGISTRY,
  INSTITUTION_RULE_FIELDS,
  type InstitutionKnownFact,
  type InstitutionRegistry,
  type InstitutionRuleField,
} from "./institutions";

/**
 * 병무청 공통 규정: what applies to every 복무기관 when the registry has no
 * institution-level evidence for a field (or for the institution at all).
 *
 * Product decision (2026-10-23): an institution without public evidence is
 * treated under the nationwide 병무청 rules; differing institution rules come
 * in later through user reports. The amounts come from the verified
 * compensation bundle and the day rules from the registry's 병무청 record, so
 * nothing here is a new or guessed value.
 */
export const COMMON_RULES_INSTITUTION_ID = "central-mma";

export type CommonServiceRule = {
  field: InstitutionRuleField;
  value: InstitutionKnownFact["value"];
  valueKind: InstitutionKnownFact["valueKind"];
  effectiveYear: number;
  confidence: InstitutionKnownFact["confidence"];
  sourceTitle: string;
  locator: string;
  quote: string;
};

export type CommonServiceRules = {
  year: number;
  label: "병무청 공통 규정";
  meal: {
    /** The 1일 중식비 minimum; an institution may pay more, never less. */
    minimumDailyAmount: number;
    institutionMayPayMore: boolean;
    basis: string;
  };
  transport: {
    /** The fare basis. There is no nationwide amount: it is the user's fare. */
    basis: string;
    dailyAmount: null;
  };
  /** 병무청 rules for the other fields (휴가·결근일, 지급일, 근무일 …). */
  rules: CommonServiceRule[];
};

export function commonServiceRules(
  year: number,
  registry: InstitutionRegistry = INSTITUTION_REGISTRY,
): CommonServiceRules | null {
  const bundle = COMPENSATION_RULE_BUNDLES.find(
    (candidate) => Number(candidate.effectiveFrom.slice(0, 4)) === year,
  );
  if (!bundle) return null;
  const mma = registry.institutions.find(
    (institution) => institution.id === COMMON_RULES_INSTITUTION_ID,
  );
  const sources = new Map(registry.sources.map((s) => [s.id, s]));
  const rules: CommonServiceRule[] = [];
  for (const field of INSTITUTION_RULE_FIELDS) {
    const entry = mma?.rules[field];
    if (!Array.isArray(entry)) continue;
    for (const fact of entry) {
      const evidence = fact.evidence[0]!;
      rules.push({
        field,
        value: fact.value,
        valueKind: fact.valueKind,
        effectiveYear: fact.effectiveYear,
        confidence: fact.confidence,
        sourceTitle: sources.get(evidence.sourceId)?.title ?? evidence.sourceId,
        locator: evidence.locator,
        quote: evidence.quote,
      });
    }
  }
  return {
    year,
    label: "병무청 공통 규정",
    meal: {
      minimumDailyAmount: bundle.meal.minimumDailyAmount,
      institutionMayPayMore: bundle.meal.institutionMayPayMore,
      basis: bundle.meal.minimumSource,
    },
    transport: { basis: bundle.transport.legalBasis, dailyAmount: null },
    rules,
  };
}
