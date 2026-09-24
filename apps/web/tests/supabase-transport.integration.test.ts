import { createHmac } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import {
  STORAGE_KEYS,
  buildServiceProfile,
  canonicalJson,
  createEmptyUserData,
  createMemoryStorage,
  createServiceEvent,
  createSyncEngine,
  createSyncStateStore,
  createUserDataRepository,
  createUserDataStore,
  parseBackup,
  saveAttendanceMonth,
  updateServiceEvent,
  type CommandContext,
  type CommandResult,
  type ServiceEventDraft,
  type UserData,
} from "@super-gongik/domain";

import {
  categorize,
  createSupabaseTransport,
} from "../src/lib/sync/supabase-transport";

/**
 * End-to-end against a real PostgREST + PostgreSQL with the migrations and
 * RLS applied: supabase-js → HTTP → SQL functions → policies. Auth is the
 * only part simulated: tokens are signed locally with the test JWT secret,
 * exactly as Supabase Auth would sign them.
 *
 * Opt-in (skipped by `pnpm test`): run through
 * `supabase/tests/run-integration.sh`, which starts the stack and sets
 *   SUPER_GONGIK_IT_REST_URL, SUPER_GONGIK_IT_JWT_SECRET,
 *   SUPER_GONGIK_IT_USERS (comma-separated auth.users ids).
 */
const REST_URL = process.env.SUPER_GONGIK_IT_REST_URL;
const SECRET = process.env.SUPER_GONGIK_IT_JWT_SECRET;
const USERS = (process.env.SUPER_GONGIK_IT_USERS ?? "").split(",");
const enabled = Boolean(REST_URL && SECRET && USERS.length >= 4);

function sign(claims: Record<string, unknown>) {
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  const body = `${encode({ alg: "HS256", typ: "JWT" })}.${encode(claims)}`;
  const signature = createHmac("sha256", SECRET!)
    .update(body)
    .digest("base64url");
  return `${body}.${signature}`;
}

const exp = () => Math.floor(Date.now() / 1000) + 3600;
const anonKey = () => sign({ role: "anon", exp: exp() });

type FetchHook = (url: string) => "PASS" | "FAIL_BEFORE" | "LOSE_RESPONSE";

/** supabase-js client acting as `userId` (or anonymous). */
function client(userId: string | null, hook?: FetchHook) {
  return createClient("http://supabase.test", anonKey(), {
    accessToken: userId
      ? async () =>
          sign({
            sub: userId,
            role: "authenticated",
            aud: "authenticated",
            exp: exp(),
          })
      : undefined,
    global: {
      // PostgREST serves at its root; Supabase puts it under /rest/v1.
      fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input instanceof Request ? input.url : input);
        const target = url.replace("http://supabase.test/rest/v1", REST_URL!);
        const decision = hook?.(target) ?? "PASS";
        if (decision === "FAIL_BEFORE") throw new TypeError("fetch failed");
        const response = await fetch(target, init);
        if (decision === "LOSE_RESPONSE") {
          await response.arrayBuffer();
          throw new TypeError("network connection lost");
        }
        return response;
      },
    },
  });
}

function device(
  name: string,
  userId: string,
  hook?: FetchHook,
  seed?: UserData,
) {
  const storage = createMemoryStorage(
    seed
      ? {
          [STORAGE_KEYS.current]: JSON.stringify({ ...seed, deviceId: name }),
        }
      : {},
  );
  let n = 0;
  const createId = () => `${name}-${Date.now()}-${++n}`;
  const store = createUserDataStore({
    repository: createUserDataRepository(storage, {
      now: () => new Date().toISOString(),
      createId,
    }),
    createId,
  });
  const engine = createSyncEngine({
    userId,
    store,
    transport: createSupabaseTransport(client(userId, hook)),
    state: createSyncStateStore(storage, userId),
  });
  return {
    store,
    engine,
    data() {
      const snapshot = store.getSnapshot();
      if (snapshot.phase !== "READY") throw new Error("not loaded");
      return snapshot.data;
    },
    async act<T>(
      command: (data: UserData, ctx: CommandContext) => CommandResult<T>,
    ) {
      const result = await store.run(command);
      if (!result.ok) throw new Error(JSON.stringify(result.errors));
      return result.value;
    },
    async enable() {
      await store.load();
      await engine.init();
      const preview = await engine.previewEnable();
      if (preview.kind !== "READY") throw new Error(preview.kind);
      const result = await engine.enable(preview);
      if (result.kind !== "ENABLED") throw new Error(result.kind);
      return { preview, status: result.status };
    },
  };
}

