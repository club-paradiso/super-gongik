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

  it("falls back to the 병무청 공통 규정 for an unregistered institution", () => {
    const result = suggestInstitutionRates("없는기관123", { year: 2026 });
    if (result.status !== "UNKNOWN_INSTITUTION") throw new Error("expected");
    expect(result.common).toMatchObject({
      label: "병무청 공통 규정",
      meal: { amount: 9000, institutionMayPayMore: true },
    });
    expect(result.common?.notes.some((n) => n.field === "MEAL_ON_LEAVE")).toBe(
      true,
    );
    expect(result.common?.transportNote).toContain("실비");
  });

  it("has no fallback for a year without a verified bundle", () => {
    const result = suggestInstitutionRates("없는기관123", { year: 2031 });
    if (result.status !== "UNKNOWN_INSTITUTION") throw new Error("expected");
    expect(result.common).toBeNull();
  });

  it("uses the fallback for a matched institution with no meal amount", () => {
    const result = suggestInstitutionRates("경기도 광명시", { year: 2026 });
    if (result.status !== "MATCHED") throw new Error("expected a match");
    expect(result.meal).toBeNull();
    expect(result.common?.meal.amount).toBe(9000);
    const known = suggestInstitutionRates("경기도교육청", { year: 2025 });
    if (known.status !== "MATCHED") throw new Error("expected a match");
    expect(known.common).toBeNull();
  });

  it("returns suggestions, never a guess, for an unregistered name", () => {
    // "경기" names no registry record; 경기도 and 경기도교육청 only contain it.
    const result = suggestInstitutionRates("경기", { year: 2026 });
    expect(result.status).toBe("UNKNOWN_INSTITUTION");
    if (result.status !== "UNKNOWN_INSTITUTION")
      throw new Error("expected unknown");
    expect(result.suggestions.map((item) => item.id)).toEqual(
      expect.arrayContaining(["edu-gyeonggi", "metro-gyeonggi"]),
    );
    const none = suggestInstitutionRates("없는기관123", { year: 2026 });
    expect(none).toMatchObject({
      status: "UNKNOWN_INSTITUTION",
      suggestions: [],
    });
  });
});
