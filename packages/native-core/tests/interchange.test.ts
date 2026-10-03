import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createEmptyUserData,
  parseBackup,
  planRestore,
  type UserData,
} from "@super-gongik/domain";
import { describe, expect, it } from "vitest";

import { fullDocument } from "../../domain/tests/fixtures";

/**
 * Release gate, iOS → web: `contracts/interchange/ios-export.json` was written
 * by the iOS app's export path (JavaScriptCore, `BackupInterchangeTests`).
 * The web's own parser and restore planner must accept it as an ordinary
 * backup with a verified digest and the same records.
 */
const here = dirname(fileURLToPath(import.meta.url));
const text = readFileSync(
  resolve(here, "../../../contracts/interchange/ios-export.json"),
  "utf8",
);

/** Record content only: installation metadata differs per device. */
function records(data: UserData) {
  return { ...data, deviceId: null, documentRevision: null, savedAt: null };
}

describe("iOS export restores on the web", () => {
  it("parses with a verified digest", () => {
    const parsed = parseBackup(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.info.integrity).toBe("VERIFIED");
    expect(records(parsed.data)).toEqual(records(fullDocument()));
  });

  it("plans a clean restore into an empty web store", () => {
    const parsed = parseBackup(text);
    if (!parsed.ok) throw new Error(parsed.error);
    const plan = planRestore(createEmptyUserData("web-device"), parsed.data, {
      mode: "MERGE",
      now: "2026-10-04T00:00:00.000Z",
      deviceId: "web-device",
    });
    expect(plan.blocked).toBeNull();
    expect(plan.conflicts).toEqual([]);
    expect(plan.result?.events.length).toBe(fullDocument().events.length);
  });
});
