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

CI runs the first in the `verify` job (plus the bundle drift check), the
second and the simulator build in the `ios` job (`macos-15`), and the app unit
tests (`SuperGongikTests`) plus the screenshot matrix in the `ios-visual-qa`
job, which creates its own iPhone 16 simulator (see § Simulator screenshot QA).

## Results on `main` `794e489` (2026-10-25, Xcode 26.3, iPhone 16 simulator iOS 26.3)

| Suite                              | Command                                          | Result                                                                                                                                       |
| ---------------------------------- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| native-core                        | `pnpm --filter @super-gongik/native-core test`   | 4 files, 43 tests pass                                                                                                                       |
| domain                             | `pnpm --filter @super-gongik/domain test`        | 16 files, 233 tests pass (one timing test in `sync-engine.test.ts` exceeds 5 s while an `xcodebuild` runs on the same machine; passes alone) |
| `swift test --jobs 2`              | SuperGongikKit                                   | 54 tests, 12 suites pass                                                                                                                     |
| `xcodebuild test-without-building` | `SuperGongikTests`, unsigned Debug, QA bundle id | 20 tests, 8 suites pass                                                                                                                      |
| GitHub Actions                     | run `39975299371` on the same commit             | 5 jobs success                                                                                                                               |

Older results below are kept for the history of the branch they were run on;
they are not evidence for the current `main`.

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

| Area        | Covered by                                                                                                                                                                      | Gaps                                            |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| Domain      | 387 fixture cases (DOMAIN-CONFORMANCE.md)                                                                                                                                       | sync engine runs, importer on real files        |
| Persistence | port tests; store lifecycle on files; quarantine; newer version; pre-restore; wipe via shared store                                                                             | disk-full on device, migration from a future v4 |
| Backup      | web→iOS→iOS export round trip; iOS export→web parse/plan; idempotent merge; tampering; destructive confirmation                                                                 | very large backups on device                    |
| Sync / auth | PostgREST client tests; full native path over the reference server; controller in JSC through the Swift host; auth tests; PostgREST + RLS scenarios with the native client (CI) | hosted Supabase, real devices                   |
| Widgets     | `WidgetModel` tests (Seoul midnight, states, flooring); extension builds; App Group snapshot written on the simulator (file content checked)                                    | home-screen rendering; timeline on device       |
| Reminders   | planning tests (evening-before, generic text, disabled categories)                                                                                                              | delivery on device                              |
| Lock        | builds; logic reviewed                                                                                                                                                          | Face ID / passcode on hardware                  |
| UI          | simulator screenshots (below); contrast tests                                                                                                                                   | XCUITest automation; VoiceOver pass on device   |

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

Also checked: 급여 attendance editor and the signed-out cloud screen (placeholder project URL, no request made).

Not done: compact (SE) and Pro Max sizes, iPad, landscape, Reduce Motion
visual pass, Increase Contrast visual pass, empty states of every tab,
very long Korean text. Only one simulator device was available; interactive
tapping needed simulator-panel permission, which was not granted during the
session.

## Simulator screenshot QA (CI)

CI job `ios-visual-qa`:

- runs `SuperGongikTests` on a fresh simulator;
- runs `apps/ios/scripts/screenshot-qa.sh` and uploads artifact `ios-screenshots-<sha>`.

The app is a Debug build with DEBUG-only hooks:

- `-SGSeedDemo YES` creates a demo document through the shared core commands on an empty store;
- `-SGTheme` selects the theme;
- `-SGInitialTab` opens a tab.

The matrix covers:

- iPhone 16 (393 pt): standard and Warrior, light and dark, every tab;
- iPhone SE 3rd gen (375 pt) and iPhone 16 Plus (430 pt);
- Accessibility XXL Dynamic Type;
- Increase Contrast.

`manifest.tsv` in the artifact lists each case. The job log also prints a JPEG thumbnail of each case (lines starting `QAIMG`). Results and the discrepancy classification are in `docs/design/SCREEN-MAP.md` § 4.

Still not covered by automation:

