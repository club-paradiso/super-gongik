/**
 * Visual theme. A presentation preference only, like `SGTheme` on iOS: it
 * changes color, the hero ornaments and the decorative world-language
 * eyebrows, never a number, a rule or what a screen offers. It is stored per
 * browser, not in the service document, so it is never synced or backed up.
 */
export type AppTheme = "standard" | "warrior";

export const APP_THEMES: ReadonlyArray<{
  value: AppTheme;
  title: string;
  summary: string;
}> = [
  { value: "standard", title: "일반", summary: "차분한 기본 화면" },
  {
    value: "warrior",
    title: "워리어",
    summary: "RPG 여정 분위기 · 세계관 라벨 표시",
  },
];

export const THEME_STORAGE_KEY = "super-gongik:theme";

/** Anything stored that is not a known theme falls back to the default. */
export function parseTheme(value: string | null | undefined): AppTheme {
  return value === "warrior" ? "warrior" : "standard";
}

/**
 * Runs in `<head>` before the first paint so a Warrior user never sees a
 * flash of the standard palette. Kept dependency-free and defensive: storage
 * can throw in private modes.
 */
export const THEME_BOOT_SCRIPT = `(function(){try{var t=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY,
)});document.documentElement.setAttribute("data-theme",t==="warrior"?"warrior":"standard")}catch(e){}})()`;

const listeners = new Set<() => void>();
/** The choice made on this page, for when storage is unavailable. */
let chosen: AppTheme | null = null;

export function readTheme(): AppTheme {
  try {
    return parseTheme(window.localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return chosen ?? "standard";
  }
}

function applyTheme(theme: AppTheme) {
  document.documentElement.setAttribute("data-theme", theme);
}

export function subscribeTheme(listener: () => void) {
  listeners.add(listener);
  // Another tab changed the theme.
  const onStorage = (event: StorageEvent) => {
    if (event.key !== THEME_STORAGE_KEY) return;
    applyTheme(readTheme());
    listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function setTheme(theme: AppTheme) {
  chosen = theme;
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Not persisted (private mode); still applies to this page.
  }
  applyTheme(theme);
  for (const listener of listeners) listener();
}
