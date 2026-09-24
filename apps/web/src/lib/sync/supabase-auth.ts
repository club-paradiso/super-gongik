import {
  CloudAuthError,
  type CloudAuth,
  type CloudSession,
} from "./cloud-controller";
import type { CloudConfig } from "./cloud-config";
import { createSupabaseTransport } from "./supabase-transport";

/**
 * Supabase Auth with a one-time email code (or the magic link in the same
 * email). Loaded with a dynamic import, so guests never download the SDK.
 */
export async function loadSupabaseAuth(
  config: CloudConfig,
): Promise<CloudAuth> {
  const { createClient } = await import("@supabase/supabase-js");
  const client = createClient(config.url, config.anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      flowType: "pkce",
    },
  });

  const toSession = (
    user: { id: string; email?: string | null } | null | undefined,
  ): CloudSession | null =>
    user ? { userId: user.id, email: user.email ?? null } : null;

  const authError = (error: { status?: number; code?: string } | null) => {
    if (!error) return new CloudAuthError("UNKNOWN");
    if (error.status === 429 || error.code === "over_email_send_rate_limit") {
      return new CloudAuthError("RATE_LIMITED");
    }
    if (
      error.code === "otp_expired" ||
      error.code === "invalid_credentials" ||
      error.status === 403
    ) {
      return new CloudAuthError("INVALID_CODE");
    }
    if (
      error.code === "validation_failed" ||
      error.code === "email_address_invalid"
    ) {
      return new CloudAuthError("INVALID_EMAIL");
    }
    if (error.status === 0 || error.status === undefined) {
      return new CloudAuthError("NETWORK");
    }
    return new CloudAuthError("UNKNOWN");
  };

  return {
    async getSession() {
      const { data } = await client.auth.getSession();
      return toSession(data.session?.user);
    },
    onChange(listener) {
      const { data } = client.auth.onAuthStateChange((_event, session) => {
        // Defer: calling Supabase from inside this callback can deadlock.
        setTimeout(() => listener(toSession(session?.user)), 0);
      });
      return () => data.subscription.unsubscribe();
    },
    async sendCode(email) {
      const { error } = await client.auth.signInWithOtp({
        email,
        options: {
          shouldCreateUser: true,
          emailRedirectTo:
            typeof window === "undefined" ? undefined : window.location.origin,
        },
      });
      if (error) throw authError(error);
    },
    async verifyCode(email, code) {
      const { data, error } = await client.auth.verifyOtp({
        email,
        token: code,
        type: "email",
      });
      const session = toSession(data.user);
      if (error || !session) throw authError(error);
      return session;
    },
    async signOut() {
      // This device only; other devices stay signed in.
      await client.auth.signOut({ scope: "local" });
    },
    transport: () => createSupabaseTransport(client),
  };
}
