import { describe, expect, it } from "vitest";

import {
  createMemorySyncServer,
  createSyncScheduler,
  type SyncStatus,
} from "../src";
import { userDataWithProfile } from "./helpers";
import { installation } from "./sync-helpers";

/** Manual timers: nothing runs until the test advances time. */
function fakeTimers() {
  let now = 0;
  let next = 1;
  const pending = new Map<number, { at: number; run: () => void }>();
  return {
    setTimer: (run: () => void, ms: number) => {
      const id = next++;
      pending.set(id, { at: now + ms, run });
      return id;
    },
    clearTimer: (id: unknown) => {
      pending.delete(id as number);
    },
    async advance(ms: number) {
      const until = now + ms;
      for (;;) {
        const due = [...pending.entries()]
          .filter(([, timer]) => timer.at <= until)
          .sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        pending.delete(due[0]);
        now = due[1].at;
        due[1].run();
        // Let the triggered run settle (it only awaits promises).
        for (let i = 0; i < 3; i += 1) {
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
      }
      now = until;
    },
    get pendingCount() {
      return pending.size;
    },
  };
}

function status(patch: Partial<SyncStatus>): SyncStatus {
  return {
    phase: "IDLE",
    block: null,
    error: null,
    conflicts: [],
    held: [],
    lastSyncedAt: null,
    dirty: false,
    generation: 1,
    lastSummary: null,
    localRevision: null,
    ...patch,
  };
}

describe("sync scheduler", () => {
  it("debounces a burst of local changes into one sync", async () => {
    const timers = fakeTimers();
    const runs: string[] = [];
    const scheduler = createSyncScheduler({
      ...timers,
      run: async (reason) => {
        runs.push(reason);
        return status({});
      },
    });
    for (let i = 0; i < 10; i += 1) {
      scheduler.localChange();
      await timers.advance(500);
    }
    expect(runs).toEqual([]);
    await timers.advance(2_000);
    expect(runs).toEqual(["local-change"]);
  });

  it("backs off with bounded, growing delays and stops after max attempts", async () => {
    const timers = fakeTimers();
    const delays: number[] = [];
    let runs = 0;
    const scheduler = createSyncScheduler({
      ...timers,
      random: () => 0.5,
      maxAttempts: 5,
      onRetryScheduled: ({ delayMs }) => delays.push(delayMs),
      run: async () => {
        runs += 1;
        return status({ phase: "OFFLINE", error: "NETWORK" });
      },
    });
    scheduler.soon("online");
    await timers.advance(10 * 60_000);
    expect(delays).toEqual([5_000, 15_000, 60_000, 300_000]);
    expect(runs).toBe(5);
    expect(timers.pendingCount).toBe(0);
    // Local edits while given up do trigger a new attempt (debounced).
    scheduler.localChange();
    await timers.advance(2_000);
    expect(runs).toBe(6);
  });

  it("does not let local edits shorten an active backoff", async () => {
    const timers = fakeTimers();
    let runs = 0;
    const scheduler = createSyncScheduler({
      ...timers,
      random: () => 0.5,
      run: async () => {
        runs += 1;
        return status({ phase: "OFFLINE", error: "NETWORK" });
      },
    });
    scheduler.soon("manual");
    await timers.advance(0);
    expect(runs).toBe(1);
    for (let i = 0; i < 20; i += 1) scheduler.localChange();
    await timers.advance(4_000);
    expect(runs).toBe(1);
    await timers.advance(1_000);
    expect(runs).toBe(2);
  });

  it("never retries a blocked state or a conflict on its own", async () => {
    const timers = fakeTimers();
    let runs = 0;
    const scheduler = createSyncScheduler({
      ...timers,
      run: async () => {
        runs += 1;
        return status({
          phase: "BLOCKED",
          block: {
            reason: "GENERATION_MISMATCH",
            account: {
              generation: 2,
              lastSeq: 0,
              profileId: null,
              resetAt: null,
            },
          },
        });
      },
    });
    scheduler.soon("foreground");
    await timers.advance(60 * 60_000);
    expect(runs).toBe(1);
    scheduler.stop();
    scheduler.soon("manual");
    await timers.advance(1_000);
    expect(runs).toBe(1);
  });

  it("drives a real engine: offline edits are retried until the server is reachable", async () => {
    const server = createMemorySyncServer();
    const a = await installation(server, "phone-a", {
      seed: userDataWithProfile(),
    }).load();
    await a.enable("user-a");
    const timers = fakeTimers();
    const scheduler = createSyncScheduler({
      ...timers,
      random: () => 0.5,
      run: (reason) => a.engine.sync(reason),
    });
    server.fail("pull", "BEFORE");
    server.fail("pull", "BEFORE");
    const { createServiceEvent } = await import("../src");
    const { allDay } = await import("./helpers");
    await a.act((data, ctx) =>
      createServiceEvent(data, allDay("ANNUAL_LEAVE", "2026-10-01"), ctx),
    );
    scheduler.localChange();
    await timers.advance(2_000);
    expect(a.engine.getStatus().phase).toBe("OFFLINE");
    await timers.advance(5_000);
    expect(a.engine.getStatus().phase).toBe("OFFLINE");
    await timers.advance(15_000);
    expect(a.engine.getStatus().phase).toBe("IDLE");
    expect(
      server.rows("user-a").filter((row) => row.collection === "events"),
    ).toHaveLength(1);
    expect(timers.pendingCount).toBe(0);
  });
});
