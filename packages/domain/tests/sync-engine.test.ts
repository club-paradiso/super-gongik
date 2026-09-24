import { describe, expect, it } from "vitest";

import {
  STORAGE_KEYS,
  commitImport,
  createMemorySyncServer,
  createSyncEngine,
  createSyncStateStore,
  createServiceEvent,
  deleteServiceEvent,
  editProfile,
  importConsistencyIssues,
  newSyncState,
  parseBackup,
  planRestore,
  profileDigest,
  replaceUserData,
  rollbackImport,
  syncStateKey,
  updateServiceEvent,
  userDataSchema,
  type ServiceEvent,
  type UserData,
} from "../src";
import { fullDocument, largeDocument } from "./fixtures";
import { allDay, userDataWithProfile } from "./helpers";
import {
  clock,
  installation,
  mutex,
  recordCount,
  records,
} from "./sync-helpers";

const USER = "user-a";
const OTHER_USER = "user-b";

const addLeave =
  (date: string, note: string | null = null) =>
  (data: UserData, ctx: Parameters<typeof createServiceEvent>[2]) =>
    createServiceEvent(data, { ...allDay("ANNUAL_LEAVE", date), note }, ctx);

const editNote =
  (id: string, date: string, note: string) =>
  (data: UserData, ctx: Parameters<typeof updateServiceEvent>[3]) =>
    updateServiceEvent(
      data,
      id,
      { ...allDay("ANNUAL_LEAVE", date), note },
      ctx,
    );

const remove =
  (id: string) =>
  (data: UserData, ctx: Parameters<typeof deleteServiceEvent>[2]) =>
    deleteServiceEvent(data, id, ctx);

const eventOf = (data: UserData, id: string): ServiceEvent | undefined =>
  data.events.find((event) => event.id === id);

function expectValid(data: UserData) {
  expect(userDataSchema.safeParse(data).success).toBe(true);
  expect(importConsistencyIssues(data)).toEqual([]);
}

/** Phone A with a profile and one leave, synced; laptop B enabled after it. */
async function twoDevices() {
  const server = createMemorySyncServer();
  const a = await installation(server, "phone-a", {
    seed: userDataWithProfile(),
  }).load();
  const id = (await a.act(addLeave("2026-09-10", "처음"))).id;
  await a.enable(USER);
  const b = await installation(server, "laptop-b").load();
  const enabled = await b.enable(USER);
  expect(enabled.preview.case).toBe("DOWNLOAD");
  expect(records(b.data())).toEqual(records(a.data()));
  return { server, a, b, id };
}

describe("guest mode and enabling", () => {
  it("never calls the backend without an account or before sync is turned on", async () => {
    const server = createMemorySyncServer();
    const guest = await installation(server, "guest", {
      seed: userDataWithProfile(),
    }).load();
    await guest.act(addLeave("2026-09-01"));
    expect(server.calls).toEqual([]);

    // Signed in, but the user has not turned sync on: still no request.
    const engine = guest.signIn(USER);
    expect((await engine.init()).phase).toBe("DISABLED");
    expect((await engine.sync()).phase).toBe("DISABLED");
    guest.engine.notifyLocalChange();
    expect(server.calls).toEqual([]);
  });

  it("first sign-in with local-only data previews an upload, then uploads every record", async () => {
    const server = createMemorySyncServer();
    const a = await installation(server, "phone-a", {
      seed: fullDocument(),
    }).load();
    const engine = a.signIn(USER);
    const preview = await engine.previewEnable();
    expect(preview).toMatchObject({
      kind: "READY",
      case: "UPLOAD",
      remoteRecords: 0,
      conflicts: 0,
    });
    if (preview.kind !== "READY") throw new Error();
    expect(preview.uploads).toBe(recordCount(a.data()));
    // Preview changes nothing anywhere.
    expect(server.rows(USER)).toEqual([]);
    expect(await a.storage.getItem(syncStateKey(USER))).toBeNull();

    const before = a.data().documentRevision;
    const status = await engine.enable(preview);
    expect(status.phase).toBe("IDLE");
    expect(server.rows(USER)).toHaveLength(recordCount(a.data()));
    expect(server.account(USER)?.profileId).toBe(a.data().profile!.id);
    // Uploading does not rewrite the local document.
    expect(a.data().documentRevision).toBe(before);
  });

  it("first sign-in on a fresh device downloads the cloud copy", async () => {
    const server = createMemorySyncServer();
    const a = await installation(server, "phone-a", {
      seed: fullDocument(),
    }).load();
    await a.enable(USER);
    const b = await installation(server, "laptop-b").load();
    expect(b.data().profile).toBeNull();
    const { preview, status } = await b.enable(USER);
    expect(preview).toMatchObject({ case: "DOWNLOAD", uploads: 0 });
    expect(status.phase).toBe("IDLE");
    expect(records(b.data())).toEqual(records(a.data()));
    expectValid(b.data());
    // Record provenance travels; the installation keeps its own identity.
    expect(b.data().deviceId).not.toBe(a.data().deviceId);
    expect(b.data().events.map((event) => event.deviceId)).toEqual(
      a.data().events.map((event) => event.deviceId),
    );
  });

  it("local and remote holding identical data merge with no transfer", async () => {
    const server = createMemorySyncServer();
    const a = await installation(server, "phone-a", {
      seed: fullDocument(),
    }).load();
    await a.enable(USER);
    // B restored A's backup file before ever signing in.
    const b = await installation(server, "laptop-b", {
      seed: replaceUserData({ ...a.data(), deviceId: "laptop-b" }, a.data()),
    }).load();
    expect(b.data().deviceId).toBe("laptop-b");
    const lastSeq = server.account(USER)!.lastSeq;
    const { preview, status } = await b.enable(USER);
    expect(preview).toMatchObject({
      case: "MERGE",
      downloads: 0,
      uploads: 0,
      conflicts: 0,
    });
    expect(status.conflicts).toEqual([]);
    expect(server.account(USER)!.lastSeq).toBe(lastSeq);
  });

  it("both sides with different data merge by the causal rules and upload the difference", async () => {
    const server = createMemorySyncServer();
    const shared = userDataWithProfile();
    const a = await installation(server, "phone-a", { seed: shared }).load();
    await a.act(addLeave("2026-09-01", "A"));
    await a.enable(USER);
    const b = await installation(server, "laptop-b", { seed: shared }).load();
    await b.act(addLeave("2026-09-02", "B"));
    const { preview } = await b.enable(USER);
    expect(preview).toMatchObject({ case: "MERGE", downloads: 1, uploads: 1 });
    await a.engine.sync();
    expect(records(a.data())).toEqual(records(b.data()));
    expect(a.data().events).toHaveLength(2);
  });
});

