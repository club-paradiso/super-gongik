# Cloud sync on iOS

Status: **implemented, verified without a hosted project.** Guests never
contact a backend. Verification against a real Supabase project is still
open (issue #29). Design: [CLOUD_SYNC.md](../CLOUD_SYNC.md),
[ADR 0002](../adr/0002-optional-cloud-sync-supabase.md).

## How it is built (no schema change)

```text
CloudSyncView / CloudModel (Swift, @MainActor)
        │ facade calls (cloudStart, cloudPreview, cloudEnable, …)
        ▼
JavaScriptCore: apps/web/src/lib/sync/cloud-controller.ts   (unchanged)
                packages/domain/src/sync engine + scheduler (unchanged)
                apps/web/src/lib/sync/supabase-transport.ts (unchanged)
                packages/native-core/src/postgrest.ts  ← supabase-js subset
        │ host functions: http, authSession, authSendCode, authVerifyCode,
        │ authSignOut, setTimer, clearTimer, cloudStateChanged
        ▼
SGSync (Swift): URLSession HTTP (pinned to the configured host),
                SupabaseAuth (GoTrue), KeychainSessionStore
```

- The native PostgREST client implements exactly the builder calls the
  web transport makes (`rpc`, `from().select().order()`, `.eq().single()`,
  `setHeader`, `abortSignal`) and maps responses like postgrest-js 2.x.
  Request shapes, response schemas, error categories and account pinning
  are therefore the web's own code.
- Timers run on the core queue (`DispatchWorkItem`); reachability
  (`NWPathMonitor`) and returning to the foreground are hints to the shared
  scheduler; the request itself decides OFFLINE.
- One process, one store, one engine: no locks are passed (the store's
  queue and compare-and-set serialize writes).
- Sign-in uploads nothing; sync is enabled per device after a preview whose
  wording comes from the web (`sync-copy.ts`). Conflicts, held records,
  blocked states (cloud reset, profile mismatch, auth expiry, invalid or
  newer remote data), cloud backups and cloud data deletion follow the web.

## Evidence

| Test                                                                                         | What it proves                                                                                                                                                                  |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/native-core/tests/postgrest.test.ts`                                               | request URLs/headers/bodies and postgrest-js response mapping                                                                                                                   |
| `packages/native-core/tests/cloud.test.ts`                                                   | controller → transport → native client → host contract → PostgREST-shaped facade over the reference server: two devices converge (upload, then download), stale session refused |
| `SGCoreTests/CloudBridgeTests.swift`                                                         | the same controller in JavaScriptCore through the Swift host: guest makes no request, wrong code, sign-in, preview, enable, upload, sign-out scoping                            |
| `SGSyncTests/SupabaseAuthTests.swift`                                                        | auth error kinds (web mapping), email code, refresh/expiry/offline, PKCE URL, host pinning, account deletion                                                                    |
| `apps/web/tests/supabase-transport.integration.test.ts` with `SUPER_GONGIK_IT_CLIENT=native` | every PostgREST + RLS scenario of the web transport, through the native client (CI `database` job; not run locally: PostgREST is not installed here)                            |

## Not verified yet

Hosted Supabase (email delivery, OAuth redirects, Apple, refresh against
real tokens), two physical devices, background behaviour. No background
sync in v1.
