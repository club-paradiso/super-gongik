/**
 * Public cloud-sync configuration, inlined at build time. Both values are
 * public client configuration (the Supabase URL and anon/publishable key);
 * access control is enforced by Row Level Security on the server.
 */
export type CloudConfig = { url: string; anonKey: string };

export function readCloudConfig(): CloudConfig | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  return url && anonKey ? { url, anonKey } : null;
}

/** supabase-js's default session storage key for a project URL. */
export function sessionStorageKey(url: string): string {
  return `sb-${new URL(url).hostname.split(".")[0]}-auth-token`;
}

/**
 * True when this device may hold a session: one was stored before, or the
 * page is returning from a sign-in link. Pure local check — no network.
 */
export function mayHaveSession(
  config: CloudConfig,
  storage: Pick<Storage, "getItem">,
  location: { search: string; hash: string },
): boolean {
  try {
    if (storage.getItem(sessionStorageKey(config.url)) !== null) return true;
  } catch {
    return false;
  }
  return (
    /[?&]code=/.test(location.search) ||
    /access_token=|error_description=/.test(location.hash)
  );
}
