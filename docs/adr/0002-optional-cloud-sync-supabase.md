# ADR 0002: Optional cloud sync on Supabase, domain-authoritative

Status: accepted (Issue #27)

## Context

Local-first persistence, backup v2 and a causal merge contract (revision,
deviceId, `supersedes`, tombstones, structured conflicts) were in place
after #26. No backend had been chosen (ADR 0001 deferred Supabase). Users
lose data when they change phones and cannot use two devices.

## Decision

1. **Supabase** (Auth, PostgreSQL, Row Level Security) is the transport,
   storage and identity provider. It was the default named for this sprint,
   nothing in the repository pointed elsewhere, and it lets the whole
   authorization model live in version-controlled SQL that can be tested on
   plain PostgreSQL.
2. **Domain semantics stay authoritative.** Sync reuses `analyzeMerge`
   unchanged except for one sync-policy refinement (a snapshot-only import
   batch's rollback propagates under `APPLY_NEWER`). The database never
   compares timestamps or picks winners. `documentRevision` stays local.
3. **Record-oriented remote model** (one row per record, payload = the local
   record) rather than a document blob: incremental pulls, per-record
   conditional writes, and per-record conflicts without re-uploading the
   whole document.
4. **Transport metadata is separate**: a per-account, commit-ordered `seq`
   (cursor and compare-and-set token) and an account `generation` (cloud
   reset / stale-device protection).
5. **Security in the database**: forced RLS on every table, invoker-rights
   functions keyed on `auth.uid()`, no direct table writes, no service-role
   key anywhere in the client.
6. **Optional by construction**: no config → feature hidden; no stored
   session → SDK never loaded, no request made.
7. **Email one-time code** for sign-in: no provider setup, works in a
   home-screen web app. Apple/Google can be added later without touching
   sync.

## Consequences

- The sync engine is backend-independent (`SyncTransport` port); a
  different backend is one adapter plus equivalent server functions.
- An in-memory reference server mirrors the SQL functions so multi-device
  scenarios run deterministically in `pnpm test`; SQL tests and a
  PostgREST integration run in CI against a PostgreSQL service container.
- Not end-to-end encrypted. The operator of the Supabase project can read
  synced records and cloud backups.
- Tombstones are kept until the user deletes cloud data (no garbage
  collection yet).

See [CLOUD_SYNC.md](../CLOUD_SYNC.md).
