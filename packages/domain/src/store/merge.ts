import type {
  AttendanceMonth,
  CompensationSnapshot,
} from "../compensation/records";
import {
  SERVICE_EVENT_TYPE_LABELS,
  isLive,
  serviceEventContentKey,
  type ServiceEvent,
} from "../events/model";
import { compareLeaveRecords } from "../events/validation";
import type {
  ImportRecord,
  LeaveAdjustment,
  LeaveSnapshot,
} from "../leave/records";
import {
  addDays,
  differenceInCalendarDays,
  type DateOnly,
} from "../service/date-only";
import type { ServiceProfile } from "../service/profile";
import type { UserData } from "./schema";
import {
  OutcomeLog,
  compareImmutable,
  compareRevisioned,
  descendsFrom,
  conflictKey,
  payloadKey,
  profileSupersedes,
  settleProfile,
  settledVersion,
  versionInfo,
  type CollectionCounts,
  type ConflictResolution,
  type MergeConflict,
  type RecordChange,
  type RecordOutcome,
  type RejectReason,
  type Revisioned,
  type SyncCollection,
} from "./sync-contract";

export type MergeOptions = {
  /**
   * Explicit user choice: bring back records that were deleted on this device
   * but are live in an older incoming copy. Off by default, because a stale
   * copy must never silently resurrect a newer deletion.
   */
  restoreLocallyDeleted?: boolean;
  /**
   * What to do with an incoming tombstone that is newer than a live local
   * record. Backup recovery keeps the local record (`KEEP_LOCAL_LIVE`); the
   * sync engine propagates deletions (`APPLY_NEWER`).
   */
  incomingDeletions?: "KEEP_LOCAL_LIVE" | "APPLY_NEWER";
  /** Human answers for conflicts, keyed by `MergeConflict.key`. */
  resolutions?: Readonly<Record<string, ConflictResolution>>;
  /**
   * A record whose content matches a live local record under another id.
   * Backup recovery skips it (`SKIP`, default): the same fact probably came
   * in twice. Sync keeps it (`KEEP_BOTH`): every device must hold the same
   * set of ids to converge, and the user deletes a real duplicate once for
   * all devices. Invariants (overlapping leave, a second credit
   * confirmation, a second answer for a month) are enforced either way.
   */
  duplicateContent?: "SKIP" | "KEEP_BOTH";
};

export type MergeContext = { now: string; deviceId: string };

export type MergeStats = {
  addedEvents: number;
  updatedEvents: number;
  restoredEvents: number;
  /** Current live events the backup had deleted; merge keeps them live. */
  keptLiveOverBackupDeletion: number;
  /** Events deleted here that the (older) backup still has live. */
  keptLocalDeletions: number;
  skippedDuplicateEvents: number;
  skippedConflictingEvents: number;
  addedAdjustments: number;
  restoredAdjustments: number;
  skippedAdjustments: number;
  addedSnapshots: number;
  restoredSnapshots: number;
  addedImports: number;
  reactivatedImports: number;
  addedAttendanceMonths: number;
  updatedAttendanceMonths: number;
  addedCompensationSnapshots: number;
  profileUpdated: boolean;
  /** Human-readable reasons for records that were kept as they were. */
  conflicts: string[];
};

export type MergeAnalysis = {
  /** The merged document. Records with unresolved conflicts stay local. */
  data: UserData;
  stats: MergeStats;
  counts: CollectionCounts;
  changes: RecordChange[];
  /** Unresolved conflicts; the merge must not be applied while any remain. */
  conflicts: MergeConflict[];
};

export type MergeFailureReason =
  "NO_INCOMING_PROFILE" | "PROFILE_MISMATCH" | "UNRESOLVED_CONFLICTS";

export type MergeResult =
  | ({ ok: true } & MergeAnalysis)
  | {
      ok: false;
      reason: MergeFailureReason;
      error: string;
      conflicts: MergeConflict[];
    };

type VersionedLike = {
  id: string;
  revision?: number;
  updatedAt?: string;
  deletedAt?: string | null;
};

type Block = { outcome: "DUPLICATE" | "REJECTED"; reason?: RejectReason };
type Phase = "ADD" | "UPDATE" | "RESTORE";

/** Events whose range exceeds this are checked against every live event. */
const WIDE_RANGE_DAYS = 62;

