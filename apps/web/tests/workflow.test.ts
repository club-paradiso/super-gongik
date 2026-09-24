import { describe, expect, it } from "vitest";

import {
  STORAGE_KEYS,
  commitImport,
  confirmLeaveCredit,
  createBackup,
  createMemoryStorage,
  createProfile,
  createServiceEvent,
  createUserDataRepository,
  createUserDataStore,
  editProfile,
  formatLeaveQuantity,
  parseBackup,
  replaceUserData,
  rollbackImport,
  saveAttendanceMonth,
  saveCompensationSnapshot,
  serializeBackup,
  type UserData,
} from "@super-gongik/domain";
import {
  buildImportDrafts,
  buildImportPreview,
  createImportBatchDescriptor,
  parseDelimitedText,
} from "@super-gongik/importer";

import { buildAppProjection } from "../src/lib/projections";

function newStore(storage = createMemoryStorage()) {
  let id = 0;
  const createId = () => `id-${++id}`;
  return {
    storage,
    store: createUserDataStore({
      repository: createUserDataRepository(storage, {
        now: () => "2026-09-24T00:00:00.000Z",
        createId,
      }),
      now: () => new Date("2026-09-24T00:00:00.000Z"),
      createId,
    }),
  };
}

function ready(store: ReturnType<typeof newStore>["store"]): UserData {
  const snapshot = store.getSnapshot();
  if (snapshot.phase !== "READY") throw new Error("store not ready");
  return snapshot.data;
}

async function importCsv(
  store: ReturnType<typeof newStore>["store"],
  csv: string,
  batchId: string,
) {
  const preview = await buildImportPreview(
    parseDelimitedText(csv),
    createImportBatchDescriptor({
      id: batchId,
      fileName: `${batchId}.csv`,
      sourceFormat: "CSV",
      createdAt: "2026-09-24T00:00:00.000Z",
    }),
  );
  const accepted = new Set(
    preview.events
      .map((event) => event.sourceRowIndex)
      .filter((row) => !preview.unresolvedRowIndexes.includes(row)),
  );
  const { drafts } = buildImportDrafts(preview, accepted);
  return store.run((data, context) =>
    commitImport(
      data,
      { batch: preview.batch, drafts, snapshots: [] },
      context,
    ),
  );
}

const CSV = [
  "사용일자,복무상황,사용시간,비고",
  "2026-06-12,연가,,가족 행사",
  "2026-06-19,오전반가,,병원",
  "2026-07-03,외출,1시간 30분,은행",
].join("\n");