describe("multi-device scenarios", () => {
  it("A: an edit on one device reaches the other", async () => {
    const { a, b, id } = await twoDevices();
    await a.act(editNote(id, "2026-09-10", "고침"));
    await a.engine.sync();
    const status = await b.engine.sync();
    expect(status.lastSummary).toMatchObject({ pulled: 1, pushed: 0 });
    expect(eventOf(b.data(), id)?.note).toBe("고침");
    expect(records(b.data())).toEqual(records(a.data()));
  });

  it("B: independent edits of one record become a structured conflict on both devices", async () => {
    const { a, b, id } = await twoDevices();
    await a.act(editNote(id, "2026-09-10", "A가 고침"));
    await b.act(editNote(id, "2026-09-10", "B가 고침"));
    await a.engine.sync();
    const bStatus = await b.engine.sync();
    expect(bStatus.conflicts).toHaveLength(1);
    expect(bStatus.conflicts[0]).toMatchObject({
      key: `events:${id}`,
      type: "EQUAL_VERSION_DIVERGENT",
      local: { revision: 2, deleted: false },
      incoming: { revision: 2, deleted: false },
    });
    // Nothing was picked: each side keeps its own version.
    expect(eventOf(b.data(), id)?.note).toBe("B가 고침");
    expect(eventOf(a.data(), id)?.note).toBe("A가 고침");
    // The conflict stays visible on later syncs, after the cursor moved on.
    expect((await b.engine.sync()).conflicts).toHaveLength(1);
    const cloud = bStatus.conflicts[0]!.cloudRecord as ServiceEvent;
    expect(cloud.note).toBe("A가 고침");
  });

  it("C: a stale live copy cannot resurrect a deletion", async () => {
    const { a, b, id } = await twoDevices();
    await a.act(remove(id));
    await a.engine.sync();
    // B never touched the record: it adopts the deletion.
    await b.engine.sync();
    expect(eventOf(b.data(), id)?.deletedAt).not.toBeNull();
    // Syncing again from either side changes nothing.
    await b.engine.sync();
    await a.engine.sync();
    expect(eventOf(a.data(), id)?.deletedAt).not.toBeNull();
    const liveAgain = [a, b].filter(
      (device) => eventOf(device.data(), id)?.deletedAt === null,
    );
    expect(liveAgain).toEqual([]);
  });

  it("C': a stale device's older live version is never pushed over a newer tombstone", async () => {
    const { server, a, b, id } = await twoDevices();
    b.signOut(); // B keeps its stale live copy while away.
    await a.act(remove(id));
    await a.engine.sync();
    const engine = b.signIn(USER);
    await engine.init();
    const status = await engine.sync();
    expect(status.conflicts).toEqual([]);
    const row = server.rows(USER).find((item) => item.recordId === id)!;
    expect((row.payload as ServiceEvent).deletedAt).not.toBeNull();
    expect(eventOf(b.data(), id)?.deletedAt).not.toBeNull();
  });

  it("D: deletion vs an independent newer-revision edit is a conflict, not a revision-size winner", async () => {
    const { a, b, id } = await twoDevices();
    await a.act(remove(id)); // rev 2 tombstone
    await b.act(editNote(id, "2026-09-10", "B1")); // rev 2
    await b.act(editNote(id, "2026-09-10", "B2")); // rev 3
    await a.engine.sync();
    const status = await b.engine.sync();
    expect(status.conflicts).toHaveLength(1);
    expect(status.conflicts[0]).toMatchObject({
      type: "CROSS_DEVICE_DIVERGENT",
      local: { revision: 3, deleted: false },
      incoming: { revision: 2, deleted: true },
    });
    expect(eventOf(b.data(), id)?.deletedAt).toBeNull();
    // A sees the same conflict from the other direction.
    const aStatus = await a.engine.sync();
    expect(aStatus.conflicts).toEqual([]); // B never pushed its branch
    expect(eventOf(a.data(), id)?.deletedAt).not.toBeNull();
  });

  it("E: a conflict resolved on one device converges and never reopens", async () => {
    const { server, a, b, id } = await twoDevices();
    await a.act(editNote(id, "2026-09-10", "A"));
    await b.act(editNote(id, "2026-09-10", "B"));
    await a.engine.sync();
    const open = await b.engine.sync();
    expect(open.conflicts).toHaveLength(1);

    const resolved = await b.engine.resolveConflicts({
      [open.conflicts[0]!.key]: "LOCAL",
    });
    expect(resolved.conflicts).toEqual([]);
    const settled = eventOf(b.data(), id)!;
    expect(settled).toMatchObject({
      note: "B",
      revision: 3,
      deviceId: b.data().deviceId,
      supersedes: { "phone-a": 2 },
    });
    // A still holds its old branch: it adopts the settled version.
    const aStatus = await a.engine.sync();
    expect(aStatus.conflicts).toEqual([]);
    expect(eventOf(a.data(), id)).toEqual(settled);

    // Re-fetching everything from scratch (old versions are gone, but the
    // settled one descends from both) reopens nothing.
    const state = JSON.parse((await b.storage.getItem(syncStateKey(USER)))!);
    await b.storage.setItem(
      syncStateKey(USER),
      JSON.stringify({ ...state, cursor: 0, shadow: {} }),
    );
    expect((await b.engine.sync()).conflicts).toEqual([]);
    // A's next edit builds on the settled version without a conflict.
    await a.act(editNote(id, "2026-09-10", "A2"));
    await a.engine.sync();
    expect((await b.engine.sync()).conflicts).toEqual([]);
    expect(eventOf(b.data(), id)?.note).toBe("A2");
    expect(server.rows(USER).filter((row) => row.recordId === id)).toHaveLength(
      1,
    );
  });

  it("F: unrelated offline records on both devices both survive", async () => {
    const { server, a, b } = await twoDevices();
    server.fail("pull", "BEFORE", USER);
    server.fail("pull", "BEFORE", USER);
    const fromA = await a.act(addLeave("2026-10-01", "A 오프라인"));
    const fromB = await b.act(addLeave("2026-10-02", "B 오프라인"));
    expect((await a.engine.sync()).phase).toBe("OFFLINE");
    expect((await b.engine.sync()).phase).toBe("OFFLINE");
    await a.engine.sync();
    await b.engine.sync();
    await a.engine.sync();
    for (const device of [a, b]) {
      expect(eventOf(device.data(), fromA.id)?.note).toBe("A 오프라인");
      expect(eventOf(device.data(), fromB.id)?.note).toBe("B 오프라인");
      expectValid(device.data());
    }
    expect(records(a.data())).toEqual(records(b.data()));
  });

  it("G: a push that fails before reaching the server is retried without duplicates", async () => {
    const { server, a, b } = await twoDevices();
    const created = await a.act(addLeave("2026-10-05"));
    server.fail("push", "BEFORE", USER);
    const failed = await a.engine.sync();
    expect(failed.phase).toBe("OFFLINE");
    expect(failed.error).toBe("NETWORK");
    expect(server.rows(USER).some((row) => row.recordId === created.id)).toBe(
      false,
    );
    // Local data is untouched by the failure.
    expect(eventOf(a.data(), created.id)).toBeDefined();
    expect((await a.engine.sync()).phase).toBe("IDLE");
    expect(
      server.rows(USER).filter((row) => row.recordId === created.id),
    ).toHaveLength(1);
    await b.engine.sync();
    expect(eventOf(b.data(), created.id)).toBeDefined();
  });

  it("H: a push accepted by the server whose response was lost is retried idempotently", async () => {
    const { server, a, b } = await twoDevices();
    const created = await a.act(addLeave("2026-10-06"));
    server.fail("push", "AFTER_COMMIT", USER);
    expect((await a.engine.sync()).phase).toBe("OFFLINE");
    // The server has it, the client does not know yet.
    const seq = server.account(USER)!.lastSeq;
    const retry = await a.engine.sync();
    expect(retry.phase).toBe("IDLE");
    expect(retry.lastSummary?.pushed).toBe(0);
    expect(server.account(USER)!.lastSeq).toBe(seq);
    expect(
      server.rows(USER).filter((row) => row.recordId === created.id),
    ).toHaveLength(1);
    // And the next sync is a no-op.
    const again = await a.engine.sync();
    expect(again.lastSummary).toMatchObject({ pulled: 0, pushed: 0 });
    await b.engine.sync();
    expect(records(b.data())).toEqual(records(a.data()));
  });

  it("I: signing out while changes are pending deletes nothing, and they sync after signing in", async () => {
    const { server, a, b } = await twoDevices();
    const created = await a.act(addLeave("2026-10-07", "대기 중"));
    const stored = await a.storage.getItem(STORAGE_KEYS.current);
    a.signOut();
    expect(await a.storage.getItem(STORAGE_KEYS.current)).toBe(stored);
    expect(eventOf(a.data(), created.id)).toBeDefined();
    expect(server.rows(USER).some((row) => row.recordId === created.id)).toBe(
      false,
    );
    // Signing in again resumes from the kept checkpoint.
    const engine = a.signIn(USER);
    expect((await engine.init()).phase).toBe("IDLE");
    await engine.sync();
    await b.engine.sync();
    expect(eventOf(b.data(), created.id)?.note).toBe("대기 중");
  });

  it("J: two tabs of one browser and two other devices converge", async () => {
    const server = createMemorySyncServer();
    const time = clock();
    const dataLock = mutex();
    const syncLock = mutex();
    const tab1 = await installation(server, "phone-a", {
      seed: userDataWithProfile(),
      dataLock,
      syncLock,
      time,
    }).load();
    const tab2 = await installation(server, "phone-a", {
      storage: tab1.storage,
      dataLock,
      syncLock,
      time,
    }).load();
    await tab1.enable(USER);
    tab2.signIn(USER);
    await tab2.engine.init();
    const b = await installation(server, "laptop-b").load();
    await b.enable(USER);
    const c = await installation(server, "tablet-c").load();
    await c.enable(USER);

    // Everyone writes at once; both tabs sync concurrently.
    const writes = await Promise.all([
      tab1.act(addLeave("2026-11-01", "tab1")),
      tab2.act(addLeave("2026-11-02", "tab2")),
      b.act(addLeave("2026-11-03", "b")),
      c.act(addLeave("2026-11-04", "c")),
    ]);
    await Promise.all([
      tab1.engine.sync(),
      tab2.engine.sync(),
      b.engine.sync(),
      c.engine.sync(),
    ]);
    for (let round = 0; round < 2; round += 1) {
      for (const device of [tab1, b, c]) await device.engine.sync();
    }
    await tab2.store.refresh();
    const expected = records(tab1.data());
    for (const device of [tab2, b, c]) {
      expect(records(device.data())).toEqual(expected);
    }
    for (const write of writes) {
      expect(eventOf(tab1.data(), write.id)).toBeDefined();
    }
    // Tabs share one installation identity.
    expect(tab2.data().deviceId).toBe(tab1.data().deviceId);
    expect(
      server.rows(USER).filter((row) => row.collection === "events"),
    ).toHaveLength(4);
  });
});

