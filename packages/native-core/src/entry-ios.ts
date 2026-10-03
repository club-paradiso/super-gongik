import { createNativeRuntime } from "./runtime";

/**
 * Bundle entry for JavaScriptCore. The host loads `sg-shims.js` first, then
 * this bundle, then calls methods on `globalThis.SGCore`.
 */
(globalThis as { SGCore?: unknown }).SGCore = createNativeRuntime();
