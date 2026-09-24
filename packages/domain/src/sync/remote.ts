import type { z } from "zod";

import { attendanceMonthSchema } from "../compensation/records";
import { compensationSnapshotSchema } from "../compensation/records";
import { serviceEventSchema } from "../events/model";
import {
  importRecordSchema,
  leaveAdjustmentSchema,
  leaveSnapshotSchema,
} from "../leave/records";
import { storedServiceProfileSchema } from "../service/profile";
import { canonicalJson, sha256Hex } from "../store/integrity";
import {
  CURRENT_SCHEMA_VERSION,
  createEmptyUserData,
  userDataSchema,
  type UserData,
} from "../store/schema";
import {
  SYNC_COLLECTIONS,
  conflictKey,
  payloadKey,
  profileDigest,
  type Ancestry,
  type SyncCollection,
} from "../store/sync-contract";

/**
 * Remote record model.
 *
 * The cloud stores one row per `(account, collection, record id)`. The row's
 * `payload` is exactly the local record (the same JSON a backup holds), so
 * every causal field the merge contract needs — `revision`, `deviceId`,
 * `supersedes`, `deletedAt` — travels inside it. The only other fields are
 * transport metadata:
 *
 * - `seq`: a per-account, commit-ordered sequence assigned by the server. It
 *   is a pull cursor and a compare-and-set token for pushes. It is never
 *   compared with a record's `revision` and never decides a conflict.
 * - `schemaVersion`: the document schema the payload was written under.
 *
 * Nothing here is trusted: every payload is validated with the same Zod
 * schemas as local storage before it can reach the merge engine.
 */

export type SyncRecordKey = string;

export const syncRecordKey = (collection: SyncCollection, id: string) =>
  conflictKey(collection, id);

/** A row as the transport returned it. `payload` is untrusted. */
export type RemoteRow = {
  collection: string;
  recordId: string;
  seq: number;
  schemaVersion: number;
  payload: unknown;
};

/** Any validated record of one collection. */
export type SyncRecord =
  | NonNullable<UserData["profile"]>
  | UserData["events"][number]
  | UserData["leaveAdjustments"][number]
  | UserData["leaveSnapshots"][number]
  | UserData["imports"][number]
  | UserData["attendanceMonths"][number]
  | UserData["compensationSnapshots"][number];

export type ValidRow = {
  collection: SyncCollection;
  recordId: string;
  key: SyncRecordKey;
  seq: number;
  schemaVersion: number;
  record: SyncRecord;
};

const RECORD_SCHEMAS: Record<SyncCollection, z.ZodType> = {
  profile: storedServiceProfileSchema,
  events: serviceEventSchema,
  leaveAdjustments: leaveAdjustmentSchema,
  leaveSnapshots: leaveSnapshotSchema,
  imports: importRecordSchema,
  attendanceMonths: attendanceMonthSchema,
  compensationSnapshots: compensationSnapshotSchema,
};

/** Mutable fields of records that have no revision (see merge.ts). */
export const DERIVED_FIELDS: Partial<Record<SyncCollection, string[]>> = {
  leaveSnapshots: ["deletedAt"],
  imports: ["status", "rolledBackAt"],
};

export const isSyncCollection = (value: string): value is SyncCollection =>
  (SYNC_COLLECTIONS as readonly string[]).includes(value);

/**
 * Diagnostic for a rejected remote row. Carries the row's address and the
 * failing field path only — never a value — so it can be shown or logged
 * without leaking record contents.
 */
export type RemoteIssue = {
  key: string;
  seq: number | null;
  code:
    | "UNKNOWN_COLLECTION"
    | "NEWER_SCHEMA"
    | "INVALID_SCHEMA_VERSION"
    | "INVALID_RECORD"
    | "ID_MISMATCH"
    | "INVALID_DOCUMENT";
  path: string | null;
};

export type RemoteValidation =
  | { ok: true; rows: ValidRow[] }
  | { ok: false; newerSchema: boolean; issues: RemoteIssue[] };

const MAX_ISSUES = 20;

/**
 * Validate rows before they can reach the merge engine. All or nothing: a
 * single bad row rejects the batch, so the local document is never merged
 * with a partial or corrupt remote view.
 */
export function validateRemoteRows(
  rows: readonly RemoteRow[],
): RemoteValidation {
  const issues: RemoteIssue[] = [];
  const valid: ValidRow[] = [];
  let newerSchema = false;
  for (const row of rows) {
    const key = `${String(row.collection)}:${String(row.recordId)}`;
    const seq = Number.isSafeInteger(row.seq) ? row.seq : null;
    const report = (code: RemoteIssue["code"], path: string | null = null) => {
      if (issues.length < MAX_ISSUES) issues.push({ key, seq, code, path });
    };
    if (!isSyncCollection(row.collection)) {
      report("UNKNOWN_COLLECTION");
      continue;
    }
    if (!Number.isSafeInteger(row.schemaVersion) || row.schemaVersion < 2) {
      report("INVALID_SCHEMA_VERSION");
      continue;
    }
    if (row.schemaVersion > CURRENT_SCHEMA_VERSION) {
      newerSchema = true;
      report("NEWER_SCHEMA");
      continue;
    }
    if (seq === null || seq < 1) {
      report("INVALID_RECORD", "seq");
      continue;
    }
    const parsed = RECORD_SCHEMAS[row.collection].safeParse(row.payload);
    if (!parsed.success) {
      report("INVALID_RECORD", parsed.error.issues[0]?.path.join(".") ?? null);
      continue;
    }
    const record = parsed.data as SyncRecord;
    if (record.id !== row.recordId) {
      report("ID_MISMATCH", "id");
      continue;
    }
    valid.push({
      collection: row.collection,
      recordId: row.recordId,
      key: syncRecordKey(row.collection, row.recordId),
      seq,
      schemaVersion: row.schemaVersion,
      record,
    });
  }
  if (issues.length > 0) return { ok: false, newerSchema, issues };
  return { ok: true, rows: valid };
}

