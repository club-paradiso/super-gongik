import { describe, expect, it } from "vitest";

import {
  regionalFareSuggestion,
  RESIDENCE_REGIONS,
} from "@/lib/regional-transit-fares";

describe("regional transit fare suggestions", () => {
  it("uses verified Seoul city-bus cash fare as a round-trip suggestion", () => {
    expect(regionalFareSuggestion("서울특별시")?.dailyRoundTripFare).toBe(3000);
  });

  it("uses verified Jeju local bus cash fare as a round-trip suggestion", () => {
    expect(
      regionalFareSuggestion("제주특별자치도")?.dailyRoundTripFare,
    ).toBe(2400);
  });

  it("does not guess an unverified region fare", () => {
    expect(regionalFareSuggestion("부산광역시")).toBeNull();
    expect(RESIDENCE_REGIONS).toContain("부산광역시");
  });
});