describe("failures, validation and idempotency", () => {
  it("a failed pull changes nothing locally and keeps the checkpoint", async () => {
    const { server, b } = await twoDevices();
    const before = await b.storage.getItem(STORAGE_KEYS.current);
    const state = await b.storage.getItem(syncStateKey(USER));
    server.fail("pull", "BEFORE", USER);
    const status = await b.engine.sync();
    expect(status).toMatchObject({ phase: "OFFLINE", error: "NETWORK" });
    expect(await b.storage.getItem(STORAGE_KEYS.current)).toBe(before);
    expect(await b.storage.getItem(syncStateKey(USER))).toBe(state);
  });

  it("offline edits are saved locally at once and synced on reconnect", async () => {
    const { server, a, b } = await twoDevices();
    server.fail("pull", "BEFORE", USER);
    server.fail("pull", "BEFORE", USER);
    const first = await a.act(addLeave("2026-10-10"));
    expect(eventOf(a.data(), first.id)).toBeDefined();
    expect((await a.engine.sync()).phase).toBe("OFFLINE");
    const second = await a.act(addLeave("2026-10-11"));
    expect((await a.engine.sync()).phase).toBe("OFFLINE");
    expect(a.engine.getStatus().dirty).toBe(true);
    const online = await a.engine.sync();
    expect(online).toMatchObject({ phase: "IDLE" });
    expect(online.lastSummary?.pushed).toBe(2);
    await b.engine.sync();
    expect(eventOf(b.data(), first.id)).toBeDefined();
    expect(eventOf(b.data(), second.id)).toBeDefined();
  });

  it("repeating a push request is idempotent at the transport level", async () => {
    const server = createMemorySyncServer();
    const transport = server.transport(USER);
    const account = await transport.ensureAccount();
    const profile = userDataWithProfile().profile!;
    const request = {
      generation: account.generation,
      deviceId: "phone-a",
      items: [
        {
          collection: "profile",
          recordId: profile.id,
          baseSeq: null,
          schemaVersion: 3,
          payload: JSON.parse(JSON.stringify(profile)),
        },
      ],
    };
    const first = await transport.push(request);
    const second = await transport.push(request);
    expect(first).toMatchObject({
      kind: "OK",
      results: [{ status: "APPLIED", seq: 1 }],
    });
    expect(second).toMatchObject({
      kind: "OK",
      results: [{ status: "UNCHANGED", seq: 1 }],
    });
    expect(server.rows(USER)).toHaveLength(1);
    // A different payload on a stale base is refused, not applied.
    const stale = await transport.push({
      ...request,
      items: [
        {
          ...request.items[0]!,
          payload: {
            ...request.items[0]!.payload,
            updatedAt: "2026-09-25T00:00:00.000Z",
          },
        },
      ],
    });
    expect(stale).toMatchObject({
      kind: "OK",
      results: [{ status: "STALE", seq: 1 }],
    });
  });

  it("a remote change landing between pull and push is never overwritten", async () => {
    const { server, a, b, id } = await twoDevices();
    await a.act(editNote(id, "2026-09-10", "A"));
    await b.act(editNote(id, "2026-09-10", "B"));
    // A pulls, then B pushes before A's push arrives: A's base is stale.
    const base = server.transport(USER);
    let interleave: (() => Promise<unknown>) | null = () => b.engine.sync();
    const engine = createSyncEngine({
      userId: USER,
      store: a.store,
      state: createSyncStateStore(a.storage, USER),
      transport: {
        ...base,
        async push(request) {
          if (interleave) {
            const run = interleave;
            interleave = null;
            await run();
          }
          return base.push(request);
        },
      },
    });
    const status = await engine.sync();
    expect(status.lastSummary?.rounds).toBe(2);
    expect(status.conflicts).toHaveLength(1);
    expect(eventOf(a.data(), id)?.note).toBe("A");
    const row = server.rows(USER).find((item) => item.recordId === id)!;
    expect((row.payload as ServiceEvent).note).toBe("B");
  });

  it("an invalid remote payload blocks the merge without touching local data or leaking content", async () => {
    const { server, a, b, id } = await twoDevices();
    await a.act(editNote(id, "2026-09-10", "비밀 메모 123"));
    await a.engine.sync();
    const row = server.rows(USER).find((item) => item.recordId === id)!;
    server.tamper(USER, `events:${id}`, {
      ...(row.payload as object),
      revision: "not-a-number",
    });
    const before = await b.storage.getItem(STORAGE_KEYS.current);
    const cursor = JSON.parse(
      (await b.storage.getItem(syncStateKey(USER)))!,
    ).cursor;
    const status = await b.engine.sync();
    expect(status.phase).toBe("BLOCKED");
    expect(status.block).toMatchObject({
      reason: "REMOTE_INVALID",
      issues: [
        { key: `events:${id}`, code: "INVALID_RECORD", path: "revision" },
      ],
    });
    expect(await b.storage.getItem(STORAGE_KEYS.current)).toBe(before);
    expect(
      JSON.parse((await b.storage.getItem(syncStateKey(USER)))!).cursor,
    ).toBe(cursor);
    expect(JSON.stringify(status)).not.toContain("비밀 메모");
    expect(JSON.stringify(b.diagnostics)).not.toContain("비밀 메모");
  });

  it("a row whose id does not match its payload, or from a newer schema, is refused", async () => {
    const { server, b, id } = await twoDevices();
    const row = server.rows(USER).find((item) => item.recordId === id)!;
    server.tamper(USER, "events:someone-else", row.payload);
    expect((await b.engine.sync()).block).toMatchObject({
      reason: "REMOTE_INVALID",
      issues: [{ code: "ID_MISMATCH" }],
    });
    const server2 = await twoDevices();
    server2.server.tamper(USER, `events:${server2.id}`, row.payload, 4);
    expect((await server2.b.engine.sync()).block).toEqual({
      reason: "REMOTE_NEWER_SCHEMA",
    });
  });

  it("repeated sync after convergence is a no-op everywhere", async () => {
    const { server, a, b } = await twoDevices();
    await a.act(addLeave("2026-10-12"));
    await a.engine.sync();
    await b.engine.sync();
    const seq = server.account(USER)!.lastSeq;
    const revisions = [a.data().documentRevision, b.data().documentRevision];
    for (let i = 0; i < 3; i += 1) {
      for (const device of [a, b]) {
        const status = await device.engine.sync();
        expect(status.lastSummary).toMatchObject({ pulled: 0, pushed: 0 });
      }
    }
    expect(server.account(USER)!.lastSeq).toBe(seq);
    expect([a.data().documentRevision, b.data().documentRevision]).toEqual(
      revisions,
    );
  });

  it("tombstones stay on the server so a device offline for a long time still learns of a deletion", async () => {
    const { server, a, b, id } = await twoDevices();
    b.signOut(); // B goes away for a long time.
    await a.act(remove(id));
    for (let i = 0; i < 30; i += 1)
      await a.act(addLeave(`2027-01-${String(i + 1).padStart(2, "0")}`));
    await a.engine.sync();
    const engine = b.signIn(USER);
    await engine.init();
    await engine.sync();
    expect(eventOf(b.data(), id)?.deletedAt).not.toBeNull();
    expect(
      b.data().events.filter((event) => event.deletedAt === null),
    ).toHaveLength(30);
    // A brand-new device receives the tombstone as history, too.
    const c = await installation(server, "tablet-c").load();
    await c.enable(USER);
    expect(eventOf(c.data(), id)?.deletedAt).not.toBeNull();
  });

  it("unauthenticated transport calls fail with AUTH and the engine blocks for sign-in", async () => {
    const server = createMemorySyncServer();
    await expect(server.transport(null).ensureAccount()).rejects.toMatchObject({
      category: "AUTH",
    });
    const a = await installation(server, "phone-a", {
      seed: userDataWithProfile(),
    }).load();
    await a.enable(USER);
    // Session lost: the same checkpoint, a transport with no user.
    const engine = createSyncEngine({
      userId: USER,
      store: a.store,
      transport: server.transport(null),
      state: createSyncStateStore(a.storage, USER),
    });
    expect(await engine.sync()).toMatchObject({
      phase: "BLOCKED",
      block: { reason: "AUTH" },
    });
  });

  it("one account never sees another account's rows", async () => {
    const server = createMemorySyncServer();
    const a = await installation(server, "phone-a", {
      seed: fullDocument(),
    }).load();
    await a.enable(USER);
    const other = server.transport(OTHER_USER);
    const account = await other.ensureAccount();
    const pulled = await other.pull({
      generation: account.generation,
      afterSeq: 0,
      limit: 1000,
    });
    expect(pulled).toMatchObject({ kind: "OK", rows: [] });
    expect(await other.listBackups()).toEqual([]);
  });
});

