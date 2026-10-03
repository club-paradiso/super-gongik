# Cloud sync on iOS

Status: **not implemented in this branch.** The app is local-only; the
더보기 screen says so and never contacts a backend. This document is the
plan, grounded in the audit of the web implementation
([CLOUD_SYNC.md](../CLOUD_SYNC.md), [ADR 0002](../adr/0002-optional-cloud-sync-supabase.md)).

## Why it is not in v1 of this branch

- Hosted Supabase is not provisioned yet (issue #29): sign-in and sync
  cannot be verified end to end without project credentials.
- Sync is where silent data loss would happen. It ships only with the same
  deterministic evidence the web has (reference server, PostgREST + RLS in
  CI) running through the iOS transport.

## Plan (no schema change)

The database, RLS and RPCs need no change (audit §5).

1. **Engine in JavaScriptCore.** Run `createSyncEngine` and
   `createSyncScheduler` from `packages/domain/src/sync` unchanged inside
   `CoreRuntime`, with:
   - `store`: the same store instance the app uses;
   - `state`: `createSyncStateStore(nativeStorage, userId)` (checkpoint key
     `super-gongik:sync:v1:<userId>` in the same file store);
   - `lock`: omitted (one process, one engine), `writeLock` omitted;
   - `setTimer`/`clearTimer`: host functions backed by `DispatchSourceTimer`
     on the core queue;
   - `transport`: a JS object whose methods call async host functions.
2. **Swift transport** (`SGSync`, URLSession) implementing exactly the wire
   contract in the audit: `POST /rest/v1/rpc/{sync_ensure_account, sync_pull,
sync_push, sync_reset, backup_create, backup_delete}`, `GET
/rest/v1/cloud_backups` (list; single with
   `Accept: application/vnd.pgrst.object+json`), headers `apikey` + pinned
   `Authorization: Bearer`, 20 s timeout, and the same error categorisation
   (status 0 → NETWORK; 401/403/28000/42501/PGRST301/302 → AUTH; 429 →
   RATE_LIMITED; PGRST116 → NOT_FOUND; else SERVER). Errors are rethrown in
   JS as the domain's own `SyncTransportError` (the engine uses
   `instanceof`).
3. **Identity pinning.** Before each request the transport reads the
   Keychain session and refuses if its user differs from the engine's user
   (`ACCOUNT_CHANGED`), as the web transport does.
4. **Triggers.** Local change (2 s debounce, scheduler), foreground
   (throttled 60 s), `NWPathMonitor` reachability as a trigger only (the
   request decides OFFLINE), manual "지금 동기화". No background sync in v1.
5. **UI.** Enable preview with counts and evidence, conflict list with
   per-record choice (using `sync-copy.ts` wording through the bundle),
   blocked states (generation mismatch after a cloud reset, profile
   mismatch, invalid remote), cloud backups through the existing restore
   preview, cloud data deletion with typed confirmation.

## Verification gates

- Engine scenarios from `packages/domain/tests/sync-engine.test.ts` replayed
  through JavaScriptCore against the in-memory reference server.
- Swift transport against PostgREST + PostgreSQL with RLS in the macOS CI
  job (same migrations and locally signed JWTs as the existing database job).
- Hosted verification after #29: email OTP, OAuth, refresh, two devices.