- VoiceOver traversal on a device;
- a visual Reduce Motion pass (SwiftUI's `accessibilityReduceMotion` is read-only, so CI cannot force it; the code removes interpolation through `SGMotion`, unit-level only);
- widget rendering on a home screen;
- iPad.

## UI flows and Figma comparison (CI)

CI job `ios-ui-flows` (since PR #89) runs scheme `SuperGongikUI` (target `SuperGongikUITests`) through `apps/ios/scripts/ui-flows.sh`. It uses one fresh simulator per device, with the status bar pinned to 9:41.

| Device        | Width                      | What runs                            |
| ------------- | -------------------------- | ------------------------------------ |
| iPhone 16     | 393 pt (Figma frame width) | interaction tests and Figma captures |
| iPhone 16e    | 390 pt                     | Figma captures only                  |
| iPhone 16 Pro | 402 pt                     | Figma captures only                  |

If the runner image does not have a device type, that row writes `SKIPPED` and does not count as a pass.

Every launch uses DEBUG-only hooks, so the date, data and appearance are fixed:

| Hook                        | Effect                                                                                                                                           |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `-SGToday 2026-03-14`       | `AppClock` returns this date as "today" (the date drawn in the Figma frames)                                                                     |
| `-SGSeedFixture figma`      | creates the Figma page 52 sample through the core commands: 소집 2025-03-18, 소집해제 예정 2027-01-14, records on 3/6, 3/11, 3/14, 3/20 and 3/30 |
| `-SGResetStore YES`         | starts from an empty local store                                                                                                                 |
| `-SGColorScheme light/dark` | sets the appearance                                                                                                                              |
| `-SGTheme`                  | selects the theme                                                                                                                                |
| `-SGInitialTab`             | opens a tab                                                                                                                                      |

Interaction tests (`InteractionTests.swift`):

| Test                                    | What it checks                                                                 |
| --------------------------------------- | ------------------------------------------------------------------------------ |
| `testTabsSwitchAndKeepOneTabBar`        | every tab opens its screen, is marked selected, and no second tab bar appears  |
| `testHeaderProfileButtonOpensProfile`   | the header profile button opens 내 정보                                        |
| `testCalendarMonthSurvivesTabSwitch`    | the calendar keeps its month across a tab switch                               |
| `testDuplicateAnnualLeaveIsRefused`     | a duplicate 연가 is refused with the core's message, and the editor stays open |
| `testQuickRecordPersistsAcrossRelaunch` | a quick record is still listed after the app is terminated and relaunched      |
| `testEditedEditorAsksBeforeClosing`     | closing an edited editor asks first                                            |
| `testHomeAgendaRowOpensEditor`          | tapping a 홈 agenda row opens that record in the editor                        |
| `testRetapTabScrollsToTop`              | tapping the selected 홈 item again scrolls back to the top                     |
| `testRetapTabPopsPushedScreen`          | with 연가 내역 pushed, tapping 홈 again returns to 홈                          |
| `testPullingDownEditedEditorAsks`       | pulling an edited editor down asks before closing                              |
| `testPayMonthSwitcher`                  | 급여 moves to the next and the previous month                                  |

Figma comparison:

- `FigmaCaptureTests.swift` captures 온보딩 steps 1–4 (standard light, empty store, `-SGToday 2026-10-13`, `-SGOnboardingStep N`) and 홈, 캘린더, 급여 and 내 정보 in four combinations: standard light, Warrior light, Warrior dark and standard dark. Each screen is captured at the top and then in fixed scroll steps.
- `apps/ios/scripts/figma-compare.py` compares those captures with `docs/design/figma-reference/*.png` and writes:
  - `<case>-compare.png`: Figma, app and difference, first viewport only. The status bar and the bottom-bar zone are masked.
  - `<case>-sheet.png`: the full Figma frame beside every capture.
  - `report.md`: similarity, changed pixels and the known deviations. It is also appended to the job summary.
- Artifact: `ios-figma-compare-<device>-<sha>`. The `xcresult` is uploaded only when a test fails.
- Similarity is a triage signal, not a verdict. `deviations.json` lists the owner decisions that are newer than the Figma frames.
- No baseline is ever updated automatically. `--baseline <dir>` adds before/after sheets when approved captures are supplied.

## Real-device checklist

See RELEASE.md § Real-device QA.