/**
 * Day-bucket index of live events, so duplicate and overlap checks only look
 * at events sharing a date instead of scanning the whole timeline.
 */
class LiveEventIndex {
  private readonly byDay = new Map<string, Set<string>>();
  private readonly wide = new Set<string>();

  constructor(private readonly events: Map<string, ServiceEvent>) {
    for (const event of events.values()) if (isLive(event)) this.add(event);
  }

  private days(event: ServiceEvent): DateOnly[] | null {
    const span = differenceInCalendarDays(event.endDate, event.startDate);
    if (span < 0 || span > WIDE_RANGE_DAYS) return null;
    return Array.from({ length: span + 1 }, (_, offset) =>
      addDays(event.startDate, offset),
    );
  }

  add(event: ServiceEvent) {
    const days = this.days(event);
    if (!days) {
      this.wide.add(event.id);
      return;
    }
    for (const day of days) {
      let bucket = this.byDay.get(day);
      if (!bucket) this.byDay.set(day, (bucket = new Set()));
      bucket.add(event.id);
    }
  }

  remove(event: ServiceEvent) {
    this.wide.delete(event.id);
    for (const day of this.days(event) ?? [])
      this.byDay.get(day)?.delete(event.id);
  }

  /** Live events that may share a date with `event`, excluding itself. */
  neighbours(event: ServiceEvent): ServiceEvent[] {
    const days = this.days(event);
    const ids = new Set<string>(this.wide);
    if (days) {
      for (const day of days) {
        for (const id of this.byDay.get(day) ?? []) ids.add(id);
      }
    } else {
      for (const [id, other] of this.events) if (isLive(other)) ids.add(id);
    }
    ids.delete(event.id);
    return [...ids]
      .map((id) => this.events.get(id)!)
      .filter((other) => isLive(other));
  }
}

function correctionKey(item: LeaveAdjustment) {
  return [
    item.kind,
    item.creditKey ?? "",
    item.effectiveDate,
    item.amountHalfDays,
    item.amountMinutes,
    item.reason,
  ].join("|");
}

const byId = <T extends { id: string }>(a: T, b: T) =>
  a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

/**
 * Merge two versions of one user's document.
 *
 * Record contract (every revisioned collection — events, adjustments,
 * attendance months, compensation snapshots; see `compareRevisioned`):
 * 1. Same payload (ignoring write metadata) is a no-op.
 * 2. If one version provably descends from the other (`descendsFrom`: same
 *    device and higher revision, or recorded ancestry), it wins.
 * 3. Concurrent versions — equal revisions, or unequal revisions with no
 *    provable ancestry — are structured conflicts. Nothing is applied until
 *    every conflict has an explicit resolution; the chosen content is
 *    written as a new version above and descending from both, so merging
 *    either old branch again is a no-op instead of a reopened conflict.
 * 4. A stale copy from the same device never resurrects a newer local
 *    deletion, unless the caller passes `restoreLocallyDeleted` (an explicit
 *    user choice); the restored record then gets a revision above both.
 * 5. A newer same-device deletion of a live local record is applied only
 *    with `incomingDeletions: "APPLY_NEWER"`. Backup recovery keeps the live
 *    record and reports it.
 * 6. Domain invariants still hold: a record that would charge the same leave
 *    twice, give one credit two confirmations or one month two attendance
 *    answers is not applied; the local state is kept and reported.
 *
 * Records without revisions:
 * - Leave snapshots and import records are written once. Differing content
 *   under one id is a conflict. Their live/rolled-back state follows the
 *   events of their import batch.
 * - The profile has no revision: it is ordered only by its digest ancestry
 *   (`supersedes`); otherwise any difference is a conflict.
 *
 * Neither input is mutated. `documentRevision`, `deviceId` and `savedAt`
 * always come from `current`: they describe this device's storage, not the
 * records.
 */