describe("end-to-end local workflow", () => {
  it("keeps one timeline for imported and manual records through rollback and restore", async () => {
    const { store, storage } = newStore();
    await store.load();
    await store.run((data, context) =>
      createProfile(
        data,
        {
          callUpDate: "2026-05-04",
          expectedDischargeDate: "2028-02-03",
          serviceCategory: null,
          workplaceType: null,
          defaultCommuteCost: null,
          defaultMealAllowanceOverride: null,
          timezone: "Asia/Seoul",
          priorServiceCredit: "NONE",
        },
        context,
      ),
    );

    const manual = await store.run((data, context) =>
      createServiceEvent(
        data,
        {
          eventType: "ANNUAL_LEAVE",
          startDate: "2026-08-14",
          endDate: "2026-08-14",
          timing: { kind: "ALL_DAY", dayCount: 1 },
          title: null,
          note: null,
        },
        context,
      ),
    );
    expect(manual.ok).toBe(true);

    const first = await importCsv(store, CSV, "batch-1");
    expect(first.ok && first.value).toMatchObject({
      added: 3,
      skippedDuplicates: 0,
    });
    // Importing the same export again does not charge anything twice.
    const second = await importCsv(store, CSV, "batch-2");
    expect(second.ok).toBe(false);

    const profile = ready(store).profile!;
    let projection = buildAppProjection(ready(store), profile, "2026-09-24");
    expect(projection.liveEvents).toHaveLength(4);
    // 15 days − (1 manual day + 1 imported day + one half day) = 12.5 days.
    expect(projection.ledger.balance.remainingAfterScheduled).toEqual({
      halfDays: 25,
      minutes: 0,
    });
    expect(projection.ledger.attendanceMinutes.OUTING).toBe(90);
    expect(projection.compensation.components[0]?.monthlyAmount).toBe(900_000);

    const backupText = serializeBackup(
      createBackup(ready(store), "2026-09-24T00:00:00.000Z"),
    );

    const rolledBack = await store.run((data, context) =>
      rollbackImport(data, "batch-1", context),
    );
    expect(rolledBack.ok && rolledBack.value.removedEvents).toBe(3);
    projection = buildAppProjection(ready(store), profile, "2026-09-24");
    expect(projection.liveEvents.map((event) => event.source.kind)).toEqual([
      "MANUAL",
    ]);
    expect(projection.ledger.balance.remainingAfterScheduled.halfDays).toBe(28);

    // Restoring the backup on a fresh device brings the imported records back.
    const device = newStore();
    await device.store.load();
    const parsed = parseBackup(backupText);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    await device.store.run((data) => ({
      ok: true,
      data: replaceUserData(data, parsed.data),
      value: undefined,
    }));
    const restored = buildAppProjection(
      ready(device.store),
      profile,
      "2026-09-24",
    );
    expect(restored.liveEvents).toHaveLength(4);
    expect(storage.dump()[STORAGE_KEYS.current]).toBeDefined();
  });

  it("asks for confirmation instead of guessing leave for older call-up dates", async () => {
    const { store } = newStore();
    await store.load();
    await store.run((data, context) =>
      createProfile(
        data,
        {
          callUpDate: "2025-11-03",
          expectedDischargeDate: "2027-08-02",
          serviceCategory: null,
          workplaceType: null,
          defaultCommuteCost: null,
          defaultMealAllowanceOverride: null,
          timezone: "Asia/Seoul",
        },
        context,
      ),
    );
    const profile = ready(store).profile!;
    const before = buildAppProjection(ready(store), profile, "2026-09-24");
    expect(before.ledger.balance.status).toBe("NEEDS_CREDIT_CONFIRMATION");
    // Prior service unanswered: base pay needs input and no total exists.
    expect(before.compensation.components[0]?.status).toBe("NEEDS_INPUT");
    expect(before.compensation.total).toBeNull();

    await store.run((data, context) =>
      confirmLeaveCredit(
        data,
        {
          creditKey: "YEAR_1",
          grantDate: "2025-11-03",
          days: 15,
          reason: "기관 확인",
        },
        context,
      ),
    );
    const after = buildAppProjection(ready(store), profile, "2026-09-24");
    expect(after.ledger.balance.status).toBe("RESOLVED");
    expect(
      formatLeaveQuantity(after.ledger.balance.remainingAfterScheduled, null),
    ).toBe("15일");
  });

  it("combines partial minutes only after the workday length is set", async () => {
    const { store } = newStore();
    await store.load();
    await store.run((data, context) =>
      createProfile(
        data,
        {
          callUpDate: "2026-05-04",
          expectedDischargeDate: "2028-02-03",
          serviceCategory: null,
          workplaceType: null,
          defaultCommuteCost: null,
          defaultMealAllowanceOverride: null,
          timezone: "Asia/Seoul",
        },
        context,
      ),
    );
    await store.run((data, context) =>
      createServiceEvent(
        data,
        {
          eventType: "ANNUAL_LEAVE",
          startDate: "2026-09-01",
          endDate: "2026-09-01",
          timing: {
            kind: "PARTIAL",
            durationMinutes: 120,
            startTime: null,
            endTime: null,
          },
          title: null,
          note: null,
        },
        context,
      ),
    );
    let data = ready(store);
    let projection = buildAppProjection(data, data.profile!, "2026-09-24");
    expect(projection.ledger.balance.status).toBe("NEEDS_WORKDAY_MINUTES");

    await store.run((current, context) =>
      editProfile(
        current,
        { ...current.profile!, workdayMinutes: 480 },
        context,
      ),
    );
    data = ready(store);
    projection = buildAppProjection(data, data.profile!, "2026-09-24");
    expect(projection.ledger.balance.status).toBe("RESOLVED");
    expect(
      formatLeaveQuantity(
        projection.ledger.balance.remainingAfterScheduled,
        480,
      ),
    ).toBe("14일 6시간");
  });

  it("reaches a traceable monthly total only after every input is confirmed", async () => {
    const { store } = newStore();
    await store.load();
    await store.run((data, context) =>
      createProfile(
        data,
        {
          callUpDate: "2026-01-05",
          expectedDischargeDate: "2027-10-04",
          defaultCommuteCost: 2800,
          // No institution meal rate: the MMA 2026 minimum (9,000) applies.
          defaultMealAllowanceOverride: null,
          priorServiceCredit: "NONE",
          workPattern: "WEEKDAY_DAYTIME",
          workWeekdays: [1, 2, 3, 4, 5],
        },
        context,
      ),
    );
    await store.run((data, context) =>
      createServiceEvent(
        data,
        {
          eventType: "ANNUAL_LEAVE",
          startDate: "2026-09-10",
          endDate: "2026-09-10",
          timing: { kind: "ALL_DAY", dayCount: 1 },
          title: null,
          note: null,
        },
        context,
      ),
    );
    const profile = ready(store).profile!;
    const before = buildAppProjection(ready(store), profile, "2026-09-24");
    expect(before.compensation.total).toBeNull();
    expect(before.compensation.unresolved.join(" ")).toContain("공휴일");

    // 2026-09 has 22 weekdays; the user marks 9/24–9/25 as holidays.
    await store.run((data, context) =>
      saveAttendanceMonth(
        data,
        {
          month: "2026-09",
          nonWorkingDates: ["2026-09-24", "2026-09-25"],
          dayOverrides: [],
          hadNonPayableAbsence: false,
        },
        context,
      ),
    );
    // The full-day leave on 9/10 still needs an allowance decision.
    const pending = buildAppProjection(ready(store), profile, "2026-09-24");
    expect(pending.compensation.total).toBeNull();
    expect(pending.compensation.serviceDays?.undecidedDates).toEqual([
      "2026-09-10",
    ]);
    await store.run((data, context) =>
      saveAttendanceMonth(
        data,
        {
          month: "2026-09",
          nonWorkingDates: ["2026-09-24", "2026-09-25"],
          dayOverrides: [
            {
              date: "2026-09-10",
              mealEligible: false,
              transportEligible: false,
            },
          ],
          hadNonPayableAbsence: false,
        },
        context,
      ),
    );
    const after = buildAppProjection(ready(store), profile, "2026-09-24");
    expect(after.compensation.status).toBe("COMPLETE");
    // Month 9 → 상등병 1,200,000; 22 − 2 holidays − 1 leave = 19 days.
    expect(after.compensation.total).toBe(1_200_000 + 9000 * 19 + 2800 * 19);

    const saved = await store.run((data, context) =>
      saveCompensationSnapshot(
        data,
        {
          month: "2026-09",
          ruleId: after.compensation.rule!.id,
          ruleVersion: after.compensation.rule!.version,
          total: after.compensation.total,
          evaluation: JSON.parse(JSON.stringify(after.compensation)),
        },
        context,
      ),
    );
    expect(saved.ok).toBe(true);
    const restored = parseBackup(
      serializeBackup(createBackup(ready(store), "2026-09-24T00:00:00.000Z")),
    );
    expect(restored.ok && restored.data.compensationSnapshots[0]).toMatchObject(
      { ruleVersion: "2026", total: after.compensation.total },
    );
  });
});
