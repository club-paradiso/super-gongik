# iOS Figma fidelity and functional reliability audit (2026-11-08)

- Branch / PR: `claude/super-gongik-figma-ios-overhaul-80f8p7`, PR #89. Base: `main` `e75b64a` (PR #88).
- Figma: file `hy0KYmsJxVzj2JwJtbfIpS`, read through the Figma MCP (`get_metadata` on page 52, `get_screenshot` on every frame below). The 1x renders are committed in [`figma-reference/`](./figma-reference/).
- App "before": CI run 40684514009 on `main` (job `ios-visual-qa`, 33 simulator screenshots, iPhone 16 / SE / 16 Plus).
- App "after": CI job `ios-ui-flows` on this PR. The results are on the PR. Nothing below is marked verified unless a CI run shows it.

## 1. Which design is current

Three sources were compared independently (see [STITCH-REAL-FIDELITY-AUDIT-2026-10.md](./STITCH-REAL-FIDELITY-AUDIT-2026-10.md) for why):

- **A**: the Stitch export
- **B**: Figma page 52
- **C**: the app

Findings:

- **Tabs.** The app has 4 tabs: 홈, 캘린더, 급여, 내 정보 (`RootView.swift`, PR #68/#70). [FIGMA-SOURCE-OF-TRUTH.md](./FIGMA-SOURCE-OF-TRUTH.md) still says "5 native tabs". That line is outdated. The Civic Codex frames on page 52 also draw 4 tabs. The 5-tab layout was not restored.
- **홈 in Figma is older than the app.**
  - Frames `202:3614`, `202:3847` and `202:3956` were redrawn on 2026-10-15 from the PR #68 app.
  - PR #70 (2026-10-20, owner-approved) then replaced that home with the Stitch `master_synthesis` layout: full-bleed hero, journey trail and a 2×2 ledger.
  - PR #88 (2026-10-28) added the 오늘 기록하기 tray. It also made world-language labels Warrior-only.
  - Matching the app to `202:*` would undo both owner decisions, so the app was not changed toward those frames.
  - The frames need a redraw from A. That is recorded in `figma-reference/deviations.json`.
- **No newer production frame exists.** The highest node ids on page 52 are `244:*`, and those are components inside the Civic Codex frames.
- **Figma sample data is internally inconsistent** in one place: the 내 정보 card shows 소집일 2025.03.18, while the row below it shows 2025.9.23. The app always shows one core value.

## 2. Figma ↔ SwiftUI map (Civic Codex)

| Screen        | Figma node(s)                                                       | SwiftUI                                                                                                    | Compared by                           |
| ------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| 홈            | `202:3614` Light, `202:3847` Warrior Light, `202:3956` Warrior Dark | `Features/Today/TodayView.swift`, `Features/Common/AppHeader.swift`, `App/RootView.swift` (`StitchTabBar`) | `ios-ui-flows` captures `home-*`      |
| 캘린더        | `204:3938`, `204:4256`, `204:4469`                                  | `Features/Records/RecordsView.swift`, `EventEditorSheet.swift`                                             | captures `calendar-*`                 |
| 급여          | `206:4205`, `206:4424`, `206:4539`                                  | `Features/Pay/PayView.swift`, `AttendanceEditorView.swift`                                                 | captures `pay-*`                      |
| 내 정보       | `207:4469`, `207:4633`, `207:4728`                                  | `Features/More/MoreView.swift`, `ProfileEditView.swift`                                                    | captures `profile-*`                  |
| 온보딩        | `208:4628`, `208:4655`, `208:4683`, `208:4721`                      | `Features/Onboarding/OnboardingView.swift`                                                                 | reference committed; not captured yet |
| PDF           | `209:4634`                                                          | `Features/More/RecordSummaryPDF.swift`                                                                     | not compared                          |
| Live Activity | `210:4634`, `210:4646`, `210:4650`                                  | `SuperGongikWidgets/DutyLiveActivity.swift`, `Core/DutyActivityController.swift`                           | not compared (needs a device)         |
| 기념 카드     | `210:4664`, `210:4672`                                              | `Features/More/MemorialCardView.swift`                                                                     | not compared                          |

## 3. Visual differences (first viewport, `main` vs Figma)

Measured locally with `apps/ios/scripts/figma-compare.py` on `main`'s CI thumbnails. Those are 540 px JPEGs with a different date and data, so the scores are indicative only. The CI run on this PR uses the Figma fixture.

| Case                   | Similarity | Main difference                                                              | Class                                              |
| ---------------------- | ---------- | ---------------------------------------------------------------------------- | -------------------------------------------------- |
| 홈 standard light      | 0.745      | full-bleed hero vs compact card, quick-record tray                           | Figma outdated (PR #70/#88)                        |
| 홈 Warrior dark        | 0.848      | same                                                                         | Figma outdated                                     |
| 캘린더 standard light  | 0.952      | 월간/목록 control, + / … buttons, Sunday/Saturday colours, neighbouring days | intentional (code newer, SCREEN-MAP "not redrawn") |
| 급여 standard light    | 0.880      | different core state (unresolved inputs vs "Base only")                      | state, not layout                                  |
| 내 정보 standard light | 0.918      | row glyphs                                                                   | intentional (PR #67/#68)                           |

## 4. Functional defects found and fixed

Every tappable control was traced: action → state → AppModel → core → store → UI. Two independent static reviews were done, and each finding was re-read in the code before it was fixed. Severity follows the request: P0 = data loss, wrong numbers or an unusable feature; P1 = UX or core behaviour.

| #   | Sev | Where                                                    | Defect                                                                                                                                                                                 | Fix                                                                                                                           |
| --- | --- | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| 1   | P0  | `More/ProfileEditView.swift` `loadDraft`/`save`          | 근무 요일 was loaded as Mon–Fri when it was not stored, then saved together with any other change. 중식비·교통비 day counts were then calculated from weekdays the user never entered. | Load only what is stored. Send `null` when the set is empty. Suggest Mon–Fri only when the user picks 주간 출퇴근.            |
| 2   | P0  | `More/RecordImportView.swift` `load`                     | After a failed second file, the first file's preview could still be committed under the second file's error.                                                                           | A new file clears `result`, `rawPreview` and the accepted rows first. Picker errors are shown.                                |
| 3   | P1  | `Pay/PayView.swift`                                      | Rule status `GATED` showed as raw "GATED" or "—".                                                                                                                                      | Shows 확인 필요 with a warning tone.                                                                                          |
| 4   | P1  | `Pay/PayView.swift` month switcher                       | The standard theme never showed the year. Going from December to January looked the same.                                                                                              | The year is shown when the month is outside this year.                                                                        |
| 5   | P1  | `Leave/LeaveView.swift`                                  | 보정 delete happened in one tap and could not be undone. 기관 기록에 맞추기 had no confirmation and no double-tap guard. Errors appeared as green success.                             | Confirmation dialogs, an in-flight guard, and a notice whose tone matches the outcome, placed next to the cards.              |
| 6   | P1  | `Core/AppModel.swift` `reproject`                        | A projection error set `projection = nil`, so 홈 and 연가 내역 showed a spinner forever.                                                                                               | Keeps the last projection and sets `projectionFailed`. `ProjectionPlaceholder` / `ProjectionStaleNotice` offer 다시 불러오기. |
| 7   | P1  | `Core/AppModel.swift` `run`                              | When only the snapshot re-read failed after a committed write, it was reported as "저장하지 못했어요". Retrying then created a duplicate.                                              | The write result and the snapshot refresh are handled separately.                                                             |
| 8   | P1  | `Records/RecordsView.swift`                              | Delete and 되돌리기 errors were silent, for example a restore onto a new overlapping 연가. Delete was not blocked when read-only.                                                      | `actionError` notice above the bottom bar, and a read-only guard.                                                             |
| 9   | P1  | `Records/RecordsView.swift` `DayCell`                    | Two-digit days clipped to "…" at AX3–AX5.                                                                                                                                              | Capped at xxxLarge, single line, scales down.                                                                                 |
| 10  | P1  | `Records/EventEditorSheet.swift`                         | A double tap on 저장 could create two records. Quick patches could overwrite each other. A load failure showed a spinner forever. Delete failures were silent.                         | `saving` guard, patches serialized on the latest draft, error view, failures shown through `refuse`.                          |
| 11  | P1  | `Pay/AttendanceEditorView.swift`                         | A load failure showed a spinner forever. A stale reload could overwrite day counts. There was no unsaved-change guard.                                                                 | Error state with retry, a generation counter, and `EditorDismissGuard`.                                                       |
| 12  | P1  | `App/SuperGongikApp.swift`, `Security/PrivacyLock.swift` | The lock and app-switcher cover was an overlay under modal sheets. An open sheet stayed visible and usable over the lock.                                                              | `PrivacyCoverWindow`: its own `UIWindow` at `.alert + 1`.                                                                     |
| 13  | P1  | `Core/DutyActivityController.swift`                      | The Live Activity was never updated, so it kept yesterday's D-day, and it stayed after 데이터 지우기.                                                                                  | `refresh` runs on every reprojection. A new discharge date restarts it. It ends on wipe.                                      |
| 14  | P1  | `Notifications/ReminderScheduler.swift`                  | The backup reminder was based on `now`, re-planned on every write, so it never fired. The copy said 더보기.                                                                            | It counts from the first planned date. The copy now says 내 정보.                                                             |
| 15  | P1  | `Cloud/CloudModel.swift`, `CloudSyncView.swift`          | `try?` dropped errors, so 동기화 켜기 looked done after a failure. A cloud backup was deleted in one tap.                                                                              | Errors are shown, the preview is kept on failure, and delete asks for confirmation.                                           |
| 16  | P1  | `App/RootView.swift`                                     | Corrupt or newer-version data opens as an empty document, which leads to onboarding. The storage notice was only shown inside the tabs.                                                | The notice is shown above onboarding too.                                                                                     |
| 17  | P1  | `More/ProfileEditView.swift`                             | Opening the form auto-filled institution and fare amounts, so 닫기 asked about changes. A refused save showed its message below the fold.                                              | Auto-fill only after the user edits. A local check that 소집해제 comes after 소집일. Scroll to the message and announce it.   |
| 18  | P2  | `Records/RecordsView.swift`                              | The grid did not follow a day change.                                                                                                                                                  | It follows `model.today` when today was selected.                                                                             |
| 19  | P2  | `Records/EventEditorSheet.swift`                         | Moving 시작일 past 종료일 was refused only on 저장.                                                                                                                                    | 종료일 moves along with it.                                                                                                   |

## 5. Open items (not fixed in this PR)

- **P2** — 홈 agenda rows can't be tapped (in 캘린더 they open the editor).
- **P2** — Tabs:
  - re-tapping the active tab does not pop to root or scroll to top;
  - hidden tabs keep their `TimelineView` and animations running.
- **P2** — Pull-down on an edited sheet is blocked but does not ask; only 닫기 asks.
- **P2** — `PaySetupActions` still matches on Korean explanation text (`인정 기간`). It needs a structured gate reason from the core.
- **P2** — 9,000원 meal minimum is hard-coded in `ProfileEditView`. The rules version it per year.
- **P2** — Widgets reload on every reprojection, and a failed projection clears them.
- **Plausible, needs a run:**
  - `ASWebAuthenticationSession` is not strongly retained;
  - several `.fileExporter`s share the 내 정보 list;
  - `kvGet` read errors look like an empty store.
- **Design:**
  - redraw Figma 홈 `202:*` from Stitch A;
  - draw the 캘린더 월간/목록 control;
  - draw the 내 정보 row glyphs;
  - set `theme/world-language` off for Standard in Figma.

## 6. Needs a real device (not covered by simulator results)

None of these are covered by simulator results:

- Face ID / app lock, including the new cover window over sheets
- push and local notifications (backup reminder)
- widgets on the home screen
- Live Activity and Dynamic Island update/end
- file sharing and exporters
- OAuth sign-in (Google / Kakao / NAVER / Apple)
- VoiceOver traversal
- the Reduce Motion setting (SwiftUI cannot force it in CI; Warrior effects animate in the captures)
- iPad readability