describe("profiles and accounts", () => {
  it("signing into an account that holds a different person's profile fails closed", async () => {
    const server = createMemorySyncServer();
    const a = await installation(server, "phone-a", {
      seed: fullDocument(),
    }).load();
    await a.enable(USER);
    // A different person: a different profile id.
    const person = userDataWithProfile({ callUpDate: "2025-01-06" });
    const stranger = await installation(server, "other-phone", {
      seed: {
        ...person,
        profile: {
          ...person.profile!,
          id: "profile-2",
          localProfileId: "profile-2",
        },
      },
    }).load();
    const engine = stranger.signIn(USER);
    const preview = await engine.previewEnable();
    expect(preview).toMatchObject({ kind: "PROFILE_MISMATCH" });
    expect(await engine.enable(preview)).toMatchObject({ phase: "DISABLED" });
    expect(server.rows(USER)).toHaveLength(recordCount(a.data()));

    // Even a forged checkpoint cannot push the other profile.
    await createSyncStateStore(stranger.storage, USER).save(
      newSyncState({
        userId: USER,
        generation: 1,
        now: "2026-09-24T00:00:00.000Z",
      }),
    );
    const status = await engine.sync();
    expect(status).toMatchObject({
      phase: "BLOCKED",
      block: { reason: "PROFILE_MISMATCH" },
    });
    expect(stranger.data().profile!.id).toBe("profile-2");
    expect(server.rows(USER)).toHaveLength(recordCount(a.data()));
  });

  it("profile edits sync by digest ancestry; concurrent edits conflict and resolve", async () => {
    const { server, a, b } = await twoDevices();
    const input = (cost: number) => {
      const profile = a.data().profile!;
      return {
        callUpDate: profile.callUpDate,
        expectedDischargeDate: profile.expectedDischargeDate,
        serviceCategory: profile.serviceCategory,
        workplaceType: profile.workplaceType,
        defaultCommuteCost: cost,
        defaultMealAllowanceOverride: profile.defaultMealAllowanceOverride,
        timezone: profile.timezone,
      };
    };
    await a.act((data, ctx) => editProfile(data, input(3000), ctx));
    await a.engine.sync();
    await b.engine.sync();
    expect(b.data().profile!.defaultCommuteCost).toBe(3000);

    await a.act((data, ctx) => editProfile(data, input(4000), ctx));
    await b.act((data, ctx) => editProfile(data, input(5000), ctx));
    await a.engine.sync();
    const open = await b.engine.sync();
    expect(open.conflicts).toMatchObject([
      { collection: "profile", type: "UNVERSIONED_DIVERGENT" },
    ]);
    await b.engine.resolveConflicts({ [open.conflicts[0]!.key]: "INCOMING" });
    expect(b.data().profile!.defaultCommuteCost).toBe(4000);
    expect((await a.engine.sync()).conflicts).toEqual([]);
    // Same content on both; write metadata may differ and is never pushed
    // back and forth.
    expect(profileDigest(a.data().profile!)).toBe(
      profileDigest(b.data().profile!),
    );
    const seq = server.account(USER)!.lastSeq;
    await a.engine.sync();
    await b.engine.sync();
    expect(server.account(USER)!.lastSeq).toBe(seq);
  });
});

