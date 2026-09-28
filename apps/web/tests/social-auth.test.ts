import { describe, expect, it } from "vitest";

import {
  SOCIAL_AUTH_OPTIONS,
  socialProviderId,
} from "../src/lib/sync/social-auth";

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
