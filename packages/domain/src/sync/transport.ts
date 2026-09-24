import type { RemoteRow } from "./remote";

/**
 * Backend-independent transport port. The Supabase adapter in the web app
 * implements it with RPCs; tests use `createMemorySyncServer`. Every method
 * acts on the signed-in account only — the server derives the account from
 * the session, never from an argument.
 *
 * Transport metadata (`generation`, `seq`) orders deliveries and guards
 * writes. It never enters conflict resolution: that is decided by the
 * records' own causal metadata in the merge engine.
 */

export type RemoteAccount = {
  /**
   * Account sync generation. Incremented when the user deletes all cloud
   * data. A device holding an older generation must not push.
   */
  generation: number;
  /** Highest sequence assigned in this account (transport cursor). */
  lastSeq: number;
  /** Service profile this account's records belong to, once one is pushed. */
  profileId: string | null;
  /** When cloud data was last deleted, if ever (display only). */
  resetAt: string | null;
};

export type PullRequest = {
  generation: number;
  afterSeq: number;
  limit: number;
};

export type PullResponse =
  | { kind: "OK"; account: RemoteAccount; rows: RemoteRow[]; hasMore: boolean }
  | { kind: "GENERATION_MISMATCH"; account: RemoteAccount };

export type PushItem = {
  collection: string;
  recordId: string;
  /** Remote `seq` this write replaces; null when the row should not exist. */
  baseSeq: number | null;
  schemaVersion: number;
  payload: Record<string, unknown>;
};

export type PushItemResult = {
  collection: string;
  recordId: string;
  /**
   * APPLIED: written with a new seq.
   * UNCHANGED: the row already holds exactly this payload (e.g. a retry after
   *   a lost response) — safe, nothing written.
   * STALE: the row changed since `baseSeq`; nothing written, pull again.
   */
  status: "APPLIED" | "UNCHANGED" | "STALE";
  seq: number | null;
};

export type PushRequest = {
  generation: number;
  /** Installation that pushes (transport provenance only). */
  deviceId: string;
  items: PushItem[];
};

export type PushResponse =
  | { kind: "OK"; account: RemoteAccount; results: PushItemResult[] }
  | { kind: "GENERATION_MISMATCH"; account: RemoteAccount }
  /** The account holds another service profile. Nothing was written. */
  | { kind: "PROFILE_MISMATCH"; account: RemoteAccount };

export type ResetResponse =
  | { kind: "OK"; account: RemoteAccount }
  | { kind: "GENERATION_MISMATCH"; account: RemoteAccount };

export type CloudBackupInfo = {
  id: string;
  createdAt: string;
  exportedAt: string;
  generation: number;
  schemaVersion: number;
  formatVersion: number;
  byteSize: number;
  digest: string | null;
};

export type UploadBackupRequest = {
  generation: number;
  text: string;
  exportedAt: string;
  schemaVersion: number;
  formatVersion: number;
  digest: string | null;
};

export type UploadBackupResponse =
  | { kind: "OK"; backup: CloudBackupInfo }
  | { kind: "GENERATION_MISMATCH"; account: RemoteAccount };

export interface SyncTransport {
  /** Create the account's sync row if missing; return it. */
  ensureAccount(): Promise<RemoteAccount>;
  pull(request: PullRequest): Promise<PullResponse>;
  /** Conditional, idempotent batch write; all items or none are applied. */
  push(request: PushRequest): Promise<PushResponse>;
  /** Delete every synced record and backup, then increment the generation. */
  resetCloud(request: { expectedGeneration: number }): Promise<ResetResponse>;
  listBackups(): Promise<CloudBackupInfo[]>;
  uploadBackup(request: UploadBackupRequest): Promise<UploadBackupResponse>;
  downloadBackup(id: string): Promise<string>;
  deleteBackup(id: string): Promise<void>;
}

/**
 * Sanitized failure categories. Messages never include payloads, and callers
 * must not attach request bodies to errors they report.
 */
export type TransportErrorCategory =
  /** No response (offline, DNS, timeout, connection reset). Retry later. */
  | "NETWORK"
  /** Session missing or expired; the user must sign in again. */
  | "AUTH"
  /** Server rejected or failed the request (5xx, constraint). */
  | "SERVER"
  | "RATE_LIMITED"
  /** The response did not have the expected shape. */
  | "INVALID_RESPONSE"
  | "NOT_FOUND";

export class SyncTransportError extends Error {
  constructor(
    readonly category: TransportErrorCategory,
    message: string = category,
  ) {
    super(message);
    this.name = "SyncTransportError";
  }
}

export const RETRYABLE_CATEGORIES: ReadonlySet<TransportErrorCategory> =
  new Set(["NETWORK", "SERVER", "RATE_LIMITED"]);
