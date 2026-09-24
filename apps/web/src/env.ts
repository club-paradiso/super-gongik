import { z } from "zod";

const appEnvironmentSchema = z.preprocess(
  (value) => {
    if (typeof value !== "string") {
      return value;
    }

    const normalized = value
      .trim()
      .toLowerCase()
      .replace(/^next_public_app_env\s*=\s*/, "")
      .replace(/^['"]|['"]$/g, "");

    if (normalized === "") {
      return undefined;
    }

    const aliases: Record<string, "development" | "staging" | "production"> = {
      dev: "development",
      development: "development",
      preview: "staging",
      stage: "staging",
      staging: "staging",
      prod: "production",
      production: "production",
    };

    return aliases[normalized] ?? normalized;
  },
  z.enum(["development", "staging", "production"]).optional(),
);

/**
 * Catch the most damaging misconfiguration: a privileged key in a variable
 * that is inlined into the browser bundle. Recognises Supabase secret keys
 * (`sb_secret_…`) and legacy JWT keys whose role is `service_role`.
 */
export function isPrivilegedSupabaseKey(key: string | undefined): boolean {
  if (!key) return false;
  if (key.startsWith("sb_secret_")) return true;
  const parts = key.split(".");
  if (parts.length !== 3) return false;
  try {
    const base64 = parts[1]!.replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(
      typeof atob === "function"
        ? atob(base64)
        : Buffer.from(base64, "base64").toString("utf8"),
    ) as { role?: unknown };
    return payload.role === "service_role";
  } catch {
    return false;
  }
}

const optionalText = z.preprocess(
  (value) =>
    typeof value === "string" && value.trim() === "" ? undefined : value,
  z.string().trim().optional(),
);

const environmentSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).optional(),
    NEXT_PUBLIC_APP_ENV: appEnvironmentSchema,
    /**
     * Optional cloud sync (Supabase). Both public values or neither: without
     * them the app is local-only and never contacts a backend. Only the
     * public anon (publishable) key belongs here — never a service-role key.
     */
    NEXT_PUBLIC_SUPABASE_URL: optionalText.pipe(
      z
        .string()
        .url()
        .refine(
          (value) =>
            value.startsWith("https://") ||
            /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(value),
          "NEXT_PUBLIC_SUPABASE_URL must use https (http only for localhost).",
        )
        .optional(),
    ),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: optionalText,
  })
  .superRefine((value, context) => {
    if (
      Boolean(value.NEXT_PUBLIC_SUPABASE_URL) !==
      Boolean(value.NEXT_PUBLIC_SUPABASE_ANON_KEY)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Set both NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY, or neither.",
      });
    }
    if (isPrivilegedSupabaseKey(value.NEXT_PUBLIC_SUPABASE_ANON_KEY)) {
      context.addIssue({
        code: "custom",
        message:
          "NEXT_PUBLIC_SUPABASE_ANON_KEY holds a secret/service-role key. Use the public anon (publishable) key; secret keys must never reach the browser.",
      });
    }
  });

export function validateEnvironment(raw: Record<string, string | undefined>) {
  return environmentSchema.parse(raw);
}

export const environment = validateEnvironment({
  NODE_ENV: process.env.NODE_ENV,
  NEXT_PUBLIC_APP_ENV: process.env.NEXT_PUBLIC_APP_ENV,
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
});
