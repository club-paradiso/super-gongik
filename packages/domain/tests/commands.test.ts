import { describe, expect, it } from "vitest";

import {
  commitImport,
  createServiceEvent,
  deleteServiceEvent,
  importConsistencyIssues,
  isLive,
  planImportRows,
  restoreServiceEvent,
  rollbackImport,
  updateServiceEvent,
  type ImportDraft,
  type UserData,
} from "../src";
import {
  allDay,
  context,
  halfDay,
  partial,
  userDataWithProfile,
} from "./helpers";

function unwrap<T>(
  result: { ok: true; data: UserData; value: T } | { ok: false },
) {
  if (!result.ok) throw new Error(JSON.stringify(result));
  return result;
}

function importDraft(
  draft: ImportDraft["draft"],
  fingerprint: string,
  row = 2,
): ImportDraft {
  return {
    draft,
    source: {
      kind: "IMPORT",
      batchId: "pending",
      format: "CSV",
      fileName: "복무기록.csv",
      fingerprint,
      confidence: 1,
      sourceRowIndex: row,
    },
  };
}

const batch = (id: string) => ({
  id,
  fileName: `${id}.csv`,
  sourceFormat: "CSV" as const,
  fileSha256: `sha-${id}`,
  createdAt: "2026-09-24T00:00:00.000Z",
});

describe("manual service-event lifecycle", () => {
  it("creates, edits, soft-deletes and restores one canonical record", () => {
    const ctx = context();
    const created = unwrap(
      createServiceEvent(
        userDataWithProfile(),
        allDay("ANNUAL_LEAVE", "2026-09-10"),
        ctx,
      ),
    );
    expect(created.value.source).toEqual({ kind: "MANUAL" });
    expect(created.value.revision).toBe(1);

    const edited = unwrap(
      updateServiceEvent(
        created.data,
        created.value.id,
        halfDay("2026-09-10", "AM"),
        ctx,
      ),
    );
    expect(edited.value.timing).toEqual({ kind: "HALF_DAY", half: "AM" });
    expect(edited.value.revision).toBe(2);
    expect(edited.value.createdAt).toBe(created.value.createdAt);
    expect(edited.data.events).toHaveLength(1);

    const deleted = unwrap(
      deleteServiceEvent(edited.data, created.value.id, ctx),
    );
    expect(deleted.data.events).toHaveLength(1);
    expect(deleted.data.events.filter(isLive)).toHaveLength(0);
    expect(deleted.value.revision).toBe(3);

    const restored = unwrap(
      restoreServiceEvent(deleted.data, created.value.id, ctx),
    );
    expect(restored.value.deletedAt).toBeNull();
    expect(restored.value.revision).toBe(4);
  });

  it("refuses a second identical partial leave through the command layer (case B)", () => {
    const ctx = context();
    const first = unwrap(
      createServiceEvent(
        userDataWithProfile(),
        partial("ANNUAL_LEAVE", "2026-09-10", 120),
        ctx,
      ),
    );
    const second = createServiceEvent(
      first.data,
      partial("ANNUAL_LEAVE", "2026-09-10", 120),
      ctx,
    );
    expect(second.ok).toBe(false);
    expect(!second.ok && second.errors[0]?.code).toBe("LEAVE_OVERLAP");
  });

  it("refuses to restore a deleted leave that now conflicts", () => {
    const ctx = context();
    const first = unwrap(
      createServiceEvent(
        userDataWithProfile(),
        allDay("ANNUAL_LEAVE", "2026-09-10"),
        ctx,
      ),
    );
    const deleted = unwrap(deleteServiceEvent(first.data, first.value.id, ctx));
    const replacement = unwrap(
      createServiceEvent(deleted.data, allDay("SICK_LEAVE", "2026-09-10"), ctx),
    );
    const result = restoreServiceEvent(replacement.data, first.value.id, ctx);
    expect(result.ok).toBe(false);
  });
});

