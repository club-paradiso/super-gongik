# Backup, restore, recovery and the sync-ready merge contract

Status: implemented for local backup/restore (Issue #25). **Remote sync is
not implemented** — see [Not implemented yet](#not-implemented-yet).

Code: `packages/domain/src/store/` — `backup.ts` (file format), `integrity.ts`
(checksum), `sync-contract.ts` (record rules, conflict types), `merge.ts`
(merge engine), `restore.ts` (plan/execute), `repository.ts` (generations,
quarantine), `controller.ts` (store, `restore()`).

## 1. Layers and the storage-provider boundary

```text
UI (React today, native later)
  -> store (controller.ts): in-tab queue, cross-tab write lock (optional),
     rebase on the newest document, read-only fail-closed
     -> pure domain: commands, planRestore/executeRestore, mergeUserData
     -> repository (repository.ts): validation, compare-and-set on
        documentRevision, generations, quarantine, newer-version refusal,
        migrations on read
        -> KeyValueStorage provider: getItem / setItem / removeItem / keys
```

The provider is deliberately tiny. Its obligations (documented on the
interface):

- `setItem` replaces one value atomically: readers see the old or the new
  value, never a mix. A failed `setItem` leaves the old value.
- `setItem` throws on any failure, including quota errors.
- `getItem` returns exactly the last string written, or null.
- Any method may throw when storage is unavailable.

Everything else is above the port, so an IndexedDB, native file or
encrypted-file provider is one adapter file. A remote sync adapter would not
be a provider: it would exchange documents and call `mergeUserData` with the
sync policy (section 6). No new abstraction was added in #25; the existing
boundary was sufficient and is now documented and tested with failing
providers.

Production uses `localStorage` (`apps/web/src/lib/browser-storage.ts`).

### Concurrent writers (tabs and windows)

Every write is read → rebase → validate → write. Two guards keep another
tab's change from being lost:

1. **Cross-tab lock (production web).** `createUserDataStore({ writeLock })`
   runs load, every command and every restore inside one exclusive lock.
   The web passes the Web Locks API (`navigator.locks`, lock name
   `super-gongik:user-data`), shared by every tab and window of the origin.
   Inside the lock the store re-reads the stored document, rebases, re-plans
   a restore, and saves, so no other tab can write in between.
2. **Compare-and-set (always).** `repository.save(next, { expectedRevision })`
   refuses with `ConcurrentWriteError` if the stored `documentRevision` is
   not the one the write was built on. `store.run` then re-runs the (pure)
   command on the newer document, up to 3 attempts; `store.restore` returns
   `STALE_PREVIEW` so the user sees a fresh preview.

Guarantee levels, stated exactly:

| Environment                                                   | Guarantee                                                                                                                                                                                                                           |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Web Locks available (current Chromium, Firefox, Safari 15.4+) | Writes from all tabs of the origin are serialized; no lost update between tabs of this app.                                                                                                                                         |
| No Web Locks                                                  | Compare-and-set catches a write that landed after the base was read, but two tabs that both pass the check before either writes can still lose one change (last `setItem` wins). A deterministic test documents this residual race. |

Writers outside this app (devtools, extensions, another app version that
does not take the lock) are not covered. Locks do not span devices; that is
what the merge contract is for.

## 2. What `documentRevision` means

`documentRevision` is a **per-device write counter** for the stored document.
The store bumps it on every save and uses it only for same-device
concurrency: rebase on a newer document another tab saved, compare-and-set
before writing, and refuse a restore whose preview is stale.

It is **not** a distributed clock. Merge never reads it; two devices'
counters are unrelated numbers. A merge keeps the local `documentRevision`,
`deviceId` and `savedAt`. Tests assert that an incoming document with an
absurd `documentRevision` merges exactly like any other.

## 3. Backup file format

```jsonc
{
  "format": "super-gongik.backup",
  "formatVersion": 2,
  "exportedAt": "2026-09-24T03:00:00.000Z",
  "schemaVersion": 3, // must equal data.schemaVersion
  "integrity": {
    "algorithm": "SHA-256",
    "canonicalization": "JCS",
    "digest": "<64 hex chars>",
  },
  "data": {/* the complete user document, schema 3 */},
}
```

Envelope versions:

| formatVersion | Written by         | Read by this app           | Integrity                     |
| ------------- | ------------------ | -------------------------- | ----------------------------- |
| 1             | releases ≤ #24     | yes                        | none — shown as "체크섬 없음" |
| 2             | this release (#25) | yes                        | verified before anything else |
| > 2           | future apps        | rejected: "update the app" | —                             |

An older deployed app (formatVersion-1 reader) rejects v2 files with its
existing "update the app" message; it cannot misread them.

### Integrity field

`digest = SHA-256(UTF-8(canonicalJson({ data, exportedAt, schemaVersion })))`.
`canonicalJson` sorts object keys by UTF-16 code unit, drops `undefined`,
emits no whitespace and serializes numbers/strings exactly like
`JSON.stringify` — for the JSON subset backups use this is RFC 8785 (JCS), so
a native client can reproduce it. SHA-256 is implemented in plain TypeScript
(synchronous, verified against Node's `crypto` in tests).

**It is corruption detection only.** Anyone who edits the file can recompute
the digest. It is not authentication, not a signature, not proof of origin,
and nothing is encrypted. It detects truncated downloads, damaged copies and
accidental hand edits.

### Parse results

`parseBackup(text)` is pure and returns `{ ok: true, data, summary, info }` or
`{ ok: false, kind, error }`:

| kind                         | Meaning                                                |
| ---------------------------- | ------------------------------------------------------ |
| `TOO_LARGE`                  | over `MAX_BACKUP_BYTES` (10M UTF-16 code units)        |
| `MALFORMED_JSON`             | not JSON                                               |
| `TRUNCATED`                  | not valid JSON but starts like a SUPER GONGIK backup   |
| `FOREIGN_FILE`               | valid JSON, not a SUPER GONGIK backup                  |
| `UNSUPPORTED_FORMAT_VERSION` | envelope from a newer app                              |
| `INTEGRITY_MISMATCH`         | checksum does not match                                |
| `NEWER_SCHEMA`               | document written by a newer schema                     |
| `INVALID_STRUCTURE`          | envelope/document violates the schema, header mismatch |

Order of checks: size → JSON → format marker → envelope version → integrity
(v2) → header/body schema agreement → schema decode/migration.

## 4. Migrations

- Stored/backup documents: schema 2 → 3 (adds empty `attendanceMonths` and
  `compensationSnapshots`). Schema 1 never existed as a document; the
  pre-document `localStorage` layout is migrated by `legacy.ts` and its keys
  are left untouched.
- Newer schema: never decoded, never written over. The app becomes read-only
  (`NEWER_VERSION`), and since #25 the repository itself refuses to save over
  a newer-version document, and a running tab that discovers one (another
  tab updated the app) switches to read-only instead of downgrading it.
- Migrations are pure and deterministic (tested by decoding the same input
  twice). A migrated stored document is persisted once; the pre-migration
  text becomes the previous generation.

No historical migrations were invented.

## 5. Restore: plan, then execute

```ts
const parsed = parseBackup(text); // pure
const plan = planRestore(current, parsed.data, {
  // pure
  mode: "MERGE" | "REPLACE",
  options,
  now,
  deviceId,
});
await store.restore(parsed.data, {
  mode,
  options,
  expectedDocumentRevision: plan.baseDocumentRevision,
  confirmDestructive, // REPLACE only
});
```

`RestorePlan` exposes: `mode`, `destructive`,
`requiresDestructiveConfirmation`, `baseDocumentRevision`, `profile`
compatibility (`SAME_PROFILE`, `NO_LOCAL_PROFILE`, `DIFFERENT_PROFILE`,
`NO_BACKUP_PROFILE`), per-collection `counts` by outcome, `changes`
(every non-trivial per-record outcome), structured `conflicts`, `blocked`
reason, and the `result` document.

Outcomes per record: `UNCHANGED`, `ADDED`, `ADDED_HISTORY`, `UPDATED`,
`RESTORED`, `DELETED`, `RETAINED_LOCAL`, `INCOMING_DELETION_NOT_APPLIED`,
`LOCAL_DELETION_KEPT`, `DUPLICATE`, `REJECTED` (+ reason `LEAVE_OVERLAP`,
`CREDIT_ALREADY_CONFIRMED`, `MONTH_ALREADY_CONFIRMED`,
`BATCH_RECORDS_UNAVAILABLE`), `CONFLICT`, `RESOLVED_LOCAL`,
`RESOLVED_INCOMING`, `HISTORY_UPDATED`, and for REPLACE `REMOVED` /
`REPLACED`.

### `store.restore` guarantees

1. Holds the cross-tab write lock (when available) for all of the steps
   below, re-reads storage and refuses (`STALE_PREVIEW`) if the document
   changed since the preview (another tab/window wrote).
2. Refuses in read-only states (`READ_ONLY`: newer version, storage
   unreadable, unreadable data not yet copied).
3. Re-plans; refuses if blocked (`BLOCKED`: foreign profile for MERGE,
   unresolved conflicts).
4. REPLACE over existing data: refuses without `confirmDestructive`
   (`CONFIRMATION_REQUIRED`), then writes a pre-restore copy; if that copy
   cannot be written it stops (`PRESERVE_FAILED`) before touching the
   document.
5. Writes the whole new document with one compare-and-set `save`. If
   another tab slipped in (possible only without Web Locks) it returns
   `STALE_PREVIEW` and writes nothing. On a storage failure
   (`STORAGE_WRITE_FAILED`) the stored document is byte-identical to before
   and the in-memory snapshot returns to it.

Restore is therefore atomic from the user's point of view: it either applied
everything the preview showed or nothing. Tests inject quota errors on each
key (current, previous, pre-restore, quarantine) to prove it.

## 6. Merge contract (record level)

Applies to `events`, `leaveAdjustments`, `attendanceMonths`,
`compensationSnapshots` (all carry `id`, `revision`, `updatedAt`,
`deletedAt`, `deviceId`).

**What a revision proves.** `revision` is incremented by the device that
edits a record. Along one device's history (same `deviceId` on both
versions) a higher revision is a later version. Across devices it proves
nothing: two devices editing from the same base count up independently, so
"3 > 2" does not mean the rev-3 device saw the rev-2 change. There is no
causal metadata (no version vector, no "based on" field) in schema 3, so the
contract never picks a winner between devices by number.

"Payload" is the record minus `revision`, `updatedAt` and `deviceId`, with
`deletedAt` reduced to deleted/not deleted. A tombstone is part of the
payload.

| Case | Local vs incoming                                                          | Result                                                                 |
| ---- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| C    | same payload (any revisions, any devices)                                  | no-op (`UNCHANGED`)                                                    |
| A    | same device, incoming revision higher                                      | incoming applied (`UPDATED`/`RESTORED`) unless it breaks an invariant  |
| B    | same device, incoming revision lower                                       | local kept (`RETAINED_LOCAL`)                                          |
| D    | equal revision, different payload                                          | conflict `EQUAL_VERSION_DIVERGENT`; merge refused until resolved       |
| D'   | different devices, different revisions, different payload (incl. liveness) | conflict `CROSS_DEVICE_DIVERGENT`; merge refused until resolved        |
| E    | same device: local tombstone newer than incoming live copy                 | deletion kept (`LOCAL_DELETION_KEPT`)                                  |
| E'   | other device: tombstone vs live edit, whatever the revisions               | conflict (D or D') — never a silent resurrection or deletion           |
| F    | same device: incoming tombstone newer than local live record               | recovery merge: not applied, reported; `APPLY_NEWER`: applied          |
| G    | same content, different id                                                 | not added (`DUPLICATE`), reported; distinct content kept               |
| H    | device far behind                                                          | same device: cases A/B/E; other device: conflicts, nothing overwritten |

Consequence to be aware of: a record edited on phone A after it was
restored from phone B's backup carries A's device id, so merging B's older
copy back conflicts even though A's edit came later. That is the safe side
of missing causal metadata; the UI offers "모두 이 기기 값 유지" for exactly
this.

**Options (`MergeOptions`) — every place a human decides:**

- `resolutions: { [conflict.key]: "LOCAL" | "INCOMING" }` — the only way
  past cases D/D'. The chosen side is kept **verbatim** (no revision is
  invented), so a merge applied again with the same resolutions yields the
  same document. Without resolutions, merging the same divergent copy again
  asks again, because nothing proves an order.
- `restoreLocallyDeleted: true` — bring back records deleted on this device
  that an older copy of the same device still has live (case E). The
  restored record gets `revision = max + 1`. Off by default; offered as a
  checkbox in the UI. _Before #25 this was the unconditional behavior._
- `incomingDeletions: "KEEP_LOCAL_LIVE"` (default, backup recovery) or
  `"APPLY_NEWER"` (case F). A future sync adapter would need the same rules
  plus causal metadata to converge without human input; see
  [Not implemented yet](#not-implemented-yet).

**Records without a revision:**

- `profile`: no revision, no device id. Any difference in content is a
  conflict (`UNVERSIONED_DIVERGENT`); timestamps do not decide. A backup of
  a different profile id cannot be merged.
- `leaveSnapshots`, `imports`: written once. Different content under one id
  is `IMMUTABLE_RECORD_DIVERGENT`. Their live/rolled-back state follows the
  events of their import batch; a snapshot-only batch's deleted snapshots
  come back only with `restoreLocallyDeleted`.

**Domain invariants stay above the record rules:** a record that would
charge the same leave twice, give one credit two confirmations or one month
two live attendance answers is not applied (`REJECTED`/`DUPLICATE`, local
kept, reason reported). A rolled-back batch never owns live records.

### Conflict shape

```ts
{
  key: "events:<id>",            // for resolutions
  collection: "events",
  recordId: "<id>",
  type:
    | "EQUAL_VERSION_DIVERGENT"
    | "CROSS_DEVICE_DIVERGENT"
    | "IMMUTABLE_RECORD_DIVERGENT"
    | "UNVERSIONED_DIVERGENT",
  local:    { revision, updatedAt, deleted },
  incoming: { revision, updatedAt, deleted },
}
```

Only version metadata — no notes, reasons or amounts.

### Properties (tested)

- **Deterministic**: independent of incoming array order.
- **Pure**: neither input is mutated.
- **Idempotent** when no conflict is unresolved: `merge(merge(L, B), B)`
  equals `merge(L, B)` for every option combination tested, and with the
  same `resolutions` when there were conflicts.
- **Commutative** on record content **only** under
  `incomingDeletions: "APPLY_NEWER"` with no conflicts and no duplicate
  content under different ids. Not commutative by design:
  - recovery merge keeps local live records the other side deleted;
  - duplicate content under two ids keeps the one the local side has;
  - document metadata (`deviceId`, `documentRevision`, `savedAt`) is local.
- **Conflicts are symmetric**: if A→B stops on a record, B→A stops on the
  same record. They are never made "commutative" by picking a winner.

### Restore vs a newer deletion (case F, exact semantics)

- MERGE an older backup of this device after deleting a record here: the
  record stays deleted, shown as "이 기기에서 지운 상태 유지"; the user may
  tick "지운 기록도 되살리기".
- MERGE a later backup of this device in which the record was deleted: your
  live record stays, shown as "백업의 삭제는 적용 안 함".
- MERGE a backup from another device where the record was deleted while it
  was edited here (or the reverse): a conflict; the user picks a side.
- REPLACE: the backup is taken verbatim, deletions and resurrections
  included, after destructive confirmation and a pre-restore copy.

## 7. Local recovery (repository)

Keys: `super-gongik:data:v2` (current), `…:previous` (previous generation),
`…:pre-restore`, `super-gongik:quarantine:<timestamp>[:previous]`.

- Every save moves the current document to `previous` **only if it is a
  readable document of this version**. Unreadable bytes are quarantined
  instead, so a corrupt copy can never push out the last good generation.
  (#25 fix: previously a failed write during recovery could leave both keys
  holding corrupt text.)
- Load: current unreadable → quarantine copy; previous readable →
  `RECOVERED`; both unreadable → both quarantined, `CORRUPT` (empty app,
  writable; both copies stay).
- If the quarantine copy cannot be written (quota), the bytes are left at
  the live key, the outcome says `quarantineInPlace: true`, and the app is
  read-only so the only copy is never overwritten. The repository also
  refuses to overwrite unreadable bytes it could not copy.
- Quarantine copies are deduplicated by content.
- `store.load()` is idempotent, so a second call cannot hide a
  `RECOVERED`/`MIGRATED` notice.
- "Delete all data" still purges every copy, by explicit request only.

User-facing copy never says data is gone when a copy exists; it says where
the unreadable original is and offers it as a download.

## 8. PWA / browser behavior

| Scenario                                        | Unit                                | Chromium (Playwright)                                     | iOS Safari   |
| ----------------------------------------------- | ----------------------------------- | --------------------------------------------------------- | ------------ |
| reload immediately after write                  | ✓                                   | ✓                                                         | not verified |
| multiple tabs / stale tab write                 | ✓ (lock, CAS, racing interleavings) | ✓ (storage event; restore waits for a held Web Lock)      | not verified |
| storage write failure / quota                   | ✓ (simulated `QuotaExceededError`)  | —                                                         | not verified |
| storage unavailable (`SecurityError`)           | ✓ (simulated)                       | —                                                         | not verified |
| app update with old-schema data                 | ✓ (v2→v3, newer-version tab)        | —                                                         | not verified |
| offline startup with existing data              | —                                   | ✓ (service worker, offline context)                       | not verified |
| offline → online                                | —                                   | ✓ (storage unchanged)                                     | not verified |
| file-picker cancel                              | —                                   | partial (empty file list; real cancel UI not automatable) | not verified |
| backup parse failure / corrupt file             | ✓                                   | ✓                                                         | not verified |
| restore preview cancel / refresh before confirm | ✓ (nothing written)                 | ✓                                                         | not verified |
| large backup (1,500 events, ~1.1 MB file)       | ✓                                   | ✓                                                         | not verified |
| corrupt current + valid previous                | ✓                                   | ✓                                                         | not verified |
| corrupt current + corrupt previous              | ✓                                   | ✓                                                         | not verified |
| newer-schema local document                     | ✓                                   | ✓                                                         | not verified |

No part of this was verified on a real iPhone or in iOS Safari/WebKit.
Assumptions that remain unverified there: `localStorage` quota (~5 MB,
UTF-16 accounting in some engines), eviction of site data for home-screen
apps after inactivity (`navigator.storage.persist()` is requested but may be
declined), and file-picker behavior.

The service worker caches the app shell only; it never reads or writes user
data. Going online triggers no data code path.

## 9. Current limitations

- Storage headroom: current + previous + pre-restore (+ quarantine) are full
  copies. A 1,500-event document is ~0.7 MB of JSON, so three copies fit in
  a typical 5 MB `localStorage` budget, but much larger histories could hit
  the quota. Writes then fail safely (tested), but the user must free space
  or export.
- No causal metadata: cross-device edits always need a human choice, even
  when one side really did see the other's change, and re-merging the same
  divergent file asks again unless the same resolutions are passed.
- Without the Web Locks API, two tabs writing at the same instant can still
  lose one change (section 1).
- Only one pre-restore slot: a second REPLACE overwrites the first
  pre-restore copy (the exported backup is the durable copy).
- Leave snapshots and import records have no revision; divergence under one
  id is a conflict and, if resolved to LOCAL, recurs on the next merge with
  the same file.
- Conflict resolution UI is per record, with version metadata only; it does
  not show both contents side by side.

## Not implemented yet

- remote/cloud synchronization (no server, no sync adapter, no queue)
- causal metadata (version vectors / "based on" revisions) needed for
  conflict-free convergence between devices
- account/login/authentication
- server-side backup
- multi-user sharing
- end-to-end encryption (backups are plain JSON; the checksum is not
  encryption or a signature)
- Capacitor/iOS native wrapper
