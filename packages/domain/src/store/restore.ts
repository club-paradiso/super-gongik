import {
  analyzeMerge,
  replaceUserData,
  type MergeFailureReason,
  type MergeOptions,
  type MergeStats,
} from "./merge";
import { canonicalJson } from "./integrity";
import type { UserData } from "./schema";
import {
  OutcomeLog,
  SYNC_COLLECTIONS,
  type CollectionCounts,
  type MergeConflict,
  type RecordChange,
  type SyncCollection,
} from "./sync-contract";

export type RestoreMode = "MERGE" | "REPLACE";

export type ProfileCompatibility =
  | "SAME_PROFILE"
  | "NO_LOCAL_PROFILE"
  | "DIFFERENT_PROFILE"
  | "NO_BACKUP_PROFILE";

export type RestoreBlock = {
  reason: MergeFailureReason;
  message: string;
};

/**
 * What a restore would do, computed without touching storage or either
 * input. The UI renders it; `executeRestore` refuses to apply anything the
 * plan did not show.
 */
export type RestorePlan = {
  mode: RestoreMode;
  /** REPLACE over existing data discards local records. */
  destructive: boolean;
  /** Must be confirmed explicitly before `executeRestore` will apply it. */
  requiresDestructiveConfirmation: boolean;
  /** `documentRevision` the plan was computed against (local tab check). */
  baseDocumentRevision: number;
  profile: ProfileCompatibility;
  counts: CollectionCounts;
  /** Every non-trivial per-record outcome (unchanged/retained are counted only). */
  changes: RecordChange[];
  conflicts: MergeConflict[];
  /** Why the plan cannot be applied as-is, or null. */
  blocked: RestoreBlock | null;
  /** MERGE only: legacy aggregate numbers used by existing copy. */
  stats: MergeStats | null;
  /** The document that would be persisted; null when blocked. */
  result: UserData | null;
};

export type RestoreRequest = {
  mode: RestoreMode;
  options?: MergeOptions;
  now: string;
  deviceId: string;
};

function hasLocalData(data: UserData): boolean {
  return (
    data.profile !== null ||
    data.events.length > 0 ||
    data.leaveAdjustments.length > 0 ||
    data.leaveSnapshots.length > 0 ||
    data.imports.length > 0 ||
    data.attendanceMonths.length > 0 ||
    data.compensationSnapshots.length > 0
  );
}

function profileCompatibility(
  current: UserData,
  incoming: UserData,
): ProfileCompatibility {
  if (!incoming.profile) return "NO_BACKUP_PROFILE";
  if (!current.profile) return "NO_LOCAL_PROFILE";
  return current.profile.id === incoming.profile.id
    ? "SAME_PROFILE"
    : "DIFFERENT_PROFILE";
}

type AnyRecord = { id: string; deletedAt?: string | null };

function collectionRecords(
  data: UserData,
  collection: SyncCollection,
): AnyRecord[] {
  if (collection === "profile") return data.profile ? [data.profile] : [];
  return data[collection] as AnyRecord[];
}

/** REPLACE: exact per-record diff of what the backup overwrites. */
function replaceDiff(current: UserData, incoming: UserData) {
  const log = new OutcomeLog();
  for (const collection of SYNC_COLLECTIONS) {
    const local = new Map(
      collectionRecords(current, collection).map((item) => [item.id, item]),
    );
    for (const item of collectionRecords(incoming, collection)) {
      const existing = local.get(item.id);
      local.delete(item.id);
      const itemLive = (item.deletedAt ?? null) === null;
      if (!existing) {
        log.add(collection, item.id, itemLive ? "ADDED" : "ADDED_HISTORY");
        continue;
      }
      const existingLive = (existing.deletedAt ?? null) === null;
      // Replace takes the backup verbatim, so compare full records.
      if (canonicalJson(existing) === canonicalJson(item)) {
        log.add(collection, item.id, "UNCHANGED");
      } else if (existingLive && !itemLive) {
        log.add(collection, item.id, "DELETED");
      } else if (!existingLive && itemLive) {
        log.add(collection, item.id, "RESTORED");
      } else {
        log.add(collection, item.id, "REPLACED");
      }
    }
    for (const id of local.keys()) log.add(collection, id, "REMOVED");
  }
  return log;
}

