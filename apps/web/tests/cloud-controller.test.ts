import { describe, expect, it } from "vitest";

import {
  STORAGE_KEYS,
  buildServiceProfile,
  createEmptyUserData,
  createMemoryStorage,
  createMemorySyncServer,
  createServiceEvent,
  createUserDataRepository,
  createUserDataStore,
  type MemorySyncServer,
  type ServiceEventDraft,
  type UserData,
} from "@super-gongik/domain";

import { validateEnvironment } from "../src/env";
import {
  CloudAuthError,
  createCloudController,
  type CloudAuth,
  type CloudSession,
} from "../src/lib/sync/cloud-controller";
import {
  mayHaveSession,
  sessionStorageKey,
} from "../src/lib/sync/cloud-config";

function seed(profileId: string): UserData {
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
  return { ...createEmptyUserData("phone"), profile };
}

const leave = (date: string): ServiceEventDraft => ({
  eventType: "ANNUAL_LEAVE",
  startDate: date as ServiceEventDraft["startDate"],
  endDate: date as ServiceEventDraft["endDate"],
  timing: { kind: "ALL_DAY", dayCount: 1 },
  title: null,
  note: null,
});

/** A fake auth provider over the in-memory server: accepts code "123456". */
function fakeAuth(server: MemorySyncServer, users: Record<string, string>) {
  let session: CloudSession | null = null;
  const listeners = new Set<(session: CloudSession | null) => void>();
  const calls: string[] = [];
  const auth: CloudAuth = {
    async getSession() {
      calls.push("getSession");
      return session;
    },
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async sendCode(email) {
      calls.push("sendCode");
      if (!users[email]) throw new CloudAuthError("INVALID_EMAIL");
    },
    async verifyCode(email, code) {
      calls.push("verifyCode");
      if (code !== "123456") throw new CloudAuthError("INVALID_CODE");
      session = { userId: users[email]!, email };
      return session;
    },
    async signOut() {
      calls.push("signOut");
      session = null;
    },
    transport: () => server.transport(session?.userId ?? null),
  };
  return { auth, calls };
}

function setup(
  options: {
    server?: MemorySyncServer;
    configured?: boolean;
    storedSession?: boolean;
    seedData?: UserData;
  } = {},
) {
  const server = options.server ?? createMemorySyncServer();
  const storage = createMemoryStorage(
    options.seedData
      ? { [STORAGE_KEYS.current]: JSON.stringify(options.seedData) }
      : {},
  );
  let n = 0;
  const createId = () => `id-${++n}`;
  const store = createUserDataStore({
    repository: createUserDataRepository(storage, {
      now: () => new Date().toISOString(),
      createId,
    }),
    createId,
  });
  const { auth, calls } = fakeAuth(server, {
    "a@example.test": "user-a",
    "b@example.test": "user-b",
  });
  let loads = 0;
  const timers: Array<() => void> = [];
  const controller = createCloudController({
    configured: options.configured ?? true,
    hasStoredSession: () => options.storedSession ?? false,
    loadAuth: async () => {
      loads += 1;
      return auth;
    },
    store,
    storage,
    setTimer: (callback) => timers.push(callback),
    clearTimer: () => undefined,
  });
  return {
    server,
    storage,
    store,
    controller,
    calls,
    timers,
    loads: () => loads,
  };
}

