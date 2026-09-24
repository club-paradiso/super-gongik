import { createBackup, serializeBackup } from "../store/backup";
import type { UserDataStore, WriteLock } from "../store/controller";
import { analyzeMerge, type MergeAnalysis } from "../store/merge";
import type { UserData } from "../store/schema";
import type {
  ConflictResolution,
  MergeConflict,
  OutcomeCounts,
  RecordChange,
  RejectReason,
  SyncCollection,
} from "../store/sync-contract";
import { planPush } from "./push-plan";
import {
  incomingDocument,
  localRecords,
  shadowEntryFor,
  syncRecordKey,
  validateRemoteRows,
  type RemoteIssue,
  type RemoteRow,
  type ShadowEntry,
  type SyncRecord,
  type ValidRow,
} from "./remote";
import { newSyncState, type SyncStateStore } from "./state";
import {
  SyncTransportError,
  type CloudBackupInfo,
  type RemoteAccount,
  type SyncTransport,
  type TransportErrorCategory,
  type UploadBackupResponse,
} from "./transport";

/**
 * Backend-independent sync engine.
 *
 * One sync run:
 *   pull rows after the checkpoint cursor (all pages)
 *   → validate every row with the domain schemas (all or nothing)
 *   → merge into the local document as one store command (inside the store's
 *     cross-tab write lock, rebased on the newest local document), using the
 *     existing causal merge contract with the sync policy
 *     (`incomingDeletions: "APPLY_NEWER"`); concurrent versions stay local
 *     and become structured conflicts
 *   → save the checkpoint (shadow of remote versions, cursor, open conflicts)
 *   → push local records that provably descend from what the server has,
 *     each conditioned on the remote `seq` it replaces
 *   → if the server refused a stale base, pull again (bounded rounds).
 *
 * Every step is idempotent, so a retry after any failure — including a push
 * the server applied whose response was lost — converges instead of
 * duplicating or oscillating.
 *
 * `documentRevision` is not used for any of this. Remote order comes from
 * the server's per-account `seq`; conflict decisions come only from the
 * records' own `revision`/`deviceId`/`supersedes`/`deletedAt`.
 */

export type SyncConflict = MergeConflict & {
  /** This device's record, for display. Never logged. */
  localRecord: SyncRecord | null;
  /** The cloud's record, for display. Never logged. */
  cloudRecord: SyncRecord | null;
};

/**
 * A cloud record this device could not apply because it would break a
 * domain invariant here (overlapping leave, a second confirmation of one
 * credit, a second answer for one month). Kept and retried every run, so it
 * applies as soon as the user fixes the local record it collides with.
 */
export type SyncHeld = {
  key: string;
  collection: SyncCollection;
  recordId: string;
  reason: RejectReason | null;
  cloudRecord: SyncRecord | null;
};

export type SyncBlock =
  /** Cloud data was deleted (generation moved on). Needs a user decision. */
  | { reason: "GENERATION_MISMATCH"; account: RemoteAccount }
  /** The account holds a different service profile. */
  | { reason: "PROFILE_MISMATCH"; account: RemoteAccount | null }
  /** A remote row failed validation. Nothing was merged. */
  | { reason: "REMOTE_INVALID"; issues: RemoteIssue[] }
  /** The cloud holds data from a newer app version. */
  | { reason: "REMOTE_NEWER_SCHEMA" }
  /** Local storage refuses writes (newer app version, unreadable data). */
  | { reason: "LOCAL_READ_ONLY"; message: string }
  /** Session expired or missing. */
  | { reason: "AUTH" };

export type SyncErrorCategory =
  TransportErrorCategory | "LOCAL_WRITE" | "UNKNOWN";

export type SyncPhase =
  "DISABLED" | "IDLE" | "SYNCING" | "OFFLINE" | "ERROR" | "BLOCKED";

export type SyncSummary = {
  pulled: number;
  pushed: number;
  /** Per-collection merge outcomes of the last run. */
  counts: Partial<Record<SyncCollection, OutcomeCounts>>;
  rounds: number;
};