describe("cloud reset and stale devices", () => {
  it("deleting cloud data blocks a stale device from pushing until its user decides", async () => {
    const { server, a, b } = await twoDevices();
    const reset = await a.engine.deleteCloudData();
    expect(reset).toMatchObject({ ok: true, account: { generation: 2 } });
    expect(server.rows(USER)).toEqual([]);
    expect(a.engine.getStatus().phase).toBe("DISABLED");
    // A's local data is untouched.
    expect(a.data().events).toHaveLength(1);
    // A does not re-upload on its own.
    expect((await a.engine.sync()).phase).toBe("DISABLED");
    expect(server.rows(USER)).toEqual([]);

    // B was offline and edited meanwhile.
    const offline = await b.act(addLeave("2026-10-20", "stale"));
    const status = await b.engine.sync();
    expect(status).toMatchObject({
      phase: "BLOCKED",
      block: { reason: "GENERATION_MISMATCH", account: { generation: 2 } },
    });
    expect(server.rows(USER)).toEqual([]);
    expect(eventOf(b.data(), offline.id)).toBeDefined(); // not erased
    // Retrying does not change that.
    expect((await b.engine.sync()).phase).toBe("BLOCKED");
    expect(server.rows(USER)).toEqual([]);

    // Explicit decision: start syncing this device's data into the new generation.
    const preview = await b.engine.previewEnable();
    expect(preview).toMatchObject({
      kind: "READY",
      case: "UPLOAD",
      account: { generation: 2 },
    });
    await b.engine.enable(preview);
    expect(server.rows(USER).some((row) => row.recordId === offline.id)).toBe(
      true,
    );
  });

  it("a stale direct push or backup upload with the old generation is refused by the server", async () => {
    const { server, a } = await twoDevices();
    const transport = server.transport(USER);
    await a.engine.deleteCloudData();
    const push = await transport.push({
      generation: 1,
      deviceId: "phone-a",
      items: [],
    });
    expect(push.kind).toBe("GENERATION_MISMATCH");
    const upload = await transport.uploadBackup({
      generation: 1,
      text: "{}",
      exportedAt: "2026-09-24T00:00:00.000Z",
      schemaVersion: 3,
      formatVersion: 2,
      digest: null,
    });
    expect(upload.kind).toBe("GENERATION_MISMATCH");
    // A second reset with an outdated expectation is refused too.
    expect((await transport.resetCloud({ expectedGeneration: 1 })).kind).toBe(
      "GENERATION_MISMATCH",
    );
  });

  it("deleting local data turns sync off on that device instead of re-downloading silently", async () => {
    const { a } = await twoDevices();
    await a.store.wipeAll();
    expect(a.data().events).toEqual([]);
    const engine = a.signIn(USER);
    expect((await engine.init()).phase).toBe("DISABLED");
    expect((await engine.sync()).phase).toBe("DISABLED");
    expect(a.data().profile).toBeNull();
  });
});

