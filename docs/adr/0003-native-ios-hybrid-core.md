# ADR 0003 — Native iOS client: SwiftUI shell, TypeScript core in JavaScriptCore

- Status: accepted
- Date: 2026-10-03
- Scope: `apps/ios`, `packages/native-core`, `contracts`
- Supersedes nothing; builds on ADR 0001 ("SwiftUI route") and ADR 0002.

## Context

ADR 0001 left the iOS route open: a Capacitor wrapper, or SwiftUI with the
TypeScript packages either run in JavaScriptCore or ported. The product now
wants a genuinely native client (widgets, notifications, Face ID, native
sheets and file import), not a WebView, while keeping the web client and one
product truth.

The shared TypeScript is not small: about 360 exports across `domain`,
`rules` and `importer`, including an 1,100-line sync engine, an 850-line
causal merge, a 750-line command module and a 640-line compensation engine,
covered by ≈370 Vitest cases. The web also keeps pure presentation models
(`home-model.ts`, `projections.ts`) with product decisions in them.

Options evaluated:

1. **Pure Swift port.** Fast and idiomatic, but every rule, merge decision and
   migration would exist twice. Fixtures detect drift only where a fixture
   exists; the merge and sync state space is far larger than any fixture set.
   Each future rule change (effective-dated bundles change every year) would
   need two implementations reviewed by people fluent in both. High ongoing
   drift risk for the parts where drift destroys data or misstates pay.
2. **JavaScriptCore for everything.** One implementation. But widgets would
   have to start JSC inside a 30 MB extension budget, and a 1 Hz countdown
   would cross the bridge every second.
3. **Hybrid.** Run the TypeScript packages, unchanged, in JavaScriptCore for
   every business rule and data operation; port to Swift only the small,
   stable, hot calculations that must run without JSC (civil dates, service
   progress, live progress). Lock both to shared fixtures.

A spike bundled `domain + rules + importer` with rolldown (already in the
lockfile through Vite): ≈440 KB, loads in ≈50 ms on an M-series Mac, and with
four small shims (crypto, TextEncoder, URL, SHA-256) produced identical
output to Node for every probe, including `Intl` time-zone dates and `ko-KR`
number formatting.

## Decision

Hybrid (option 3).

1. **TypeScript stays the executable specification.** `packages/native-core`
   is a thin JSON facade over the unchanged packages: `open/run/restore/
wipeAll` drive the same `createUserDataStore` + `createUserDataRepository`
   the web uses; `project(today)` returns the web's `buildAppProjection` +
   `buildHomeModel`; `call(name, args)` reaches a whitelist of pure
   functions; `applyCommand` runs a store command with a fixed context for
   fixtures. Only whitelisted names are callable.
2. **The bundle is built, committed and verified.** `pnpm --filter
@super-gongik/native-core build:ios` writes
   `apps/ios/Packages/SuperGongikKit/Sources/SGCore/Resources/sg-core.js`.
   It is committed so the iOS build never needs Node; CI rebuilds it and
   fails on any difference. It is never edited by hand.
3. **One serial JavaScript queue.** `CoreRuntime` is a Swift actor whose
   executor is a `DispatchSerialQueue`; JavaScriptCore is touched only there.
   Native services are synchronous host functions (`__sgHost`: file KV,
   random bytes, SHA-256, logging), so promises settle within one microtask
   drain; genuinely asynchronous work (network) resolves on the same queue.
4. **Swift-native slice, by exception.** `SGFoundation` ports `CivilDate`,
   `SeoulClock`, `ServiceProgress`, `LiveServiceProgress`,
   `continuousServiceCompletion`, `floorPercent` and JavaScript `toFixed`
   rounding. Nothing else may be ported without a new ADR. Policy constants
   never appear in Swift.
5. **Shared conformance fixtures.** `contracts/fixtures/*.json` are generated
   by the TypeScript reference (`packages/native-core/tests/
conformance.test.ts`). Node re-checks them on every `pnpm test`; `swift
test` replays every suite through JavaScriptCore and the `swift`-engine
   suites through the Swift slice. A behaviour change in TypeScript fails one
   of the two until the fixtures are regenerated and both agree.
6. **Pure web lib modules are part of the specification.** The bundle
   imports `apps/web/src/lib/{home-model, projections,
live-service-progress}` through the `@/` alias. They must stay free of
   React/DOM imports; logic currently inside React components that native
   needs (audit §6.1) is extracted into such modules before native depends
   on it.

## Consequences

- Business rules, migrations, merge, restore and sync have exactly one
  implementation. A rule fix ships to both clients when the bundle is rebuilt.
- Swift code decodes JSON results into view models; it never decides leave,
  pay, overlaps or conflicts.
- Debugging crosses a language boundary. `CoreError` carries the JavaScript
  message for developers; users see mapped Korean copy.
- Bundle size (≈440 KB) and JSC start-up are paid once per app launch, off the
  main thread. Widgets and the per-second hero use the Swift slice only.
- JavaScriptCore is a system framework (no third-party engine, no JIT
  entitlement). The JavaScript ships inside the signed binary and is never
  downloaded or updated remotely. The App Review rules on executable code
  (guideline 2.5.2) must be re-checked against the current guidelines before
  submission; this is a release-checklist item in `docs/ios/RELEASE.md`, not
  an assumption.

## Rejected

- **Capacitor/WebView**: explicitly out of scope; no native widgets/sheets
  feel, and the web UI is not designed for it.
- **Porting the merge and sync engine**: highest risk of silent data loss for
  the least user-visible benefit.
- **Generating Swift from TypeScript**: no tool handles zod schemas, closures
  and the promise-based store faithfully.