export type SyncStatus = {
  phase: SyncPhase;
  block: SyncBlock | null;
  error: SyncErrorCategory | null;
  conflicts: SyncConflict[];
  /** Cloud records held back by a local invariant (see `SyncHeld`). */
  held: SyncHeld[];
  lastSyncedAt: string | null;
  /** A local change happened after the last completed sync. */
  dirty: boolean;
  generation: number | null;
  lastSummary: SyncSummary | null;
  /**
   * `documentRevision` of the local document the last completed run ended
   * on. Local bookkeeping only (was there a local write after this run?);
   * it never leaves the device and never orders remote versions.
   */
  localRevision: number | null;
};

/** Privacy-safe diagnostics: counts, phases and categories only. */
export type SyncDiagnostic = {
  kind: "sync" | "enable-preview" | "reset" | "backup";
  reason: string;
  outcome: "OK" | "CONFLICT" | "BLOCKED" | "OFFLINE" | "ERROR";
  pulled: number;
  pushed: number;
  conflicts: number;
  rounds: number;
  durationMs: number;
  errorCategory: SyncErrorCategory | null;
  block: SyncBlock["reason"] | null;
};

/**
 * What a preview was computed against. Enabling re-checks every field
 * immediately before it acts: a preview approved for one account, one local
 * document and one remote state never authorizes a different plan.
 * Version counters only — no record content.
 */
export type PreviewEvidence = {
  userId: string;
  /** Local write counter at preview time (same-device bookkeeping only). */
  localRevision: number;
  generation: number;
  lastSeq: number;
  profileId: string | null;
};

export type EnableResult =
  | { kind: "ENABLED"; status: SyncStatus }
  /** The preview no longer describes what enabling would do. Nothing changed. */
  | { kind: "STALE_PREVIEW"; reason: "ACCOUNT" | "LOCAL" | "REMOTE" }
  | { kind: "NOT_READY" };

/** Returned when a destructive request was confirmed for another account. */
export type AccountMismatch = { ok: false; reason: "ACCOUNT_MISMATCH" };

export type EnablePreview =
  | {
      kind: "READY";
      evidence: PreviewEvidence;
      account: RemoteAccount;
      /** What enabling will do. */
      case: "NOTHING" | "UPLOAD" | "DOWNLOAD" | "MERGE";
      localRecords: number;
      remoteRecords: number;
      /** Records the merge would add or change on this device. */
      downloads: number;
      /** Records that would be uploaded. */
      uploads: number;
      conflicts: number;
      counts: Partial<Record<SyncCollection, OutcomeCounts>>;
    }
  | { kind: "PROFILE_MISMATCH"; account: RemoteAccount; remoteRecords: number }
  | { kind: "REMOTE_INVALID"; issues: RemoteIssue[]; newerSchema: boolean };

export type SyncEngineOptions = {
  userId: string;
  store: Pick<UserDataStore, "getSnapshot" | "run">;
  transport: SyncTransport;
  state: SyncStateStore;
  now?: () => Date;
  /** Cross-tab lock for sync runs (separate from the data write lock). */
  lock?: WriteLock;
  diagnostics?: (event: SyncDiagnostic) => void;
  pageSize?: number;
  pushBatchSize?: number;
  maxRounds?: number;
};

type MergeValue =
  | {
      kind: "MERGED";
      conflicts: MergeConflict[];
      /** Cloud records not applied because of a local invariant. */
      rejected: RecordChange[];
      /** Keys of conflicts settled by an explicit resolution in this merge. */
      resolved: string[];
      counts: MergeAnalysis["counts"] | null;
    }
  | { kind: "PROFILE_MISMATCH" }
  | { kind: "INVALID"; issues: RemoteIssue[] };

/** True when a merge changed no record (reference equality per record). */
function sameRecords(base: UserData, next: UserData): boolean {
  if (base.profile !== next.profile) return false;
  const collections = [
    "events",
    "leaveAdjustments",
    "leaveSnapshots",
    "imports",
    "attendanceMonths",
    "compensationSnapshots",
  ] as const;
  return collections.every((name) => {
    const before = base[name] as readonly object[];
    const after = next[name] as readonly object[];
    if (before.length !== after.length) return false;
    const known = new Set<object>(before);
    return after.every((record) => known.has(record));
  });
}

