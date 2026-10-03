# Security review — native iOS client

Scope: this branch (local-only client). Reviewed 2026-10-04.

| Area                   | State                                                                                                                                                                                                                         |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Local storage          | Files in Application Support with `completeUntilFirstUserAuthentication`; atomic writes; nothing in plaintext caches or the pasteboard.                                                                                       |
| Keychain               | Supabase session only, `AfterFirstUnlockThisDeviceOnly`, never synced; removed on sign-out or account deletion.                                                                                                               |
| Secrets                | None in source or xcconfig. Supabase values are publishable and empty by default; `Config/Local.xcconfig` is git-ignored.                                                                                                     |
| Network                | None for guests. Signed in with cloud configured: Supabase Auth and PostgREST over HTTPS, ephemeral `URLSession` (no cache, no cookies); the sync transport is pinned to the configured host. No analytics or crash SDK.      |
| JavaScript             | `sg-core.js` ships inside the signed bundle and is never downloaded. Only whitelisted facade functions are callable. Host functions expose file KV for the app's own store directory, random bytes, SHA-256 and logging only. |
| Logging                | `os.Logger` with `.private` for every message; messages carry error domains/codes and phases, never record content, notes, tokens or file text.                                                                               |
| Crash reports          | No third-party reporter. Apple's opt-in diagnostics only.                                                                                                                                                                     |
| Screenshots / switcher | Privacy cover on by default when the scene is inactive; optional Face ID/passcode lock with passcode fallback.                                                                                                                |
| Widgets                | Read a minimal snapshot: two dates, formatted leave remaining, next record date and generic category (sick leave and memos read "일정"). Lock Screen shows D-Day/percent only; medium widget details are `privacySensitive`.  |
| Notifications          | Opt-in; titles name a category only; no notes, titles or sick-leave mention on the lock screen.                                                                                                                               |
| Backups                | Plain JSON with an integrity digest (corruption detection, not a signature or encryption); the export screen says so.                                                                                                         |
| Imports                | Backup files are size-checked (≤ 30 MB read, ≤ 10 MB parsed) and fully validated before any write; tampering is rejected (test).                                                                                              |
| Deep links             | None registered.                                                                                                                                                                                                              |
| Debug hooks            | `-SGInitialTab` launch argument compiled only in DEBUG.                                                                                                                                                                       |

## Open items

- The account-deletion Edge Function holds the service-role key in the
  Supabase runtime only; it deletes the user identified by the caller's
  token, never an id from the request (tests in handler_test.ts).
- XcodeGen rewrites `.entitlements` from `project.yml`; entitlements must be
  edited there (a hand-written App Group was silently emptied once).
- `swift test --sanitize=thread` passes every test but reports races inside
  `CoreRuntime.installExceptionHandler` between worker threads. Every
  JavaScriptCore entry asserts `dispatchPrecondition(.onQueue(coreQueue))`,
  and a 400-call concurrent stress test passes with it, so all calls run on
  the one serial queue; the reports come from TSan not seeing the
  happens-before edge of Swift's dispatch-backed actor executor. Kept as a
  known false positive, not suppressed; re-check with each Xcode release.
  The app itself has not been run under TSan.
