import {
  createSyncEngine,
  createSyncScheduler,
  createSyncStateStore,
  type ConflictResolution,
  type EnablePreview,
  type EnableResult,
  type UploadBackupResponse,
  type KeyValueStorage,
  type SyncDiagnostic,
  type SyncEngine,
  type SyncScheduler,
  type SyncStatus,
  type SyncTransport,
  type UserDataStore,
  type WriteLock,
} from "@super-gongik/domain";

/**
 * Optional account + cloud sync, wired around the domain sync engine.
 *
 * Guest-first: `start()` does nothing — no SDK import, no request — unless
 * cloud sync is configured for this build AND a session was stored on this
 * device earlier (or the page is returning from a sign-in link). Local writes
 * never wait for any of this.
 *
 * Sign out stops syncing and keeps every local record and the sync
 * checkpoint. Deleting local data and deleting cloud data are separate
 * actions elsewhere.
 */

export type CloudSession = { userId: string; email: string | null };

export type AuthErrorKind =
  "INVALID_EMAIL" | "INVALID_CODE" | "RATE_LIMITED" | "NETWORK" | "UNKNOWN";

/**
 * The signed-in account changed (or signed out) after the user made a
 * choice; nothing was done.
 */
export type AccountChanged = { kind: "ACCOUNT_CHANGED" };
export const ACCOUNT_CHANGED: AccountChanged = { kind: "ACCOUNT_CHANGED" };

export function isAccountChanged(value: unknown): value is AccountChanged {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { kind?: unknown }).kind === "ACCOUNT_CHANGED"
  );
}

export class CloudAuthError extends Error {
  constructor(readonly kind: AuthErrorKind) {
    super(kind);
    this.name = "CloudAuthError";
  }
}

/** Everything the controller needs from an auth provider. */
export type CloudAuth = {
  getSession(): Promise<CloudSession | null>;
  onChange(listener: (session: CloudSession | null) => void): () => void;
  sendCode(email: string): Promise<void>;
  verifyCode(email: string, code: string): Promise<CloudSession>;
  signOut(): Promise<void>;
  /** A transport that only ever acts as `userId` (refuses otherwise). */
  transport(userId: string): SyncTransport;
};

export type CloudPhase =
  "UNCONFIGURED" | "GUEST" | "LOADING" | "CODE_SENT" | "SIGNED_IN";

export type CloudState = {
  phase: CloudPhase;
  email: string | null;
  userId: string | null;
  /**
   * The current sign-in session (new on every sign-in, account switch or
   * re-sign-in). Account-scoped UI is keyed by it and every account-scoped
   * action names it, so nothing decided in an earlier session can act now.
   */
  accountSession: string | null;
  sync: SyncStatus | null;
  /** Short, user-facing, content-free message for the last auth action. */
  authError: AuthErrorKind | null;
  diagnostics: SyncDiagnostic[];
};