function mergeCommand(
  rows: readonly ValidRow[],
  resolutions: Readonly<Record<string, ConflictResolution>> | undefined,
) {
  return (base: UserData, context: { now: string }) => {
    const unchanged = (value: MergeValue) => ({
      ok: true as const,
      data: base,
      value,
    });
    const incoming = incomingDocument(base, rows);
    if (!incoming.ok)
      return unchanged({ kind: "INVALID", issues: incoming.issues });
    if (!incoming.data) {
      return unchanged({
        kind: "MERGED",
        conflicts: [],
        rejected: [],
        resolved: [],
        counts: null,
      });
    }
    const result = analyzeMerge(
      base,
      incoming.data,
      { now: context.now, deviceId: base.deviceId },
      SYNC_MERGE_OPTIONS(resolutions),
    );
    if (!result.ok) return unchanged({ kind: "PROFILE_MISMATCH" });
    const { analysis } = result;
    const value: MergeValue = {
      kind: "MERGED",
      conflicts: analysis.conflicts,
      // A rejected snapshot is still stored (as history); only records that
      // were not stored at all are held for a retry.
      rejected: analysis.changes.filter(
        (change) =>
          change.outcome === "REJECTED" &&
          change.collection !== "leaveSnapshots",
      ),
      resolved: analysis.changes
        .filter(
          (change) =>
            change.outcome === "RESOLVED_LOCAL" ||
            change.outcome === "RESOLVED_INCOMING",
        )
        .map((change) => syncRecordKey(change.collection, change.recordId)),
      counts: analysis.counts,
    };
    return sameRecords(base, analysis.data)
      ? unchanged(value)
      : { ok: true as const, data: analysis.data, value };
  };
}

/** Merge policy for sync: deletions travel, ids are never collapsed. */
const SYNC_MERGE_OPTIONS = (
  resolutions?: Readonly<Record<string, ConflictResolution>>,
) => ({
  incomingDeletions: "APPLY_NEWER" as const,
  duplicateContent: "KEEP_BOTH" as const,
  resolutions,
});

function hasUserData(data: UserData) {
  return data.profile !== null;
}

class Stop extends Error {
  constructor(readonly block: SyncBlock) {
    super(block.reason);
  }
}

