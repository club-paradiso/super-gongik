import { afterEach, describe, expect, it, vi } from "vitest";

import {
  SOCIAL_AUTH_OPTIONS,
  hasAuthReturnError,
  socialProviderId,
  startSocialSignIn,
  withoutAuthReturnError,
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
  it.each(["kakao", "google", "naver"] as const)(
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
          redirectTo: `${origin}/`,
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
      "kakao",
      "google",
      "naver",
    ]);
  });
});

describe("returning from a sign-in that did not finish", () => {
  it("recognises GoTrue's error in the query (PKCE) and in the hash", () => {
    expect(
      hasAuthReturnError({
        search: "?error=access_denied&error_description=User+denied",
        hash: "",
      }),
    ).toBe(true);
    expect(
      hasAuthReturnError({ search: "", hash: "#error_description=denied" }),
    ).toBe(true);
  });

  it("ignores a successful return and ordinary addresses", () => {
    expect(hasAuthReturnError({ search: "?code=abc", hash: "" })).toBe(false);
    expect(hasAuthReturnError({ search: "?tab=calendar", hash: "" })).toBe(
      false,
    );
    expect(hasAuthReturnError({ search: "", hash: "" })).toBe(false);
  });

  it("removes only GoTrue's error parameters from the address", () => {
    expect(
      withoutAuthReturnError(
        "https://app.example/?tab=profile&error=access_denied&error_code=x&error_description=denied",
      ),
    ).toBe("/?tab=profile");
    expect(
      withoutAuthReturnError("https://app.example/#error=server_error"),
    ).toBe("/");
  });
});
