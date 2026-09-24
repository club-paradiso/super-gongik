import { canonicalJson } from "../store/integrity";
import { isSyncCollection, type RemoteRow } from "./remote";
import {
  SyncTransportError,
  type CloudBackupInfo,
  type PullResponse,
  type PushItemResult,
  type PushResponse,
  type RemoteAccount,
  type SyncTransport,
} from "./transport";

/**
 * In-memory reference implementation of the server contract that
 * `supabase/migrations/*_cloud_sync.sql` implements in PostgreSQL. Used by
 * deterministic tests (and usable as an offline dev backend). It mirrors the
 * SQL functions rule for rule: per-account commit-ordered `seq`, conditional
 * idempotent pushes, generation checks, profile binding, reset.
 *
 * Fault injection simulates the network: a request can fail before the
 * server sees it, or after the server applied it but before the response
 * arrived (the "lost response" case).
 */

type Row = RemoteRow & { deviceId: string };

type Account = {
  generation: number;
  lastSeq: number;
  profileId: string | null;
  resetAt: string | null;
  rows: Map<string, Row>;
  backups: Array<CloudBackupInfo & { text: string }>;
};

export type FaultMode = "BEFORE" | "AFTER_COMMIT";
type Operation = "pull" | "push" | "reset" | "ensure" | "backup";

export const MAX_CLOUD_BACKUPS = 10;

