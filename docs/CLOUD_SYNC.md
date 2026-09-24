# Optional cloud sync and cloud backup

Status: implemented (Issue #27). Guest, local-only use is unchanged and
remains the default. Decision record:
[ADR 0002](./adr/0002-optional-cloud-sync-supabase.md). The record merge
contract this builds on: [BACKUP_AND_SYNC.md](./BACKUP_AND_SYNC.md) §6.

Two rules hold everywhere below:

- **`documentRevision` is not a distributed clock.** It is this device's
  local write counter. It is never sent as a version, never used as a
  remote cursor and never decides a conflict.
- **Supabase/backend timestamps never decide domain conflicts.** Conflicts
  are decided on the device by each record's own `revision`, `deviceId`,
  `supersedes` and `deletedAt`. Server columns such as `server_updated_at`,
  `created_at`, `reset_at` are informational.

## 1. Architecture

```text
UI (React)  ──local writes──▶  store (controller.ts) ──▶ localStorage
   │                              ▲  (Web Locks + compare-and-set, unchanged)
   │ status                       │ one merge command per sync run
   ▼                              │
cloud controller (web)  ──▶  sync engine (packages/domain/src/sync)
   │  auth (Supabase, lazy)        │  pull → validate → merge → push
   │  scheduler (debounce/backoff) ▼
   └──────────────────────▶  SyncTransport port
                                   │ Supabase adapter (apps/web/src/lib/sync)
                                   ▼
                     PostgREST RPCs → PostgreSQL + RLS (supabase/migrations)
```

- `packages/domain/src/sync/` knows nothing about Supabase: `engine.ts`,
  `push-plan.ts`, `remote.ts` (row validation), `state.ts` (checkpoint),
  `scheduler.ts`, `transport.ts` (port), `memory-server.ts` (reference
  server used by tests).
- `apps/web/src/lib/sync/`: `supabase-transport.ts`, `supabase-auth.ts`,
  `cloud-controller.ts` (auth + engine + scheduler wiring), `cloud.ts`
  (browser singleton), `cloud-config.ts`.
- `supabase/migrations/20260924000000_cloud_sync.sql`: tables, indexes,
  constraints, RLS, policies, guard trigger, RPCs.

## 2. Authentication and local-first behavior

- Sign-in is optional and only needed for sync and cloud backup. Method:
  Supabase Auth email one-time code (the same email also carries a magic
  link). No password, no provider configuration needed.
- **Guest mode never contacts a backend.** Without
  `NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_ANON_KEY` the whole
  feature is hidden. With them, the Supabase SDK is loaded (dynamic import)
  only when the user starts signing in, or when a session was stored on this
  device before. Tested: `apps/web/tests/cloud-controller.test.ts`.
- Signing in does not upload anything. Sync is turned on per device after a
  preview (§4).
- Every local action is committed to local storage first, exactly as
  before. The UI never waits for the network.

## 3. Remote data model

Record-oriented: one row per `(user, collection, record id)`.

| table           | purpose                                                                                                                                                                                                                  |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `sync_accounts` | one row per user: `generation`, `last_seq`, bound `profile_id`, `reset_at`                                                                                                                                               |
| `sync_records`  | `collection`, `record_id`, `seq`, `schema_version`, `payload jsonb` (the record exactly as the app stores it), `device_id` (installation that pushed it), `server_updated_at`. Tombstones are rows with `deletedAt` set. |
| `cloud_backups` | immutable backup-v2 files (newest 10 kept per account)                                                                                                                                                                   |

Synced collections: `profile`, `events`, `leaveAdjustments`,
`leaveSnapshots`, `imports`, `attendanceMonths`, `compensationSnapshots`.

| travels across devices (inside `payload`)                                                                                               | local only                                                                                                                                                                                                                       |
| --------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| every record field, including `revision`, `deviceId` (writer provenance), `supersedes` (ancestry), `deletedAt` (tombstone), `updatedAt` | `documentRevision`, `savedAt`, document `deviceId` (installation identity), previous generation, pre-restore copy, quarantine copies, the sync checkpoint, UI state (modals, previews, open conflicts choices), the auth session |

Transport metadata (never used for conflicts):

- `seq`: per-account sequence assigned by the push function **while holding
  the account row lock**, so sequence order equals commit order. That makes
  "rows with `seq > cursor`" a complete incremental pull.
- `generation`: account sync generation (§8).

Remote payloads are untrusted: every row is validated with the same Zod
schemas as local storage (`validateRemoteRows`, then `userDataSchema` for
ownership and invariants) before it can reach the merge engine (§6).

## 4. Turning sync on (first time on a device)

`engine.previewEnable()` reads everything and changes nothing, then shows:

| case                     | what enabling does                                                                                  |
| ------------------------ | --------------------------------------------------------------------------------------------------- |
| cloud empty, local data  | upload local records                                                                                |
| cloud data, empty device | download (merge into the empty document)                                                            |
| both have data           | merge with the causal rules; counts of downloads, uploads and conflicts are shown; nothing replaced |
| different profile id     | refused (`PROFILE_MISMATCH`): different people are never merged                                     |
| invalid/newer remote     | refused, nothing changed                                                                            |

The user confirms, the checkpoint is created for the account's current
generation, and the first sync runs.

**The confirmation is bound to the preview.** A READY preview carries
`evidence`: the account it was made for, this device's local
`documentRevision` at preview time (local bookkeeping only), and the
account's `generation`, `lastSeq` and bound profile. `enable()` re-reads all
of them immediately before acting and returns `STALE_PREVIEW` (`ACCOUNT`,
`LOCAL` or `REMOTE`) without changing anything if any differ; the UI then
shows a fresh preview and asks again. A different plan never runs under an
old confirmation.

**Decisions never cross accounts.** The sign-in session is shared by the
tabs of one browser, so another tab can switch accounts. The sync panel's
account subtree is keyed by the user id (every open confirmation, preview
and pending choice is dropped on a switch), and every account-scoped action
— delete cloud data, resolve conflicts, upload/delete a backup, turn sync
off — names the account it was decided for; the controller and engine
refuse it for any other account. Conflict resolutions are honored only for
conflicts the merge actually has open in that run, so a stale choice can
never force-push a record.

## 5. Sync lifecycle

One run (`engine.sync`), under a cross-tab Web Lock `super-gongik:sync`
(separate from the data lock, so local edits never wait for the network):

1. **Pull** every row with `seq > cursor` (pages of 500). A generation
   mismatch stops the run (§8). Rows this device already knows at that exact
   `seq` (its own pushes) are skipped.
2. **Validate** all rows plus the stashed remote versions of open
   conflicts. One invalid row blocks the run: nothing is merged, the cursor
   does not move, and the status lists the row key, error code and field
   path (never values).
3. **Merge** with `analyzeMerge(local, remote, …, { incomingDeletions:
"APPLY_NEWER" })` as a single store command: inside the store's
   cross-tab write lock, rebased on the newest local document, saved with
   compare-and-set. A no-op merge writes nothing.
4. **Checkpoint**: record each pulled row's `seq` and version stamp
   (revision, writer, ancestry, digests — no content) and advance the
   cursor. Remote versions of records still in conflict are stashed so the
   conflict stays visible and resolvable after the cursor moves on.
5. **Push** (`planPush`) local records that the cloud lacks, or that
   provably descend from the cloud version, in batches of 200. Each item
   carries the `seq` it replaces.
6. If the server reports any item `STALE` (someone pushed after our pull),
   go back to 1 (at most 3 rounds, then retry later).

Local edits trigger a run after a 2-second debounce; reconnecting
(`online`), returning to the foreground (throttled) and the manual button
trigger one too.

### Pull semantics and the tradeoff

Incremental by cursor. It is correct because `seq` is assigned in commit
order under the account row lock (a pull takes a share lock, so it sees a
consistent page). Tombstones are never garbage-collected, so an incremental
pull never misses a deletion. After a REPLACE restore the device asks for a
full re-pull (cursor 0), because a REPLACE can put versions on the device
that are older than rows the cursor already passed.

### Push semantics

`sync_push` is conditional and idempotent, per item:

- the row already holds exactly this payload → `UNCHANGED` (a retry after a
  lost response is safe);
- the row's `seq` equals the item's `baseSeq` (or both absent) → written
  with a new `seq` → `APPLIED`;
- otherwise → `STALE`, nothing written; the client pulls and merges again.

A whole request is refused (nothing written) on a generation mismatch or
when it would bind the account to a second profile. A record the cloud has
in a newer or concurrent version is never pushed: the device merges (or
asks) instead.

## 6. Conflicts, tombstones, ancestry

Unchanged from [BACKUP_AND_SYNC.md](./BACKUP_AND_SYNC.md) §6, with the sync
policy for deletions:

- a version wins only if it provably descends from the other (same device
  and higher revision, or recorded `supersedes`); otherwise it is a
  structured conflict — **never** a revision-size or timestamp winner;
- a descending tombstone is applied (`APPLY_NEWER`); a tombstone concurrent
  with a live edit is a conflict; a stale live copy never resurrects a
  deletion (the push rule refuses to send it, the merge refuses to apply
  it);
- the user resolves each conflict (this device / cloud). The chosen content
  becomes a settled version above and descending from both, is saved
  locally, pushed, and adopted by devices still on either old branch; the
  conflict never reopens;
- profile: ordered by its content-digest ancestry; concurrent edits are a
  conflict (`UNVERSIONED_DIVERGENT`);
- leave snapshots / import records (no revision): content never changes;
  their live/rolled-back state is derived from their batch's events (under
  the sync policy a snapshot-only batch's rollback also travels) and is only
  pushed when it matches that derivation, so devices cannot flip it back and
  forth.

Conflict UI (`cloud-sync-panel.tsx`) shows the record type, identifying
context (date, kind, note excerpt), both versions (revision, time, deleted),
and a per-record or bulk choice. No raw JSON.

## 7. Device identity

- The installation id is the local document's `deviceId`, created once per
  browser storage and shared by its tabs.
- Records keep their writer's `deviceId`; restoring another device's backup
  preserves those (record provenance), while the current installation keeps
  its own `deviceId` (`replaceUserData`, MERGE keeps local metadata).
  Tested in `sync-engine.test.ts` ("first sign-in on a fresh device…",
  "cloud backup…").
- Copying a browser profile's storage to another machine would clone the
  installation id; its "same device" linear-history assumption would then
  be wrong. Not a supported flow.

## 8. Account sync generation, cloud reset, stale devices

"클라우드 데이터 삭제" calls `sync_reset(expectedGeneration)`: it deletes
every `sync_records` and `cloud_backups` row of the account, clears the
profile binding and increments `generation` — in one transaction under the
account lock.

- Every pull, push and backup upload carries the device's generation. A
  device holding an older one gets `GENERATION_MISMATCH` and **does not
  push** — not automatically, not on retry. Its status shows that the cloud
  was deleted (and when); its local data is untouched.
- Only an explicit user decision ("이 기기 데이터로 동기화 다시 시작")
  starts the device on the new generation: a new preview, then upload.
- The device that deleted the cloud data turns its own sync off.
- The account row (generation, sequence, timestamps — no content) stays,
  which is what makes this protection work.

## 9. Offline behavior and retries

- Offline: local writes succeed as always; the status reads "오프라인 ·
  변경사항 저장됨" (no error styling, no toasts).
- `navigator.onLine` is only a trigger. Whether the backend is reachable is
  decided by the actual request (network failure → `OFFLINE`).
- Retry: 5 s, 15 s, 60 s, 300 s (±20 % jitter); after 8 consecutive
  failures automatic retries stop until the next trigger. Local edits do not
  shorten an active backoff. Blocked states (sign-in expired, cloud reset,
  profile mismatch, invalid remote data) never auto-retry.
- Every step is idempotent: a retry after a failure at any point (before
  the request, after the server applied it, after a local commit) converges
  without duplicates.

## 10. Security

- Browser holds only the public URL and anon (publishable) key. Build-time
  validation rejects a secret/service-role key in `NEXT_PUBLIC_*`.
- RLS enabled **and forced** on all three tables; every policy is
  `user_id = auth.uid()` for `authenticated` only; `anon` has no table or
  function privileges. The account is always `auth.uid()` — no function
  accepts a user id.
- All functions are `SECURITY INVOKER` (RLS applies inside them) with
  `search_path = ''`. A trigger refuses direct table writes without the
  functions' transaction-local flag, so even the owner's client cannot
  bypass the generation/seq rules through PostgREST.
- Tables are not added to a Realtime publication; there is no subscription
  path.
- Diagnostics (`SyncDiagnostic`) carry phases, counts, durations and
  sanitized categories only. Transport errors carry a category and a
  PostgREST code, never a request or response body.
- Storage: Supabase stores data encrypted at rest on its infrastructure.
  **This is not end-to-end encryption**: the service operator can read the
  records. Backups are plain JSON with an integrity checksum (not a
  signature).

Verification: `supabase/tests/database/cloud_sync.test.sql` (owner flows,
cross-user read/write/delete attempts, anon, claim-less JWT, direct-write
guard, reset, stale generation, policy catalog checks; mutation-checked) and
`apps/web/tests/supabase-transport.integration.test.ts` (supabase-js →
PostgREST → PostgreSQL with RLS).

## 11. Backup vs sync

- **Sync** keeps the current state of records converged across devices.
- **Cloud backup** is an immutable, point-in-time backup-v2 file (same
  format and integrity check as a downloaded file), listed with its time,
  newest 10 kept. Restoring one goes through the unchanged restore preview
  (parse → plan → MERGE/REPLACE → confirmation → atomic store restore). A
  cloud backup is never applied directly.

## 12. Data deletion — three separate actions

| action                       | effect                                                                                                                                |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| 로그아웃 (sign out)          | stops syncing on this device; keeps all local records and the checkpoint                                                              |
| 클라우드 데이터 삭제         | deletes synced records and cloud backups of the account (typed confirmation); bumps the generation; no device's local data is touched |
| 이 기기의 모든 데이터 지우기 | deletes this device's records and recovery copies (and its sync checkpoint, so sync is off here); cloud data and sign-in stay         |

## 13. Configuration and tests

Environment (`apps/web/.env.example`): `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY` — both or neither.

Project setup:

1. Apply `supabase/migrations/*.sql` (Supabase CLI `supabase db push`, or
   the SQL editor). Never apply `supabase/tests/shim/*` to a project.
2. Auth → Email: enable email sign-in; add `{{ .Token }}` to the "Magic
   Link" and "Confirm signup" templates so the email carries the code
   (needed for the home-screen app, where a link opens in the browser
   instead); set the site URL / redirect URLs to the app origin.
3. Set the two public variables in Vercel and redeploy.

Tests:

- `pnpm test` — deterministic, no network: engine scenarios against the
  in-memory reference server (`packages/domain/tests/sync-*.test.ts`), web
  controller tests.
- `supabase/tests/run-db-tests.sh` — migrations + SQL policy tests on any
  PostgreSQL 15+ (CI: `database` job).
- `supabase/tests/run-integration.sh` — PostgREST + PostgreSQL end-to-end
  (CI: `database` job). Auth tokens are signed locally; Supabase Auth itself
  is not exercised there.

## 14. Limitations

- Supabase Auth (email delivery, OTP verification, session refresh) and a
  hosted project were not exercised in automated tests; see the PR's
  live-verification checklist.
- Records blocked by a domain invariant (`REJECTED` overlap, `DUPLICATE`
  content under another id) stay as they are on each side; they are
  reported in that run's counts, not stashed.
- Resolving a conflict of a write-once record (import record, leave
  snapshot) to "this device" can raise the same question on another device
  that holds the other content (they have no ancestry).
- Records written by app versions before #26 (no `supersedes`) produce
  one-time conflicts when they differ across devices.
- The checkpoint stores per-record version stamps (~100 bytes per record) in
  `localStorage`, next to the document's three copies.
- iOS Safari / home-screen app behavior was not verified on a device.

## Not implemented yet

- multi-user shared service profiles
- collaborative editing
- end-to-end encryption
- iOS/Android native wrapper
- background (push-triggered) native sync
- cross-account record sharing
- account deletion from inside the app (deleting the Supabase user cascades
  all of its cloud rows)
