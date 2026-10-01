import { afterEach, describe, expect, it, vi } from "vitest";

import {
  SOCIAL_AUTH_OPTIONS,
  socialProviderId,
  startSocialSignIn,
} from "../src/lib/sync/social-auth";

const { signInWithOAuth } = vi.hoisted(() => ({
  signInWithOAuth: vi.fn().mockResolvedValue({ error: null }),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ auth: { signInWithOAuth } }),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("social auth requests", () => {
  it.each(["google", "kakao", "naver"] as const)(
    "returns %s to the preview origin and only overrides Kakao scopes",
    async (provider) => {
      const origin = "https://super-gongik-test-club-paradiso.vercel.app";
      vi.stubGlobal("window", { location: { origin } });
      vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://test.supabase.co");
      vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "public-test-key");

      await startSocialSignIn(provider);

      expect(signInWithOAuth).toHaveBeenCalledExactlyOnceWith({
        provider: socialProviderId(provider),
        options: {
          redirectTo: origin,
          ...(provider === "kakao"
            ? { queryParams: { scope: "profile_nickname profile_image" } }
            : {}),
        },
      });
    },
  );
});

describe("social auth provider mapping", () => {
  it("uses built-in Supabase providers for Google and Kakao", () => {
    expect(socialProviderId("google")).toBe("google");
    expect(socialProviderId("kakao")).toBe("kakao");
  });

  it("uses the documented custom OIDC identifier for NAVER", () => {
    expect(socialProviderId("naver")).toBe("custom:naver");
  });

  it("keeps the three sign-in options in the intended UI order", () => {
    expect(SOCIAL_AUTH_OPTIONS.map((option) => option.id)).toEqual([
      "google",
      "kakao",
      "naver",
    ]);
  });
});
