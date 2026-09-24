"use client";

import { useEffect, useSyncExternalStore } from "react";

import type { CloudState } from "@/lib/sync/cloud-controller";
import { getCloudController } from "@/lib/sync/cloud";

const SERVER_STATE: CloudState = {
  phase: "UNCONFIGURED",
  email: null,
  userId: null,
  accountSession: null,
  sync: null,
  authError: null,
  diagnostics: [],
};

function subscribe(callback: () => void) {
  return getCloudController().subscribe(callback);
}

/** Cloud account/sync state. Starts the controller once per page. */
export function useCloud() {
  const state = useSyncExternalStore(
    subscribe,
    () => getCloudController().getState(),
    () => SERVER_STATE,
  );

  useEffect(() => {
    const controller = getCloudController();
    void controller.start();
    const online = () => controller.notifyOnline();
    const visible = () => {
      if (document.visibilityState === "visible") controller.notifyForeground();
    };
    window.addEventListener("online", online);
    document.addEventListener("visibilitychange", visible);
    return () => {
      window.removeEventListener("online", online);
      document.removeEventListener("visibilitychange", visible);
    };
  }, []);

  return { state, cloud: getCloudController() };
}
