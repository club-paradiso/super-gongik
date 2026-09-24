import type { KeyValueStorage } from "@super-gongik/domain";

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