describe("imports and derived state", () => {
  it("rolling back an import on one device rolls it back on the other, without oscillation", async () => {
    const server = createMemorySyncServer();
    const a = await installation(server, "phone-a", {
      seed: fullDocument(),
    }).load();
    await a.enable(USER);
    const b = await installation(server, "laptop-b").load();
    await b.enable(USER);
    await a.act((data, ctx) => rollbackImport(data, "batch-active", ctx));
    await a.engine.sync();
    await b.engine.sync();
    const batch = b.data().imports.find((item) => item.id === "batch-active")!;
    expect(batch.status).toBe("ROLLED_BACK");
    expectValid(b.data());
    const seq = server.account(USER)!.lastSeq;
    for (let i = 0; i < 3; i += 1) {
      await a.engine.sync();
      await b.engine.sync();
    }
    expect(server.account(USER)!.lastSeq).toBe(seq);
    expect(records(a.data())).toEqual(records(b.data()));
  });
});

describe("cloud backup", () => {
  it("uploads an immutable backup-v2 file that restores through the normal preview", async () => {
    const { a, b } = await twoDevices();
    const uploaded = await a.engine.uploadBackup();
    expect(uploaded.kind).toBe("OK");
    if (uploaded.kind !== "OK") throw new Error();
    const list = await b.engine.listBackups();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ formatVersion: 2, schemaVersion: 3 });
    const text = await b.engine.downloadBackup(list[0]!.id);
    const parsed = parseBackup(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error();
    expect(parsed.info.integrity).toBe("VERIFIED");
    const plan = planRestore(b.data(), parsed.data, {
      mode: "MERGE",
      now: "2026-09-24T10:00:00.000Z",
      deviceId: b.data().deviceId,
    });
    expect(plan.blocked).toBeNull();
    expect(plan.conflicts).toEqual([]);
    // Restoring keeps this installation's identity.
    const replaced = replaceUserData(b.data(), parsed.data);
    expect(replaced.deviceId).toBe(b.data().deviceId);
    expect(replaced.events[0]!.deviceId).toBe("phone-a");
  });
});