const leave = (
  date: string,
  note: string | null = null,
): ServiceEventDraft => ({
  eventType: "ANNUAL_LEAVE",
  startDate: date as ServiceEventDraft["startDate"],
  endDate: date as ServiceEventDraft["endDate"],
  timing: { kind: "ALL_DAY", dayCount: 1 },
  title: null,
  note,
});

function seedDocument(profileId: string): UserData {
  const profile = buildServiceProfile(
    {
      callUpDate: "2026-05-04",
      expectedDischargeDate: "2028-02-03",
      serviceCategory: null,
      workplaceType: null,
      defaultCommuteCost: null,
      defaultMealAllowanceOverride: null,
      timezone: "Asia/Seoul",
    },
    {
      id: profileId,
      localProfileId: profileId,
      timestamp: "2026-05-04T00:00:00.000Z",
    },
  );
  return { ...createEmptyUserData("seed"), profile };
}

const records = (data: UserData) =>
  canonicalJson({
    profile: data.profile,
    events: [...data.events].sort((a, b) => a.id.localeCompare(b.id)),
    attendanceMonths: data.attendanceMonths,
  });

describe.skipIf(!enabled)("Supabase transport against PostgREST + RLS", () => {
  const [userA, userB, userC, userD] = USERS as [
    string,
    string,
    string,
    string,
  ];

  it("two devices converge, conflict explicitly and resolve through the real server", async () => {
    const a = device("phone-a", userA, undefined, seedDocument("profile-a"));
    await a.store.load();
    const event = await a.act((data, ctx) =>
      createServiceEvent(data, leave("2026-09-10", "처음"), ctx),
    );
    await a.act((data, ctx) =>
      saveAttendanceMonth(
        data,
        {
          month: "2026-07",
          nonWorkingDates: ["2026-07-17"],
          dayOverrides: [],
          hadNonPayableAbsence: false,
        },
        ctx,
      ),
    );
    const enabledA = await a.enable();
    expect(enabledA.preview).toMatchObject({ case: "UPLOAD", uploads: 3 });
    expect(enabledA.status.phase).toBe("IDLE");

    const b = device("laptop-b", userA);
    const enabledB = await b.enable();
    expect(enabledB.preview).toMatchObject({ case: "DOWNLOAD", uploads: 0 });
    expect(records(b.data())).toBe(records(a.data()));

    // Concurrent edits of one record.
    const edit = (note: string) => (data: UserData, ctx: CommandContext) =>
      updateServiceEvent(data, event.id, leave("2026-09-10", note), ctx);
    await a.act(edit("A"));
    await b.act(edit("B"));
    expect((await a.engine.sync()).phase).toBe("IDLE");
    const open = await b.engine.sync();
    expect(open.conflicts).toHaveLength(1);
    expect(open.conflicts[0]!.type).toBe("EQUAL_VERSION_DIVERGENT");
    await b.engine.resolveConflicts({ [open.conflicts[0]!.key]: "INCOMING" });
    const settled = await a.engine.sync();
    expect(settled.conflicts).toEqual([]);
    expect(records(a.data())).toBe(records(b.data()));
    // Converged: further syncs move nothing.
    expect((await a.engine.sync()).lastSummary).toMatchObject({
      pulled: 0,
      pushed: 0,
    });
    expect((await b.engine.sync()).lastSummary).toMatchObject({
      pulled: 0,
      pushed: 0,
    });
  });

  it("a push whose response is lost is retried without duplicates", async () => {
    let lose = true;
    const a = device(
      "phone-a",
      userB,
      (url) => {
        if (lose && url.endsWith("/rpc/sync_push")) {
          lose = false;
          return "LOSE_RESPONSE";
        }
        return "PASS";
      },
      seedDocument("profile-b"),
    );
    await a.store.load();
    const first = await a.enable();
    expect(first.status).toMatchObject({ phase: "OFFLINE", error: "NETWORK" });
    const retry = await a.engine.sync();
    expect(retry.phase).toBe("IDLE");
    expect(retry.lastSummary?.pushed).toBe(0);
    const account = await createSupabaseTransport(
      client(userB),
    ).ensureAccount();
    expect(account.lastSeq).toBe(1);
    expect(account.profileId).toBe("profile-b");
  });

  it("isolates accounts: another user reads nothing, anonymous calls are refused", async () => {
    const owner = createSupabaseTransport(client(userA));
    const backup = await owner.uploadBackup({
      generation: (await owner.ensureAccount()).generation,
      text: '{"secret":"a"}',
      exportedAt: "2026-09-24T00:00:00.000Z",
      schemaVersion: 3,
      formatVersion: 2,
      digest: null,
    });
    expect(backup.kind).toBe("OK");
    if (backup.kind !== "OK") throw new Error();

    const other = createSupabaseTransport(client(userC));
    const account = await other.ensureAccount();
    const pulled = await other.pull({
      generation: account.generation,
      afterSeq: 0,
      limit: 1000,
    });
    expect(pulled).toMatchObject({ kind: "OK", rows: [] });
    expect(await other.listBackups()).toEqual([]);
    await expect(other.downloadBackup(backup.backup.id)).rejects.toMatchObject({
      category: "NOT_FOUND",
    });
    await other.deleteBackup(backup.backup.id);
    expect(await owner.downloadBackup(backup.backup.id)).toBe('{"secret":"a"}');

    // A crafted push naming A's profile only writes into C's own account.
    const crafted = await other.push({
      generation: account.generation,
      deviceId: "attacker",
      items: [
        {
          collection: "profile",
          recordId: "profile-a",
          baseSeq: null,
          schemaVersion: 3,
          payload: { id: "profile-a", overwritten: true },
        },
      ],
    });
    expect(crafted.kind).toBe("OK");
    const ownerRows = await owner.pull({
      generation: (await owner.ensureAccount()).generation,
      afterSeq: 0,
      limit: 1000,
    });
    if (ownerRows.kind !== "OK") throw new Error();
    expect(JSON.stringify(ownerRows.rows)).not.toContain("overwritten");

    const anonymous = createSupabaseTransport(client(null));
    await expect(anonymous.ensureAccount()).rejects.toMatchObject({
      category: "AUTH",
    });
    await expect(anonymous.listBackups()).rejects.toMatchObject({
      category: "AUTH",
    });
  });

  it("cloud reset stops a stale device, and backups restore through parseBackup", async () => {
    const a = device("phone-a", userD, undefined, seedDocument("profile-d"));
    await a.store.load();
    await a.act((data, ctx) =>
      createServiceEvent(data, leave("2026-10-01"), ctx),
    );
    await a.enable();
    const b = device("laptop-b", userD);
    await b.enable();

    const uploaded = await a.engine.uploadBackup();
    expect(uploaded.kind).toBe("OK");
    const [info] = await b.engine.listBackups();
    const parsed = parseBackup(await b.engine.downloadBackup(info!.id));
    expect(parsed.ok && parsed.info.integrity).toBe("VERIFIED");

    expect(await a.engine.deleteCloudData({ userId: userD })).toMatchObject({
      ok: true,
      account: { generation: 2 },
    });
    await b.act((data, ctx) =>
      createServiceEvent(data, leave("2026-10-02"), ctx),
    );
    const stale = await b.engine.sync();
    expect(stale).toMatchObject({
      phase: "BLOCKED",
      block: { reason: "GENERATION_MISMATCH" },
    });
    expect(await b.engine.listBackups()).toEqual([]);
    const transport = createSupabaseTransport(client(userD));
    const pulled = await transport.pull({
      generation: 2,
      afterSeq: 0,
      limit: 10,
    });
    expect(pulled).toMatchObject({ kind: "OK", rows: [] });
    expect(b.data().events).toHaveLength(2);
  });

  it("reports an unreachable server as NETWORK", async () => {
    const offline = createSupabaseTransport(client(userA, () => "FAIL_BEFORE"));
    await expect(offline.ensureAccount()).rejects.toMatchObject({
      category: "NETWORK",
    });
  });
});

describe("Supabase error categories", () => {
  it("maps statuses and codes without exposing messages", () => {
    expect(categorize(0, { message: "fetch failed" })).toBe("NETWORK");
    expect(categorize(401, { code: "PGRST301" })).toBe("AUTH");
    expect(categorize(403, { code: "42501" })).toBe("AUTH");
    expect(categorize(400, { code: "28000" })).toBe("AUTH");
    expect(categorize(429, null)).toBe("RATE_LIMITED");
    expect(categorize(406, { code: "PGRST116" })).toBe("NOT_FOUND");
    expect(categorize(500, { code: "XX000" })).toBe("SERVER");
    expect(categorize(404, { code: "PGRST202" })).toBe("SERVER");
  });
});
