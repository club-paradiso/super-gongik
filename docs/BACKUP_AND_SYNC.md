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

Every write is a read-modify-write of one document: read the stored
document, rebase the command or restore on it, validate, write. Writing a
single `localStorage` value is atomic; the read-modify-write sequence is not.
Two mechanisms make the whole transaction safe.

1. **Cross-tab write lock (critical section).**
   `createUserDataStore({ writeLock })` runs `load` (which may persist a
   migration or recovery), every `run` and every `restore` inside one
   exclusive lock. Everything happens **inside** the lock: re-read storage,
   check read-only states (newer schema, unreadable data), rebase the
   command or re-plan the restore, verify the preview's
   `expectedDocumentRevision`, write the pre-restore copy, save. Nothing is
   read before the lock and written after it. The web passes the Web Locks
   API (`navigator.locks.request("super-gongik:user-data", { mode:
"exclusive" })`, `apps/web/src/lib/browser-storage.ts`), shared by every
   tab and window of the origin. `refresh()` only reads and takes no lock.
2. **Atomic compare-and-set commit (always).** The repository reads the
   stored text, checks its `documentRevision` against the base the write
   was built on (`save(next, { expectedRevision })`), and commits with the
   provider's optional `compareAndSet(key, expectedText, newText)`, which
   writes only if the stored text is still exactly what was read. The
   `localStorage` adapter implements it as one synchronous
   `getItem`/compare/`setItem` block. If anything was saved in between, the
   save throws `ConcurrentWriteError` and writes nothing: `store.run`
   re-runs the pure command on the newer document (up to 3 attempts) and
   `store.restore` returns `STALE_PREVIEW`.

Guarantees, stated exactly:

| Environment                                                                                                                 | Guarantee                                                                                                                                                                                                                                                                                                                                                                                                  |
| --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Web Locks available (Chrome/Edge 69+/79+, Firefox 96+, Safari and iOS Safari 15.4+, per MDN compatibility data; HTTPS only) | Writes from every tab/window of the origin running this app version are serialized. No lost update between them. Verified in unit tests with a deterministic mutex and in headless Chromium.                                                                                                                                                                                                               |
| No Web Locks, `localStorage` adapter                                                                                        | No serialization. The compare-and-set commit refuses any write whose base changed before the commit block ran, so the tested interleavings (both tabs read N, one commits first) never lose a change. It relies on `localStorage` being read and written consistently within one synchronous block; browsers that sync `localStorage` between processes lazily do not formally guarantee that across tabs. |
| A provider without `compareAndSet` and no lock                                                                              | Degraded: the revision check and the write are separate steps, and a write landing between them can be lost. A test documents this. No production path uses this combination.                                                                                                                                                                                                                              |

Not covered: writers outside this app (devtools, extensions) and an older
app version still open in another tab (it neither takes the lock nor
compare-and-sets). The lock does not span devices; that is what the merge
contract is for.

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

This section is about **merging two copies of one person's data** (backup
MERGE today). Keep four layers apart:

1. **Local backup/recovery semantics**: MERGE never deletes a live local
   record, never resurrects a newer local deletion unless asked, and refuses
   to apply anything while a conflict is open (sections 5–6).
2. **Same-device linear history**: one device's versions of a record form a
   line (its tabs are serialized, section 1), so there a higher `revision`
   is later.
3. **Cross-device divergent history**: two devices editing from a common
   base produce concurrent versions. Revision size says nothing about which
   saw which; only recorded ancestry does. Without it, the result is a
   structured conflict.
4. **Future remote sync** (not implemented): would reuse these rules but
   also needs an outbox, tombstone retention/garbage collection, and
   ancestry kept by every client (section 9).

### Versions and ancestry

Applies to `events`, `leaveAdjustments`, `attendanceMonths`,
`compensationSnapshots`. Each version carries `revision` (per-record edit
counter), `deviceId` (the device that wrote it), `updatedAt`, `deletedAt`,
and since #25 an optional `supersedes` map: for each **other** device, the
highest revision of this record that this version is known to descend from.

- Commands (`nextVersion`) write `revision + 1`, this device's id, and carry
  over the previous version's ancestry plus the previous writer itself. So a
  record created on phone B, restored onto phone A and edited there records
  `supersedes: { B: 1 }`.
- `supersedes` is additive and optional: **no schema version change, no
  migration**. Existing records simply have none (the conservative case).
  An older app version drops it when it saves, which can only produce extra
  conflicts later, never a silent overwrite.

Version V **descends from** W when either:

- V and W come from the same device and V.revision > W.revision, or
- V.supersedes[W.deviceId] ≥ W.revision.

"Payload" is the record minus `revision`, `updatedAt`, `deviceId` and
`supersedes`, with `deletedAt` reduced to deleted/not deleted. A tombstone is
part of the payload.

| Case | Local vs incoming                                                                    | Result                                                                       |
| ---- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| C    | same payload, any versions                                                           | `UNCHANGED`; if incoming descends from local, its metadata is adopted        |
| A    | incoming descends from local (e.g. same device, higher revision)                     | incoming applied (`UPDATED`/`RESTORED`) unless it breaks an invariant        |
| B    | local descends from incoming                                                         | local kept (`RETAINED_LOCAL`)                                                |
| D    | neither descends, equal revisions                                                    | conflict `EQUAL_VERSION_DIVERGENT`                                           |
| D'   | neither descends, unequal revisions (e.g. rev2 on A vs rev4 on B from a common rev1) | conflict `CROSS_DEVICE_DIVERGENT` — **never** a winner by revision size      |
| E    | local tombstone descends from incoming live copy                                     | deletion kept (`LOCAL_DELETION_KEPT`)                                        |
| E'   | tombstone vs live edit, neither descends (rev2 tombstone on A vs rev3 live on B)     | conflict (D or D') in both merge directions — never a silent resurrection    |
| F    | incoming tombstone descends from local live record                                   | recovery merge: not applied, reported; `APPLY_NEWER`: applied                |
| G    | same content, different id                                                           | not added (`DUPLICATE`), reported; distinct content kept                     |
| H    | device far behind                                                                    | its versions are ancestors (A/B/E) or concurrent (conflict); never overwrite |

