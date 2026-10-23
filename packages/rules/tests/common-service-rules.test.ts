import { describe, expect, it } from "vitest";

import { COMPENSATION_RULE_BUNDLES } from "../src";
import { commonServiceRules } from "../src/common-service-rules";

describe("병무청 공통 규정 fallback", () => {
  it("takes the 2026 meal minimum and fare basis from the verified bundle", () => {
    const common = commonServiceRules(2026)!;
    const bundle = COMPENSATION_RULE_BUNDLES[0]!;
    expect(common.meal.minimumDailyAmount).toBe(9000);
    expect(common.meal.minimumDailyAmount).toBe(bundle.meal.minimumDailyAmount);
    expect(common.meal.institutionMayPayMore).toBe(true);
    expect(common.transport.dailyAmount).toBeNull();
    expect(common.transport.basis).toContain("시내버스");
  });

  it("carries the 병무청 record's cited day rules", () => {
    const fields = commonServiceRules(2026)!.rules.map((rule) => [
      rule.field,
      rule.value,
    ]);
    expect(fields).toContainEqual(["MEAL_ON_LEAVE", "NOT_PAID"]);
    expect(fields).toContainEqual(["TRANSPORT_ON_ABSENCE", "NOT_PAID"]);
    for (const rule of commonServiceRules(2026)!.rules) {
      expect(rule.quote.length).toBeGreaterThan(1);
    }
  });

  it("has nothing for a year without a verified bundle", () => {
    expect(commonServiceRules(2019)).toBeNull();
  });
});
