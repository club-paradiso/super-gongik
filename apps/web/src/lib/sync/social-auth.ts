import { readCloudConfig } from "./cloud-config";

export type SocialAuthProvider = "google" | "kakao" | "naver";

export const SOCIAL_AUTH_OPTIONS: ReadonlyArray<{
  id: SocialAuthProvider;
  label: string;
  pendingLabel: string;
}> = [
  {
    id: "google",
    label: "Google로 계속하기",
    pendingLabel: "Google 연결 중…",
  },
  {
    id: "kakao",
    label: "카카오로 계속하기",
    pendingLabel: "카카오 연결 중…",
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
      redirectTo: window.location.origin,
    },
  });

  if (!error) return;
  if (error.status === 0 || error.status === undefined) {
    throw new SocialSignInError("NETWORK");
  }
  throw new SocialSignInError("PROVIDER");
}