**Options (`MergeOptions`) — every place a human decides:**

- `resolutions: { [conflict.key]: "LOCAL" | "INCOMING" }` — the only way
  past D/D'. The chosen content is written as a **new version**
  (`settledVersion`): revision `max(local, incoming) + 1`, this device's id,
  `updatedAt` now, and ancestry covering **both** sides. Consequences
  (tested):
  - merging either old branch again is a no-op — no reopened conflict,
    with or without the resolution map;
  - a device still holding either old branch takes the resolved version
    automatically (it descends from what that device has), and that
    device's next edit builds on it without a new conflict.
- `restoreLocallyDeleted: true` — bring back records deleted on this device
  that an older copy still has live (case E); the restored record is also a
  settled version above both. Off by default; offered as a checkbox.
  _Before #25 this was the unconditional behavior._
- `incomingDeletions: "KEEP_LOCAL_LIVE"` (default, backup recovery) or
  `"APPLY_NEWER"` (case F).

**Where same-device ordering can be wrong:** REPLACE with an older backup
rewinds this device's records; later edits count up from the old revision.
A version from before the REPLACE with a lower revision is then treated as
an ancestor. REPLACE is explicit and destructive, and a pre-restore copy is
kept, so this is accepted and documented rather than tracked.

**Records without a revision:**

- `profile`: no revision, no device id. Wall-clock `updatedAt`
  last-writer-wins was **removed**: it is not a safe distributed rule
  (device clocks differ and a later edit need not have seen the earlier
  one). Instead the profile carries an optional list of content digests of
  versions it replaced (`supersedes`, written by edits and resolutions,
  capped at 32). A profile that lists the other side's digest wins;
  otherwise any difference is a conflict (`UNVERSIONED_DIVERGENT`). No
  migration. A backup of a different profile id cannot be merged.
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
- **Idempotent**: `merge(merge(L, B), B)` equals `merge(L, B)` for every
  option combination tested; after resolving conflicts, merging B again
  needs no resolutions and changes nothing.
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

| Scenario                                        | Unit                                                             | Chromium (Playwright)                                                                     | iOS Safari   |
| ----------------------------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------ |
| reload immediately after write                  | ✓                                                                | ✓                                                                                         | not verified |
| multiple tabs / concurrent writes               | ✓ (forced interleavings with and without lock; mutation-checked) | ✓ (two tabs restoring at once, with and without Web Locks; held-lock wait; storage event) | not verified |
| storage write failure / quota                   | ✓ (simulated `QuotaExceededError`)                               | —                                                                                         | not verified |
| storage unavailable (`SecurityError`)           | ✓ (simulated)                                                    | —                                                                                         | not verified |
| app update with old-schema data                 | ✓ (v2→v3, newer-version tab)                                     | —                                                                                         | not verified |
| offline startup with existing data              | —                                                                | ✓ (service worker, offline context)                                                       | not verified |
| offline → online                                | —                                                                | ✓ (storage unchanged)                                                                     | not verified |
| file-picker cancel                              | —                                                                | partial (empty file list; real cancel UI not automatable)                                 | not verified |
| backup parse failure / corrupt file             | ✓                                                                | ✓                                                                                         | not verified |
| restore preview cancel / refresh before confirm | ✓ (nothing written)                                              | ✓                                                                                         | not verified |
| large backup (1,500 events, ~1.1 MB file)       | ✓                                                                | ✓                                                                                         | not verified |
| corrupt current + valid previous                | ✓                                                                | ✓                                                                                         | not verified |
| corrupt current + corrupt previous              | ✓                                                                | ✓                                                                                         | not verified |
| newer-schema local document                     | ✓                                                                | ✓                                                                                         | not verified |

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
- Ancestry exists only for versions written by this release onward.
  Records last written before it, or by an older app version, have none,
  so cross-device differences in them are conflicts even when one side did
  see the other. The UI's "모두 이 기기 값 유지 / 모두 백업 값 사용" and the
  settled version make this a one-time question per record.
- Ancestry is a per-record "descends from" summary, not a full version
  vector of the whole document. It is enough for the rules above, not a
  complete sync protocol.
- Without Web Locks, cross-tab safety rests on the compare-and-set commit
  (section 1).
- Only one pre-restore slot: a second REPLACE overwrites the first
  pre-restore copy (the exported backup is the durable copy).
- Leave snapshots and import records have no revision; divergence under one
  id is a conflict and, if resolved to LOCAL, recurs on the next merge with
  the same file.
- Conflict resolution UI is per record, with version metadata only; it does
  not show both contents side by side.

## Not implemented yet

- remote/cloud synchronization (no server, no sync adapter, no queue)
- the rest of a remote sync protocol: an outbox of local changes, a server
  or peer transport, tombstone retention and garbage collection, and a
  guarantee that every client keeps `supersedes` (older app versions drop
  it)
- account/login/authentication
- server-side backup
- multi-user sharing
- end-to-end encryption (backups are plain JSON; the checksum is not
  encryption or a signature)
- Capacitor/iOS native wrapper
