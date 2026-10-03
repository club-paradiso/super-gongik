import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { createNativeRuntime } from "../src/runtime";
import { SUITES, type FixtureCase } from "./fixture-cases";

/**
 * Drift guard for `contracts/fixtures`. The TypeScript packages are the
 * reference: this test recomputes every fixture through the native facade
 * and fails if a stored expectation differs. After an intended behaviour
 * change, regenerate with `pnpm --filter @super-gongik/native-core fixtures`
 * and review the diff; the Swift suite then has to agree with the new files.
 */
const here = dirname(fileURLToPath(import.meta.url));
const fixtureDir = resolve(here, "../../../contracts/fixtures");
const update = process.env.UPDATE_FIXTURES === "1";
const runtime = createNativeRuntime();

function evaluate(fixture: FixtureCase): unknown {
  switch (fixture.kind) {
    case "call":
      return JSON.parse(runtime.call(fixture.fn, JSON.stringify(fixture.args)));
    case "command":
      return JSON.parse(
        runtime.applyCommand(
          fixture.command,
          JSON.stringify(fixture.data),
          JSON.stringify(fixture.args),
          JSON.stringify(fixture.context),
        ),
      );
    case "projection":
      return JSON.parse(
        runtime.call(
          "buildNativeProjection",
          JSON.stringify([fixture.data, fixture.today]),
        ),
      );
  }
}

describe.each(SUITES)("fixture suite $suite", (suite) => {
  const file = resolve(fixtureDir, `${suite.suite}.json`);
  const computed = {
    formatVersion: 1,
    suite: suite.suite,
    description: suite.description,
    engines: suite.engines,
    generatedBy: "packages/native-core/tests/conformance.test.ts",
    cases: suite.cases.map((fixture) => ({
      ...JSON.parse(JSON.stringify(fixture)),
      expected: evaluate(fixture),
    })),
  };

  it("has unique case ids", () => {
    const ids = suite.cases.map((fixture) => fixture.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("never records an unknown function", () => {
    for (const fixture of computed.cases) {
      expect(JSON.stringify(fixture.expected)).not.toContain("UnknownFunction");
      expect(JSON.stringify(fixture.expected)).not.toContain("UnknownCommand");
    }
  });

  it("matches the stored fixture", () => {
    if (update) {
      mkdirSync(fixtureDir, { recursive: true });
      writeFileSync(file, `${JSON.stringify(computed, null, 2)}\n`);
    }
    expect(
      existsSync(file),
      `${file} is missing; run the fixtures script`,
    ).toBe(true);
    const stored = JSON.parse(readFileSync(file, "utf8"));
    expect(computed).toEqual(stored);
  });
});
