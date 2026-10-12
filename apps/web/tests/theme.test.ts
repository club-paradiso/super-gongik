import { describe, expect, it } from "vitest";

import {
  APP_THEMES,
  THEME_BOOT_SCRIPT,
  THEME_STORAGE_KEY,
  parseTheme,
} from "../src/lib/theme";

/** Runs the inline boot script against a stub document and storage. */
function boot(storage: { getItem(key: string): string | null }) {
  const attributes: Record<string, string> = {};
  const document = {
    documentElement: {
      setAttribute(name: string, value: string) {
        attributes[name] = value;
      },
    },
  };
  new Function("localStorage", "document", THEME_BOOT_SCRIPT)(
    storage,
    document,
  );
  return attributes["data-theme"];
}

describe("theme preference", () => {
  it("offers the same two themes as iOS, standard first", () => {
    expect(APP_THEMES.map((theme) => theme.value)).toEqual([
      "standard",
      "warrior",
    ]);
    expect(APP_THEMES.map((theme) => theme.title)).toEqual(["일반", "워리어"]);
  });

  it("falls back to the standard theme for anything unknown", () => {
    expect(parseTheme("warrior")).toBe("warrior");
    expect(parseTheme("standard")).toBe("standard");
    expect(parseTheme(null)).toBe("standard");
    expect(parseTheme("WARRIOR")).toBe("standard");
    expect(parseTheme("dark")).toBe("standard");
  });

  it("applies the stored theme before paint", () => {
    expect(
      boot({
        getItem: (key) => (key === THEME_STORAGE_KEY ? "warrior" : null),
      }),
    ).toBe("warrior");
    expect(boot({ getItem: () => null })).toBe("standard");
    expect(boot({ getItem: () => "neon" })).toBe("standard");
  });

  it("keeps the server default when storage throws", () => {
    expect(
      boot({
        getItem: () => {
          throw new Error("SecurityError");
        },
      }),
    ).toBeUndefined();
  });
});
