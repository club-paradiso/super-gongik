# Domain conformance between TypeScript and Swift

The TypeScript packages are the executable specification. The native client
either runs them unchanged (JavaScriptCore) or, for a small slice, runs a
Swift port. Shared JSON fixtures prove both produce the reference result.

```text
fixture input ──▶ TypeScript (Node)            ──▶ expected (stored JSON)
fixture input ──▶ same bundle in JavaScriptCore ──▶ must equal expected
fixture input ──▶ Swift slice (where listed)    ──▶ must equal expected
```

## Files

- `packages/native-core/tests/fixture-cases.ts` — inputs, grouped in suites.
- `packages/native-core/tests/conformance.test.ts` — computes every case
  through the facade in Node and fails if `contracts/fixtures/<suite>.json`
  differs (drift guard). `UPDATE_FIXTURES=1` rewrites them.
- `apps/ios/Packages/SuperGongikKit/Tests/SGCoreTests/BridgeConformanceTests.swift`
  — replays every suite through the bundle in JavaScriptCore.
- `apps/ios/Packages/SuperGongikKit/Tests/SGFoundationTests/NativeConformanceTests.swift`
  — replays the `swift`-engine suites through the Swift port.
- `…/SGCoreTests/ModelDecodingTests.swift` — every projection decodes into
  the Swift read models.

## Suites (387 cases in 11 suites at the time of writing)

| Suite              | Engines     | Covers                                                                                                                                                                      |
| ------------------ | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dates`            | jsc + swift | parsing (incl. years 0–99 rejected), addDays, addCalendarMonths clamping, differences, Seoul date of instants incl. 1988 DST, Seoul midnight                                |
| `service-progress` | jsc + swift | NOT_STARTED / IN_SERVICE / COMPLETED, D-Day, final day, leap spans, zero-length, `toFixed(1)` ties (0.25 → 0.3), a 640-day sweep                                            |
| `live-progress`    | jsc + swift | second-level progress, 6-digit floored text, countdown text, continuous completion, home `floorPercent`, D-Day wording                                                      |
| `milestones`       | jsc         | milestone lists, next/today milestone, days since discharge                                                                                                                 |
| `leave`            | jsc         | effective-dated credits (before/after 2026-04-23 and 2026-08-28), half-day and minute charging, 8-hour accumulation, full ledgers, formatting                               |
| `events`           | jsc         | validation, overlap conflict vs unresolved, explicit times, classification at the 14:00 boundary, taxonomy, timing text, month grids                                        |
| `event-form`       | jsc         | editor initial state, coercions, automatic classification into half/full day, money month, profile options, fare suggestions                                                |
| `commands`         | jsc         | create/edit profile, create/update/delete/restore events, overlap rejection, credits, corrections, attendance                                                               |
| `compensation`     | jsc         | five profile variants × four dates: safety gate (no total while unresolved), unsupported months, pay bands, prior-service credit                                            |
| `backup`           | jsc         | canonical JSON, SHA-256, create/parse, tampering, v2 migration, newer-version refusal, ownership, merge conflicts/resolutions, descent, tombstones, replace, plans, execute |
| `projection`       | jsc         | the whole screen contract (web `buildAppProjection` + `buildHomeModel`, leave text, event display) across service states                                                    |

## What the first runs found

- `parseDateOnly` rejects years 0–99 because it validates through
  `Date.UTC`, which maps them to 1900–1999. The Swift port now matches.
- `Number.prototype.toFixed` rounds exact ties up; `String(format:)` rounds
  half-to-even. `JSNumberFormat.toFixed` reproduces JavaScript.
- JavaScriptCore lacks `crypto`, `TextEncoder` and `URL`; the shims are
  covered because every backup, id and digest fixture runs through them.

## Changing behaviour

1. Change TypeScript; update its own tests.
2. `pnpm --filter @super-gongik/native-core fixtures`, review the JSON diff.
3. `pnpm --filter @super-gongik/native-core build:ios`.
4. `swift test` in `apps/ios/Packages/SuperGongikKit`. If a `swift`-engine
   suite fails, fix the Swift slice; never edit expected JSON by hand.

## Not yet covered by fixtures

Sync engine runs (the engine is exercised by the domain's own Vitest suite
against the reference server; it will be fixtured through JavaScriptCore
with a Swift transport in Phase 5), importer normalization of real files,
and the restore-copy wording returned by `previewRestore` (exercised by
`BackupInterchangeTests`).