describe("import commit and rollback", () => {
  it("keeps imported and manual events in one list and skips cross-source duplicates", () => {
    const ctx = context();
    const manual = unwrap(
      createServiceEvent(
        userDataWithProfile(),
        allDay("ANNUAL_LEAVE", "2026-06-12"),
        ctx,
      ),
    );
    const drafts = [
      importDraft(allDay("ANNUAL_LEAVE", "2026-06-12"), "fp-a", 2),
      importDraft(partial("OUTING", "2026-06-15", 90), "fp-b", 3),
    ];
    expect(
      planImportRows(manual.data, drafts).map((row) => row.status),
    ).toEqual(["DUPLICATE_CONTENT", "NEW"]);

    const committed = unwrap(
      commitImport(
        manual.data,
        { batch: batch("batch-1"), drafts, snapshots: [] },
        ctx,
      ),
    );
    expect(committed.value).toMatchObject({ added: 1, skippedDuplicates: 1 });
    expect(committed.data.events.filter(isLive)).toHaveLength(2);
    const imported = committed.data.events.find(
      (event) => event.source.kind === "IMPORT",
    );
    expect(imported?.source).toMatchObject({
      batchId: "batch-1",
      fingerprint: "fp-b",
    });

    // Importing the same file again adds nothing.
    const again = commitImport(
      committed.data,
      { batch: batch("batch-2"), drafts, snapshots: [] },
      ctx,
    );
    expect(again.ok).toBe(false);
  });

  it("reactivates a rolled-back batch when one of its events is restored", () => {
    const ctx = context();
    const committed = unwrap(
      commitImport(
        userDataWithProfile(),
        {
          batch: batch("batch-r"),
          drafts: [importDraft(allDay("ANNUAL_LEAVE", "2026-06-12"), "fp-r")],
          snapshots: [],
        },
        ctx,
      ),
    );
    const rolledBack = unwrap(rollbackImport(committed.data, "batch-r", ctx));
    const eventId = rolledBack.data.events[0]!.id;
    const restored = unwrap(restoreServiceEvent(rolledBack.data, eventId, ctx));
    expect(restored.data.imports[0]).toMatchObject({
      status: "ACTIVE",
      rolledBackAt: null,
    });
    expect(importConsistencyIssues(restored.data)).toEqual([]);
  });

  it("rejects an imported partial leave on a manual full-day leave (case A via import)", () => {
    const ctx = context();
    const manual = unwrap(
      createServiceEvent(
        userDataWithProfile(),
        allDay("ANNUAL_LEAVE", "2026-06-12"),
        ctx,
      ),
    );
    const decisions = planImportRows(manual.data, [
      importDraft(partial("ANNUAL_LEAVE", "2026-06-12", 120), "fp-x"),
    ]);
    expect(decisions[0]?.status).toBe("CONFLICT");
    const commit = commitImport(
      manual.data,
      {
        batch: batch("b"),
        drafts: [
          importDraft(partial("ANNUAL_LEAVE", "2026-06-12", 120), "fp-x"),
        ],
        snapshots: [],
      },
      ctx,
    );
    expect(commit.ok).toBe(false);
  });

  it("marks imported rows with undecidable overlap as NEW with an explicit warning", () => {
    const ctx = context();
    const manual = unwrap(
      createServiceEvent(
        userDataWithProfile(),
        partial("ANNUAL_LEAVE", "2026-06-12", 60),
        ctx,
      ),
    );
    const [decision] = planImportRows(manual.data, [
      importDraft(partial("ANNUAL_LEAVE", "2026-06-12", 90), "fp-y"),
    ]);
    expect(decision?.status).toBe("NEW");
    expect(
      decision?.status === "NEW" && decision.warnings.map((w) => w.code),
    ).toContain("LEAVE_OVERLAP_UNRESOLVED");
  });

  it("rejects import rows that would double-charge leave inside the same file", () => {
    const decisions = planImportRows(userDataWithProfile(), [
      importDraft(allDay("ANNUAL_LEAVE", "2026-07-01"), "fp-1", 2),
      importDraft(allDay("SICK_LEAVE", "2026-07-01"), "fp-2", 3),
    ]);
    expect(decisions.map((row) => row.status)).toEqual(["NEW", "CONFLICT"]);
  });

  it("rollback removes only that batch and never manual or other-batch records", () => {
    const ctx = context();
    const manual = unwrap(
      createServiceEvent(
        userDataWithProfile(),
        allDay("ANNUAL_LEAVE", "2026-06-12"),
        ctx,
      ),
    );
    const first = unwrap(
      commitImport(
        manual.data,
        {
          batch: batch("batch-1"),
          drafts: [importDraft(partial("OUTING", "2026-06-15", 60), "fp-1")],
          snapshots: [
            {
              leaveType: "ANNUAL_LEAVE",
              asOfDate: "2026-06-30",
              grantedDays: 15,
              grantedMinutes: null,
              usedDays: 1,
              usedMinutes: null,
              remainingDays: 14,
              remainingMinutes: 0,
              confidence: 1,
              sourceRowIndex: 2,
            },
          ],
        },
        ctx,
      ),
    );
    const second = unwrap(
      commitImport(
        first.data,
        {
          batch: batch("batch-2"),
          drafts: [
            importDraft(partial("LATE_ARRIVAL", "2026-06-16", 20), "fp-2"),
          ],
          snapshots: [],
        },
        ctx,
      ),
    );

    const rolledBack = unwrap(rollbackImport(second.data, "batch-1", ctx));
    expect(rolledBack.value.removedEvents).toBe(1);
    const live = rolledBack.data.events.filter(isLive);
    expect(live.map((event) => event.eventType).sort()).toEqual([
      "ANNUAL_LEAVE",
      "LATE_ARRIVAL",
    ]);
    expect(
      rolledBack.data.leaveSnapshots.every((item) => item.deletedAt !== null),
    ).toBe(true);
    expect(
      rolledBack.data.imports.find((item) => item.id === "batch-1")?.status,
    ).toBe("ROLLED_BACK");
    expect(rollbackImport(rolledBack.data, "batch-1", ctx).ok).toBe(false);
  });
});
