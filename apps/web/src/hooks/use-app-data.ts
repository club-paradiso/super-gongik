"use client";

import { useEffect, useSyncExternalStore } from "react";

import type { StoreSnapshot } from "@super-gongik/domain";

import { WATCHED_STORAGE_KEY, getAppStore } from "@/lib/app-store";
import { requestPersistentStorage } from "@/lib/browser-storage";

const LOADING: StoreSnapshot = { phase: "LOADING" };

function subscribe(callback: () => void) {
  return getAppStore().subscribe(callback);
}

export function useAppData() {
  const snapshot = useSyncExternalStore(
    subscribe,
    () => getAppStore().getSnapshot(),
    () => LOADING,
  );

  useEffect(() => {
    const store = getAppStore();
    if (store.getSnapshot().phase === "LOADING") void store.load();

    const handleStorage = (event: StorageEvent) => {
      if (event.key === WATCHED_STORAGE_KEY) void store.refresh();
    };
    const handleVisibility = () => {
      if (document.visibilityState === "visible") void store.refresh();
    };
    window.addEventListener("storage", handleStorage);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.removeEventListener("storage", handleStorage);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, []);

  useEffect(() => {
    if (snapshot.phase === "READY" && snapshot.data.profile) {
      void requestPersistentStorage();
    }
  }, [snapshot]);

  return { snapshot, store: getAppStore() };
}
