import type { SyncStatus } from "./engine";

/**
 * When to run sync. Local writes never wait for it: they are committed to
 * local storage first, and this only decides when to reconcile.
 *
 * - Local change: debounced, so a burst of edits becomes one sync.
 * - Online/foreground/manual: soon.
 * - Failure: bounded exponential backoff with jitter, only for categories
 *   that can succeed on their own (network, server, rate limit). After
 *   `maxAttempts` consecutive failures automatic retries stop until the next
 *   trigger (a local change, reconnect, foreground or the manual button).
 * - A blocked state (auth, cloud reset, profile mismatch, invalid remote)
 *   never retries on its own: it needs the user.
 *
 * `navigator.onLine` is only a hint used as a trigger; the result of the
 * actual request decides whether the backend is reachable.
 */
export type SyncSchedulerOptions = {
  run: (reason: string) => Promise<SyncStatus>;
  setTimer: (callback: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
  debounceMs?: number;
  backoffMs?: readonly number[];
  maxAttempts?: number;
  random?: () => number;
  onRetryScheduled?: (info: { attempt: number; delayMs: number }) => void;
};

export const DEFAULT_BACKOFF_MS = [5_000, 15_000, 60_000, 300_000] as const;

export function createSyncScheduler(options: SyncSchedulerOptions) {
  const debounceMs = options.debounceMs ?? 2_000;
  const backoff = options.backoffMs ?? DEFAULT_BACKOFF_MS;
  const maxAttempts = options.maxAttempts ?? 8;
  const random = options.random ?? Math.random;
  let timer: unknown = null;
  let running = false;
  let rerun: string | null = null;
  let failures = 0;
  let stopped = false;

  function clear() {
    if (timer !== null) options.clearTimer(timer);
    timer = null;
  }

  function schedule(reason: string, delay: number) {
    if (stopped) return;
    clear();
    timer = options.setTimer(() => {
      timer = null;
      void execute(reason);
    }, delay);
  }

  async function execute(reason: string) {
    if (stopped) return;
    if (running) {
      rerun = reason;
      return;
    }
    running = true;
    let status: SyncStatus | null;
    try {
      status = await options.run(reason);
    } catch {
      status = null;
    } finally {
      running = false;
    }
    if (stopped) return;
    const retryable =
      status === null ||
      ((status.phase === "OFFLINE" || status.phase === "ERROR") &&
        status.error !== "LOCAL_WRITE");
    if (status && !retryable) {
      failures = 0;
    } else {
      failures += 1;
      if (failures < maxAttempts) {
        const base = backoff[Math.min(failures - 1, backoff.length - 1)]!;
        const delay = Math.round(base * (0.8 + random() * 0.4));
        options.onRetryScheduled?.({ attempt: failures, delayMs: delay });
        schedule("retry", delay);
      }
    }
    if (rerun !== null) {
      const next = rerun;
      rerun = null;
      schedule(next, debounceMs);
    } else if (status && !retryable && status.dirty) {
      // Something changed locally while this run was in flight.
      schedule("local-change", debounceMs);
    }
  }

  return {
    /** A local write committed. */
    localChange() {
      // While backing off, a local edit does not shorten the wait: the
      // pending retry will carry it.
      if (failures > 0 && timer !== null) return;
      if (running) {
        rerun = "local-change";
        return;
      }
      schedule("local-change", debounceMs);
    },
    /** Connectivity or foreground regained, or the user asked. */
    soon(reason: string) {
      failures = 0;
      schedule(reason, 0);
    },
    stop() {
      stopped = true;
      clear();
    },
    get consecutiveFailures() {
      return failures;
    },
  };
}

export type SyncScheduler = ReturnType<typeof createSyncScheduler>;