export function createSyncEngine(options: SyncEngineOptions) {
  const now = options.now ?? (() => new Date());
  const pageSize = options.pageSize ?? 500;
  const pushBatchSize = options.pushBatchSize ?? 200;
  const maxRounds = options.maxRounds ?? 3;
  const listeners = new Set<() => void>();
  let status: SyncStatus = {
    phase: "DISABLED",
    block: null,
    error: null,
    conflicts: [],
    held: [],
    lastSyncedAt: null,
    dirty: false,
    generation: null,
    lastSummary: null,
    localRevision: null,
  };
  let queue: Promise<unknown> = Promise.resolve();
  let changeCounter = 0;

  function setStatus(patch: Partial<SyncStatus>) {
    status = { ...status, ...patch };
    for (const listener of listeners) listener();
  }

  function exclusive<T>(task: () => Promise<T>): Promise<T> {
    const lock = options.lock;
    const run = queue.then(
      () => (lock ? lock(task) : task()),
      () => (lock ? lock(task) : task()),
    );
    queue = run.catch(() => undefined);
    return run;
  }

  function emit(event: SyncDiagnostic) {
    try {
      options.diagnostics?.(event);
    } catch {
      // Diagnostics must never break sync.
    }
  }

  /** The newest stored document, read inside the store's write lock. */
  async function latestData(): Promise<UserData> {
    const result = await options.store.run((base) => ({
      ok: true,
      data: base,
      value: undefined,
    }));
    if (!result.ok) throw localFailure(result.errors[0]?.message);
    return result.data;
  }

  function localFailure(message: string | undefined) {
    const snapshot = options.store.getSnapshot();
    if (snapshot.phase === "READY" && snapshot.readOnly) {
      return new Stop({
        reason: "LOCAL_READ_ONLY",
        message: message ?? "이 기기의 데이터는 지금 수정할 수 없어요.",
      });
    }
    return new SyncTransportErrorLike("LOCAL_WRITE");
  }

  async function pullAll(generation: number, afterSeq: number) {
    const rows: RemoteRow[] = [];
    let cursor = afterSeq;
    let account: RemoteAccount;
    for (;;) {
      const page = await options.transport.pull({
        generation,
        afterSeq: cursor,
        limit: pageSize,
      });
      if (page.kind === "GENERATION_MISMATCH") {
        throw new Stop({
          reason: "GENERATION_MISMATCH",
          account: page.account,
        });
      }
      account = page.account;
      for (const row of page.rows) {
        rows.push(row);
        if (Number.isSafeInteger(row.seq) && row.seq > cursor) cursor = row.seq;
      }
      if (!page.hasMore || page.rows.length === 0) break;
    }
    return { rows, cursor, account };
  }

  function conflictViews(
    conflicts: readonly MergeConflict[],
    data: UserData,
    remote: ReadonlyMap<string, ValidRow>,
  ): SyncConflict[] {
    const local = new Map(localRecords(data).map((item) => [item.key, item]));
    return conflicts.map((conflict) => ({
      ...conflict,
      localRecord: local.get(conflict.key)?.record ?? null,
      cloudRecord: remote.get(conflict.key)?.record ?? null,
    }));
  }

  async function runSync(
    reason: string,
    resolutions?: Readonly<Record<string, ConflictResolution>>,
  ): Promise<SyncStatus> {
    const started = Date.now();
    const state = await options.state.load();
    if (!state) {
      setStatus({
        phase: "DISABLED",
        block: null,
        error: null,
        conflicts: [],
        held: [],
      });
      return status;
    }
    const changesAtStart = changeCounter;
    setStatus({ phase: "SYNCING", generation: state.generation });
    let pulledTotal = 0;
    let pushedTotal = 0;
    let rounds = 0;
    let counts: SyncSummary["counts"] = {};
    let conflicts: SyncConflict[];
    let held: SyncHeld[];
    let localRevision: number | null;
    try {
      // A resolution only counts for a conflict this account actually has
      // open (its cloud version is stashed). Anything else — a stale choice
      // made while another account was signed in — is ignored, never
      // force-pushed.
      const openKeys = new Set(Object.keys(state.stash));
      let pendingResolutions = resolutions
        ? Object.fromEntries(
            Object.entries(resolutions).filter(([key]) => openKeys.has(key)),
          )
        : undefined;
      if (pendingResolutions && Object.keys(pendingResolutions).length === 0) {
        pendingResolutions = undefined;
      }
      // Filled from the merge: only conflicts it actually settled with a
      // resolution may overwrite the cloud copy they were compared with.
      let forced = new Set<string>();
      for (;;) {
        rounds += 1;
        // ── Pull ──────────────────────────────────────────────────────
        const pulled = await pullAll(state.generation, state.cursor);
        const fresh = pulled.rows.filter(
          (row) =>
            state.shadow[`${String(row.collection)}:${String(row.recordId)}`]
              ?.s !== row.seq,
        );
        pulledTotal += fresh.length;
        const freshKeys = new Set(
          fresh.map(
            (row) => `${String(row.collection)}:${String(row.recordId)}`,
          ),
        );
        const stashed = Object.entries(state.stash)
          .filter(([key]) => !freshKeys.has(key))
          .map(([, row]) => row as RemoteRow);
        const validation = validateRemoteRows([...stashed, ...fresh]);
        if (!validation.ok) {
          throw new Stop(
            validation.newerSchema
              ? { reason: "REMOTE_NEWER_SCHEMA" }
              : { reason: "REMOTE_INVALID", issues: validation.issues },
          );
        }
        const remoteByKey = new Map(
          validation.rows.map((row) => [row.key, row]),
        );

        // ── Merge and commit locally ──────────────────────────────────
        let data: UserData;
        let mergeConflicts: MergeConflict[] = [];
        let rejected: RecordChange[] = [];
        if (validation.rows.length > 0 || pendingResolutions) {
          const result = await options.store.run(
            mergeCommand(validation.rows, pendingResolutions),
          );
          if (!result.ok) throw localFailure(result.errors[0]?.message);
          const value = result.value;
          if (value.kind === "PROFILE_MISMATCH") {
            throw new Stop({
              reason: "PROFILE_MISMATCH",
              account: pulled.account,
            });
          }
          if (value.kind === "INVALID") {
            throw new Stop({ reason: "REMOTE_INVALID", issues: value.issues });
          }
          data = result.data;
          mergeConflicts = value.conflicts;
          rejected = value.rejected;
          if (pendingResolutions) forced = new Set(value.resolved);
          if (value.counts) counts = value.counts;
        } else {
          data = await latestData();
        }
        pendingResolutions = undefined;
        localRevision = data.documentRevision;

        // ── Checkpoint ───────────────────────────────────────────────
        for (const row of validation.rows) {
          if (freshKeys.has(row.key)) {
            state.shadow[row.key] = shadowEntryFor(
              row.collection,
              row.record,
              row.seq,
            );
          }
        }
        state.cursor = Math.max(state.cursor, pulled.cursor);
        const conflictKeys = new Set(mergeConflicts.map((item) => item.key));
        const heldKeys = new Set(
          rejected.map((change) =>
            syncRecordKey(change.collection, change.recordId),
          ),
        );
        const rawByKey = new Map<string, RemoteRow>();
        for (const row of [...stashed, ...fresh]) {
          rawByKey.set(
            `${String(row.collection)}:${String(row.recordId)}`,
            row,
          );
        }
        state.stash = Object.fromEntries(
          [...conflictKeys, ...heldKeys]
            .filter((key) => rawByKey.has(key))
            .map((key) => {
              const row = rawByKey.get(key)!;
              return [
                key,
                {
                  collection: row.collection,
                  recordId: row.recordId,
                  seq: row.seq,
                  schemaVersion: row.schemaVersion,
                  payload: row.payload,
                },
              ];
            }),
        );
        await options.state.save(state);
        conflicts = conflictViews(mergeConflicts, data, remoteByKey);
        held = rejected.map((change) => {
          const key = syncRecordKey(change.collection, change.recordId);
          return {
            key,
            collection: change.collection,
            recordId: change.recordId,
            reason: change.reason ?? null,
            cloudRecord: remoteByKey.get(key)?.record ?? null,
          };
        });

        // ── Push ─────────────────────────────────────────────────────
        const items = planPush({
          data,
          shadow: state.shadow,
          conflicted: conflictKeys,
          forced,
        });
        forced = new Set();
        let stale = false;
        const recordByKey = new Map(
          localRecords(data).map((item) => [item.key, item]),
        );
        for (let index = 0; index < items.length; index += pushBatchSize) {
          const batch = items.slice(index, index + pushBatchSize);
          const response = await options.transport.push({
            generation: state.generation,
            deviceId: data.deviceId,
            items: batch,
          });
          if (response.kind === "GENERATION_MISMATCH") {
            throw new Stop({
              reason: "GENERATION_MISMATCH",
              account: response.account,
            });
          }
          if (response.kind === "PROFILE_MISMATCH") {
            throw new Stop({
              reason: "PROFILE_MISMATCH",
              account: response.account,
            });
          }
          for (const result of response.results) {
            const key = `${result.collection}:${result.recordId}`;
            const local = recordByKey.get(key);
            if (result.status === "STALE" || result.seq === null || !local) {
              stale = true;
              continue;
            }
            if (result.status === "APPLIED") pushedTotal += 1;
            state.shadow[key] = shadowEntryFor(
              local.collection,
              local.record,
              result.seq,
            );
          }
          await options.state.save(state);
        }
        if (!stale) break;
        if (rounds >= maxRounds) {
          // Another device keeps writing the same records; try again later.
          throw new SyncTransportError("SERVER", "too many concurrent writes");
        }
      }

      state.lastSyncedAt = now().toISOString();
      await options.state.save(state);
      setStatus({
        phase: "IDLE",
        block: null,
        error: null,
        conflicts,
        held,
        lastSyncedAt: state.lastSyncedAt,
        dirty: changeCounter !== changesAtStart,
        lastSummary: {
          pulled: pulledTotal,
          pushed: pushedTotal,
          counts,
          rounds,
        },
        localRevision,
      });
      emit({
        kind: "sync",
        reason,
        outcome: conflicts.length || held.length ? "CONFLICT" : "OK",
        pulled: pulledTotal,
        pushed: pushedTotal,
        conflicts: conflicts.length,
        rounds,
        durationMs: Date.now() - started,
        errorCategory: null,
        block: null,
      });
    } catch (error) {
      fail(error, {
        kind: "sync",
        reason,
        pulled: pulledTotal,
        pushed: pushedTotal,
        rounds,
        started,
        lastSyncedAt: state.lastSyncedAt,
      });
    }
    return status;
  }

  function fail(
    error: unknown,
    context: {
      kind: SyncDiagnostic["kind"];
      reason: string;
      pulled: number;
      pushed: number;
      rounds: number;
      started: number;
      lastSyncedAt?: string | null;
    },
  ) {
    let outcome: SyncDiagnostic["outcome"];
    let block: SyncBlock | null = null;
    let category: SyncErrorCategory | null = null;
    if (error instanceof Stop) {
      block = error.block;
      outcome = "BLOCKED";
    } else if (
      error instanceof SyncTransportError &&
      error.category === "AUTH"
    ) {
      block = { reason: "AUTH" };
      outcome = "BLOCKED";
    } else {
      category =
        error instanceof SyncTransportError ||
        error instanceof SyncTransportErrorLike
          ? error.category
          : "UNKNOWN";
      outcome = category === "NETWORK" ? "OFFLINE" : "ERROR";
    }
    setStatus({
      phase: block ? "BLOCKED" : outcome === "OFFLINE" ? "OFFLINE" : "ERROR",
      block,
      error: category,
      ...(context.lastSyncedAt !== undefined
        ? { lastSyncedAt: context.lastSyncedAt }
        : {}),
    });
    emit({
      kind: context.kind,
      reason: context.reason,
      outcome,
      pulled: context.pulled,
      pushed: context.pushed,
      conflicts: status.conflicts.length,
      rounds: context.rounds,
      durationMs: Date.now() - context.started,
      errorCategory: category,
      block: block?.reason ?? null,
    });
  }

  /** What turning sync on would do. Reads only; changes nothing. */
  async function previewEnable(): Promise<EnablePreview> {
    const started = Date.now();
    const account = await options.transport.ensureAccount();
    const pulled = await pullAll(account.generation, 0).catch((error) => {
      if (error instanceof Stop) {
        // The generation moved between two requests: ask again.
        throw new SyncTransportError("SERVER", "account changed");
      }
      throw error;
    });
    const validation = validateRemoteRows(pulled.rows);
    if (!validation.ok) {
      return {
        kind: "REMOTE_INVALID",
        issues: validation.issues,
        newerSchema: validation.newerSchema,
      };
    }
    // The newest stored document (another tab may have written), read
    // without writing; its revision goes into the preview's evidence.
    const local = await latestData();
    const remoteRecords = validation.rows.length;
    const localCount = localRecords(local).length;
    const remoteProfile = validation.rows.find(
      (row) => row.collection === "profile",
    );
    const remoteProfileId = remoteProfile?.recordId ?? pulled.account.profileId;
    if (
      local.profile &&
      remoteProfileId !== null &&
      remoteProfileId !== local.profile.id
    ) {
      return {
        kind: "PROFILE_MISMATCH",
        account: pulled.account,
        remoteRecords,
      };
    }

    let merged = local;
    let conflicts = 0;
    let counts: Partial<Record<SyncCollection, OutcomeCounts>> = {};
    let downloads = 0;
    const conflictKeys = new Set<string>();
    const incoming = incomingDocument(local, validation.rows);
    if (!incoming.ok) {
      return {
        kind: "REMOTE_INVALID",
        issues: incoming.issues,
        newerSchema: false,
      };
    }
    if (incoming.data) {
      const result = analyzeMerge(
        local,
        incoming.data,
        { now: now().toISOString(), deviceId: local.deviceId },
        SYNC_MERGE_OPTIONS(),
      );
      if (!result.ok) {
        return {
          kind: "PROFILE_MISMATCH",
          account: pulled.account,
          remoteRecords,
        };
      }
      merged = result.analysis.data;
      conflicts = result.analysis.conflicts.length;
      for (const conflict of result.analysis.conflicts) {
        conflictKeys.add(conflict.key);
      }
      counts = result.analysis.counts;
      for (const change of result.analysis.changes) {
        if (
          [
            "ADDED",
            "ADDED_HISTORY",
            "UPDATED",
            "RESTORED",
            "DELETED",
            "HISTORY_UPDATED",
          ].includes(change.outcome)
        ) {
          downloads += 1;
        }
      }
    }
    const shadow: Record<string, ShadowEntry> = {};
    for (const row of validation.rows) {
      shadow[row.key] = shadowEntryFor(row.collection, row.record, row.seq);
    }
    const uploads = planPush({
      data: merged,
      shadow,
      conflicted: conflictKeys,
    }).length;
    const localHas = hasUserData(local);
    const remoteHas = remoteRecords > 0;
    emit({
      kind: "enable-preview",
      reason: "preview",
      outcome: conflicts ? "CONFLICT" : "OK",
      pulled: remoteRecords,
      pushed: 0,
      conflicts,
      rounds: 0,
      durationMs: Date.now() - started,
      errorCategory: null,
      block: null,
    });
    return {
      kind: "READY",
      evidence: {
        userId: options.userId,
        localRevision: local.documentRevision,
        generation: pulled.account.generation,
        lastSeq: pulled.account.lastSeq,
        profileId: pulled.account.profileId,
      },
      account: pulled.account,
      case:
        localHas && remoteHas
          ? "MERGE"
          : localHas
            ? "UPLOAD"
            : remoteHas
              ? "DOWNLOAD"
              : "NOTHING",
      localRecords: localCount,
      remoteRecords,
      downloads,
      uploads,
      conflicts,
      counts,
    };
  }

  return {
    getStatus: () => status,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    /** Read the checkpoint and publish the initial status. */
    async init(): Promise<SyncStatus> {
      const state = await options.state.load();
      setStatus(
        state
          ? {
              phase: "IDLE",
              lastSyncedAt: state.lastSyncedAt,
              generation: state.generation,
            }
          : { phase: "DISABLED", generation: null },
      );
      return status;
    },

    /** A local write happened; the next sync pushes it. */
    notifyLocalChange() {
      changeCounter += 1;
      if (!status.dirty && status.phase !== "DISABLED") {
        setStatus({ dirty: true });
      }
    },

    previewEnable: () => exclusive(previewEnable),

    /**
     * Turn sync on for this device after the user saw `preview`. Refuses a
     * preview that is not READY. The first run pulls everything, merges with
     * the causal rules (conflicts are surfaced, never auto-picked) and
     * uploads what the cloud lacks.
     */
    enable(preview: EnablePreview): Promise<EnableResult> {
      return exclusive(async (): Promise<EnableResult> => {
        if (preview.kind !== "READY") return { kind: "NOT_READY" };
        const evidence = preview.evidence;
        // Re-check, immediately before acting, everything the user saw.
        if (evidence.userId !== options.userId) {
          return { kind: "STALE_PREVIEW", reason: "ACCOUNT" };
        }
        const local = await latestData();
        if (local.documentRevision !== evidence.localRevision) {
          return { kind: "STALE_PREVIEW", reason: "LOCAL" };
        }
        const account = await options.transport.ensureAccount();
        if (
          account.generation !== evidence.generation ||
          account.lastSeq !== evidence.lastSeq ||
          account.profileId !== evidence.profileId
        ) {
          return { kind: "STALE_PREVIEW", reason: "REMOTE" };
        }
        await options.state.save(
          newSyncState({
            userId: options.userId,
            generation: evidence.generation,
            now: now().toISOString(),
          }),
        );
        return { kind: "ENABLED", status: await runSync("enable") };
      });
    },

    /** The account this engine acts for. */
    userId: options.userId,

    sync: (reason = "manual") => exclusive(() => runSync(reason)),

    /**
     * Apply explicit choices for open conflicts, then sync. Only keys that
     * are open conflicts of this account are honored.
     */
    resolveConflicts(
      resolutions: Readonly<Record<string, ConflictResolution>>,
    ): Promise<SyncStatus> {
      return exclusive(() => runSync("resolve", resolutions));
    },

    /**
     * Forget what this device knows about remote rows so the next run pulls
     * and merges everything again. Needed after a REPLACE restore: it can
     * put versions on this device that are older than rows the cursor has
     * already passed, and only a full merge brings the newer ones back
     * (or surfaces them as conflicts). Open conflicts are kept.
     */
    requestFullResync: () =>
      exclusive(async () => {
        const state = await options.state.load();
        if (!state) return;
        await options.state.save({ ...state, cursor: 0, shadow: {} });
      }),

    /** Stop syncing on this device. Keeps local data; forgets the checkpoint. */
    disable: () =>
      exclusive(async () => {
        await options.state.clear();
        setStatus({
          phase: "DISABLED",
          block: null,
          error: null,
          conflicts: [],
          held: [],
          generation: null,
        });
      }),

    /**
     * Delete every synced record and cloud backup of this account and move
     * the account to a new generation, so devices still holding the old one
     * cannot push until their user decides. Local data is not touched; this
     * device's sync is turned off.
     */
    deleteCloudData: (expected: { userId: string }) =>
      exclusive(
        async (): Promise<
          | { ok: true; account: RemoteAccount }
          | { ok: false; reason: "GENERATION_MISMATCH"; account: RemoteAccount }
          | AccountMismatch
        > => {
          // The confirmation was given for one account; never apply it to
          // another (e.g. after a sign-in switch in another tab).
          if (expected.userId !== options.userId) {
            return { ok: false, reason: "ACCOUNT_MISMATCH" };
          }
          const started = Date.now();
          const state = await options.state.load();
          const expectedGeneration =
            state?.generation ??
            (await options.transport.ensureAccount()).generation;
          const response = await options.transport.resetCloud({
            expectedGeneration,
          });
          if (response.kind === "GENERATION_MISMATCH") {
            return {
              ok: false,
              reason: "GENERATION_MISMATCH",
              account: response.account,
            };
          }
          await options.state.clear();
          setStatus({
            phase: "DISABLED",
            block: null,
            error: null,
            conflicts: [],
            held: [],
            generation: null,
            lastSyncedAt: null,
          });
          emit({
            kind: "reset",
            reason: "delete-cloud-data",
            outcome: "OK",
            pulled: 0,
            pushed: 0,
            conflicts: 0,
            rounds: 0,
            durationMs: Date.now() - started,
            errorCategory: null,
            block: null,
          });
          return { ok: true, account: response.account };
        },
      ),

    listBackups: (): Promise<CloudBackupInfo[]> =>
      options.transport.listBackups(),

    /** Upload a backup-v2 file of the current local document. */
    async uploadBackup(): Promise<UploadBackupResponse> {
      const data = await latestData();
      const exportedAt = now().toISOString();
      const backup = createBackup(data, exportedAt);
      const state = await options.state.load();
      const generation =
        state?.generation ??
        (await options.transport.ensureAccount()).generation;
      return options.transport.uploadBackup({
        generation,
        text: serializeBackup(backup),
        exportedAt,
        schemaVersion: backup.schemaVersion,
        formatVersion: backup.formatVersion,
        digest: backup.integrity.digest,
      });
    },

    /** Raw backup text; restore it through `parseBackup` + the restore preview. */
    downloadBackup: (id: string) => options.transport.downloadBackup(id),
    deleteBackup: (id: string) => options.transport.deleteBackup(id),
  };
}

/** Local (non-transport) failure category carrier. */
class SyncTransportErrorLike extends Error {
  constructor(readonly category: SyncErrorCategory) {
    super(category);
  }
}

export type SyncEngine = ReturnType<typeof createSyncEngine>;

export { syncRecordKey };
