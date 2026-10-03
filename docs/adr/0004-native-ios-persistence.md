# ADR 0004 — Native iOS persistence: canonical document files under the shared repository

- Status: accepted
- Date: 2026-10-03
- Scope: `apps/ios/Packages/SuperGongikKit/Sources/SGPersistence`

## Context

The web stores one canonical `UserData` v3 document (plus previous
generation, pre-restore copy and quarantine copies) through the domain's
`KeyValueStorage` port. The repository above the port does validation,
generations, quarantine, migrations and newer-version refusal (ADR 0001 §3).
The native client needs durable local storage with the same guarantees and
must produce backups byte-compatible with the web.

Options evaluated for the native side of the port:

| Option             | Migration reliability                                    | Testability             | Backup semantics                            | Fit with canonical UserData                            |
| ------------------ | -------------------------------------------------------- | ----------------------- | ------------------------------------------- | ------------------------------------------------------ |
| SwiftData          | lightweight migrations, opaque store, hard to inspect    | needs a model container | must be re-serialized to the JSON contract  | poor: relational model ≠ the zod document; two schemas |
| SQLite / GRDB      | explicit, excellent                                      | good                    | rows must be re-assembled into the document | good for indexed projections; adds a dependency (GRDB) |
| Files, one per key | none needed at this layer (the document migrates itself) | trivial                 | the stored text **is** the backup payload   | exact: stores the validated document text verbatim     |

## Decision

1. **Files, one per key**, in `Application Support/SuperGongik/store`
   (`FileKeyValueStore`). File names are base64url of the key, so every key
   round-trips. Writes are `Data.write(options: .atomic)` (temp file +
   rename): readers see the old or the new value, never a mix, and a failed
   write leaves the old value. `compareAndSet` checks and writes under one
   lock. These are exactly the port's provider obligations.
2. **Everything else is the shared repository**, running in JavaScriptCore
   (ADR 0003): validation on every read and write, previous generation,
   quarantine of unreadable copies (never discarded), refusal to overwrite a
   newer schema, pre-restore copy before REPLACE, legacy migration, and the
   purge used by "이 기기의 모든 데이터 지우기". There is no native schema
   and no native migration code.
3. **Data protection**: `completeUntilFirstUserAuthentication`. Encrypted at
   rest until the first unlock after boot, readable afterwards so a midnight
   refresh or notification rescheduling can run while locked. Face ID app
   lock (Phase 6) is a separate, UI-level control.
4. **Widgets do not read the document.** The app writes a minimal widget
   snapshot (dates, leave remaining, next event label — only what the widget
   shows) to the App Group container after each change. Extensions never open
   the store, so there is exactly one writer and no cross-process lock.
5. **No indexed projections yet.** The document is far below 1 MB (ADR 0001
   §4); projections are recomputed in JSC in milliseconds. Revisit (SQLite
   projection tables keyed by document revision) only if profiling shows
   recomputation on the main path above ~16 ms on the oldest supported device.
6. **OS device backup**: the store is included in iCloud/Finder device
   backups by default, like the web's origin storage. The in-app JSON backup
   remains the portable, cross-client format.

## Consequences

- Native and web keep byte-identical documents: an exported backup is the
  same text either client would produce for the same data.
- Corrupt or truncated files are handled by the shared quarantine path (the
  native layer returns the bytes; it never "fixes" or drops them).
- No third-party persistence dependency.
- A future attachment feature (photos of documents) would need a separate
  blob store; the document must not grow by embedding binaries.