export function analyzeMerge(
  current: UserData,
  incoming: UserData,
  context: MergeContext,
  options: MergeOptions = {},
):
  | { ok: true; analysis: MergeAnalysis }
  | { ok: false; reason: MergeFailureReason; error: string } {
  if (!incoming.profile) {
    return {
      ok: false,
      reason: "NO_INCOMING_PROFILE",
      error: "백업에 복무 프로필이 없어 합칠 수 없어요.",
    };
  }
  if (current.profile && current.profile.id !== incoming.profile.id) {
    return {
      ok: false,
      reason: "PROFILE_MISMATCH",
      error:
        "다른 복무 프로필의 백업이에요. 합치기 대신 '덮어쓰기'로만 복원할 수 있어요.",
    };
  }

  const log = new OutcomeLog();
  const conflicts: MergeConflict[] = [];
  const messages: string[] = [];
  const resolutionFor = (collection: SyncCollection, id: string) =>
    options.resolutions?.[conflictKey(collection, id)];
  const conflict = (
    collection: SyncCollection,
    local: VersionedLike,
    other: VersionedLike,
    type: MergeConflict["type"],
  ) => {
    conflicts.push({
      key: conflictKey(collection, local.id),
      collection,
      recordId: local.id,
      type,
      local: versionInfo(local),
      incoming: versionInfo(other),
    });
    log.add(collection, local.id, "CONFLICT");
  };
  /** `chosen`'s content as a new version above and descending from both. */
  const settle = <T extends Revisioned>(chosen: T, other: T): T => ({
    ...chosen,
    ...settledVersion(chosen, other, context),
  });

  /** Shared per-record rules for every revisioned collection. */
  function reconcile<T extends Revisioned>(spec: {
    collection: SyncCollection;
    records: Map<string, T>;
    incoming: T[];
    put: (record: T) => void;
    block: (candidate: T, phase: Phase) => Block | null;
  }) {
    const { collection, records, put } = spec;
    const localIds = new Set(records.keys());
    const tryPut = (candidate: T, phase: Phase): boolean => {
      const blocked = spec.block(candidate, phase);
      if (blocked) {
        log.add(collection, candidate.id, blocked.outcome, blocked.reason);
        return false;
      }
      put(candidate);
      return true;
    };

    for (const item of spec.incoming) {
      localIds.delete(item.id);
      const existing = records.get(item.id);
      if (!existing) {
        if (!isLive(item)) {
          put(item);
          log.add(collection, item.id, "ADDED_HISTORY");
        } else if (tryPut(item, "ADD")) {
          log.add(collection, item.id, "ADDED");
        }
        continue;
      }

      const verdict = compareRevisioned(existing, item);
      switch (verdict) {
        case "IDENTICAL":
          // Same content. Still adopt a newer version's metadata (revision,
          // ancestry) when it provably descends from ours, so this device's
          // next edit builds on the settled history instead of forking it.
          if (descendsFrom(item, existing) && !descendsFrom(existing, item)) {
            put(item);
          }
          log.add(collection, item.id, "UNCHANGED");
          break;
        case "DIVERGENT":
        case "UNORDERED": {
          const choice = resolutionFor(collection, item.id);
          if (!choice) {
            conflict(
              collection,
              existing,
              item,
              verdict === "DIVERGENT"
                ? "EQUAL_VERSION_DIVERGENT"
                : "CROSS_DEVICE_DIVERGENT",
            );
            break;
          }
          // The chosen content becomes a new version that descends from
          // both branches, so merging either branch again finds an ancestor
          // and never reopens this conflict.
          const resolved =
            choice === "LOCAL"
              ? settle(existing, item)
              : settle(item, existing);
          if (choice === "INCOMING" && isLive(resolved)) {
            if (!tryPut(resolved, "UPDATE")) break;
          } else {
            put(resolved);
          }
          log.add(
            collection,
            item.id,
            choice === "LOCAL" ? "RESOLVED_LOCAL" : "RESOLVED_INCOMING",
          );
          break;
        }
        case "LOCAL_NEWER":
          if (!isLive(existing) && isLive(item)) {
            if (!options.restoreLocallyDeleted) {
              log.add(collection, item.id, "LOCAL_DELETION_KEPT");
            } else if (
              tryPut({ ...settle(item, existing), deletedAt: null }, "RESTORE")
            ) {
              log.add(collection, item.id, "RESTORED");
            }
          } else {
            log.add(collection, item.id, "RETAINED_LOCAL");
          }
          break;
        case "INCOMING_NEWER":
          if (!isLive(item)) {
            if (!isLive(existing)) {
              put(item);
              log.add(collection, item.id, "HISTORY_UPDATED");
            } else if (options.incomingDeletions === "APPLY_NEWER") {
              put(item);
              log.add(collection, item.id, "DELETED");
            } else {
              log.add(collection, item.id, "INCOMING_DELETION_NOT_APPLIED");
            }
          } else if (tryPut(item, isLive(existing) ? "UPDATE" : "RESTORE")) {
            log.add(
              collection,
              item.id,
              isLive(existing) ? "UPDATED" : "RESTORED",
            );
          }
          break;
      }
    }
    for (const id of localIds) log.add(collection, id, "RETAINED_LOCAL");
  }

  // ── Profile ─────────────────────────────────────────────────────────────
  let profile: ServiceProfile = current.profile ?? incoming.profile;
  if (!current.profile) {
    log.add("profile", incoming.profile.id, "ADDED");
  } else if (payloadKey(current.profile) === payloadKey(incoming.profile)) {
    log.add("profile", profile.id, "UNCHANGED");
  } else {
    // The profile has no revision and wall clocks prove nothing; only its
    // digest ancestry (`supersedes`) can order two versions.
    const local = current.profile;
    const other = incoming.profile;
    const localAfter = profileSupersedes(local, other);
    const incomingAfter = profileSupersedes(other, local);
    const choice = resolutionFor("profile", profile.id);
    if (localAfter && !incomingAfter) {
      log.add("profile", profile.id, "RETAINED_LOCAL");
    } else if (incomingAfter && !localAfter) {
      profile = other;
      log.add("profile", profile.id, "UPDATED");
    } else if (!choice) {
      conflict("profile", local, other, "UNVERSIONED_DIVERGENT");
    } else {
      profile = settleProfile(
        choice === "LOCAL" ? local : other,
        choice === "LOCAL" ? other : local,
        context.now,
      );
      log.add(
        "profile",
        profile.id,
        choice === "LOCAL" ? "RESOLVED_LOCAL" : "RESOLVED_INCOMING",
      );
    }
  }

  // ── Events ──────────────────────────────────────────────────────────────
  const events = new Map(current.events.map((event) => [event.id, event]));
  const index = new LiveEventIndex(events);
  const describe = (event: ServiceEvent) =>
    `${event.startDate} ${SERVICE_EVENT_TYPE_LABELS[event.eventType]}`;
  reconcile<ServiceEvent>({
    collection: "events",
    records: events,
    incoming: [...incoming.events].sort(
      (a, b) => a.startDate.localeCompare(b.startDate) || byId(a, b),
    ),
    put(event) {
      const previous = events.get(event.id);
      if (previous && isLive(previous)) index.remove(previous);
      events.set(event.id, event);
      if (isLive(event)) index.add(event);
    },
    block(candidate, phase) {
      const others = index.neighbours(candidate);
      const key = serviceEventContentKey(candidate);
      if (
        options.duplicateContent !== "KEEP_BOTH" &&
        others.some((other) => serviceEventContentKey(other) === key)
      ) {
        return { outcome: "DUPLICATE" };
      }
      if (
        !others.some(
          (other) => compareLeaveRecords(candidate, other) === "CONFLICT",
        )
      ) {
        return null;
      }
      messages.push(
        phase === "ADD"
          ? `${describe(candidate)}: 기존 휴가와 시간이 겹쳐 추가하지 않았어요.`
          : phase === "UPDATE"
            ? `${describe(candidate)}: 백업의 수정본이 다른 기록과 겹쳐 현재 기록을 유지했어요.`
            : `${describe(candidate)}: 되살리면 다른 휴가와 겹쳐 삭제 상태를 유지했어요.`,
      );
      return { outcome: "REJECTED", reason: "LEAVE_OVERLAP" };
    },
  });

  // ── Leave adjustments ───────────────────────────────────────────────────
  const adjustments = new Map(
    current.leaveAdjustments.map((item) => [item.id, item]),
  );
  reconcile<LeaveAdjustment>({
    collection: "leaveAdjustments",
    records: adjustments,
    incoming: [...incoming.leaveAdjustments].sort(
      (a, b) => a.createdAt.localeCompare(b.createdAt) || byId(a, b),
    ),
    put: (item) => adjustments.set(item.id, item),
    block(candidate) {
      const others = [...adjustments.values()].filter(
        (item) => isLive(item) && item.id !== candidate.id,
      );
      if (
        candidate.kind === "GRANT_CONFIRMATION" &&
        others.some(
          (item) =>
            item.kind === "GRANT_CONFIRMATION" &&
            item.creditKey === candidate.creditKey,
        )
      ) {
        messages.push(
          `${candidate.creditKey} 부여 확인값이 이미 있어 현재 값을 유지했어요.`,
        );
        return { outcome: "REJECTED", reason: "CREDIT_ALREADY_CONFIRMED" };
      }
      if (options.duplicateContent === "KEEP_BOTH") return null;
      const key = correctionKey(candidate);
      return others.some((item) => correctionKey(item) === key)
        ? { outcome: "DUPLICATE" }
        : null;
    },
  });

  // ── Import batches: liveness follows their events ───────────────────────
  const batchHasEvents = new Set<string>();
  const batchHasLiveEvents = new Set<string>();
  for (const event of events.values()) {
    if (event.source.kind !== "IMPORT") continue;
    batchHasEvents.add(event.source.batchId);
    if (isLive(event)) batchHasLiveEvents.add(event.source.batchId);
  }

  // ── Leave snapshots (written once; deletion follows the batch) ──────────
  const snapshots = new Map(
    current.leaveSnapshots.map((item) => [item.id, item]),
  );
  const localSnapshotIds = new Set(snapshots.keys());
  for (const item of [...incoming.leaveSnapshots].sort(byId)) {
    localSnapshotIds.delete(item.id);
    const batch = item.importBatchId;
    const existing = snapshots.get(item.id);
    if (!existing) {
      if (
        isLive(item) &&
        batchHasEvents.has(batch) &&
        !batchHasLiveEvents.has(batch)
      ) {
        // Its batch's events are not live here; keep it as history only.
        snapshots.set(item.id, { ...item, deletedAt: context.now });
        log.add(
          "leaveSnapshots",
          item.id,
          "REJECTED",
          "BATCH_RECORDS_UNAVAILABLE",
        );
      } else {
        snapshots.set(item.id, item);
        log.add(
          "leaveSnapshots",
          item.id,
          isLive(item) ? "ADDED" : "ADDED_HISTORY",
        );
      }
      continue;
    }

    let base: LeaveSnapshot = existing;
    let resolved: "RESOLVED_LOCAL" | "RESOLVED_INCOMING" | null = null;
    if (compareImmutable(existing, item, ["deletedAt"]) === "DIVERGENT") {
      const choice = resolutionFor("leaveSnapshots", item.id);
      if (!choice) {
        conflict(
          "leaveSnapshots",
          existing,
          item,
          "IMMUTABLE_RECORD_DIVERGENT",
        );
        continue;
      }
      if (choice === "INCOMING") {
        base = { ...item, deletedAt: existing.deletedAt };
        snapshots.set(item.id, base);
      }
      resolved = choice === "LOCAL" ? "RESOLVED_LOCAL" : "RESOLVED_INCOMING";
    }

    if (isLive(item) && !isLive(base)) {
      const restore =
        batchHasLiveEvents.has(batch) ||
        (options.restoreLocallyDeleted === true && !batchHasEvents.has(batch));
      if (restore) snapshots.set(item.id, { ...base, deletedAt: null });
      log.add(
        "leaveSnapshots",
        item.id,
        resolved ?? (restore ? "RESTORED" : "LOCAL_DELETION_KEPT"),
      );
    } else if (!isLive(item) && isLive(base)) {
      // Sync policy: a deletion is applied when this side has no live event
      // of the batch either. That includes a snapshot-only batch, whose
      // rollback is terminal (no command revives it), so its deletion can
      // travel between devices.
      const apply =
        options.incomingDeletions === "APPLY_NEWER" &&
        !batchHasLiveEvents.has(batch);
      if (apply) snapshots.set(item.id, { ...base, deletedAt: item.deletedAt });
      log.add(
        "leaveSnapshots",
        item.id,
        resolved ?? (apply ? "DELETED" : "INCOMING_DELETION_NOT_APPLIED"),
      );
    } else {
      log.add("leaveSnapshots", item.id, resolved ?? "UNCHANGED");
    }
  }
  for (const id of localSnapshotIds) {
    log.add("leaveSnapshots", id, "RETAINED_LOCAL");
  }
  const finalSnapshots = [...snapshots.values()];
  const batchHasLiveSnapshots = new Set(
    finalSnapshots.filter(isLive).map((item) => item.importBatchId),
  );
  // Under the sync policy a snapshot-only batch's status follows its
  // snapshots, as a batch with events follows its events.
  const batchHasRecords = new Set(batchHasEvents);
  if (options.incomingDeletions === "APPLY_NEWER") {
    for (const item of finalSnapshots) batchHasRecords.add(item.importBatchId);
  }

  // ── Import records (written once; status re-derived) ────────────────────
  const imports = new Map(current.imports.map((item) => [item.id, item]));
  const localImportIds = new Set(imports.keys());
  for (const item of [...incoming.imports].sort(byId)) {
    localImportIds.delete(item.id);
    const existing = imports.get(item.id);
    const isNew = !existing;
    let record: ImportRecord = existing ?? item;
    let resolved: "RESOLVED_LOCAL" | "RESOLVED_INCOMING" | null = null;
    if (
      existing &&
      compareImmutable(existing, item, ["status", "rolledBackAt"]) ===
        "DIVERGENT"
    ) {
      const choice = resolutionFor("imports", item.id);
      if (!choice) {
        conflict("imports", existing, item, "IMMUTABLE_RECORD_DIVERGENT");
        continue;
      }
      if (choice === "INCOMING") {
        record = {
          ...item,
          status: existing.status,
          rolledBackAt: existing.rolledBackAt,
        };
      }
      resolved = choice === "LOCAL" ? "RESOLVED_LOCAL" : "RESOLVED_INCOMING";
    }

    const live =
      batchHasLiveEvents.has(item.id) || batchHasLiveSnapshots.has(item.id);
    const before = record.status;
    if (live && record.status !== "ACTIVE") {
      record = { ...record, status: "ACTIVE", rolledBackAt: null };
    } else if (
      !live &&
      record.status === "ACTIVE" &&
      batchHasRecords.has(item.id)
    ) {
      record = {
        ...record,
        status: "ROLLED_BACK",
        rolledBackAt: context.now,
      };
    }
    imports.set(item.id, record);

    if (resolved) log.add("imports", item.id, resolved);
    else if (isNew) {
      log.add(
        "imports",
        item.id,
        record.status === "ACTIVE" ? "ADDED" : "ADDED_HISTORY",
      );
    } else if (before !== record.status) {
      log.add(
        "imports",
        item.id,
        record.status === "ACTIVE" ? "RESTORED" : "DELETED",
      );
    } else {
      log.add("imports", item.id, "UNCHANGED");
    }
  }
  for (const id of localImportIds) log.add("imports", id, "RETAINED_LOCAL");

  // ── Month attendance confirmations (one live answer per month) ──────────
  const attendance = new Map(
    current.attendanceMonths.map((item) => [item.id, item]),
  );
  reconcile<AttendanceMonth>({
    collection: "attendanceMonths",
    records: attendance,
    incoming: [...incoming.attendanceMonths].sort(
      (a, b) => a.month.localeCompare(b.month) || byId(a, b),
    ),
    put: (item) => attendance.set(item.id, item),
    block(candidate) {
      const owner = [...attendance.values()].find(
        (item) =>
          isLive(item) &&
          item.month === candidate.month &&
          item.id !== candidate.id,
      );
      if (!owner) return null;
      messages.push(
        `${candidate.month} 근무일 확인: 이미 확인한 값이 있어 현재 값을 유지했어요.`,
      );
      return { outcome: "REJECTED", reason: "MONTH_ALREADY_CONFIRMED" };
    },
  });

  // ── Compensation snapshots (immutable history, revisioned tombstones) ───
  const compensationSnapshots = new Map(
    current.compensationSnapshots.map((item) => [item.id, item]),
  );
  reconcile<CompensationSnapshot>({
    collection: "compensationSnapshots",
    records: compensationSnapshots,
    incoming: [...incoming.compensationSnapshots].sort(byId),
    put: (item) => compensationSnapshots.set(item.id, item),
    block: () => null,
  });

  const count = (collection: SyncCollection, outcome: RecordOutcome) =>
    log.counts[collection][outcome] ?? 0;
  const stats: MergeStats = {
    addedEvents: count("events", "ADDED"),
    updatedEvents: count("events", "UPDATED"),
    restoredEvents: count("events", "RESTORED"),
    keptLiveOverBackupDeletion: count(
      "events",
      "INCOMING_DELETION_NOT_APPLIED",
    ),
    keptLocalDeletions: count("events", "LOCAL_DELETION_KEPT"),
    skippedDuplicateEvents: count("events", "DUPLICATE"),
    skippedConflictingEvents: count("events", "REJECTED"),
    addedAdjustments: count("leaveAdjustments", "ADDED"),
    restoredAdjustments: count("leaveAdjustments", "RESTORED"),
    skippedAdjustments:
      count("leaveAdjustments", "DUPLICATE") +
      count("leaveAdjustments", "REJECTED"),
    addedSnapshots: count("leaveSnapshots", "ADDED"),
    restoredSnapshots: count("leaveSnapshots", "RESTORED"),
    addedImports: count("imports", "ADDED") + count("imports", "ADDED_HISTORY"),
    reactivatedImports: count("imports", "RESTORED"),
    addedAttendanceMonths: count("attendanceMonths", "ADDED"),
    updatedAttendanceMonths:
      count("attendanceMonths", "UPDATED") +
      count("attendanceMonths", "RESTORED"),
    addedCompensationSnapshots: count("compensationSnapshots", "ADDED"),
    profileUpdated:
      count("profile", "UPDATED") + count("profile", "RESOLVED_INCOMING") > 0,
    conflicts: messages,
  };

  return {
    ok: true,
    analysis: {
      data: {
        ...current,
        profile,
        events: [...events.values()],
        leaveAdjustments: [...adjustments.values()],
        leaveSnapshots: finalSnapshots,
        imports: [...imports.values()].sort((a, b) =>
          b.createdAt.localeCompare(a.createdAt),
        ),
        attendanceMonths: [...attendance.values()],
        compensationSnapshots: [...compensationSnapshots.values()],
      },
      stats,
      counts: log.counts,
      changes: log.changes,
      conflicts,
    },
  };
}