/** Plan a restore. Pure: reads both documents, mutates neither. */
export function planRestore(
  current: UserData,
  incoming: UserData,
  request: RestoreRequest,
): RestorePlan {
  const profile = profileCompatibility(current, incoming);
  const base = {
    mode: request.mode,
    baseDocumentRevision: current.documentRevision,
    profile,
  };

  if (request.mode === "REPLACE") {
    const log = replaceDiff(current, incoming);
    const localData = hasLocalData(current);
    const discards = SYNC_COLLECTIONS.some((name) => {
      const counts = log.counts[name];
      return (
        (counts.REMOVED ?? 0) + (counts.REPLACED ?? 0) + (counts.DELETED ?? 0) >
        0
      );
    });
    return {
      ...base,
      destructive: localData,
      requiresDestructiveConfirmation: localData && discards,
      counts: log.counts,
      changes: log.changes,
      conflicts: [],
      blocked: null,
      stats: null,
      result: replaceUserData(current, incoming),
    };
  }

  const analysis = analyzeMerge(
    current,
    incoming,
    { now: request.now, deviceId: request.deviceId },
    request.options,
  );
  if (!analysis.ok) {
    return {
      ...base,
      destructive: false,
      requiresDestructiveConfirmation: false,
      counts: new OutcomeLog().counts,
      changes: [],
      conflicts: [],
      blocked: { reason: analysis.reason, message: analysis.error },
      stats: null,
      result: null,
    };
  }
  const { conflicts } = analysis.analysis;
  return {
    ...base,
    destructive: false,
    requiresDestructiveConfirmation: false,
    counts: analysis.analysis.counts,
    changes: analysis.analysis.changes,
    conflicts,
    blocked:
      conflicts.length > 0
        ? {
            reason: "UNRESOLVED_CONFLICTS",
            message: `같은 버전인데 내용이 다른 기록이 ${conflicts.length}건 있어요. 어느 쪽을 남길지 직접 골라야 합칠 수 있어요.`,
          }
        : null,
    stats: analysis.analysis.stats,
    result: conflicts.length > 0 ? null : analysis.analysis.data,
  };
}

export type RestoreFailureCode =
  | "STALE_PREVIEW"
  | "BLOCKED"
  | "CONFIRMATION_REQUIRED"
  | "READ_ONLY"
  | "PRESERVE_FAILED"
  | "STORAGE_WRITE_FAILED";

export type RestoreExecution =
  | { ok: true; plan: RestorePlan; data: UserData }
  | { ok: false; code: RestoreFailureCode; message: string };

/**
 * Re-plan against the document that is about to be written and apply only if
 * it is still the document the user previewed. Pure; persistence (and the
 * pre-restore copy) is the store's job.
 */
export function executeRestore(
  current: UserData,
  incoming: UserData,
  request: RestoreRequest & {
    /** `plan.baseDocumentRevision` of the preview the user confirmed. */
    expectedDocumentRevision: number;
    /** True only after an explicit destructive confirmation for REPLACE. */
    confirmDestructive?: boolean;
  },
): RestoreExecution {
  if (current.documentRevision !== request.expectedDocumentRevision) {
    return {
      ok: false,
      code: "STALE_PREVIEW",
      message:
        "미리보기 이후 다른 탭이나 창에서 데이터가 바뀌었어요. 아무것도 바꾸지 않았어요. 미리보기를 다시 확인해 주세요.",
    };
  }
  const plan = planRestore(current, incoming, request);
  if (plan.blocked || !plan.result) {
    return {
      ok: false,
      code: "BLOCKED",
      message: plan.blocked?.message ?? "복원할 수 없어요.",
    };
  }
  if (plan.requiresDestructiveConfirmation && !request.confirmDestructive) {
    return {
      ok: false,
      code: "CONFIRMATION_REQUIRED",
      message:
        "덮어쓰기는 이 기기의 기록을 바꾸거나 지워요. 확인 후 다시 시도해 주세요.",
    };
  }
  return { ok: true, plan, data: plan.result };
}
