# Testing the native client

## Commands

```bash
# TypeScript reference + fixture drift guard + iOS→web interchange
pnpm --filter @super-gongik/native-core test

# Swift: fixtures through JavaScriptCore and the Swift slice, store on real
# files, backup interchange, contrast, concurrency
cd apps/ios/Packages/SuperGongikKit && swift test

# App build + app unit tests (simulator)
cd apps/ios && xcodegen generate
xcodebuild -project SuperGongik.xcodeproj -scheme SuperGongik \
  -destination 'platform=iOS Simulator,name=iPhone 16' test CODE_SIGNING_ALLOWED=NO
```

CI runs the first (workspace job, plus a bundle drift check) and the
second and the simulator build (`ios` job on `macos-15`). App unit tests
(`SuperGongikTests`) are not in CI yet because runner simulator names vary.

## Results on this branch (2026-10-04, Xcode 26.3, iPhone 16 simulator iOS 26.3)

| Suite                                  | Result                                                                             |
| -------------------------------------- | ---------------------------------------------------------------------------------- |
| `pnpm -r test` (sequential)            | domain 233, importer 20, rules 119, web 78 (+7 skipped), native-core 35 — all pass |
| `swift test`                           | 23 tests in 7 suites pass (each fixture suite is one parameterised test)           |
| `swift test --sanitize=thread`         | pass; TSan reports discussed in SECURITY.md                                        |
| `xcodebuild test` (`SuperGongikTests`) | 7 tests in 3 suites pass                                                           |
| web lint / typecheck / format          | pass                                                                               |
| `pnpm build` (Next.js)                 | not run locally (disk nearly full); runs in CI                                     |

## Matrix

| Area        | Covered by                                                                                                      | Gaps                                                  |
| ----------- | --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Domain      | 387 fixture cases (DOMAIN-CONFORMANCE.md)                                                                       | sync engine runs, importer on real files              |
| Persistence | port tests; store lifecycle on files; quarantine; newer version; pre-restore; wipe via shared store             | disk-full on device, migration from a future v4       |
| Backup      | web→iOS→iOS export round trip; iOS export→web parse/plan; idempotent merge; tampering; destructive confirmation | very large backups on device                          |
| Sync / auth | not implemented                                                                                                 | all (SYNC.md, AUTH.md)                                |
| Widgets     | `WidgetModel` tests (Seoul midnight, states, flooring); extension builds                                        | timeline on device; App Group data path needs signing |
| Reminders   | planning tests (evening-before, generic text, disabled categories)                                              | delivery on device                                    |
| Lock        | builds; logic reviewed                                                                                          | Face ID / passcode on hardware                        |
| UI          | simulator screenshots (below); contrast tests                                                                   | XCUITest automation; VoiceOver pass on device         |

## Simulator QA done

Seeded with a realistic document produced by the shared commands (in
service, schedule set, prior service NONE, upcoming leave, half day,
outings, late arrival, sick leave, education), then screenshotted with
`-SGInitialTab` (DEBUG only) on iPhone 16:

- onboarding (empty store), 오늘, 기록, 휴가, 급여, 더보기 — light;
- 오늘 and 기록 — dark;
- 오늘 and 휴가 — Accessibility XXL text.

Defects found and fixed: missing picker label (onboarding); duplicated
"기본 보수" caption on the pay card; confirmed 1st-year credit shown as
"기관 확인 필요" (now shows the counted amount like the web); hero rows
breaking mid-unit at accessibility sizes (rows now stack).

Not done: compact (SE) and Pro Max sizes, iPad, landscape, Reduce Motion
visual pass, Increase Contrast visual pass, empty states of every tab,
very long Korean text. Only one simulator device was available; interactive
tapping needed simulator-panel permission, which was not granted during the
session.

## Real-device checklist

See RELEASE.md § Real-device QA.
