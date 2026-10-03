# Native iOS client — architecture

Decision records: [ADR 0003](../adr/0003-native-ios-hybrid-core.md) (hybrid
core) and [ADR 0004](../adr/0004-native-ios-persistence.md) (persistence).
Audit and plan: [NATIVE-IOS-AUDIT.md](./NATIVE-IOS-AUDIT.md).

## Layers

```text
SwiftUI app (apps/ios/SuperGongik)          presentation state only
  App/        entry, root, tabs
  Core/       AppModel (@Observable, @MainActor), config, widget snapshot
  Features/   Onboarding, Today, Records, Leave, Pay, More, Security,
              Notifications
SuperGongikWidgets                           WidgetKit, Swift slice only
Shared/                                      WidgetSnapshot + WidgetModel
        │ typed calls (CoreClient.swift), JSON in/out
        ▼
SuperGongikKit (Swift package, apps/ios/Packages/SuperGongikKit)
  SGCore        CoreRuntime actor → JavaScriptCore (one serial queue)
                + Codable read models
  SGFoundation  CivilDate, SeoulClock, ServiceProgress, LiveServiceProgress,
                JSNumberFormat, JSONValue           (fixture-locked port)
  SGPersistence FileKeyValueStore (KeyValueStorage port, atomic files)
  SGDesignSystem HORIZON tokens and components
        │ sg-core.js (generated, committed, CI-verified)
        ▼
packages/native-core (TypeScript facade)  →  packages/domain, rules, importer
                                           →  apps/web/src/lib pure modules
```

## Rules

1. **No business rule in Swift.** Leave, pay, overlaps, classification,
   migrations, merge, restore and sync decisions come from the TypeScript
   packages through `SGCore`. The Swift slice (`SGFoundation`) holds only
   civil-date arithmetic and the progress figures widgets and the 1 Hz hero
   need, and every function in it is checked against the reference by
   `contracts/fixtures` (`engines: ["jsc", "swift"]`).
2. **No policy constant in a view.** Labels that carry policy (category of
   each event type, rule explanations, unresolved inputs, credit
   explanations) are read from the core. View-level copy that mirrors the
   web is copied from the web component it mirrors.
3. **Stored records are never re-encoded from Swift models.** Swift read
   models are lossy by design. Anything that writes or validates against
   stored data runs inside the core on the stored document
   (`editProfile` patch, `eventFormEvaluate`, `moneyMonth`, restore).
4. **One writer.** Only the app process writes the document. Widgets read an
   App Group snapshot that contains only what they display.
5. **Observation, not a global store.** `AppModel` holds the latest
   `StoreSnapshot` and `Projection`; screens own their presentation state.
   Mutable shared services are actors (`CoreRuntime`) or `@MainActor`
   observable objects (`AppModel`, `PrivacyLock`, `ReminderScheduler`).

## Data flow

```text
user action
  → AppModel.run(command, args)              (@MainActor)
  → CoreRuntime.run                           (core queue)
  → store.run(command) in JS: re-read, validate, persist via
    FileKeyValueStore (atomic file), keep previous generation
  → AppModel re-reads snapshot, projects today (buildNativeProjection)
  → views update; widget snapshot rewritten; reminders rescheduled
```

The UI never waits on a network request: there is none in v1.

## Time

- "Today" is the Asia/Seoul civil date (`SeoulClock.today`, tz database).
- `AppModel` re-projects at Seoul midnight while active and on every
  return to the foreground.
- The live readout is a `TimelineView(.periodic(by: 1))` inside the hero:
  it ticks only while visible and the app is active.
- Widgets get one timeline entry per Seoul midnight for seven days.

## Generated artifacts

| File                                                                   | Source                                           | Regenerate                                             |
| ---------------------------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------ |
| `apps/ios/Packages/SuperGongikKit/Sources/SGCore/Resources/sg-core.js` | `packages/native-core/src/**`, packages, web lib | `pnpm --filter @super-gongik/native-core build:ios`    |
| `…/Resources/sg-shims.js`                                              | `packages/native-core/shims/jsc-shims.js`        | same                                                   |
| `contracts/fixtures/*.json`                                            | `packages/native-core/tests/fixture-cases.ts`    | `pnpm --filter @super-gongik/native-core fixtures`     |
| `contracts/interchange/ios-export.json`                                | iOS export path                                  | `SG_WRITE_INTERCHANGE=1 swift test --filter roundTrip` |
| `apps/ios/SuperGongik.xcodeproj`                                       | `apps/ios/project.yml`                           | `xcodegen generate` (not committed)                    |

## Not built yet

XLSX/HWP/PDF import, OCR, share extension, background sync. Cloud sync and
sign-in exist but are unverified against a hosted project
([SYNC.md](./SYNC.md), [AUTH.md](./AUTH.md)). Status: [RELEASE.md](./RELEASE.md).
