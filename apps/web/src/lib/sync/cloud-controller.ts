import {
  createSyncEngine,
  createSyncScheduler,
  createSyncStateStore,
  type ConflictResolution,
  type EnablePreview,
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
  transport(): SyncTransport;
};

export type CloudPhase =
  "UNCONFIGURED" | "GUEST" | "LOADING" | "CODE_SENT" | "SIGNED_IN";

export type CloudState = {
  phase: CloudPhase;
  email: string | null;
  userId: string | null;
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
    sync: null,
    authError: null,
    diagnostics: [],
  };
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
          set({ phase: "GUEST", email: null, userId: null, sync: null });
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
    engine = null;
  }

  async function attach(session: CloudSession) {
    if (!auth) return;
    teardown();
    const created = createSyncEngine({
      userId: session.userId,
      store: options.store,
      transport: auth.transport(),
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
        sync: null,
        authError: null,
      });
      if (loaded) await loaded.signOut().catch(() => undefined);
    },

    previewEnable: (): Promise<EnablePreview> =>
      requireEngine().previewEnable(),

    async enable(preview: EnablePreview) {
      const result = await requireEngine().enable(preview);
      return result;
    },

    syncNow: () => {
      lastAttempt = Date.now();
      return requireEngine().sync("manual");
    },

    resolveConflicts: (resolutions: Record<string, ConflictResolution>) =>
      requireEngine().resolveConflicts(resolutions),

    disableSync: () => requireEngine().disable(),

    deleteCloudData: () => requireEngine().deleteCloudData(),

    listBackups: () => requireEngine().listBackups(),
    uploadBackup: () => requireEngine().uploadBackup(),
    downloadBackup: (id: string) => requireEngine().downloadBackup(id),
    deleteBackup: (id: string) => requireEngine().deleteBackup(id),

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
     * Local data was deleted on this device. The checkpoint went with it,
     * so sync is off here until the user turns it on again.
     */
    async afterLocalWipe() {
      if (engine) set({ sync: await engine.init() });
    },
  };
}

export type CloudController = ReturnType<typeof createCloudController>;
