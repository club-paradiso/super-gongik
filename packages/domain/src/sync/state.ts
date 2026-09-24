import { z } from "zod";

import type { KeyValueStorage } from "../store/repository";
import type { ShadowEntry } from "./remote";

/**
 * Per-account sync checkpoint kept on this device, next to (never inside) the
 * user document. It is transport metadata: it is not part of backups, never
 * bumps `documentRevision`, and never influences how a conflict is decided.
 *
 * Losing it is safe: the next sync pulls everything again and the merge is
 * idempotent. That is why "delete local data" simply removes it.
 */
export const SYNC_STATE_PREFIX = "super-gongik:sync:v1:";

export const syncStateKey = (userId: string) => `${SYNC_STATE_PREFIX}${userId}`;

const shadowEntrySchema = z.object({
  s: z.number().int().positive(),
  d: z.string(),
  c: z.string().optional(),
  l: z.boolean(),
  r: z.number().int().nonnegative().optional(),
  v: z.string().optional(),
  a: z.record(z.string(), z.number().int().nonnegative()).optional(),
  p: z.string().optional(),
});

const stashedRowSchema = z.object({
  collection: z.string(),
  recordId: z.string(),
  seq: z.number().int().positive(),
  schemaVersion: z.number().int(),
  payload: z.unknown(),
});

export const syncStateSchema = z.object({
  version: z.literal(1),
  userId: z.string().min(1),
  /** Account generation this checkpoint belongs to. */
  generation: z.number().int().positive(),
  /** Highest remote `seq` merged into the local document. */
  cursor: z.number().int().nonnegative(),
  enabledAt: z.string(),
  lastSyncedAt: z.string().nullable(),
  /** What this device knows about each remote row, by sync key. */
  shadow: z.record(z.string(), shadowEntrySchema),
  /**
   * Remote versions of records with an open conflict, kept so the conflict
   * stays visible (and resolvable) after the cursor has moved past them.
   * Holds user records, like the local document itself; cleared with it.
   */
  stash: z.record(z.string(), stashedRowSchema),
});

export type SyncState = z.infer<typeof syncStateSchema> & {
  shadow: Record<string, ShadowEntry>;
};

export function newSyncState(input: {
  userId: string;
  generation: number;
  now: string;
}): SyncState {
  return {
    version: 1,
    userId: input.userId,
    generation: input.generation,
    cursor: 0,
    enabledAt: input.now,
    lastSyncedAt: null,
    shadow: {},
    stash: {},
  };
}

export type SyncStateStore = {
  load(): Promise<SyncState | null>;
  save(state: SyncState): Promise<void>;
  clear(): Promise<void>;
};

/**
 * Checkpoint persistence. An unreadable checkpoint is treated as absent:
 * the next sync then starts from a full pull, which is always safe.
 */
export function createSyncStateStore(
  storage: KeyValueStorage,
  userId: string,
): SyncStateStore {
  const key = syncStateKey(userId);
  return {
    async load() {
      const text = await storage.getItem(key);
      if (text === null) return null;
      try {
        const parsed = syncStateSchema.safeParse(JSON.parse(text));
        if (!parsed.success || parsed.data.userId !== userId) return null;
        return parsed.data as SyncState;
      } catch {
        return null;
      }
    },
    async save(state) {
      await storage.setItem(key, JSON.stringify(state));
    },
    async clear() {
      await storage.removeItem(key);
    },
  };
}
