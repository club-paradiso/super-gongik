import { describe, expect, it } from "vitest";

import {
  COMPENSATION_RULE_BUNDLES,
  LEAVE_RULE_BUNDLES,
  calculateMonthlyBasePay,
  createCalculationSnapshot,
  parseRuleBundle,
  selectRuleByDate,
} from "../src";

describe("versioned rule selector", () => {
  it("selects both sides of the 2026-08-28 leave boundary", () => {
    const before = selectRuleByDate("LEAVE", LEAVE_RULE_BUNDLES, "2026-08-27");
    const onDate = selectRuleByDate("LEAVE", LEAVE_RULE_BUNDLES, "2026-08-28");

    expect(before.status).toBe("SUPPORTED");
    expect(onDate.status).toBe("SUPPORTED");
    if (before.status === "SUPPORTED" && onDate.status === "SUPPORTED") {
      expect(before.rule.version).toBe("2026-04-23");
      expect(onDate.rule.version).toBe("2026-08-28");
    }
  });

  it("does not fall backward before the oldest verified bundle", () => {
    const selection = selectRuleByDate(
      "LEAVE",
      LEAVE_RULE_BUNDLES,
      "2026-04-22",
    );
    expect(selection.status).toBe("UNSUPPORTED_NO_APPLICABLE_RULE");
  });

  it("does not fall forward to the 2026 compensation table", () => {
    const selection = selectRuleByDate(
      "COMPENSATION",
      COMPENSATION_RULE_BUNDLES,
      "2027-01-01",
    );
    expect(selection.status).toBe("UNSUPPORTED_NO_APPLICABLE_RULE");
  });

  it("rejects overlapping applicable rules explicitly", () => {
    const bundle = LEAVE_RULE_BUNDLES[1];
    const selection = selectRuleByDate(
      "LEAVE",
      [bundle, { ...bundle, version: "duplicate" }],
      "2026-08-28",
    );
    expect(selection.status).toBe("UNSUPPORTED_AMBIGUOUS_RULES");
  });
});

describe("rule contract and historical snapshots", () => {
  it("requires official source metadata", () => {
    expect(() =>
      parseRuleBundle({
        ...LEAVE_RULE_BUNDLES[1],
        sources: [{ title: "missing URL", authority: "test", sourceType: "x" }],
      }),
    ).toThrow();
  });

  it("preserves the selected version and explanation in a snapshot", () => {
    const result = calculateMonthlyBasePay({
      calculationDate: "2026-10-15",
      serviceMonthOrdinal: 10,
    });
    const snapshot = createCalculationSnapshot(result, {
      id: "snapshot-1",
      generatedAt: "2026-08-31T00:00:00.000Z",
    });

    expect(snapshot.result.ruleVersion).toBe("2026");
    expect(snapshot.result.value).toEqual({ monthlyBasePay: 1_200_000 });
    expect(snapshot.result.breakdown).toMatchObject({
      equivalentRank: "CORPORAL",
    });
    expect(snapshot.result.sources.length).toBeGreaterThan(0);
  });
});
