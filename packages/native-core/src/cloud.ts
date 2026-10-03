import type {
  ConflictResolution,
  EnablePreview,
  KeyValueStorage,
  UserDataStore,
} from "@super-gongik/domain";

import {
  CloudAuthError,
  createCloudController,
  type AuthErrorKind,
  type CloudAuth,
  type CloudSession,
} from "@/lib/sync/cloud-controller";
import { createSupabaseTransport } from "@/lib/sync/supabase-transport";

import { host } from "./host";
import { createPostgrestClient, type HttpResponse } from "./postgrest";

/**
 * Optional cloud sync on iOS: the web's `createCloudController` (accounts,
 * session scoping, engine + scheduler wiring) and `createSupabaseTransport`
 * run unchanged. The native host supplies only what a browser would:
 * HTTP, timers, the stored session (Keychain) and the sign-in requests.
 */
type NativeSession = CloudSession & { accessToken: string };

type CloudHost = {
  cloudConfigured(): boolean;
  cloudBaseURL(): string;
  cloudAnonKey(): string;
  authHasStoredSession(): boolean;
  /** Current session, refreshed by the host when its token expired. */
  authSession(done: (sessionJson: string | null) => void): void;
  authSendCode(email: string, done: (errorKind: string | null) => void): void;
  authVerifyCode(
    email: string,
    code: string,
    done: (resultJson: string) => void,
  ): void;
  authSignOut(done: () => void): void;
  http(requestJson: string, done: (responseJson: string) => void): void;
  setTimer(ms: number, callback: () => void): number;
  clearTimer(id: number): void;
  cloudStateChanged(stateJson: string): void;
};

function cloudHost(): CloudHost {
  return host() as unknown as CloudHost;
}

function call<T>(start: (done: (value: T) => void) => void): Promise<T> {
  return new Promise((resolve) => start(resolve));
}

const AUTH_ERRORS: readonly AuthErrorKind[] = [
  "INVALID_EMAIL",
  "INVALID_CODE",
  "RATE_LIMITED",
  "NETWORK",
  "UNKNOWN",
];

function authError(kind: string | null | undefined): CloudAuthError {
  return new CloudAuthError(
    AUTH_ERRORS.includes(kind as AuthErrorKind)
      ? (kind as AuthErrorKind)
      : "UNKNOWN",
  );
}

export function createNativeCloud(
  store: UserDataStore,
  storage: KeyValueStorage,
) {
  const native = cloudHost();
  const sessionListeners = new Set<(session: CloudSession | null) => void>();

  async function currentSession(): Promise<NativeSession | null> {
    const text = await call<string | null>((done) => native.authSession(done));
    return text ? (JSON.parse(text) as NativeSession) : null;
  }

  const http = async (
    request: Parameters<Parameters<typeof createPostgrestClient>[0]["http"]>[0],
  ) =>
    JSON.parse(
      await call<string>((done) => native.http(JSON.stringify(request), done)),
    ) as HttpResponse;

  const auth: CloudAuth = {
    async getSession() {
      const session = await currentSession();
      return session ? { userId: session.userId, email: session.email } : null;
    },
    onChange(listener) {
      sessionListeners.add(listener);
      return () => sessionListeners.delete(listener);
    },
    async sendCode(email) {
      const error = await call<string | null>((done) =>
        native.authSendCode(email, done),
      );
      if (error) throw authError(error);
    },
    async verifyCode(email, code) {
      const result = JSON.parse(
        await call<string>((done) => native.authVerifyCode(email, code, done)),
      ) as { session?: NativeSession; error?: string };
      if (!result.session) throw authError(result.error);
      return { userId: result.session.userId, email: result.session.email };
    },
    async signOut() {
      await call<void>((done) => native.authSignOut(() => done()));
    },
    transport(userId) {
      return createSupabaseTransport(
        createPostgrestClient({
          url: native.cloudBaseURL(),
          anonKey: native.cloudAnonKey(),
          http,
        }),
        {
          identity: {
            userId,
            session: async () => {
              const session = await currentSession();
              return session
                ? { userId: session.userId, accessToken: session.accessToken }
                : null;
            },
          },
        },
      );
    },
  };

  const controller = createCloudController({
    configured: native.cloudConfigured(),
    hasStoredSession: () => native.authHasStoredSession(),
    loadAuth: async () => auth,
    store,
    storage,
    setTimer: (callback, ms) => native.setTimer(ms, callback),
    clearTimer: (handle) => native.clearTimer(handle as number),
  });
  controller.subscribe(() =>
    native.cloudStateChanged(JSON.stringify(controller.getState())),
  );

  return {
    controller,
    /** The host signed in (OAuth, Apple) or lost the session (refresh failed). */
    sessionChanged(sessionJson: string | null) {
      const session = sessionJson
        ? (JSON.parse(sessionJson) as NativeSession)
        : null;
      const plain = session
        ? { userId: session.userId, email: session.email }
        : null;
      for (const listener of sessionListeners) listener(plain);
    },
    preview: () => controller.previewEnable(),
    enable: (preview: EnablePreview) => controller.enable(preview),
    resolve: (
      expectedSession: string,
      resolutions: Record<string, ConflictResolution>,
    ) => controller.resolveConflicts(expectedSession, resolutions),
  };
}

export type NativeCloud = ReturnType<typeof createNativeCloud>;