/**
 * Merge — non-destructive recovery. Returns `ok: false` for a foreign
 * profile or while any conflict is unresolved; nothing is ever half-applied.
 * Use `replaceUserData` for an exact, destructive restoration.
 */
export function mergeUserData(
  current: UserData,
  incoming: UserData,
  context: MergeContext,
  options: MergeOptions = {},
): MergeResult {
  const result = analyzeMerge(current, incoming, context, options);
  if (!result.ok) return { ...result, conflicts: [] };
  const { analysis } = result;
  if (analysis.conflicts.length > 0) {
    return {
      ok: false,
      reason: "UNRESOLVED_CONFLICTS",
      error: `같은 버전인데 내용이 다른 기록이 ${analysis.conflicts.length}건 있어요. 어느 쪽을 남길지 직접 골라야 합칠 수 있어요.`,
      conflicts: analysis.conflicts,
    };
  }
  return { ok: true, ...analysis };
}

/**
 * Invariant every command and merge must keep: a rolled-back import batch
 * has no live events or snapshots. (An ACTIVE batch may legitimately end up
 * empty when the user deletes its records one by one.)
 */
export function importConsistencyIssues(data: UserData): string[] {
  const issues: string[] = [];
  for (const record of data.imports) {
    if (record.status !== "ROLLED_BACK") continue;
    const liveEvents = data.events.some(
      (event) =>
        isLive(event) &&
        event.source.kind === "IMPORT" &&
        event.source.batchId === record.id,
    );
    const liveSnapshots = data.leaveSnapshots.some(
      (item) => isLive(item) && item.importBatchId === record.id,
    );
    if (liveEvents || liveSnapshots) {
      issues.push(`${record.id}: rolled back but has live records`);
    }
  }
  return issues;
}

/** Replace everything with a backup, keeping this device's identity. */
export function replaceUserData(
  current: UserData,
  incoming: UserData,
): UserData {
  return {
    ...incoming,
    deviceId: current.deviceId,
    documentRevision: current.documentRevision,
    savedAt: current.savedAt,
  };
}
