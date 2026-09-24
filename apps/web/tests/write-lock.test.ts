import { afterEach, describe, expect, it, vi } from "vitest";

import {
  USER_DATA_LOCK,
  browserWriteLock,
  createBrowserStorage,
} from "../src/lib/browser-storage";

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Minimal exclusive LockManager: callbacks for one name run one at a time. */
function fakeLocks() {
  const names: string[] = [];
  let tail: Promise<unknown> = Promise.resolve();
  return {
    names,
    request(name: string, _options: unknown, callback: () => Promise<unknown>) {
      names.push(name);
      const run = tail.then(callback);
      tail = run.catch(() => undefined);
      return run;
    },
  };
}

describe("browser write lock", () => {
  it("is absent where the Web Locks API is missing", () => {
    vi.stubGlobal("navigator", {});
    expect(browserWriteLock()).toBeUndefined();
  });

  it("runs tasks one at a time under the shared lock name and passes results through", async () => {
    const locks = fakeLocks();
    vi.stubGlobal("navigator", { locks });
    const lock = browserWriteLock()!;
    const order: string[] = [];
    const slow = lock(async () => {
      order.push("a:start");
      await new Promise((resolve) => setTimeout(resolve, 10));
      order.push("a:end");
      return 1;
    });
    const fast = lock(async () => {
      order.push("b:start");
      return 2;
    });
    expect(await Promise.all([slow, fast])).toEqual([1, 2]);
    expect(order).toEqual(["a:start", "a:end", "b:start"]);
    expect(locks.names).toEqual([USER_DATA_LOCK, USER_DATA_LOCK]);
    await expect(
      lock(async () => Promise.reject(new Error("boom"))),
    ).rejects.toThrow("boom");
  });
});

describe("localStorage adapter", () => {
  it("commits with compareAndSet only when the stored text is unchanged", async () => {
    const values = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
        key: () => null,
        length: 0,
      },
    });
    const storage = createBrowserStorage();
    expect(await storage.compareAndSet!("k", null, "one")).toBe(true);
    expect(await storage.compareAndSet!("k", null, "two")).toBe(false);
    expect(await storage.compareAndSet!("k", "one", "three")).toBe(true);
    expect(values.get("k")).toBe("three");
  });
});
