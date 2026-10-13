import { readCloudConfig } from "./cloud-config";

export type SocialAuthProvider = "google" | "kakao" | "naver";

export const SOCIAL_AUTH_OPTIONS: ReadonlyArray<{
  id: SocialAuthProvider;
  label: string;
  pendingLabel: string;
}> = [
  {
    id: "kakao",
    label: "카카오로 계속하기",
    pendingLabel: "카카오 연결 중…",
  },
  {
    id: "google",
    label: "Google로 계속하기",
    pendingLabel: "Google 연결 중…",
  },
  {
    id: "naver",
    label: "NAVER로 계속하기",
    pendingLabel: "NAVER 연결 중…",
  },
];

const PROVIDER_IDS: Record<SocialAuthProvider, string> = {
  google: "google",
  kakao: "kakao",
  naver: "custom:naver",
};

export type SocialSignInErrorKind = "UNCONFIGURED" | "NETWORK" | "PROVIDER";

export class SocialSignInError extends Error {
  constructor(readonly kind: SocialSignInErrorKind) {
    super(kind);
    this.name = "SocialSignInError";
  }
}

export function socialProviderId(provider: SocialAuthProvider): string {
  return PROVIDER_IDS[provider];
}

/**
 * Sign-in methods that work on the hosted project. NAVER needs the
 * `custom:naver` provider and the email code needs custom SMTP (the built-in
 * sender reaches organization members only), so both stay hidden until the
 * build says otherwise — the same rule as the iOS SG_SIGN_IN_* settings.
 */
export type SignInFlags = { email: boolean; naver: boolean };

export function readSignInFlags(): SignInFlags {
  return {
    email: process.env.NEXT_PUBLIC_SIGN_IN_EMAIL === "true",
    naver: process.env.NEXT_PUBLIC_SIGN_IN_NAVER === "true",
  };
}

export function enabledSocialOptions(flags: SignInFlags) {
  return SOCIAL_AUTH_OPTIONS.filter(
    (option) => option.id !== "naver" || flags.naver,
  );
}

/**
 * Where Supabase sends the browser back. The trailing slash matters: the
 * allow-list patterns end in `/**`, which matches `origin/` but not a bare
 * origin, and an unmatched preview origin silently falls back to the
 * production Site URL.
 */
export function authRedirectURL(origin: string): string {
  return `${origin.replace(/\/+$/, "")}/`;
}

/** GoTrue came back with ?error=… or #error=… instead of a code. */
export function hasAuthReturnError(location: {
  search: string;
  hash: string;
}): boolean {
  return /[?&#]error(_description)?=/.test(location.search + location.hash);
}

/** The same URL without GoTrue's error parameters (for history.replaceState). */
export function withoutAuthReturnError(href: string): string {
  const url = new URL(href);
  for (const key of ["error", "error_code", "error_description"]) {
    url.searchParams.delete(key);
  }
  if (/error/.test(url.hash)) url.hash = "";
  return url.pathname + url.search + url.hash;
}

/**
 * Starts a Supabase OAuth/OIDC redirect without loading the cloud-sync
 * controller first. Guest mode therefore stays network-free until the user
 * explicitly presses a sign-in button.
 *
 * Google and Kakao are built-in Supabase providers. NAVER is configured in
 * Supabase as the custom OIDC provider `custom:naver`.
 */
export async function startSocialSignIn(
  provider: SocialAuthProvider,
): Promise<void> {
  const config = readCloudConfig();
  if (!config || typeof window === "undefined") {
    throw new SocialSignInError("UNCONFIGURED");
  }

  const { createClient } = await import("@supabase/supabase-js");
  const client = createClient(config.url, config.anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      flowType: "pkce",
    },
  });

  const providerId = socialProviderId(provider) as Parameters<
    typeof client.auth.signInWithOAuth
  >[0]["provider"];

  const { error } = await client.auth.signInWithOAuth({
    provider: providerId,
    options: {
      redirectTo: authRedirectURL(window.location.origin),
      // Supabase's Kakao defaults include account_email even when email is
      // optional. Override the provider scope for non-Biz Kakao apps.
      ...(provider === "kakao"
        ? { queryParams: { scope: "profile_nickname profile_image" } }
        : {}),
    },
  });

  if (!error) return;
  if (error.status === 0 || error.status === undefined) {
    throw new SocialSignInError("NETWORK");
  }
  throw new SocialSignInError("PROVIDER");
}
