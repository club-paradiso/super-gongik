import type { ServiceProfile } from "../service/profile";
import { CURRENT_SCHEMA_VERSION, type UserData } from "../store/schema";
import { descendsFrom, profileDigest } from "../store/sync-contract";
import {
  contentDigest,
  localRecords,
  recordDigest,
  toWirePayload,
  type ShadowEntry,
  type SyncRecord,
  type SyncRecordKey,
} from "./remote";
import type { PushItem } from "./transport";

/**
 * Which local records to send, and the remote `seq` each write replaces.
 *
 * A record is pushed only when the remote copy is absent or provably an
 * ancestor of the local one. A remote version that is newer or concurrent is
 * never overwritten: it is the merge engine's job (and, for concurrent
 * versions, the user's). The server re-checks `baseSeq`, so a remote change
 * that lands after the pull is refused rather than overwritten.
 *
 * Records without a revision:
 * - profile: pushed when it records (in `supersedes`) the remote content it
 *   replaced;
 * - leave snapshots / import records: their content never changes; only
 *   their derived liveness is pushed, and only when it matches what the
 *   merge engine itself derives from the (synced) events, so two devices
 *   cannot flip it back and forth.
 */
export function planPush(input: {
  data: UserData;
  shadow: Readonly<Record<SyncRecordKey, ShadowEntry>>;
  /** Keys with an open conflict: never pushed. */
  conflicted: ReadonlySet<SyncRecordKey>;
  /** Keys the user just resolved explicitly: pushed over the known remote. */
  forced?: ReadonlySet<SyncRecordKey>;
}): PushItem[] {
  const { data, shadow, conflicted } = input;
  const forced = input.forced ?? new Set<SyncRecordKey>();
  const derivation = liveness(data);
  const items: PushItem[] = [];

  for (const { collection, key, record } of localRecords(data)) {
    if (conflicted.has(key)) continue;
    const remote = shadow[key];
    const push = () =>
      items.push({
        collection,
        recordId: record.id,
        baseSeq: remote?.s ?? null,
        schemaVersion: CURRENT_SCHEMA_VERSION,
        payload: toWirePayload(record),
      });
    if (!remote) {
      push();
      continue;
    }
    if (recordDigest(record) === remote.d) continue;
    if (forced.has(key)) {
      push();
      continue;
    }
    if (shouldPush(collection, record, remote, derivation)) push();
  }
  return items;
}

type Derivation = {
  batchHasEvents: Set<string>;
  batchHasLiveEvents: Set<string>;
  batchHasSnapshots: Set<string>;
  batchHasLiveSnapshots: Set<string>;
};

function liveness(data: UserData): Derivation {
  const result: Derivation = {
    batchHasEvents: new Set(),
    batchHasLiveEvents: new Set(),
    batchHasSnapshots: new Set(),
    batchHasLiveSnapshots: new Set(),
  };
  for (const event of data.events) {
    if (event.source.kind !== "IMPORT") continue;
    result.batchHasEvents.add(event.source.batchId);
    if (event.deletedAt === null) {
      result.batchHasLiveEvents.add(event.source.batchId);
    }
  }
  for (const snapshot of data.leaveSnapshots) {
    result.batchHasSnapshots.add(snapshot.importBatchId);
    if (snapshot.deletedAt === null) {
      result.batchHasLiveSnapshots.add(snapshot.importBatchId);
    }
  }
  return result;
}

function shouldPush(
  collection: string,
  record: SyncRecord,
  remote: ShadowEntry,
  derivation: Derivation,
): boolean {
  switch (collection) {
    case "profile": {
      const profile = record as ServiceProfile;
      return (
        remote.p !== undefined &&
        (profile.supersedes ?? []).includes(remote.p) &&
        profileDigest(profile) !== remote.p
      );
    }
    case "leaveSnapshots": {
      const snapshot = record as UserData["leaveSnapshots"][number];
      if (contentDigest("leaveSnapshots", snapshot) !== remote.c) return false;
      const live = snapshot.deletedAt === null;
      if (live === remote.l) return false;
      const batch = snapshot.importBatchId;
      // Same rule the merge engine applies to an incoming snapshot.
      return live
        ? derivation.batchHasLiveEvents.has(batch)
        : !derivation.batchHasLiveEvents.has(batch);
    }
    case "imports": {
      const item = record as UserData["imports"][number];
      if (contentDigest("imports", item) !== remote.c) return false;
      const active = item.status === "ACTIVE";
      if (active === remote.l) return false;
      const live =
        derivation.batchHasLiveEvents.has(item.id) ||
        derivation.batchHasLiveSnapshots.has(item.id);
      const hasRecords =
        derivation.batchHasEvents.has(item.id) ||
        derivation.batchHasSnapshots.has(item.id);
      return active ? live : hasRecords && !live;
    }
    default: {
      if (remote.r === undefined || remote.v === undefined) return false;
      const local = record as {
        revision: number;
        deviceId: string;
        supersedes?: Record<string, number>;
      };
      const remoteStamp = {
        revision: remote.r,
        deviceId: remote.v,
        supersedes: remote.a,
      };
      return (
        descendsFrom(local, remoteStamp) && !descendsFrom(remoteStamp, local)
      );
    }
  }
}