describe("snapshot-only import batches", () => {
  it("a rollback of a batch that only holds snapshots travels to other devices", async () => {
    const server = createMemorySyncServer();
    const a = await installation(server, "phone-a", {
      seed: userDataWithProfile(),
    }).load();
    await a.act((data, ctx) =>
      commitImport(
        data,
        {
          batch: {
            id: "batch-snapshots",
            fileName: "balance.csv",
            sourceFormat: "CSV",
            fileSha256: null,
            createdAt: "2026-09-01T00:00:00.000Z",
          },
          drafts: [],
          snapshots: [
            {
              leaveType: "ANNUAL_LEAVE",
              asOfDate: "2026-06-30",
              grantedDays: 15,
              grantedMinutes: null,
              usedDays: 1,
              usedMinutes: null,
              remainingDays: 14,
              remainingMinutes: 0,
              confidence: 1,
              sourceRowIndex: 3,
            },
          ],
        },
        ctx,
      ),
    );
    await a.enable(USER);
    const b = await installation(server, "laptop-b").load();
    await b.enable(USER);
    expect(
      b.data().leaveSnapshots.filter((item) => item.deletedAt === null),
    ).toHaveLength(1);

    await a.act((data, ctx) => rollbackImport(data, "batch-snapshots", ctx));
    await a.engine.sync();
    await b.engine.sync();
    expect(
      b.data().leaveSnapshots.every((item) => item.deletedAt !== null),
    ).toBe(true);
    expect(b.data().imports[0]!.status).toBe("ROLLED_BACK");
    expectValid(b.data());
    const seq = server.account(USER)!.lastSeq;
    for (let i = 0; i < 3; i += 1) {
      await b.engine.sync();
      await a.engine.sync();
    }
    expect(server.account(USER)!.lastSeq).toBe(seq);
  });
});

describe("scale (indicative timings, not an SLA)", () => {
  it("syncs a 3,000-event history, then sends only what changed", async () => {
    const server = createMemorySyncServer();
    const a = await installation(server, "phone-a", {
      seed: largeDocument(3_000),
    }).load();
    const total = recordCount(a.data());
    let started = performance.now();
    await a.enable(USER);
    const upload = performance.now() - started;
    expect(server.rows(USER)).toHaveLength(total);

    const b = await installation(server, "laptop-b").load();
    started = performance.now();
    await b.enable(USER);
    const download = performance.now() - started;
    expect(records(b.data())).toEqual(records(a.data()));

    const id = a
      .data()
      .events.slice(1_500)
      .find((event) => event.deletedAt === null)!.id;
    await a.act(remove(id));
    started = performance.now();
    const pushed = await a.engine.sync();
    const incremental = performance.now() - started;
    expect(pushed.lastSummary).toMatchObject({ pushed: 1 });
    const pulled = await b.engine.sync();
    expect(pulled.lastSummary).toMatchObject({ pulled: 1, pushed: 0 });
    expect(eventOf(b.data(), id)?.deletedAt).not.toBeNull();
    // Generous bound only to catch accidental quadratic behaviour.
    expect(upload + download + incremental).toBeLessThan(30_000);
    console.info(
      `[sync scale] ${total} records: first upload ${Math.round(upload)} ms, ` +
        `first download ${Math.round(download)} ms, one-change sync ${Math.round(incremental)} ms`,
    );
  });
});

describe("restores while sync is on", () => {
  it("a REPLACE with an old backup does not push old versions over newer cloud ones", async () => {
    const { server, a, b, id } = await twoDevices();
    const oldBackup = a.data();
    await a.act(editNote(id, "2026-09-10", "newer"));
    await a.engine.sync();
    await b.engine.sync();
    // B restores the old copy with REPLACE (explicit and destructive).
    const restored = await b.store.restore(oldBackup, {
      mode: "REPLACE",
      expectedDocumentRevision: b.data().documentRevision,
      confirmDestructive: true,
    });
    expect(restored.ok).toBe(true);
    expect(eventOf(b.data(), id)?.note).toBe("처음");
    await b.engine.requestFullResync();
    const status = await b.engine.sync();
    expect(status.conflicts).toEqual([]);
    // The newer cloud version descends from the restored one: it comes back.
    expect(eventOf(b.data(), id)?.note).toBe("newer");
    const row = server.rows(USER).find((item) => item.recordId === id)!;
    expect((row.payload as ServiceEvent).note).toBe("newer");
  });
});