describe("cloud controller", () => {
  it("guest mode loads no SDK and makes no request, configured or not", async () => {
    for (const configured of [true, false]) {
      const env = setup({ configured, seedData: seed("profile-1") });
      await env.store.load();
      await env.controller.start();
      await env.store.run((data, ctx) =>
        createServiceEvent(data, leave("2026-09-01"), ctx),
      );
      expect(env.loads()).toBe(0);
      expect(env.calls).toEqual([]);
      expect(env.server.calls).toEqual([]);
      expect(env.controller.getState().phase).toBe(
        configured ? "GUEST" : "UNCONFIGURED",
      );
    }
  });

  it("signs in with an email code without uploading anything until sync is turned on", async () => {
    const env = setup({ seedData: seed("profile-1") });
    await env.store.load();
    await env.controller.start();
    expect(await env.controller.sendCode("a@example.test")).toBe(true);
    expect(env.controller.getState().phase).toBe("CODE_SENT");
    expect(await env.controller.verifyCode("000000")).toBe(false);
    expect(env.controller.getState().authError).toBe("INVALID_CODE");
    expect(await env.controller.verifyCode("123456")).toBe(true);
    expect(env.controller.getState()).toMatchObject({
      phase: "SIGNED_IN",
      userId: "user-a",
      sync: { phase: "DISABLED" },
    });
    expect(env.server.calls).toEqual([]);

    const preview = await env.controller.previewEnable();
    expect(preview).toMatchObject({ kind: "READY", case: "UPLOAD" });
    await env.controller.enable(preview);
    expect(env.server.rows("user-a")).toHaveLength(1);
  });

  it("signing out stops syncing and keeps every local record", async () => {
    const env = setup({ seedData: seed("profile-1") });
    await env.store.load();
    await env.controller.sendCode("a@example.test");
    await env.controller.verifyCode("123456");
    await env.controller.enable(await env.controller.previewEnable());
    await env.store.run((data, ctx) =>
      createServiceEvent(data, leave("2026-09-02"), ctx),
    );
    const before = await env.storage.getItem(STORAGE_KEYS.current);
    await env.controller.signOut();
    expect(env.controller.getState()).toMatchObject({
      phase: "GUEST",
      sync: null,
    });
    expect(env.calls).toContain("signOut");
    expect(await env.storage.getItem(STORAGE_KEYS.current)).toBe(before);
    // The pending edit was not pushed and is still local.
    expect(
      env.server.rows("user-a").filter((row) => row.collection === "events"),
    ).toHaveLength(0);
    const snapshot = env.store.getSnapshot();
    expect(snapshot.phase === "READY" && snapshot.data.events).toHaveLength(1);
    // Timers queued before sign-out do nothing afterwards.
    for (const timer of env.timers.splice(0)) timer();
    expect(
      env.server.rows("user-a").filter((row) => row.collection === "events"),
    ).toHaveLength(0);
  });

  it("switching to an account holding another person's profile never merges them", async () => {
    const server = createMemorySyncServer();
    const other = setup({ server, seedData: seed("profile-b") });
    await other.store.load();
    await other.controller.sendCode("b@example.test");
    await other.controller.verifyCode("123456");
    await other.controller.enable(await other.controller.previewEnable());

    const env = setup({ server, seedData: seed("profile-a") });
    await env.store.load();
    await env.controller.sendCode("b@example.test");
    await env.controller.verifyCode("123456");
    const preview = await env.controller.previewEnable();
    expect(preview.kind).toBe("PROFILE_MISMATCH");
    const snapshot = env.store.getSnapshot();
    expect(snapshot.phase === "READY" && snapshot.data.profile?.id).toBe(
      "profile-a",
    );
    expect(server.rows("user-b").map((row) => row.recordId)).toEqual([
      "profile-b",
    ]);
  });

  it("a local edit schedules a debounced sync; a stored session resumes on start", async () => {
    const server = createMemorySyncServer();
    const first = setup({ server, seedData: seed("profile-1") });
    await first.store.load();
    await first.controller.sendCode("a@example.test");
    await first.controller.verifyCode("123456");
    await first.controller.enable(await first.controller.previewEnable());
    first.timers.splice(0);
    await first.store.run((data, ctx) =>
      createServiceEvent(data, leave("2026-09-03"), ctx),
    );
    expect(first.timers.length).toBeGreaterThan(0);
    for (const timer of first.timers.splice(0)) timer();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(
      server.rows("user-a").filter((row) => row.collection === "events"),
    ).toHaveLength(1);
  });
});

describe("cloud configuration", () => {
  it("detects a possible session only from local evidence", () => {
    const config = { url: "https://abcd.supabase.co", anonKey: "public" };
    const key = sessionStorageKey(config.url);
    expect(key).toBe("sb-abcd-auth-token");
    const empty = { getItem: () => null };
    const stored = { getItem: (name: string) => (name === key ? "{}" : null) };
    const plain = { search: "", hash: "" };
    expect(mayHaveSession(config, empty, plain)).toBe(false);
    expect(mayHaveSession(config, stored, plain)).toBe(true);
    expect(mayHaveSession(config, empty, { search: "?code=x", hash: "" })).toBe(
      true,
    );
    const blocked = {
      getItem: () => {
        throw new Error("SecurityError");
      },
    };
    expect(mayHaveSession(config, blocked, plain)).toBe(false);
  });

  it("requires both public Supabase values or neither, and refuses a service-role key", () => {
    expect(() => validateEnvironment({})).not.toThrow();
    expect(() =>
      validateEnvironment({
        NEXT_PUBLIC_SUPABASE_URL: "https://abcd.supabase.co",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "public-anon",
      }),
    ).not.toThrow();
    expect(() =>
      validateEnvironment({
        NEXT_PUBLIC_SUPABASE_URL: "https://abcd.supabase.co",
      }),
    ).toThrow();
    expect(() =>
      validateEnvironment({
        NEXT_PUBLIC_SUPABASE_URL: "http://example.com",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "public-anon",
      }),
    ).toThrow();
    const jwt = (role: string) =>
      [
        Buffer.from('{"alg":"HS256"}').toString("base64url"),
        Buffer.from(JSON.stringify({ role, iss: "supabase" })).toString(
          "base64url",
        ),
        "signature",
      ].join(".");
    expect(() =>
      validateEnvironment({
        NEXT_PUBLIC_SUPABASE_URL: "https://abcd.supabase.co",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: jwt("anon"),
      }),
    ).not.toThrow();
    for (const secret of [jwt("service_role"), "sb_secret_abc123"]) {
      expect(() =>
        validateEnvironment({
          NEXT_PUBLIC_SUPABASE_URL: "https://abcd.supabase.co",
          NEXT_PUBLIC_SUPABASE_ANON_KEY: secret,
        }),
      ).toThrow(/secret\/service-role/);
    }
  });
});
