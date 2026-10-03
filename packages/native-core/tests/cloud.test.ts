import {
  createProfile,
  createServiceEvent,
  createMemorySyncServer,
  createMemoryStorage,
  createUserDataRepository,
  createUserDataStore,
  type RemoteAccount,
  type SyncTransport,
} from "@super-gongik/domain";
import { afterEach, describe, expect, it } from "vitest";

import { createNativeCloud } from "../src/cloud";
import type { HttpRequest, HttpResponse } from "../src/postgrest";

/**
 * The whole native cloud path without a network: the web cloud controller
 * and Supabase transport (unchanged) → the native PostgREST client → the host
 * contract (HTTP, timers, session) → a PostgREST-shaped facade over the
 * domain's reference sync server. Wire shapes are those of the SQL functions
 * (supabase/migrations), mapped exactly as supabase-transport.ts expects.
 */
const server = createMemorySyncServer();

const snakeAccount = (account: RemoteAccount) => ({
  generation: account.generation,
  last_seq: account.lastSeq,
  profile_id: account.profileId,
  reset_at: account.resetAt,
});

function bearerUser(headers: Record<string, string>): string | null {
  const token = headers.Authorization?.replace("Bearer ", "") ?? "";
  return token.startsWith("user:") ? token.slice(5) : null;
}

/** PostgREST-shaped HTTP over the reference server. */
async function postgrest(request: HttpRequest): Promise<HttpResponse> {
  const user = bearerUser(request.headers);
  const transport: SyncTransport = server.transport(user);
  const ok = (value: unknown) => ({ status: 200, body: JSON.stringify(value) });
  const url = new URL(request.url);
  try {
    if (url.pathname.startsWith("/rest/v1/rpc/")) {
      if (!user)
        return {
          status: 401,
          body: '{"code":"28000","message":"not authenticated"}',
        };
      const name = url.pathname.slice("/rest/v1/rpc/".length);
      const args = JSON.parse(request.body ?? "{}");
      switch (name) {
        case "sync_ensure_account":
          return ok(snakeAccount(await transport.ensureAccount()));
        case "sync_pull": {
          const result = await transport.pull({
            generation: args.p_generation,
            afterSeq: args.p_after_seq,
            limit: args.p_limit,
          });
          if (result.kind !== "OK")
            return ok({
              kind: result.kind,
              account: snakeAccount(result.account),
            });
          return ok({
            kind: "OK",
            account: snakeAccount(result.account),
            has_more: result.hasMore,
            rows: result.rows.map((row) => ({
              collection: row.collection,
              record_id: row.recordId,
              seq: row.seq,
              schema_version: row.schemaVersion,
              payload: row.payload,
            })),
          });
        }
        case "sync_push": {
          const result = await transport.push({
            generation: args.p_generation,
            deviceId: args.p_device_id,
            items: args.p_items.map((item: Record<string, unknown>) => ({
              collection: item.collection,
              recordId: item.record_id,
              baseSeq: item.base_seq,
              schemaVersion: item.schema_version,
              payload: item.payload,
            })),
          });
          if (result.kind !== "OK")
            return ok({
              kind: result.kind,
              account: snakeAccount(result.account),
            });
          return ok({
            kind: "OK",
            account: snakeAccount(result.account),
            results: result.results.map((item) => ({
              collection: item.collection,
              record_id: item.recordId,
              status: item.status,
              seq: item.seq,
            })),
          });
        }
        case "sync_reset": {
          const result = await transport.resetCloud({
            expectedGeneration: args.p_expected_generation,
          });
          return ok({
            kind: result.kind,
            account: snakeAccount(result.account),
          });
        }
        default:
          return {
            status: 404,
            body: '{"code":"PGRST202","message":"function not found"}',
          };
      }
    }
    if (url.pathname === "/rest/v1/cloud_backups") return ok([]);
    return { status: 404, body: "" };
  } catch {
    return { status: 500, body: '{"code":"XX000","message":"server error"}' };
  }
}

const devices: Array<{ stop(): void }> = [];

