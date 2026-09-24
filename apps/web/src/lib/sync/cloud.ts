import "client-only";

import { getAppStore } from "@/lib/app-store";
import { createBrowserStorage } from "@/lib/browser-storage";

import {
  createCloudController,
  type CloudController,
} from "./cloud-controller";
import { mayHaveSession, readCloudConfig } from "./cloud-config";

/** Lock name for sync runs, separate from the data write lock. */
export const SYNC_LOCK = "super-gongik:sync";

let controller: CloudController | null = null;

function syncLock() {
  if (typeof navigator === "undefined" || !navigator.locks?.request) {
    return undefined;
  }
  const locks = navigator.locks;
  return <T>(task: () => Promise<T>) =>
    new Promise<T>((resolve, reject) => {
      locks
        .request(SYNC_LOCK, { mode: "exclusive" }, () =>
          task().then(resolve, reject),
        )
        .catch(reject);
    });
}

export function getCloudController(): CloudController {
  if (!controller) {
    const config = readCloudConfig();
    controller = createCloudController({
      configured: config !== null,
      hasStoredSession: () =>
        config !== null &&
        mayHaveSession(config, window.localStorage, window.location),
      loadAuth: async () => {
        const { loadSupabaseAuth } = await import("./supabase-auth");
        return loadSupabaseAuth(config!);
      },
      store: getAppStore(),
      storage: createBrowserStorage(),
      syncLock: syncLock(),
      setTimer: (callback, ms) => window.setTimeout(callback, ms),
      clearTimer: (handle) => window.clearTimeout(handle as number),
    });
  }
  return controller;
}
