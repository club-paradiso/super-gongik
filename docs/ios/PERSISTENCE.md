# Native persistence

Decision: [ADR 0004](../adr/0004-native-ios-persistence.md).

## Where data lives

| Data                                                     | Location                                                           | Protection                                  |
| -------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------- |
| `UserData` v3 document                                   | `Application Support/SuperGongik/store/<base64url(key)>.kv`        | `completeUntilFirstUserAuthentication`      |
| previous generation, pre-restore copy, quarantine copies | same directory, keys from `STORAGE_KEYS`                           | same                                        |
| widget snapshot                                          | App Group `group.app.supergongik.shared/widget-snapshot.json`      | same; dates, formatted leave, generic label |
| UI preferences                                           | `UserDefaults` (app lock, cover, reminder categories, last backup) | not personal records                        |

Keys are the web's: `super-gongik:data:v2`, `…:previous`, `…:pre-restore`,
`super-gongik:quarantine:<timestamp>[:previous]`.

## Guarantees and who provides them

| Guarantee                                    | Provider                                        | Test                                                  |
| -------------------------------------------- | ----------------------------------------------- | ----------------------------------------------------- |
| atomic replace, failed write keeps old value | `FileKeyValueStore` (`Data.write(.atomic)`)     | `FileKeyValueStoreTests.overwriteIsAtomicReplacement` |
| exact round trip of text                     | `FileKeyValueStore`                             | `roundTripsExactText`                                 |
| compare-and-set                              | `FileKeyValueStore` under one lock              | `compareAndSetOnlyWritesOverExpectedValue`            |
| unreadable bytes are returned, never dropped | `FileKeyValueStore`                             | `unreadableBytesAreReturnedNotDropped`                |
| validation on read and write, migrations     | shared repository (JS)                          | fixtures `backup` (v2 migration), domain Vitest       |
| previous generation kept on save             | shared repository                               | `ModelDecodingTests.storeLifecycle`                   |
| corrupt document quarantined, not reset      | shared repository                               | `ModelDecodingTests.corruptDocument`                  |
| newer schema never overwritten (read-only)   | shared repository                               | `ModelDecodingTests.newerVersion`                     |
| pre-restore copy before REPLACE              | shared store                                    | `BackupInterchangeTests.replaceSafety`                |
| wipe removes records and recovery copies     | shared store `wipeAll` + `purgeAuxiliaryCopies` | domain Vitest; manual simulator check                 |

## Load notices

The banner in `StorageNoticeBanner.swift` shows MIGRATED, RECOVERED,
CORRUPT and NEWER_VERSION from the repository, offers to save the
quarantined original as a file, and cannot be dismissed for
NEWER_VERSION (writing stays disabled until the app is updated).

## Clean install, upgrade, deletion

- Clean install: empty store, guest onboarding, no network.
- App upgrade: a document with an older `schemaVersion` is migrated by the
  shared chain on first load and saved; the previous generation keeps the
  pre-migration bytes.
- 이 기기의 모든 데이터 지우기 (더보기): typed confirmation, backup export
  offered first, then `wipeAll`. Clears the widget snapshot too.
- Uninstalling the app removes the container (iOS behaviour). A JSON backup
  is the only portable copy while cloud sync is not available.

## Device backups

The store is part of the encrypted iCloud/Finder device backup like any app
data. It is not excluded, so restoring a phone from a device backup restores
the records.