export function createMemorySyncServer(options: { now?: () => string } = {}) {
  const now = options.now ?? (() => new Date().toISOString());
  const accounts = new Map<string, Account>();
  const faults: Array<{ user: string | null; op: Operation; mode: FaultMode }> =
    [];
  let backupIds = 0;
  const calls: Array<{ user: string; op: Operation }> = [];

  const account = (user: string): Account => {
    let found = accounts.get(user);
    if (!found) {
      found = {
        generation: 1,
        lastSeq: 0,
        profileId: null,
        resetAt: null,
        rows: new Map(),
        backups: [],
      };
      accounts.set(user, found);
    }
    return found;
  };

  const view = (item: Account): RemoteAccount => ({
    generation: item.generation,
    lastSeq: item.lastSeq,
    profileId: item.profileId,
    resetAt: item.resetAt,
  });

  const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

  /** Run `apply` with any queued fault for this user/operation. */
  async function call<T>(user: string, op: Operation, apply: () => T) {
    calls.push({ user, op });
    await Promise.resolve();
    const index = faults.findIndex(
      (fault) =>
        fault.op === op && (fault.user === null || fault.user === user),
    );
    const fault = index >= 0 ? faults.splice(index, 1)[0] : undefined;
    if (fault?.mode === "BEFORE") {
      throw new SyncTransportError("NETWORK", "simulated network failure");
    }
    const result = clone(apply());
    if (fault?.mode === "AFTER_COMMIT") {
      throw new SyncTransportError("NETWORK", "response lost after commit");
    }
    return result;
  }

  function transportFor(user: string | null): SyncTransport {
    const requireUser = () => {
      if (user === null) {
        throw new SyncTransportError("AUTH", "not signed in");
      }
      return user;
    };
    return {
      ensureAccount: async () => {
        const id = requireUser();
        return call(id, "ensure", () => view(account(id)));
      },

      pull: async (request) => {
        const id = requireUser();
        return call(id, "pull", (): PullResponse => {
          const item = account(id);
          if (item.generation !== request.generation) {
            return { kind: "GENERATION_MISMATCH", account: view(item) };
          }
          const rows = [...item.rows.values()]
            .filter((row) => row.seq > request.afterSeq)
            .sort((a, b) => a.seq - b.seq);
          const page = rows.slice(0, request.limit).map((row) => ({
            collection: row.collection,
            recordId: row.recordId,
            seq: row.seq,
            schemaVersion: row.schemaVersion,
            payload: row.payload,
          }));
          return {
            kind: "OK",
            account: view(item),
            rows: page,
            hasMore: rows.length > request.limit,
          };
        });
      },

      push: async (request) => {
        const id = requireUser();
        return call(id, "push", (): PushResponse => {
          const item = account(id);
          if (item.generation !== request.generation) {
            return { kind: "GENERATION_MISMATCH", account: view(item) };
          }
          // One transaction: work on copies, commit only if all items pass.
          let profileId = item.profileId;
          let lastSeq = item.lastSeq;
          const writes: Row[] = [];
          const results: PushItemResult[] = [];
          const ordered = [...request.items].sort(
            (a, b) =>
              Number(b.collection === "profile") -
              Number(a.collection === "profile"),
          );
          for (const push of ordered) {
            if (
              !isSyncCollection(push.collection) ||
              push.recordId.length === 0 ||
              push.recordId.length > 200 ||
              typeof push.payload !== "object" ||
              push.payload === null ||
              push.payload.id !== push.recordId
            ) {
              throw new SyncTransportError("SERVER", "invalid push item");
            }
            if (push.collection === "profile") {
              if (profileId === null) profileId = push.recordId;
              if (profileId !== push.recordId) {
                return { kind: "PROFILE_MISMATCH", account: view(item) };
              }
            } else if (
              profileId === null ||
              push.payload.serviceProfileId !== profileId
            ) {
              return { kind: "PROFILE_MISMATCH", account: view(item) };
            }
            const key = `${push.collection}:${push.recordId}`;
            const existing =
              writes.find(
                (row) => `${row.collection}:${row.recordId}` === key,
              ) ?? item.rows.get(key);
            if (
              existing &&
              existing.schemaVersion === push.schemaVersion &&
              canonicalJson(existing.payload) === canonicalJson(push.payload)
            ) {
              results.push({
                collection: push.collection,
                recordId: push.recordId,
                status: "UNCHANGED",
                seq: existing.seq,
              });
              continue;
            }
            const matches = existing
              ? existing.seq === push.baseSeq
              : push.baseSeq === null;
            if (!matches) {
              results.push({
                collection: push.collection,
                recordId: push.recordId,
                status: "STALE",
                seq: existing?.seq ?? null,
              });
              continue;
            }
            lastSeq += 1;
            writes.push({
              collection: push.collection,
              recordId: push.recordId,
              seq: lastSeq,
              schemaVersion: push.schemaVersion,
              payload: clone(push.payload),
              deviceId: request.deviceId,
            });
            results.push({
              collection: push.collection,
              recordId: push.recordId,
              status: "APPLIED",
              seq: lastSeq,
            });
          }
          for (const row of writes) {
            item.rows.set(`${row.collection}:${row.recordId}`, row);
          }
          item.lastSeq = lastSeq;
          item.profileId = profileId;
          return { kind: "OK", account: view(item), results };
        });
      },

      resetCloud: async ({ expectedGeneration }) => {
        const id = requireUser();
        return call(id, "reset", () => {
          const item = account(id);
          if (item.generation !== expectedGeneration) {
            return {
              kind: "GENERATION_MISMATCH" as const,
              account: view(item),
            };
          }
          item.rows.clear();
          item.backups = [];
          item.generation += 1;
          item.profileId = null;
          item.resetAt = now();
          return { kind: "OK" as const, account: view(item) };
        });
      },

      listBackups: async () => {
        const id = requireUser();
        return call(id, "backup", () =>
          account(id)
            .backups.map((backup) => {
              const { text: _text, ...info } = backup;
              void _text;
              return info;
            })
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
        );
      },

      uploadBackup: async (request) => {
        const id = requireUser();
        return call(id, "backup", () => {
          const item = account(id);
          if (item.generation !== request.generation) {
            return {
              kind: "GENERATION_MISMATCH" as const,
              account: view(item),
            };
          }
          const backup = {
            id: `backup-${++backupIds}`,
            createdAt: now(),
            exportedAt: request.exportedAt,
            generation: item.generation,
            schemaVersion: request.schemaVersion,
            formatVersion: request.formatVersion,
            byteSize: request.text.length,
            digest: request.digest,
            text: request.text,
          };
          item.backups.push(backup);
          // Retention: keep the newest MAX_CLOUD_BACKUPS.
          item.backups.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
          while (item.backups.length > MAX_CLOUD_BACKUPS) item.backups.shift();
          const { text: _text, ...info } = backup;
          void _text;
          return { kind: "OK" as const, backup: info };
        });
      },

      downloadBackup: async (backupId) => {
        const id = requireUser();
        return call(id, "backup", () => {
          const found = account(id).backups.find((b) => b.id === backupId);
          if (!found) throw new SyncTransportError("NOT_FOUND");
          return found.text;
        });
      },

      deleteBackup: async (backupId) => {
        const id = requireUser();
        await call(id, "backup", () => {
          const item = account(id);
          item.backups = item.backups.filter((b) => b.id !== backupId);
          return null;
        });
      },
    };
  }

  return {
    /** A transport acting as `userId`, or as a signed-out client (null). */
    transport: transportFor,
    /** Queue one fault for the next matching request. */
    fail(op: Operation, mode: FaultMode, user: string | null = null) {
      faults.push({ user, op, mode });
    },
    calls,
    /** Test inspection: a copy of one account's rows. */
    rows(user: string): Row[] {
      return clone([...(accounts.get(user)?.rows.values() ?? [])]);
    },
    account(user: string): RemoteAccount | null {
      const item = accounts.get(user);
      return item ? view(item) : null;
    },
    /** Test hook: corrupt or replace a stored row as a hostile writer could. */
    tamper(user: string, key: string, payload: unknown, schemaVersion = 3) {
      const item = account(user);
      const row = item.rows.get(key);
      item.lastSeq += 1;
      const [collection, ...rest] = key.split(":");
      item.rows.set(key, {
        collection: collection!,
        recordId: rest.join(":"),
        seq: item.lastSeq,
        schemaVersion,
        payload,
        deviceId: row?.deviceId ?? "tamper",
      });
    },
  };
}

export type MemorySyncServer = ReturnType<typeof createMemorySyncServer>;
