import { canonicalJson } from "./integrity";

/**
 * Backend-agnostic record reconciliation contract.
 *
 * Every merge of two independently edited documents — a backup restore today,
 * a remote adapter later — resolves each record by `(collection, id)` using
 * only the data inside the records. Nothing here knows about HTTP, a database
 * or an account, and `documentRevision` is never consulted: it is a per-device
 * write counter, not a distributed clock.
 *
 * Record rules (see docs/BACKUP_AND_SYNC.md for the full table):
 * - higher `revision` wins;
 * - equal revision with identical payload is a no-op;
 * - equal revision with divergent payload is a CONFLICT the caller must
 *   resolve explicitly — never a silent winner;
 * - a tombstone (`deletedAt`) is just a revision, so a stale live copy can
 *   never resurrect a newer deletion.
 */

export const SYNC_COLLECTIONS = [
  "profile",
  "events",
  "leaveAdjustments",
  "leaveSnapshots",
  "imports",
  "attendanceMonths",
  "compensationSnapshots",
] as const;

export type SyncCollection = (typeof SYNC_COLLECTIONS)[number];

export type Revisioned = {
  id: string;
  revision: number;
  updatedAt: string;
  deletedAt: string | null;
  deviceId: string;
};

export type VersionVerdict =
  "IDENTICAL" | "LOCAL_NEWER" | "INCOMING_NEWER" | "DIVERGENT";

/**
 * Payload used for equality: everything except write metadata. `updatedAt`
 * and `deviceId` say who wrote a version, not what it says, and two
 * tombstones are equivalent whatever their deletion timestamps.
 */
export function payloadKey(
  record: object,
  ignored: readonly string[] = [],
): string {
  const copy: Record<string, unknown> = { ...record };
  delete copy.updatedAt;
  delete copy.deviceId;
  if ("deletedAt" in copy) copy.deletedAt = copy.deletedAt !== null;
  for (const key of ignored) delete copy[key];
  return canonicalJson(copy);
}

export function compareRevisioned(
  local: Revisioned,
  incoming: Revisioned,
): VersionVerdict {
  if (incoming.revision > local.revision) return "INCOMING_NEWER";
  if (incoming.revision < local.revision) return "LOCAL_NEWER";
  return payloadKey(local) === payloadKey(incoming) ? "IDENTICAL" : "DIVERGENT";
}

/** Records without a revision whose content must never change after creation. */
export function compareImmutable(
  local: object,
  incoming: object,
  mutableKeys: readonly string[],
): "IDENTICAL" | "DIVERGENT" {
  return payloadKey(local, mutableKeys) === payloadKey(incoming, mutableKeys)
    ? "IDENTICAL"
    : "DIVERGENT";
}

/** Version metadata only — never user content such as notes or reasons. */
export type RecordVersionInfo = {
  revision: number | null;
  updatedAt: string | null;
  deleted: boolean;
};

export function versionInfo(record: {
  revision?: number;
  updatedAt?: string;
  deletedAt?: string | null;
}): RecordVersionInfo {
  return {
    revision: record.revision ?? null,
    updatedAt: record.updatedAt ?? null,
    deleted: record.deletedAt != null,
  };
}

export type ConflictType =
  /** Same id and version, different content: edited independently. */
  | "EQUAL_VERSION_DIVERGENT"
  /** A record that is written once (import, snapshot) differs between sides. */
  | "IMMUTABLE_RECORD_DIVERGENT";

export type MergeConflict = {
  /** Stable key for `MergeOptions.resolutions`. */
  key: string;
  collection: SyncCollection;
  recordId: string;
  type: ConflictType;
  local: RecordVersionInfo;
  incoming: RecordVersionInfo;
};

export function conflictKey(collection: SyncCollection, recordId: string) {
  return `${collection}:${recordId}`;
}

export type ConflictResolution = "LOCAL" | "INCOMING";

export type RecordOutcome =
  /** Same on both sides (or only write metadata differs). */
  | "UNCHANGED"
  /** Only in the incoming document and live: added. */
  | "ADDED"
  /** Only in the incoming document and already deleted: kept as history. */
  | "ADDED_HISTORY"
  /** A newer incoming version replaced a live local record. */
  | "UPDATED"
  /** A deleted local record came back (newer incoming version or explicit choice). */
  | "RESTORED"
  /** A newer incoming tombstone was applied (sync policy or REPLACE). */
  | "DELETED"
  /** Local version is newer, or the record exists only locally. */
  | "RETAINED_LOCAL"
  /** Incoming tombstone is newer, but recovery merges never delete live records. */
  | "INCOMING_DELETION_NOT_APPLIED"
  /** Incoming live copy is older than the local deletion; deletion stays. */
  | "LOCAL_DELETION_KEPT"
  /** Same content already exists live under another id; not added twice. */
  | "DUPLICATE"
  /** Would break a domain invariant (double-charged leave, two confirmations…). */
  | "REJECTED"
  /** Unresolved conflict; the local version is untouched. */
  | "CONFLICT"
  | "RESOLVED_LOCAL"
  | "RESOLVED_INCOMING"
  /** A tombstone's metadata advanced; nothing live changed. */
  | "HISTORY_UPDATED"
  /** REPLACE: exists only locally and will be gone. */
  | "REMOVED"
  /** REPLACE: both sides have it with different content; backup wins. */
  | "REPLACED";

export type RejectReason =
  | "LEAVE_OVERLAP"
  | "CREDIT_ALREADY_CONFIRMED"
  | "MONTH_ALREADY_CONFIRMED"
  | "BATCH_RECORDS_UNAVAILABLE";

export type RecordChange = {
  collection: SyncCollection;
  recordId: string;
  outcome: RecordOutcome;
  reason?: RejectReason;
};

export type OutcomeCounts = Partial<Record<RecordOutcome, number>>;

export type CollectionCounts = Record<SyncCollection, OutcomeCounts>;

export function emptyCollectionCounts(): CollectionCounts {
  return Object.fromEntries(
    SYNC_COLLECTIONS.map((name) => [name, {}]),
  ) as CollectionCounts;
}

/** Outcomes too common to list one by one; they are only counted. */
export const COUNT_ONLY_OUTCOMES: ReadonlySet<RecordOutcome> = new Set([
  "UNCHANGED",
  "RETAINED_LOCAL",
]);

export class OutcomeLog {
  readonly counts = emptyCollectionCounts();
  readonly changes: RecordChange[] = [];

  add(
    collection: SyncCollection,
    recordId: string,
    outcome: RecordOutcome,
    reason?: RejectReason,
  ) {
    const bucket = this.counts[collection];
    bucket[outcome] = (bucket[outcome] ?? 0) + 1;
    if (!COUNT_ONLY_OUTCOMES.has(outcome)) {
      this.changes.push(
        reason
          ? { collection, recordId, outcome, reason }
          : { collection, recordId, outcome },
      );
    }
  }
}