describe("records with the same content under different ids", () => {
  const note =
    (text: string) =>
    (data: UserData, ctx: Parameters<typeof createServiceEvent>[2]) =>
      createServiceEvent(
        data,
        { ...allDay("USER_NOTE", "2026-09-30"), note: text },
        ctx,
      );

  it("two distinct same-day notes both reach every device (ids are never collapsed)", async () => {
    const { a, b } = await twoDevices();
    const first = await a.act(note("첫 메모"));
    const second = await a.act(note("둘째 메모"));
    await a.engine.sync();
    const status = await b.engine.sync();
    expect(status.held).toEqual([]);
    expect(eventOf(b.data(), first.id)?.note).toBe("첫 메모");
    expect(eventOf(b.data(), second.id)?.note).toBe("둘째 메모");
    expect(records(b.data())).toEqual(records(a.data()));
  });

  it("the same leave entered on two devices is held on both, then applies once one copy is deleted", async () => {
    const { a, b } = await twoDevices();
    const onA = await a.act(addLeave("2026-10-01"));
    const onB = await b.act(addLeave("2026-10-01"));
    await a.engine.sync();
    const bStatus = await b.engine.sync();
    expect(bStatus.held).toMatchObject([
      { key: `events:${onA.id}`, reason: "LEAVE_OVERLAP" },
    ]);
    expect((bStatus.held[0]!.cloudRecord as ServiceEvent).startDate).toBe(
      "2026-10-01",
    );
    const aStatus = await a.engine.sync();
    expect(aStatus.held).toMatchObject([{ key: `events:${onB.id}` }]);
    // Neither device double-charges the leave.
    for (const device of [a, b]) {
      expect(
        device
          .data()
          .events.filter(
            (event) =>
              event.startDate === "2026-10-01" && event.deletedAt === null,
          ),
      ).toHaveLength(1);
    }
    // Still held on the next run (retried, not forgotten).
    expect((await b.engine.sync()).held).toHaveLength(1);

    // The user removes B's copy: everything converges on A's record.
    await b.act(remove(onB.id));
    expect((await b.engine.sync()).held).toEqual([]);
    expect((await a.engine.sync()).held).toEqual([]);
    expect(records(a.data())).toEqual(records(b.data()));
    expect(eventOf(b.data(), onA.id)?.deletedAt).toBeNull();
    expect(eventOf(a.data(), onB.id)?.deletedAt).not.toBeNull();
  });
});

describe("push rule (never overwrite a newer or concurrent cloud version)", () => {
  it("sends only records the cloud lacks or that descend from the cloud copy", async () => {
    const { planPush, shadowEntryFor } = await import("../src");
    const { base, id } = await (async () => {
      const created = userDataWithProfile();
      const result = createServiceEvent(
        created,
        allDay("ANNUAL_LEAVE", "2026-09-10"),
        {
          now: "2026-09-01T00:00:00.000Z",
          deviceId: "phone-a",
          createId: () => "event-1",
        },
      );
      if (!result.ok) throw new Error();
      return { base: result.data, id: result.value.id };
    })();
    const ctx = (deviceId: string) => ({
      now: "2026-09-02T00:00:00.000Z",
      deviceId,
      createId: () => "unused",
    });
    const edited = (data: UserData, deviceId: string, note: string) => {
      const result = updateServiceEvent(
        data,
        id,
        { ...allDay("ANNUAL_LEAVE", "2026-09-10"), note },
        ctx(deviceId),
      );
      if (!result.ok) throw new Error();
      return result.data;
    };
    const shadowOf = (data: UserData) => ({
      [`events:${id}`]: shadowEntryFor("events", eventOf(data, id)!, 7),
      [`profile:${data.profile!.id}`]: shadowEntryFor(
        "profile",
        data.profile!,
        1,
      ),
    });
    const keys = (data: UserData, shadow: ReturnType<typeof shadowOf>) =>
      planPush({ data, shadow, conflicted: new Set() }).map(
        (item) => `${item.collection}:${item.recordId}@${item.baseSeq}`,
      );

    const newer = edited(base, "phone-a", "newer");
    // Local descends from the cloud copy: pushed, conditioned on seq 7.
    expect(keys(newer, shadowOf(base))).toEqual([`events:${id}@7`]);
    // Cloud is newer than local (e.g. after a REPLACE): nothing is pushed.
    expect(keys(base, shadowOf(newer))).toEqual([]);
    // Concurrent versions: nothing is pushed.
    expect(keys(edited(base, "laptop-b", "B"), shadowOf(newer))).toEqual([]);
    // Same content: nothing to push.
    expect(keys(base, shadowOf(base))).toEqual([]);
    // Unknown to the cloud: pushed with no base.
    expect(keys(base, {})).toEqual([
      `profile:${base.profile!.id}@null`,
      `events:${id}@null`,
    ]);
    // Open conflicts are never pushed; explicit resolutions are.
    expect(
      planPush({
        data: newer,
        shadow: shadowOf(base),
        conflicted: new Set([`events:${id}`]),
      }),
    ).toEqual([]);
    expect(
      planPush({
        data: edited(base, "laptop-b", "B"),
        shadow: shadowOf(newer),
        conflicted: new Set(),
        forced: new Set([`events:${id}`]),
      }).map((item) => item.recordId),
    ).toEqual([id]);
  });

  it("a REPLACE restore without a full re-sync still never pushes the older versions", async () => {
    const { server, a, b, id } = await twoDevices();
    const oldBackup = a.data();
    await a.act(editNote(id, "2026-09-10", "newer"));
    await a.engine.sync();
    await b.engine.sync();
    const restored = await b.store.restore(oldBackup, {
      mode: "REPLACE",
      expectedDocumentRevision: b.data().documentRevision,
      confirmDestructive: true,
    });
    expect(restored.ok).toBe(true);
    const status = await b.engine.sync();
    expect(status.lastSummary?.pushed).toBe(0);
    const row = server.rows(USER).find((item) => item.recordId === id)!;
    expect((row.payload as ServiceEvent).note).toBe("newer");
  });
});
