"use client";

import { useCallback, useSyncExternalStore } from "react";

import {
  type AppTheme,
  readTheme,
  setTheme,
  subscribeTheme,
} from "@/lib/theme";

/** The browser's theme preference; the server always renders the default. */
export function useTheme(): [AppTheme, (theme: AppTheme) => void] {
  const theme = useSyncExternalStore(
    subscribeTheme,
    readTheme,
    (): AppTheme => "standard",
  );
  const update = useCallback((next: AppTheme) => setTheme(next), []);
  return [theme, update];
}
