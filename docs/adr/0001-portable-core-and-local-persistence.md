# ADR 0001 — Portable core, local document persistence, web first

- Status: accepted
- Date: 2026-09-24
- Scope: `packages/domain`, `packages/rules`, `packages/importer`, `apps/web`

## Context

SUPER GONGIK ships first as a Next.js PWA. A native iOS client may follow,
either as an interim Capacitor wrapper or as SwiftUI + SQLite. Before this
decision the web app stored imported records in `window.localStorage` from
React hooks, kept the leave summary in `apps/web/src/lib`, and silently reset
to an empty state when stored JSON could not be parsed — which the next save
then wrote over.

## Decision

1. **One canonical user document.** `UserData` (schema version 2) holds the
   profile, service events, leave adjustments, institution snapshots and
   import history. It is validated with zod on every read and every write.
   Backups contain exactly this document, so export, restore and future sync
   share one contract.
2. **Business logic lives in framework-free packages.**
   - `domain`: dates, canonical `ServiceEvent`, validation, pure commands
     (create/edit/delete/restore, import commit, rollback, adjustments),
     the event-derived leave ledger, backup/merge, CSV, the repository and a
     subscription store (`createUserDataStore`).
   - `rules`: effective-dated policy bundles, leave-credit derivation by grant
     date, monthly compensation evaluation with safety gates.
   - `importer`: parsing and normalization into canonical drafts.
     React components only render projections and call `store.run(command)`.
3. **Persistence port.** The domain defines an async `KeyValueStorage`
   (`getItem`/`setItem`/`removeItem`/`keys`). The web implements it over
   `localStorage`. The repository adds: previous-generation copy, quarantine
   of unreadable documents (never silently discarded), refusal to overwrite
   a newer schema version, pre-restore copy, legacy v1 migration, and a
   purge used by "delete all data".
4. **localStorage, not IndexedDB, for now.** The document is far below 1 MB;
   one `setItem` of one serialized document is atomic, which gives
   all-or-nothing writes without transaction code. Because the port is async,
   swapping in IndexedDB, Capacitor Preferences/Filesystem or SQLite changes
   one adapter file. Revisit when the document approaches ~2 MB or when
   attachments are stored.
5. **Sync-ready records, no sync yet.** Every mutable record carries
   `id` (UUID), `revision`, `createdAt`, `updatedAt`, `deletedAt`, `deviceId`.
   Deletion is soft. No Supabase/cloud work was started: nothing in this
   sprint needs it, and local recovery (JSON backup) closes the device-loss
   gap first.
6. **Restore has two explicit contracts** (`store/restore.ts`,
   `store/merge.ts`; full rules in [BACKUP_AND_SYNC.md](../BACKUP_AND_SYNC.md)).
   Both are previewed with `planRestore` (pure) before `store.restore`
   writes the whole document in one save.
   - _Merge = non-destructive recovery._ Current live records are never
     deleted; newer backup tombstones are reported, not applied. Along one
     device's history the higher revision wins; different content that
     cannot be ordered (equal revisions, or versions last written by
     different devices — revision counters are per device, not a clock) is
     a structured conflict that blocks the merge until the user picks a
     side. A stale copy does not resurrect a newer local deletion unless the
     user explicitly opts in (`restoreLocallyDeleted`). _Changed in #25:
     previously local deletions were always resurrected and higher numbers
     or later `updatedAt` won._ Anything that would charge leave twice or
     give a credit a second confirmation is skipped, the current state kept,
     and the reason reported. Import batches are re-derived: ACTIVE if and
     only if the batch still has a live event or snapshot.
   - _Replace = exact restoration._ The validated backup becomes the
     document; only this device's id and write counter are kept, a
     pre-restore copy is written first, and replacing existing data requires
     an explicit destructive confirmation.
     The same record contract is the basis for a future sync adapter
     (`incomingDeletions: "APPLY_NEWER"`).
7. **Leave may never be charged twice for the same time** (enforced in
   `events/validation.ts`, used by manual entry, import commit, restore and
   merge). Full day vs anything, the same half day, intersecting explicit
   times, or identical content is an error. Where records lack a position
   (minutes without start/end, half day vs minutes — the half-day hours
   depend on the institution schedule), the overlap is reported as
   unresolved: manual entry requires acknowledgement and imports are not
   pre-selected. The ledger also warns about overlaps already stored.

## Consequences for a future iOS client

- **Capacitor route:** reuse the web build; replace `browser-storage.ts` with
  a Preferences/Filesystem adapter. No business code changes.
- **SwiftUI route:** the TypeScript packages are the executable
  specification. Either run them in JavaScriptCore (they only need
  `crypto.getRandomValues` and, for import fingerprints, `crypto.subtle`), or
  port them with the existing Vitest suites and JSON rule fixtures as the
  conformance tests. Backup files are the interchange format between clients.
- Remaining browser-only code is confined to `apps/web`: file adapters
  (pdf.js, tesseract.js, exceljs, hwpxjs), downloads, `localStorage`,
  service worker.

## Rejected alternatives

- Keeping per-feature `localStorage` keys: no atomic multi-collection
  writes, no single backup format, drift between features.
- IndexedDB now: async transaction plumbing and SSR guards for no measurable
  benefit at current data sizes.
- Starting cloud sync: premature without auth, and it would not help users
  who never sign in.
