import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// `@/` resolves to the web app's pure lib modules (home model, projections),
// which the native bundle reuses unchanged.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("../../apps/web/src", import.meta.url)),
    },
  },
});