/**
 * The remote side of a merge: the given rows as a (partial) user document.
 * Records the rows do not mention are simply absent, which the merge engine
 * treats as "retain local". Without a profile row the local profile stands
 * in, so a delta that changed only events still merges.
 */
export function incomingDocument(
  local: UserData,
  rows: readonly ValidRow[],
): { ok: true; data: UserData | null } | { ok: false; issues: RemoteIssue[] } {
  const data = createEmptyUserData("remote");
  let profile = local.profile;
  for (const row of rows) {
    if (row.collection === "profile") {
      profile = row.record as NonNullable<UserData["profile"]>;
    } else {
      (data[row.collection] as SyncRecord[]).push(row.record);
    }
  }
  const hasRecords = rows.some((row) => row.collection !== "profile");
  if (!profile) {
    if (!hasRecords) return { ok: true, data: null };
    return {
      ok: false,
      issues: [
        {
          key: "profile",
          seq: null,
          code: "INVALID_DOCUMENT",
          path: "profile",
        },
      ],
    };
  }
  const candidate: UserData = { ...data, profile };
  const parsed = userDataSchema.safeParse(candidate);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.slice(0, MAX_ISSUES).map((issue) => ({
        key: String(issue.path[0] ?? "document"),
        seq: null,
        code: "INVALID_DOCUMENT" as const,
        path: issue.path.join("."),
      })),
    };
  }
  return { ok: true, data: parsed.data };
}

/** Every record of a document with its sync key, profile first. */
export function localRecords(data: UserData): Array<{
  collection: SyncCollection;
  key: SyncRecordKey;
  record: SyncRecord;
}> {
  const out: Array<{
    collection: SyncCollection;
    key: SyncRecordKey;
    record: SyncRecord;
  }> = [];
  for (const collection of SYNC_COLLECTIONS) {
    const records: SyncRecord[] =
      collection === "profile"
        ? data.profile
          ? [data.profile]
          : []
        : (data[collection] as SyncRecord[]);
    for (const record of records) {
      out.push({
        collection,
        key: syncRecordKey(collection, record.id),
        record,
      });
    }
  }
  return out;
}

/** Short digest of a record exactly as stored (all fields). */
export function recordDigest(record: object): string {
  return sha256Hex(canonicalJson(record)).slice(0, 16);
}

/**
 * What this device last knew about a remote row: its sequence and enough of
 * the version to decide whether a local record provably descends from it.
 * Holds no user content — ids, counters, device ids and digests only.
 */
export type ShadowEntry = {
  /** Remote sequence of the row. */
  s: number;
  /** Digest of the full remote record. */
  d: string;
  /** Digest of the immutable content (records without a revision). */
  c?: string;
  /** Remote record is live. */
  l: boolean;
  /** Revisioned records: revision, writer device, ancestry. */
  r?: number;
  v?: string;
  a?: Ancestry;
  /** Profile: digest of the remote profile content (`profileDigest`). */
  p?: string;
};

export function shadowEntryFor(
  collection: SyncCollection,
  record: SyncRecord,
  seq: number,
): ShadowEntry {
  const entry: ShadowEntry = { s: seq, d: recordDigest(record), l: true };
  if (collection === "profile") {
    entry.p = profileDigest(record as NonNullable<UserData["profile"]>);
    return entry;
  }
  if (collection === "imports") {
    const item = record as UserData["imports"][number];
    entry.l = item.status === "ACTIVE";
    entry.c = contentDigest(collection, record);
    return entry;
  }
  const withDeletion = record as { deletedAt: string | null };
  entry.l = withDeletion.deletedAt === null;
  if (collection === "leaveSnapshots") {
    entry.c = contentDigest(collection, record);
    return entry;
  }
  const versioned = record as {
    revision: number;
    deviceId: string;
    supersedes?: Ancestry;
  };
  entry.r = versioned.revision;
  entry.v = versioned.deviceId;
  if (versioned.supersedes && Object.keys(versioned.supersedes).length > 0) {
    entry.a = versioned.supersedes;
  }
  return entry;
}

/** Digest of the fields of a revision-less record that never change. */
export function contentDigest(
  collection: SyncCollection,
  record: SyncRecord,
): string {
  return sha256Hex(payloadKey(record, DERIVED_FIELDS[collection] ?? [])).slice(
    0,
    16,
  );
}

/** Plain JSON copy (drops `undefined` members) for the wire. */
export function toWirePayload(record: SyncRecord): Record<string, unknown> {
  return JSON.parse(JSON.stringify(record)) as Record<string, unknown>;
}
