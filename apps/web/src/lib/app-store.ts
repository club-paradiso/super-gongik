import "client-only";

import {
  STORAGE_KEYS,
  createId,
  createUserDataRepository,
  createUserDataStore,
  type UserDataStore,
} from "@super-gongik/domain";

import { browserWriteLock, createBrowserStorage } from "./browser-storage";

let store: UserDataStore | null = null;

export function getAppStore(): UserDataStore {
  if (!store) {
    store = createUserDataStore({
      repository: createUserDataRepository(createBrowserStorage(), {
        now: () => new Date().toISOString(),
        createId,
      }),
      createId,
      writeLock: browserWriteLock(),
    });
  }
  return store;
}

export const WATCHED_STORAGE_KEY = STORAGE_KEYS.current;
