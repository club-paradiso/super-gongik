import { describe, expect, it } from "vitest";

import {
  buildServiceProfile,
  createBackup,
  createEmptyUserData,
  createMemoryStorage,
  createServiceEvent,
  createUserDataRepository,
  createUserDataStore,
  parseBackup,
  planRestore,
  serializeBackup,
  type BackupErrorKind,
  type UserData,
} from "@super-gongik/domain";

import {
  describeCounts,
  parseErrorTitle,
  restoreGate,
} from "../src/lib/restore-copy";

const NOW = "2026-09-24T00:00:00.000Z";

function withProfile(): UserData {
  return {
    ...createEmptyUserData("device-ui"),
    profile: buildServiceProfile(
      {
        callUpDate: "2026-05-04",
        expectedDischargeDate: "2028-02-03",
        serviceCategory: null,
        workplaceType: null,
        defaultCommuteCost: null,
        defaultMealAllowanceOverride: null,
        timezone: "Asia/Seoul",
      },
      { id: "p", localProfileId: "p", timestamp: NOW },
    ),
  };
}

function withEvent(data: UserData, date: string, id: string) {
  const result = createServiceEvent(
    data,
    {
      eventType: "ANNUAL_LEAVE",
      startDate: date as "2026-09-10",
      endDate: date as "2026-09-10",
      timing: { kind: "ALL_DAY", dayCount: 1 },
      title: null,
      note: null,
    },
    { now: NOW, deviceId: "device-ui", createId: () => id },
  );
  if (!result.ok) throw new Error("create failed");
  return result.data;
}

const request = { now: NOW, deviceId: "device-ui" };

describe("restore confirmation gate", () => {
  it("keeps REPLACE disabled until the destructive box is ticked, and the store agrees", async () => {
    const storage = createMemoryStorage();
    let n = 0;
    const createId = () => `ui-${++n}`;
    const store = createUserDataStore({
      repository: createUserDataRepository(storage, {
        now: () => NOW,
        createId,
      }),
      now: () => new Date(NOW),
      createId,
    });
    await store.load();
    const local = withEvent(withProfile(), "2026-09-10", "local-event");
    const seeded = await store.restore(local, {
      mode: "REPLACE",
      expectedDocumentRevision: 0,
    });
    if (!seeded.ok) throw new Error(seeded.message);

    const backup = withEvent(withProfile(), "2026-09-11", "backup-event");
    const plan = planRestore(seeded.data, backup, {
      ...request,
      mode: "REPLACE",
    });
    expect(plan.requiresDestructiveConfirmation).toBe(true);
    expect(
      restoreGate(plan, { resolutions: {}, destructiveConfirmed: false })
        .enabled,
    ).toBe(false);
    expect(
      restoreGate(plan, { resolutions: {}, destructiveConfirmed: true })
        .enabled,
    ).toBe(true);

    // Bypassing the UI does not bypass the rule.
    const before = storage.dump();
    const sneaky = await store.restore(backup, {
      mode: "REPLACE",
      expectedDocumentRevision: plan.baseDocumentRevision,
    });
    expect(sneaky).toMatchObject({ ok: false, code: "CONFIRMATION_REQUIRED" });
    expect(storage.dump()).toEqual(before);
  });

  it("blocks MERGE until every conflict has an explicit choice", () => {
    const local = withEvent(withProfile(), "2026-09-10", "same-id");
    const incoming = structuredClone(local);
    incoming.events[0]!.note = "다른 기기";
    const open = planRestore(local, incoming, { ...request, mode: "MERGE" });
    expect(open.conflicts).toHaveLength(1);
    expect(
      restoreGate(open, { resolutions: {}, destructiveConfirmed: false }),
    ).toMatchObject({
      enabled: false,
    });

    const key = open.conflicts[0]!.key;
    const resolved = planRestore(local, incoming, {
      ...request,
      mode: "MERGE",
      options: { resolutions: { [key]: "INCOMING" } },
    });
    expect(
      restoreGate(resolved, {
        resolutions: { [key]: "INCOMING" },
        destructiveConfirmed: false,
      }),
    ).toEqual({ enabled: true });
    expect(describeCounts(resolved.counts.events)).toBe("백업 값 사용 1");
  });

  it("never offers MERGE for a different person's backup", () => {
    const local = withProfile();
    const other = {
      ...withProfile(),
      profile: { ...withProfile().profile!, id: "other" },
    };
    const plan = planRestore(local, other, { ...request, mode: "MERGE" });
    expect(
      restoreGate(plan, { resolutions: {}, destructiveConfirmed: true })
        .enabled,
    ).toBe(false);
  });
});

describe("error copy", () => {
  it("tells corrupted, outdated-app and foreign files apart", () => {
    const text = serializeBackup(createBackup(withProfile(), NOW));
    const cases: Array<[string, BackupErrorKind]> = [
      ["not json", "MALFORMED_JSON"],
      ["{}", "FOREIGN_FILE"],
      [text.slice(0, 120), "TRUNCATED"],
      [
        text.replace(
          '"callUpDate": "2026-05-04"',
          '"callUpDate": "2026-05-05"',
        ),
        "INTEGRITY_MISMATCH",
      ],
      [
        text.replace('"formatVersion": 2', '"formatVersion": 7'),
        "UNSUPPORTED_FORMAT_VERSION",
      ],
    ];
    const titles = new Set<string>();
    for (const [input, kind] of cases) {
      const parsed = parseBackup(input);
      expect(parsed).toMatchObject({ ok: false, kind });
      titles.add(parseErrorTitle(kind));
    }
    expect(titles).toEqual(
      new Set([
        "복원할 수 없는 파일이에요.",
        "백업 파일이 손상됐어요.",
        "앱 업데이트가 필요한 백업이에요.",
      ]),
    );
    // No error title claims data on the device was lost.
    for (const title of titles) expect(title).not.toMatch(/사라|삭제|잃/);
  });
});
