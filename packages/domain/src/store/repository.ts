import { LEGACY_KEYS, migrateLegacyStorage } from "./legacy";
import {
  createEmptyUserData,
  decodeUserDataText,
  userDataSchema,
  type UserData,
} from "./schema";

/**
 * Minimal persistence port. The web client adapts `localStorage`; a native
 * client can adapt SQLite, Capacitor Preferences, IndexedDB or a file.
 * Methods are async so that slower backends fit the same contract.
 *
 * Provider obligations (everything else — validation, generations,
 * quarantine, migrations, merge — lives above this port):
 * - `setItem` replaces one value atomically: a reader sees the old value or
 *   the new one, never a mix. A failed `setItem` must leave the old value.
 * - `setItem` rejects (throws) on any failure, including quota errors.
 * - `getItem` returns exactly the string last written, or null.
 * - Any method may throw when storage itself is unavailable.
 */
export interface KeyValueStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
  /** Optional key listing, used to purge every local copy on request. */
  keys?(): Promise<string[]>;
}

/** Every key this app writes starts with this prefix (legacy ones included). */
export const APP_KEY_PREFIX = "super-gongik";

export const STORAGE_KEYS = {
  current: "super-gongik:data:v2",
  previous: "super-gongik:data:v2:previous",
  preRestore: "super-gongik:data:v2:pre-restore",
  quarantinePrefix: "super-gongik:quarantine:",
} as const;

type Quarantine = {
  /** Key that holds the unreadable bytes, byte for byte. */
  quarantineKey: string;
  /**
   * True when no separate copy could be written, so the bytes still live only
   * at the live document key. Callers must not write until that is resolved,
   * or the only copy would be overwritten.
   */
  quarantineInPlace: boolean;
};

export type LoadOutcome =
  | { kind: "EMPTY"; data: UserData }
  | { kind: "LOADED"; data: UserData }
  | { kind: "MIGRATED"; data: UserData; issues: string[] }
  /** The latest copy was unreadable; the previous generation was restored. */
  | ({ kind: "RECOVERED"; data: UserData; reason: string } & Quarantine)
  /** Nothing readable. The unreadable copy was preserved under quarantineKey. */
  | ({
      kind: "CORRUPT";
      data: UserData;
      reason: string;
      /** Where an unreadable previous generation was copied, if there was one. */
      previousQuarantineKey: string | null;
    } & Quarantine)
  /** Written by a newer app version. Writing is refused to avoid a downgrade. */
  | { kind: "NEWER_VERSION"; data: UserData; foundVersion: number };

export class StorageWriteError extends Error {
  constructor(
    message: string,
    readonly causeError: unknown,
  ) {
    super(message);
    this.name = "StorageWriteError";
  }
}

/**
 * The stored document is no longer the one the write was based on: another
 * tab or window saved in between. Nothing was written.
 */
export class ConcurrentWriteError extends StorageWriteError {
  constructor(
    readonly expectedRevision: number,
    readonly storedRevision: number,
  ) {
    super(
      "다른 탭이나 창에서 방금 데이터를 저장했어요. 덮어쓰지 않았어요.",
      null,
    );
    this.name = "ConcurrentWriteError";
  }
}

export type SaveOptions = {
  /**
   * Compare-and-set: refuse with `ConcurrentWriteError` unless the stored
   * document still has this `documentRevision`. Skipped when nothing
   * readable is stored.
   */
  expectedRevision?: number;
};

export type UserDataRepository = {
  load(): Promise<LoadOutcome>;
  /** Validates, keeps the previous generation, then replaces the document. */
  save(data: UserData, options?: SaveOptions): Promise<void>;
  /** Keep a copy of the current document before a destructive restore. */
  preserveBeforeRestore(): Promise<boolean>;
  readRaw(key: string): Promise<string | null>;
  /**
   * Remove every auxiliary copy (previous generation, pre-restore copy,
   * quarantined documents, legacy keys) except the current document.
   */
  purgeAuxiliaryCopies(): Promise<void>;
};