/** A native installation: store + cloud wired to a fake host. */
function makeDevice(name: string, userId: string) {
  const storage = createMemoryStorage({});
  let n = 0;
  const createId = () => `${name}-${++n}`;
  const store = createUserDataStore({
    repository: createUserDataRepository(storage, {
      now: () => new Date().toISOString(),
      createId,
    }),
    createId,
  });
  const timers = new Map<number, ReturnType<typeof setTimeout>>();
  let timerIds = 0;
  let signedIn = false;
  const session = () =>
    JSON.stringify({
      userId,
      email: `${name}@example.com`,
      accessToken: `user:${userId}`,
    });
  globalThis.__sgHost = {
    kvGet: () => null,
    kvSet: () => null,
    kvRemove: () => null,
    kvKeys: () => [],
    kvCompareAndSet: () => true,
    randomBytes: (count: number) => Array.from({ length: count }, () => 7),
    log: () => undefined,
    ...{
      cloudConfigured: () => true,
      cloudBaseURL: () => "https://project.supabase.co",
      cloudAnonKey: () => "anon",
      authHasStoredSession: () => signedIn,
      authSession: (done: (s: string | null) => void) =>
        done(signedIn ? session() : null),
      authSendCode: (_email: string, done: (e: string | null) => void) =>
        done(null),
      authVerifyCode: (_e: string, code: string, done: (r: string) => void) => {
        if (code !== "123456")
          return done(JSON.stringify({ error: "INVALID_CODE" }));
        signedIn = true;
        done(JSON.stringify({ session: JSON.parse(session()) }));
      },
      authSignOut: (done: () => void) => {
        signedIn = false;
        done();
      },
      http: (requestJson: string, done: (r: string) => void) => {
        void postgrest(JSON.parse(requestJson)).then((response) =>
          done(JSON.stringify(response)),
        );
      },
      setTimer: (ms: number, callback: () => void) => {
        const id = ++timerIds;
        timers.set(id, setTimeout(callback, Math.min(ms, 5)));
        return id;
      },
      clearTimer: (id: number) => {
        clearTimeout(timers.get(id));
        timers.delete(id);
      },
      cloudStateChanged: () => undefined,
    },
  } as never;
  const cloud = createNativeCloud(store, storage);
  const device = {
    store,
    cloud,
    stop: () => {
      for (const timer of timers.values()) clearTimeout(timer);
    },
    data() {
      const snapshot = store.getSnapshot();
      if (snapshot.phase !== "READY") throw new Error("not ready");
      return snapshot.data;
    },
  };
  devices.push(device);
  return device;
}

afterEach(() => {
  for (const device of devices.splice(0)) device.stop();
});

describe("native cloud path", { timeout: 30_000 }, () => {
  it("signs in with an email code, enables sync and converges two devices", async () => {
    const phone = makeDevice("phone", "user-1");
    await phone.store.load();
    await phone.store.run((data, context) =>
      createProfile(
        data,
        {
          callUpDate: "2026-05-04",
          expectedDischargeDate: "2028-02-03",
          serviceCategory: null,
          workplaceType: null,
          defaultCommuteCost: null,
          defaultMealAllowanceOverride: null,
          timezone: "Asia/Seoul",
        } as never,
        context,
      ),
    );
    await phone.store.run((data, context) =>
      createServiceEvent(
        data,
        {
          eventType: "ANNUAL_LEAVE",
          startDate: "2026-07-01",
          endDate: "2026-07-01",
          timing: { kind: "ALL_DAY", dayCount: 1 },
          title: null,
          note: null,
        },
        context,
      ),
    );

    const controller = phone.cloud.controller;
    await controller.start();
    expect(controller.getState().phase).toBe("GUEST");
    expect(await controller.sendCode("phone@example.com")).toBe(true);
    expect(await controller.verifyCode("000000")).toBe(false);
    expect(controller.getState().authError).toBe("INVALID_CODE");
    expect(await controller.verifyCode("123456")).toBe(true);
    expect(controller.getState().phase).toBe("SIGNED_IN");

    const preview = await phone.cloud.preview();
    expect(preview.kind).toBe("READY");
    if (preview.kind !== "READY") return;
    expect(preview.case).toBe("UPLOAD");
    const enabled = await phone.cloud.enable(preview);
    expect(enabled.kind).toBe("ENABLED");
    expect(server.account("user-1")?.profileId).toBe(phone.data().profile!.id);

    // A second installation of the same account downloads everything.
    const tablet = makeDevice("tablet", "user-1");
    await tablet.store.load();
    await tablet.cloud.controller.start();
    await tablet.cloud.controller.sendCode("phone@example.com");
    await tablet.cloud.controller.verifyCode("123456");
    const download = await tablet.cloud.preview();
    expect(download.kind).toBe("READY");
    if (download.kind !== "READY") return;
    expect(download.case).toBe("DOWNLOAD");
    expect((await tablet.cloud.enable(download)).kind).toBe("ENABLED");
    expect(tablet.data().profile?.id).toBe(phone.data().profile!.id);
    expect(tablet.data().events.map((event) => event.id)).toEqual(
      phone.data().events.map((event) => event.id),
    );
  });

  it("refuses to act for an account after sign-out (session-scoped actions)", async () => {
    const tablet = makeDevice("tablet", "user-2");
    await tablet.store.load();
    const controller = tablet.cloud.controller;
    await controller.start();
    await controller.sendCode("tablet@example.com");
    await controller.verifyCode("123456");
    const session = controller.getState().accountSession!;
    await controller.signOut();
    expect(await controller.deleteCloudData(session)).toEqual({
      kind: "ACCOUNT_CHANGED",
    });
  });
});
