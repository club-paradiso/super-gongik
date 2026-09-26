import { describe, expect, it } from "vitest";

import {
  STORAGE_KEYS,
  addDays,
  decodeUserDataText,
  type UserData,
} from "@super-gongik/domain";

import { buildHomeModel } from "../src/lib/home-model";
import { buildAppProjection } from "../src/lib/projections";
import { SCENARIO_TODAY, buildScenarios } from "./fixtures/service-scenarios";

function expectedHero(data: UserData) {
  const profile = data.profile!;
  const { hero } = buildHomeModel(
    profile,
    buildAppProjection(data, profile, SCENARIO_TODAY),
    SCENARIO_TODAY,
  );
  return {
    phase: hero.phase,
    headline: hero.headline,
    headlineTomorrow: buildHomeModel(
      profile,
      buildAppProjection(data, profile, addDays(SCENARIO_TODAY, 1)),
      addDays(SCENARIO_TODAY, 1),
    ).hero.headline,
    progressbar: hero.phase !== "PRE_SERVICE",
  };
}

describe("home-state browser fixtures", () => {
  const scenarios = buildScenarios();

  it("every scenario is a valid stored user document", () => {
    for (const scenario of scenarios) {
      const decoded = decodeUserDataText(JSON.stringify(scenario.data));
      expect(decoded.kind, scenario.key).toBe("OK");
    }
  });

  it("the WebKit gate seeds exactly these documents", async () => {
    await expect(
      JSON.stringify(
        scenarios.map((scenario) => ({
          key: scenario.key,
          label: scenario.label,
          now: scenario.now,
          // What the gate must find in the rendered hero.
          expect: expectedHero(scenario.data),
          storageKey: STORAGE_KEYS.current,
          // Byte-for-byte what the repository writes to localStorage.
          storageValue: JSON.stringify(scenario.data),
        })),
        null,
        2,
      ) + "\n",
    ).toMatchFileSnapshot("../../../scripts/fixtures/home-scenarios.json");
  });
});
