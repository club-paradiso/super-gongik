# Native iOS release status and TestFlight preparation

Nothing has been submitted to App Store Connect or TestFlight. Submission
requires explicit authorization and the credentials listed below.

## Status by phase

| Phase                | Status                                                                                                                                                                                                              |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0 Audit              | done — NATIVE-IOS-AUDIT.md, ADR 0003, ADR 0004                                                                                                                                                                      |
| 1 Foundation         | done — XcodeGen project, SuperGongikKit, HORIZON tokens, tab shell, CI job (CI not yet run: branch not pushed)                                                                                                      |
| 2 Canonical contract | done — native-core facade, 387 fixture cases passing in Node, JavaScriptCore and the Swift slice                                                                                                                    |
| 3 Core product       | done — onboarding, 오늘, 기록, 휴가, 급여 (incl. month attendance editor), 더보기, CSV/TSV import, CSV exports                                                                                                      |
| 4 Persistence        | done — file store under the shared repository, notices, export/restore, wipe; interchange gate both directions                                                                                                      |
| 5 Cloud sync / auth  | implemented — web controller/engine/transport in JSC, Swift auth (email code, PKCE OAuth, Apple), account-deletion function; verified with fakes and (CI) PostgREST + RLS; hosted verification blocked on issue #29 |
| 6 Native advantages  | partial — Face ID lock + cover, reminders, widgets (snapshot verified on the simulator), CSV/TSV import done; XLSX/HWP/PDF import and share extension not started                                                   |
| 7 OCR                | not started (depends on moving web PDF table reconstruction into `packages/importer`)                                                                                                                               |
| 8 Polish audits      | partial — contrast tests, dark mode, accessibility-size pass on two screens; no Instruments profiling yet                                                                                                           |
| 9 TestFlight         | prepared below; not submitted                                                                                                                                                                                       |

## Identifiers and capabilities

| Item              | Value (placeholder until confirmed)                        | Where                                 |
| ----------------- | ---------------------------------------------------------- | ------------------------------------- |
| Bundle id (app)   | `app.supergongik.ios`                                      | `Config/Base.xcconfig` `SG_BUNDLE_ID` |
| Widget extension  | `$(SG_BUNDLE_ID).widgets`                                  | `project.yml`                         |
| App Group         | `group.app.supergongik.shared`                             | both `.entitlements` files            |
| Team              | `SG_DEVELOPMENT_TEAM` (empty)                              | `Config/Local.xcconfig` (git-ignored) |
| Capabilities      | App Groups, Sign in with Apple (declared in `project.yml`) | Apple Developer portal                |
| Deployment target | iOS 18.0; built with the iOS 26.2 SDK (Xcode 26.3)         | `project.yml`                         |

The bundle id and App Group are placeholders: confirm the final identifiers
(and whether the product name stays SUPER-GONGIK) before registering them.

## Signing steps (human, needs an Apple Developer account)

1. Register the app id, widget id and App Group in the developer portal.
2. `cp apps/ios/Config/Local.xcconfig.example apps/ios/Config/Local.xcconfig`
   and set `SG_BUNDLE_ID`, `SG_DEVELOPMENT_TEAM`.
3. `cd apps/ios && xcodegen generate`, open the project, let automatic
   signing create profiles, archive (Product → Archive).
4. Upload to App Store Connect only after authorization.

## Before any submission

- [ ] Replace the 1024 px icon master: `AppIcon-1024.png` is the production
      512 px web icon composited on its matte and scaled 2× (no redesign,
      but soft at full size). Needs the original artwork from PR #51 at
      ≥ 1024 px, or a decision to adopt the V3 candidate.
- [ ] Re-check App Review guidelines in force at submission (do not rely on
      this document): 2.5.2 (bundled JavaScript via JavaScriptCore), 4.8
      (Sign in with Apple is offered alongside Google/Kakao/NAVER), 5.1.1(v)
      (in-app account deletion is implemented; the Edge Function must be
      deployed), privacy labels (sync collects data: PRIVACY.md).
- [ ] Privacy manifest (`PrivacyInfo.xcprivacy`, app and widget) reviewed
      against the final API use; App Store privacy answers from PRIVACY.md.
- [ ] Export compliance: `ITSAppUsesNonExemptEncryption = false` (no
      custom encryption; HTTPS only once sync ships). Confirm.
- [ ] App Store metadata (draft below), screenshots on 6.9" and 6.5" sizes.
- [ ] Real-device QA (below) completed and recorded.

## App Store metadata draft (Korean)

- 이름: 슈퍼공익
- 부제: 사회복무요원 복무·연가·급여 관리
- 설명: 소집일만 입력하면 소집해제까지 남은 날과 복무 진행률을 보여 줘요.
  휴가·근태 기록으로 연가 잔여를 계산하고, 확인된 기준으로만 급여를
  계산해요. 기록은 이 기기에만 저장되고, 백업 파일로 웹과 주고받을 수
  있어요. 슈퍼공익은 참고용 도구이며 실제 복무·보수 관리는 복무기관과
  병무청 안내를 따라 주세요.
- 키워드: 사회복무요원,공익,소집해제,연가,복무
- 카테고리: 유틸리티 (또는 생산성)
- 연령 등급: 4+

## Real-device QA

Not performed. Record device, iOS version, date and result for each.

- [ ] Install a signed build; cold launch time; first render without spinner.
- [ ] Face ID enable/disable; unlock after background; biometrics failure →
      passcode fallback; device without passcode cannot enable the lock.
- [ ] App switcher shows the cover, never records.
- [ ] Reminders: permission prompt appears only when a category is turned
      on; evening-before reminder arrives at 20:00 KST; lock-screen text is
      generic.
- [ ] Widgets: small/medium/lock-screen families show data after the app
      writes the snapshot; values change at Seoul midnight; empty state
      before onboarding; `privacySensitive` redaction when locked.
- [ ] Backup: export to Files, AirDrop and iCloud Drive; restore the same
      file; restore a file exported from the web on the same day.
- [ ] Offline (airplane mode): every screen and every write works.
- [ ] Background/foreground across midnight: D-Day and projections update.
- [ ] Battery: hero live readout stops ticking when the tab or app is left
      (Instruments Energy Log).
- [ ] VoiceOver: hero, stat cards, calendar days, editor, restore flow.
- [ ] Dynamic Type at the largest accessibility size on SE-size hardware.
