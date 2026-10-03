import type { KeyValueStorage } from "@super-gongik/domain";

/**
 * Functions the native host installs on `globalThis.__sgHost` before the
 * bundle runs. Everything is synchronous: the host executes all JavaScript on
 * one serial queue, so a blocking file read there never touches the main
 * thread, and promises built on top of these calls settle inside the same
 * microtask drain.
 *
 * Errors cannot cross the bridge as exceptions, so writes return `null` on
 * success and a short, content-free error string on failure.
 */
export type NativeHost = {
  kvGet(key: string): string | null;
  kvSet(key: string, value: string): string | null;
  kvRemove(key: string): string | null;
  kvKeys(): string[];
  /** `true`/`false`, or an error string when storage itself failed. */
  kvCompareAndSet(
    key: string,
    expected: string | null,
    value: string,
  ): boolean | string;
  /** Cryptographically secure random bytes (SecRandomCopyBytes). */
  randomBytes(count: number): number[];
  /** Diagnostics only. Never pass record content. */
  log(level: "debug" | "info" | "error", message: string): void;
};

declare global {
  var __sgHost: NativeHost | undefined;
}

export function host(): NativeHost {
  const value = globalThis.__sgHost;
  if (!value) throw new Error("Native host is not installed.");
  return value;
}

export class NativeStorageError extends Error {
  constructor(operation: string, detail: string) {
    super(`${operation} failed: ${detail}`);
    this.name = "NativeStorageError";
  }
}

/**
 * `KeyValueStorage` over the host's file store. Provider obligations from
 * `repository.ts` (atomic replace, throw on failure, exact round trip) are
 * met natively and covered by `SGPersistenceTests`.
 */
export function createNativeStorage(
  native: NativeHost = host(),
): KeyValueStorage {
  return {
    async getItem(key) {
      return native.kvGet(key);
    },
    async setItem(key, value) {
      const error = native.kvSet(key, value);
      if (error !== null) throw new NativeStorageError("setItem", error);
    },
    async removeItem(key) {
      const error = native.kvRemove(key);
      if (error !== null) throw new NativeStorageError("removeItem", error);
    },
    async keys() {
      return native.kvKeys();
    },
    async compareAndSet(key, expected, value) {
      const result = native.kvCompareAndSet(key, expected, value);
      if (typeof result === "string") {
        throw new NativeStorageError("compareAndSet", result);
      }
      return result;
    },
  };
}
