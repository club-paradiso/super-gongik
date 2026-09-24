import type { ServiceProfile } from "../service/profile";
import { canonicalJson, sha256Hex } from "./integrity";

/**
 * Backend-agnostic record reconciliation contract.
 *
 * Every merge of two independently edited documents — a backup restore today,
 * a remote adapter later — resolves each record by `(collection, id)` using
 * only the data inside the records. Nothing here knows about HTTP, a database
 * or an account, and `documentRevision` is never consulted: it is a per-device
 * write counter, not a distributed clock.
 *
 * Version identity: a record version is written by one device (`deviceId`)
 * at one per-record `revision`. `revision` counts edits along a lineage; two
 * devices editing from the same base count up independently, so a bigger
 * number alone proves nothing across devices.
 *
 * Causal ancestry: `supersedes[device] = r` says this version descends from
 * that device's version `r` of the record (and therefore from everything
 * before it on that device). Commands add the previous writer when a record
 * changes hands, and a merge resolution adds both sides.
 *
 * Version V descends from W when
 *   - same device and V.revision > W.revision (one device's history is
 *     linear: tabs are serialized by the write lock), or
 *   - V.supersedes[W.deviceId] >= W.revision.
 *
 * Record rules (see docs/BACKUP_AND_SYNC.md for the full table):
 * - same payload (ignoring write metadata) is a no-op, whatever the versions;
 * - if exactly one side descends from the other, that side wins;
 * - otherwise the versions are concurrent: a structured CONFLICT
 *   (`EQUAL_VERSION_DIVERGENT` for equal revisions, else
 *   `CROSS_DEVICE_DIVERGENT`), never a winner picked by revision size;
 * - a tombstone (`deletedAt`) is part of the payload, so neither a stale live
 *   copy nor an independent edit silently resurrects a deletion.
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

export type Ancestry = Record<string, number>;

export type Revisioned = {
  id: string;
  revision: number;
  updatedAt: string;
  deletedAt: string | null;
  deviceId: string;
  supersedes?: Ancestry;
};

type Stamp = Pick<Revisioned, "revision" | "deviceId" | "supersedes">;

/** True when version `v` provably descends from version `w` (strictly). */
export function descendsFrom(v: Stamp, w: Stamp): boolean {
  if (v.deviceId === w.deviceId && v.revision > w.revision) return true;
  return (v.supersedes?.[w.deviceId] ?? 0) >= w.revision;
}

/**
 * Ancestry of a new version written by `writer` on top of `parents`: every
 * parent's own ancestry plus the parent itself, keeping the highest revision
 * per device. The writer's own entry is implied by the new revision (which is
 * above every ancestor) and is left out. Undefined when empty, so records
 * that never left one device stay byte-identical to before.
 */
export function ancestryAfter(
  parents: readonly Stamp[],
  writer: string,
): Ancestry | undefined {
  const merged: Ancestry = {};
  const add = (device: string, revision: number) => {
    if (device !== writer && revision > (merged[device] ?? 0)) {
      merged[device] = revision;
    }
  };
  for (const parent of parents) {
    for (const [device, revision] of Object.entries(parent.supersedes ?? {})) {
      add(device, revision);
    }
    add(parent.deviceId, parent.revision);
  }
  const keys = Object.keys(merged).sort();
  return keys.length
    ? Object.fromEntries(keys.map((key) => [key, merged[key]!]))
    : undefined;
}

/**
 * Write metadata for the next version of `existing`, written now by
 * `context.deviceId`. Every command that changes a record uses this.
 */
export function nextVersion(
  existing: Stamp,
  context: { now: string; deviceId: string },
): Pick<Revisioned, "revision" | "updatedAt" | "deviceId" | "supersedes"> {
  return withAncestry(
    {
      revision: existing.revision + 1,
      updatedAt: context.now,
      deviceId: context.deviceId,
    },
    ancestryAfter([existing], context.deviceId),
  );
}