export type CloudControllerOptions = {
  configured: boolean;
  /** Cheap local check (no network): was a session stored here before? */
  hasStoredSession: () => boolean;
  /** Load the auth provider (dynamic import of the SDK). */
  loadAuth: () => Promise<CloudAuth>;
  store: UserDataStore;
  storage: KeyValueStorage;
  syncLock?: WriteLock;
  setTimer: (callback: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
  now?: () => Date;
};

const DIAGNOSTIC_LIMIT = 20;
const FOREGROUND_MIN_INTERVAL_MS = 60_000;

export function createCloudController(options: CloudControllerOptions) {
  const listeners = new Set<() => void>();
  let state: CloudState = {
    phase: options.configured ? "GUEST" : "UNCONFIGURED",
    email: null,
    userId: null,
    accountSession: null,
    sync: null,
    authError: null,
    diagnostics: [],
  };
  let sessions = 0;
  let auth: CloudAuth | null = null;
  let authLoading: Promise<CloudAuth> | null = null;
  let engine: SyncEngine | null = null;
  let scheduler: SyncScheduler | null = null;
  let detach: Array<() => void> = [];
  let lastRevision: number | null = null;
  let lastAttempt = 0;
  let started = false;

  function set(patch: Partial<CloudState>) {
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  }

  function ensureAuth(): Promise<CloudAuth> {
    authLoading ??= options.loadAuth().then((loaded) => {
      auth = loaded;
      loaded.onChange((session) => {
        if (session && session.userId !== state.userId) {
          void attach(session);
        } else if (!session && state.phase === "SIGNED_IN") {
          teardown();
          set({
            phase: "GUEST",
            email: null,
            userId: null,
            accountSession: null,
            sync: null,
          });
        }
      });
      return loaded;
    });
    return authLoading;
  }

  function revision() {
    const snapshot = options.store.getSnapshot();
    return snapshot.phase === "READY" ? snapshot.data.documentRevision : null;
  }

  function teardown() {
    scheduler?.stop();
    scheduler = null;
    for (const stop of detach) stop();
    detach = [];
    // Anything still queued for the old account is refused.
    engine?.dispose();
    engine = null;
  }

  async function attach(session: CloudSession) {
    if (!auth) return;
    teardown();
    const created = createSyncEngine({
      userId: session.userId,
      sessionId: `${session.userId}#${++sessions}`,
      store: options.store,
      transport: auth.transport(session.userId),
      state: createSyncStateStore(options.storage, session.userId),
      now: options.now,
      lock: options.syncLock,
      diagnostics: (event) =>
        set({
          diagnostics: [event, ...state.diagnostics].slice(0, DIAGNOSTIC_LIMIT),
        }),
    });
    engine = created;
    scheduler = createSyncScheduler({
      run: (reason) => {
        lastAttempt = Date.now();
        return created.sync(reason);
      },
      setTimer: options.setTimer,
      clearTimer: options.clearTimer,
    });
    const activeScheduler = scheduler;
    detach.push(
      created.subscribe(() => {
        const sync = created.getStatus();
        set({ sync });
        // A local write that landed while a run was in flight.
        const current = revision();
        if (
          sync.phase !== "SYNCING" &&
          sync.localRevision !== null &&
          current !== null &&
          current > sync.localRevision &&
          current !== lastRevision
        ) {
          lastRevision = current;
          created.notifyLocalChange();
          activeScheduler.localChange();
        }
      }),
    );
    lastRevision = revision();
    detach.push(
      options.store.subscribe(() => {
        const current = revision();
        if (current === null || current === lastRevision) return;
        lastRevision = current;
        // Changes a sync run commits itself are not local edits.
        if (created.getStatus().phase === "SYNCING") return;
        created.notifyLocalChange();
        activeScheduler.localChange();
      }),
    );
    set({
      phase: "SIGNED_IN",
      email: session.email,
      userId: session.userId,
      accountSession: created.sessionId,
      authError: null,
      sync: await created.init(),
    });
    if (created.getStatus().phase !== "DISABLED") {
      activeScheduler.soon("sign-in");
    }
  }

  async function guard<T>(task: () => Promise<T>): Promise<T | null> {
    try {
      return await task();
    } catch (error) {
      set({
        authError: error instanceof CloudAuthError ? error.kind : "UNKNOWN",
      });
      return null;
    }
  }

  function requireEngine(): SyncEngine {
    if (!engine) throw new Error("Not signed in.");
    return engine;
  }

  /**
   * The engine, only if it still belongs to the account the user decided
   * for. Null after a sign-out or an account switch.
   */
  function forAccount(expectedSession: string): SyncEngine | null {
    if (
      !engine ||
      engine.sessionId !== expectedSession ||
      state.accountSession !== expectedSession
    ) {
      return null;
    }
    return engine;
  }

  return {
    getState: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    /** Called once on app start. Guests: no SDK load, no network. */
    async start() {
      if (started) return;
      started = true;
      if (!options.configured || !options.hasStoredSession()) return;
      set({ phase: "LOADING" });
      const loaded = await guard(ensureAuth);
      const session = loaded ? await guard(() => loaded.getSession()) : null;
      if (session) await attach(session);
      else if (state.phase === "LOADING") set({ phase: "GUEST" });
    },

    async sendCode(email: string) {
      set({ authError: null });
      const loaded = await guard(ensureAuth);
      if (!loaded) return false;
      const ok = await guard(async () => {
        await loaded.sendCode(email);
        return true;
      });
      if (ok) set({ phase: "CODE_SENT", email });
      return Boolean(ok);
    },

    async verifyCode(code: string) {
      if (!auth || !state.email) return false;
      const loaded = auth;
      const email = state.email;
      set({ authError: null });
      const session = await guard(() => loaded.verifyCode(email, code));
      if (!session) return false;
      await attach(session);
      return true;
    },

    cancelCode() {
      set({ phase: "GUEST", email: null, authError: null });
    },

    /** Stop syncing on this device. Keeps local data and the checkpoint. */
    async signOut() {
      teardown();
      const loaded = auth;
      set({
        phase: options.configured ? "GUEST" : "UNCONFIGURED",
        email: null,
        userId: null,
        accountSession: null,
        sync: null,
        authError: null,
      });
      if (loaded) await loaded.signOut().catch(() => undefined);
    },

    previewEnable: (): Promise<EnablePreview> =>
      requireEngine().previewEnable(),

    /**
     * Enable with the preview the user approved. The engine re-checks the
     * preview's account, local revision and remote version and refuses a
     * stale one (`STALE_PREVIEW`); the UI then shows a fresh preview for the
     * user to approve. After a sign-out or switch the preview is stale.
     */
    async enable(preview: EnablePreview): Promise<EnableResult> {
      const expected =
        preview.kind === "READY"
          ? preview.evidence.sessionId
          : state.accountSession;
      const current = expected ? forAccount(expected) : null;
      if (!current) return { kind: "STALE_PREVIEW", reason: "ACCOUNT" };
      return current.enable(preview);
    },

    syncNow: () => {
      lastAttempt = Date.now();
      return requireEngine().sync("manual");
    },

    // Account-scoped actions name the account the user was looking at when
    // they decided. If the session changed since (sign-out, or a switch in
    // another tab), nothing happens and the result says ACCOUNT_CHANGED: a
    // choice made for one account never acts on another.

    async resolveConflicts(
      expectedSession: string,
      resolutions: Record<string, ConflictResolution>,
    ): Promise<SyncStatus | AccountChanged> {
      const current = forAccount(expectedSession);
      return current ? current.resolveConflicts(resolutions) : ACCOUNT_CHANGED;
    },

    async disableSync(
      expectedSession: string,
    ): Promise<{ kind: "DISABLED" } | AccountChanged> {
      const current = forAccount(expectedSession);
      if (!current) return ACCOUNT_CHANGED;
      await current.disable();
      return { kind: "DISABLED" };
    },

    async deleteCloudData(expectedSession: string) {
      const current = forAccount(expectedSession);
      if (!current) return ACCOUNT_CHANGED;
      const result = await current.deleteCloudData({ userId: current.userId });
      return !result.ok && result.reason === "ACCOUNT_MISMATCH"
        ? ACCOUNT_CHANGED
        : result;
    },

    listBackups: () => requireEngine().listBackups(),

    async uploadBackup(
      expectedSession: string,
    ): Promise<UploadBackupResponse | AccountChanged> {
      const current = forAccount(expectedSession);
      return current ? current.uploadBackup() : ACCOUNT_CHANGED;
    },

    downloadBackup: (id: string) => requireEngine().downloadBackup(id),
    async deleteBackup(
      expectedSession: string,
      id: string,
    ): Promise<{ kind: "DELETED" } | AccountChanged> {
      const current = forAccount(expectedSession);
      if (!current) return ACCOUNT_CHANGED;
      await current.deleteBackup(id);
      return { kind: "DELETED" };
    },

    /** Connectivity regained (a hint; the next request decides). */
    notifyOnline() {
      scheduler?.soon("online");
    },

    /** App came to the foreground; throttled. */
    notifyForeground() {
      if (!scheduler) return;
      if (Date.now() - lastAttempt < FOREGROUND_MIN_INTERVAL_MS) return;
      scheduler.soon("foreground");
    },

    /**
     * A backup was restored locally. After a REPLACE the next sync pulls
     * and merges everything again, so newer cloud versions are not skipped.
     */
    async afterRestore(mode: "MERGE" | "REPLACE") {
      if (!engine || !scheduler) return;
      if (mode === "REPLACE") await engine.requestFullResync();
      scheduler.soon("restore");
    },

    /**
     * Local data was deleted on this device. The checkpoint went with it,
     * so sync is off here until the user turns it on again.
     */
    async afterLocalWipe() {
      if (engine) set({ sync: await engine.init() });
    },
  };
}

export type CloudController = ReturnType<typeof createCloudController>;
