import { LEGACY_KEYS, migrateLegacyStorage } from "./legacy";
import {
  createEmptyUserData,
  decodeUserDataText,
  userDataSchema,
  type UserData,
} from "./schema";

/**
 * Minimal persistence port. The web client adapts `localStorage`; a native
 * client can adapt SQLite, Capacitor Preferences or a file. Methods are async
 * so that slower backends fit the same contract.
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

export type LoadOutcome =
  | { kind: "EMPTY"; data: UserData }
  | { kind: "LOADED"; data: UserData }
  | { kind: "MIGRATED"; data: UserData; issues: string[] }
  /** The latest copy was unreadable; the previous generation was restored. */
  | { kind: "RECOVERED"; data: UserData; quarantineKey: string; reason: string }
  /** Nothing readable. The unreadable copy was preserved under quarantineKey. */
  | { kind: "CORRUPT"; data: UserData; quarantineKey: string; reason: string }
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

export type UserDataRepository = {
  load(): Promise<LoadOutcome>;
  /** Validates, keeps the previous generation, then replaces the document. */
  save(data: UserData): Promise<void>;
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
  async function quarantine(raw: string): Promise<string> {
    const key = `${STORAGE_KEYS.quarantinePrefix}${context.now()}`;
    try {
      await storage.setItem(key, raw);
    } catch {
      // If even the quarantine copy cannot be written, leave the original in
      // place: the next save rotates it into `previous` instead of losing it.
    }
    return key;
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

      const quarantineKey = await quarantine(raw);
      const previousRaw = await storage.getItem(STORAGE_KEYS.previous);
      const previous = previousRaw ? decodeUserDataText(previousRaw) : null;
      if (previous?.kind === "OK") {
        return {
          kind: "RECOVERED",
          data: previous.data,
          quarantineKey,
          reason: decoded.reason,
        };
      }
      return {
        kind: "CORRUPT",
        data: createEmptyUserData(context.createId()),
        quarantineKey,
        reason: decoded.reason,
      };
    },

    async save(data) {
      const valid = userDataSchema.safeParse(data);
      if (!valid.success) {
        const issue = valid.error.issues[0];
        throw new StorageWriteError(
          `저장하려는 데이터가 올바르지 않아요 (${issue?.path.join(".")}: ${issue?.message}).`,
          valid.error,
        );
      }

      const serialized = JSON.stringify(valid.data);
      try {
        const existing = await storage.getItem(STORAGE_KEYS.current);
        if (existing !== null && existing !== serialized) {
          await storage.setItem(STORAGE_KEYS.previous, existing);
        }
        await storage.setItem(STORAGE_KEYS.current, serialized);
      } catch (error) {
        throw new StorageWriteError(
          "기기 저장 공간에 쓰지 못했어요. 저장 공간이나 브라우저 설정을 확인해 주세요.",
          error,
        );
      }
    },

    async preserveBeforeRestore() {
      const existing = await storage.getItem(STORAGE_KEYS.current);
      if (existing === null) return false;
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