/**
 * Metadata for a version that settles two concurrent versions (a merge
 * resolution or an explicit restore): above both revisions, written by this
 * device, descending from both — so merging either old branch again is
 * recognised as an ancestor instead of reopening the conflict.
 */
export function settledVersion(
  a: Stamp,
  b: Stamp,
  context: { now: string; deviceId: string },
): Pick<Revisioned, "revision" | "updatedAt" | "deviceId" | "supersedes"> {
  return withAncestry(
    {
      revision: Math.max(a.revision, b.revision) + 1,
      updatedAt: context.now,
      deviceId: context.deviceId,
    },
    ancestryAfter([a, b], context.deviceId),
  );
}

/** How many replaced profile versions a profile remembers. */
export const PROFILE_ANCESTRY_LIMIT = 32;

/** Short content digest of a profile version (write metadata excluded). */
export function profileDigest(profile: ServiceProfile): string {
  return sha256Hex(payloadKey(profile)).slice(0, 16);
}

/** True when `v` records that it replaced `w`'s exact content. */
export function profileSupersedes(v: ServiceProfile, w: ServiceProfile) {
  return (v.supersedes ?? []).includes(profileDigest(w));
}

function profileAncestry(
  digests: readonly string[],
  own: ServiceProfile,
): string[] | undefined {
  const self = profileDigest(own);
  const unique = [...new Set(digests)].filter((digest) => digest !== self);
  const kept = unique.slice(-PROFILE_ANCESTRY_LIMIT);
  return kept.length ? kept : undefined;
}

/** The profile after an edit: it remembers the content it replaced. */
export function profileAfterEdit(
  previous: ServiceProfile,
  next: ServiceProfile,
): ServiceProfile {
  return {
    ...next,
    supersedes: profileAncestry(
      [...(previous.supersedes ?? []), profileDigest(previous)],
      next,
    ),
  };
}

/** `chosen`'s content, recorded as replacing both sides. */
export function settleProfile(
  chosen: ServiceProfile,
  other: ServiceProfile,
  now: string,
): ServiceProfile {
  return {
    ...chosen,
    updatedAt: now,
    supersedes: profileAncestry(
      [
        ...(chosen.supersedes ?? []),
        ...(other.supersedes ?? []),
        profileDigest(other),
      ],
      chosen,
    ),
  };
}

function withAncestry<T extends object>(
  base: T,
  supersedes: Ancestry | undefined,
): T & { supersedes?: Ancestry } {
  // Spread over an existing record: an explicit undefined removes a stale
  // ancestry; JSON and the canonical form both drop undefined members.
  return { ...base, supersedes };
}

export type VersionVerdict =
  | "IDENTICAL"
  | "LOCAL_NEWER"
  | "INCOMING_NEWER"
  /** Equal revision, different payload. */
  | "DIVERGENT"
  /** Different payload, unequal revisions, neither descends from the other. */
  | "UNORDERED";

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
  delete copy.supersedes;
  if ("deletedAt" in copy) copy.deletedAt = copy.deletedAt !== null;
  for (const key of ignored) delete copy[key];
  return canonicalJson(copy);
}

export function compareRevisioned(
  local: Revisioned,
  incoming: Revisioned,
): VersionVerdict {
  if (payloadKey(local, ["revision"]) === payloadKey(incoming, ["revision"])) {
    return "IDENTICAL";
  }
  const incomingAfter = descendsFrom(incoming, local);
  const localAfter = descendsFrom(local, incoming);
  if (incomingAfter && !localAfter) return "INCOMING_NEWER";
  if (localAfter && !incomingAfter) return "LOCAL_NEWER";
  // Concurrent: revision size is not a clock across devices.
  return incoming.revision === local.revision ? "DIVERGENT" : "UNORDERED";
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
  /** Different content, neither version descends from the other. */
  | "CROSS_DEVICE_DIVERGENT"
  /** The profile (no revision, no device id) differs between sides. */
  | "UNVERSIONED_DIVERGENT"
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
