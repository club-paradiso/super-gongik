import type { KeyValueStorage, WriteLock } from "@super-gongik/domain";

/** Lock name shared by every tab and window of this origin. */
export const USER_DATA_LOCK = "super-gongik:user-data";

/**
 * Cross-tab write serialization via the Web Locks API (Chromium, Firefox,
 * Safari 15.4+). Returns undefined where it is missing; the store then falls
 * back to compare-and-set, which detects most but not all concurrent writes
 * (see docs/BACKUP_AND_SYNC.md).
 */
export function browserWriteLock(): WriteLock | undefined {
  if (typeof navigator === "undefined" || !navigator.locks?.request) {
    return undefined;
  }
  const locks = navigator.locks;
  return <T>(task: () => Promise<T>) =>
    new Promise<T>((resolve, reject) => {
      // The lock is held until the task settles.
      locks
        .request(USER_DATA_LOCK, { mode: "exclusive" }, () =>
          task().then(resolve, reject),
        )
        .catch(reject);
    });
}

/**
 * `localStorage` adapter for the domain persistence port.
 *
 * Why not IndexedDB (yet): the whole user document is well under 1 MB, and a
 * single `setItem` of one serialized document is atomic, which gives the
 * repository all-or-nothing writes without transaction plumbing. The domain
 * contract is async, so an IndexedDB or native adapter can replace this file
 * without touching business code.
 */
export function createBrowserStorage(): KeyValueStorage {
  const storage = () => {
    try {
      return window.localStorage;
    } catch (error) {
      throw new Error("이 브라우저에서는 기기 저장소를 사용할 수 없어요.", {
        cause: error,
      });
    }
  };

  return {
    async getItem(key) {
      return storage().getItem(key);
    },
    async setItem(key, value) {
      storage().setItem(key, value);
    },
    async removeItem(key) {
      storage().removeItem(key);
    },
    async compareAndSet(key, expected, value) {
      // One synchronous block: no other script in this browsing context can
      // run between the check and the write.
      const target = storage();
      if (target.getItem(key) !== expected) return false;
      target.setItem(key, value);
      return true;
    },
    async keys() {
      const target = storage();
      return Array.from({ length: target.length }, (_, index) =>
        target.key(index),
      ).filter((key): key is string => key !== null);
    },
  };
}

/**
 * Ask the browser not to evict site data under storage pressure. Best effort:
 * browsers may decline, and nothing depends on the answer.
 */
export async function requestPersistentStorage(): Promise<boolean | null> {
  try {
    if (!navigator.storage?.persist) return null;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return null;
  }
}