export function createUserDataRepository(
  storage: KeyValueStorage,
  context: { now: () => string; createId: () => string },
): UserDataRepository {
  /** Last document text known to decode, to skip re-validation on save. */
  let lastGood: string | null = null;
  let lastGoodRevision = 0;

  /**
   * Copy unreadable bytes to a quarantine key (reusing an identical existing
   * copy). Returns null when no copy could be written.
   */
  async function quarantine(raw: string, suffix = ""): Promise<string | null> {
    try {
      const keys = storage.keys ? await storage.keys() : [];
      for (const key of keys) {
        if (
          key.startsWith(STORAGE_KEYS.quarantinePrefix) &&
          (await storage.getItem(key)) === raw
        ) {
          return key;
        }
      }
      const key = `${STORAGE_KEYS.quarantinePrefix}${context.now()}${suffix}`;
      await storage.setItem(key, raw);
      return key;
    } catch {
      return null;
    }
  }

  /** `documentRevision` of a readable document, or null if unreadable. */
  function revisionOf(raw: string): number | null {
    if (raw === lastGood) return lastGoodRevision;
    const decoded = decodeUserDataText(raw);
    if (decoded.kind !== "OK") return null;
    lastGood = raw;
    lastGoodRevision = decoded.data.documentRevision;
    return lastGoodRevision;
  }

  /** True when `raw` is a document this app version can read. */
  function isReadable(raw: string): boolean {
    return revisionOf(raw) !== null;
  }

  async function loadLegacy(): Promise<LoadOutcome> {
    const profileRaw = await storage.getItem(LEGACY_KEYS.profile);
    if (!profileRaw) {
      return { kind: "EMPTY", data: createEmptyUserData(context.createId()) };
    }

    let profileId: string | null;
    try {
      const parsed = JSON.parse(profileRaw) as { id?: unknown };
      profileId = typeof parsed.id === "string" ? parsed.id : null;
    } catch {
      profileId = null;
    }

    const migration = migrateLegacyStorage(
      {
        profileRaw,
        recordsRaw: profileId
          ? await storage.getItem(`${LEGACY_KEYS.recordsPrefix}${profileId}`)
          : null,
        deviceIdRaw: await storage.getItem(LEGACY_KEYS.deviceId),
      },
      { now: context.now(), createDeviceId: context.createId },
    );

    if (migration.kind === "MIGRATED") {
      return {
        kind: "MIGRATED",
        data: migration.data,
        issues: migration.issues,
      };
    }
    if (migration.kind === "CORRUPT_PROFILE") {
      return {
        kind: "CORRUPT",
        data: createEmptyUserData(context.createId()),
        quarantineKey: LEGACY_KEYS.profile,
        // Legacy keys are never written again, so the bytes are safe there.
        quarantineInPlace: false,
        previousQuarantineKey: null,
        reason: "이전 버전 프로필을 읽을 수 없어요.",
      };
    }
    return { kind: "EMPTY", data: createEmptyUserData(context.createId()) };
  }

  return {
    async load() {
      const raw = await storage.getItem(STORAGE_KEYS.current);
      if (raw === null) return loadLegacy();

      const decoded = decodeUserDataText(raw);
      if (decoded.kind === "OK") {
        lastGood = raw;
        lastGoodRevision = decoded.data.documentRevision;
        return decoded.migratedFrom === null
          ? { kind: "LOADED", data: decoded.data }
          : { kind: "MIGRATED", data: decoded.data, issues: decoded.issues };
      }
      if (decoded.kind === "NEWER_VERSION") {
        return {
          kind: "NEWER_VERSION",
          data: createEmptyUserData(context.createId()),
          foundVersion: decoded.foundVersion,
        };
      }

      const copied = await quarantine(raw);
      const where = {
        quarantineKey: copied ?? STORAGE_KEYS.current,
        quarantineInPlace: copied === null,
      };
      const previousRaw = await storage.getItem(STORAGE_KEYS.previous);
      const previous = previousRaw ? decodeUserDataText(previousRaw) : null;
      if (previous?.kind === "OK") {
        return {
          kind: "RECOVERED",
          data: previous.data,
          reason: decoded.reason,
          ...where,
        };
      }
      // Both generations unreadable: keep a copy of the previous one too,
      // because the next save rotates a new document into that key.
      const previousCopy =
        previousRaw === null || previousRaw === raw
          ? null
          : await quarantine(previousRaw, ":previous");
      return {
        kind: "CORRUPT",
        data: createEmptyUserData(context.createId()),
        reason: decoded.reason,
        previousQuarantineKey: previousCopy,
        ...where,
        quarantineInPlace:
          where.quarantineInPlace ||
          (previousRaw !== null &&
            previousRaw !== raw &&
            previousCopy === null),
      };
    },

    async save(data, options = {}) {
      const valid = userDataSchema.safeParse(data);
      if (!valid.success) {
        const issue = valid.error.issues[0];
        throw new StorageWriteError(
          `저장하려는 데이터가 올바르지 않아요 (${issue?.path.join(".")}: ${issue?.message}).`,
          valid.error,
        );
      }

      const serialized = JSON.stringify(valid.data);
      let existing: string | null;
      try {
        existing = await storage.getItem(STORAGE_KEYS.current);
      } catch (error) {
        throw new StorageWriteError(
          "기기 저장소를 읽지 못해 저장하지 않았어요. 브라우저 설정을 확인해 주세요.",
          error,
        );
      }
      if (existing !== null && options.expectedRevision !== undefined) {
        const stored = revisionOf(existing);
        if (stored !== null && stored !== options.expectedRevision) {
          throw new ConcurrentWriteError(options.expectedRevision, stored);
        }
      }
      if (existing !== null && existing !== serialized) {
        const decoded = isReadable(existing)
          ? null
          : decodeUserDataText(existing);
        if (decoded?.kind === "NEWER_VERSION") {
          // Never downgrade a document written by a newer app version.
          throw new StorageWriteError(
            "더 새로운 앱 버전이 저장한 데이터가 있어 덮어쓰지 않았어요. 페이지를 새로고침해 주세요.",
            null,
          );
        }
        if (decoded && (await quarantine(existing)) === null) {
          // Unreadable bytes and no room for a copy: refuse instead of
          // overwriting the only evidence.
          throw new StorageWriteError(
            "읽을 수 없는 저장본을 따로 보관하지 못해 저장하지 않았어요. 저장 공간을 확보한 뒤 새로고침해 주세요.",
            null,
          );
        }
        try {
          // Only a readable document becomes the previous generation, so a
          // corrupt copy can never push out the last good one.
          if (!decoded) {
            await storage.setItem(STORAGE_KEYS.previous, existing);
          }
        } catch (error) {
          throw new StorageWriteError(
            "기기 저장 공간이 부족하거나 쓸 수 없어 저장하지 않았어요. 이전 데이터는 그대로예요.",
            error,
          );
        }
      }
      try {
        await storage.setItem(STORAGE_KEYS.current, serialized);
      } catch (error) {
        throw new StorageWriteError(
          "기기 저장 공간이 부족하거나 쓸 수 없어 저장하지 않았어요. 이전 데이터는 그대로예요.",
          error,
        );
      }
      lastGood = serialized;
      lastGoodRevision = valid.data.documentRevision;
    },

    async preserveBeforeRestore() {
      const existing = await storage.getItem(STORAGE_KEYS.current);
      if (existing === null || !isReadable(existing)) return false;
      await storage.setItem(STORAGE_KEYS.preRestore, existing);
      return true;
    },

    readRaw(key) {
      return storage.getItem(key);
    },

    async purgeAuxiliaryCopies() {
      const known = [
        STORAGE_KEYS.previous,
        STORAGE_KEYS.preRestore,
        LEGACY_KEYS.profile,
        LEGACY_KEYS.deviceId,
      ];
      const listed = storage.keys ? await storage.keys() : [];
      const targets = new Set([
        ...known,
        ...listed.filter(
          (key) =>
            key.startsWith(APP_KEY_PREFIX) && key !== STORAGE_KEYS.current,
        ),
      ]);
      for (const key of targets) await storage.removeItem(key);
    },
  };
}

/** In-memory backend for tests and non-persistent previews. */
export function createMemoryStorage(
  initial: Record<string, string> = {},
): KeyValueStorage & { dump(): Record<string, string> } {
  const values = new Map(Object.entries(initial));
  return {
    async getItem(key) {
      return values.get(key) ?? null;
    },
    async setItem(key, value) {
      values.set(key, value);
    },
    async removeItem(key) {
      values.delete(key);
    },
    async keys() {
      return [...values.keys()];
    },
    dump() {
      return Object.fromEntries(values);
    },
  };
}
