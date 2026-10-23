import { describe, expect, it } from "vitest";

import {
  MEAL_MINIMUM_DAILY_AMOUNT,
  suggestInstitutionRates,
} from "../src/institution-suggestions";

describe("suggestInstitutionRates", () => {
  it("prefers a payment rule over a budget unit price", () => {
    const result = suggestInstitutionRates("경기도교육청", { year: 2025 });
    if (result.status !== "MATCHED") throw new Error("expected a match");
    expect(result.meal).toMatchObject({
      amount: 9000,
      valueKind: "PAYMENT_RULE",
      currentYear: true,
      applicable: true,
    });
    expect(result.transport).toMatchObject({
      amount: 3000,
      valueKind: "PAYMENT_RULE",
    });
    expect(result.meal?.quote.length).toBeGreaterThan(0);
  });

  it("does not apply a meal amount below the 2026 minimum", () => {
    const result = suggestInstitutionRates("경상북도 구미시", { year: 2025 });
    if (result.status !== "MATCHED") throw new Error("expected a match");
    expect(result.meal?.amount).toBeLessThan(MEAL_MINIMUM_DAILY_AMOUNT);
    expect(result.meal?.applicable).toBe(false);
    expect(result.meal?.caution).toContain("최소 기준");
  });

  it("flags a budget unit price and an other-year source", () => {
    const result = suggestInstitutionRates("경기도 오산시", { year: 2026 });
    if (result.status !== "MATCHED") throw new Error("expected a match");
    expect(result.transport?.valueKind).toBe("BUDGET_UNIT_PRICE");
    expect(result.transport?.currentYear).toBe(false);
    expect(result.transport?.caution).toContain("예산편성");
    expect(result.transport?.caution).toContain("자료예요");
  });

  it("carries the other cited rules as read-only notes", () => {
    const result = suggestInstitutionRates("경기도교육청", { year: 2025 });
    if (result.status !== "MATCHED") throw new Error("expected a match");
    expect(result.notes.some((n) => n.field === "MEAL_ON_LEAVE")).toBe(true);
    expect(result.notes.every((n) => n.sourceTitle.length > 0)).toBe(true);
  });

  it("returns suggestions, never a guess, for an unregistered name", () => {
    const result = suggestInstitutionRates("경기도", { year: 2026 });
    expect(result.status).toBe("UNKNOWN_INSTITUTION");
    const none = suggestInstitutionRates("없는기관123", { year: 2026 });
    expect(none).toMatchObject({
      status: "UNKNOWN_INSTITUTION",
      suggestions: [],
    });
  });
});
