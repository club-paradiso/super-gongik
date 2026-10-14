# Screen map — Figma ↔ iOS

- Updated: 2026-10-14 · Figma file `hy0KYmsJxVzj2JwJtbfIpS` · see [FIGMA-SOURCE-OF-TRUTH.md](./FIGMA-SOURCE-OF-TRUTH.md)
- Status: `MATCH` Figma = code · `REFINE` code or Figma adjusted in this sync / small gap noted · `MERGE` Stitch idea folded into a canonical screen · `DEPRECATE` reference only, not built · `FUTURE` needs core/domain work first · `MISSING_IN_CODE` · `MISSING_IN_FIGMA`

## 1. Canonical production screens (page 52)

| Feature               | Figma (page 52)                                | SwiftUI                                                                      | Status | Action / note                                                                               |
| --------------------- | ---------------------------------------------- | ---------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------- |
| 오늘 — normal         | `106:2` 오늘 / Normal · Light                  | `Features/Today/TodayView.swift` `TodayView`, `HeroCard`, `AgendaCard`       | MATCH  | Implemented in this sync: SGStatCard, SGDateTile agenda rows, AGENDA eyebrow, 빠른 실행 row |
| 오늘 — dark + live    | `106:151` 오늘 / Normal · Dark                 | same; `LiveReadout` (`TimelineView`)                                         | MATCH  | Hero is night-sky in both modes; live readout only when the user enabled it                 |
| 오늘 — attention      | `106:296` 오늘 / Attention · 확인 필요         | `LeaveStatCard`, `PayStatCard`                                               | MATCH  | 확인 필요 + warning symbol (was color only)                                                 |
| 오늘 — pre-service    | `106:431` 오늘 / Pre-service · Empty agenda    | same                                                                         | MATCH  | 소집 후 (muted) like the web; empty agenda copy from the web home                           |
| 오늘 — completed      | `106:547` 오늘 / Completed                     | same (`home.completed`)                                                      | MATCH  | Stats and quick actions hidden after discharge (web parity, previously shown on iOS)        |
| 오늘 — loading        | `106:609` 오늘 / Loading                       | `SGLoadingState`                                                             | MATCH  |                                                                                             |
| 오늘 — accessibility  | `106:641` 오늘 / Accessibility XXL (stacked)   | `statLayout` / `QuickActions.layout` (`AnyLayout`)                           | MATCH  | Side-by-side → stacked at accessibility sizes                                               |
| 기록 — month          | `107:608` 기록 / Month                         | `Features/Records/RecordsView.swift` `MonthCalendar`, `DayCell`, `DayPanel`  | MATCH  | Literal sizes replaced by tokens                                                            |
| 기록 — list / filter  | `107:788` 기록 / List · Filter                 | `AgendaList`, `RecentlyDeleted`                                              | MATCH  |                                                                                             |
| 기록 편집 시트        | `108:1041` 기록 편집 / Sheet · Overlap blocked | `Features/Records/EventEditorSheet.swift`                                    | MATCH  | Validation from the shared `validateServiceEventDraft`                                      |
| 휴가 — ready          | `107:891` 휴가 / Ready                         | `Features/Leave/LeaveView.swift` `BalanceCard`, `CreditsCard`, `UsageCard`   | MATCH  | Figma aligned to the code's balance grid                                                    |
| 휴가 — needs confirm  | `107:970` 휴가 / Needs confirmation · Mismatch | `ReconciliationCard`, `ConfirmCreditSheet`                                   | MATCH  |                                                                                             |
| 급여 — base only      | `108:811` 급여 / Base only                     | `Features/Pay/PayView.swift` `SummaryCard`, `ComponentsCard`, `PayBandsCard` | REFINE | Base-only label now uses the warning symbol (was `info.circle` in warning color)            |
| 급여 — pending input  | `108:895` 급여 / Pending input                 | `SummaryCard`, `UnresolvedCard`                                              | REFINE | "계산에 필요한 정보가 있어요" now carries a symbol                                          |
| 더보기                | `108:944` 더보기 / List                        | `Features/More/MoreView.swift` (`Form`)                                      | MATCH  | Native inset-grouped list on purpose                                                        |
| 온보딩                | `108:1018` 온보딩 / Call-up date               | `Features/Onboarding/OnboardingView.swift`                                   | MATCH  | Copy matches Stitch `49:2508` and the code                                                  |
| Import                | `125:2113` 기관 기록 가져오기 / Preview        | `Features/More/RecordImportView.swift`                                       | MATCH  | Native `Form`; drawn 2026-10-13 with the code's copy (CP949 notice, row toggles, history)   |
| Backup / restore      | `125:2039` 백업에서 복원 / Preview · Merge     | `Features/More/BackupViews.swift`                                            | MATCH  | Native `Form`; merge preview, segmented 합치기/덮어쓰기, 바뀌는 내용                        |
| Cloud / auth / sync   | `125:2178` Signed out, `125:2218` Conflict     | `Features/Cloud/CloudSyncView.swift`                                         | MATCH  | Native `Form`; status text and tones from `sync-copy.ts`; conflict choice in plain Korean   |
| Profile edit          | `125:2298` 복무 설정 / Sheet                   | `Features/More/ProfileEditView.swift`                                        | MATCH  | Sheet with 닫기/저장; 44 pt weekday chips                                                   |
| Attendance editor     | `125:2381` 근무일 확인 / Sheet                 | `Features/Pay/AttendanceEditorView.swift`                                    | MATCH  | Native `Form` sheet; day-kind captions omitted (core labels)                                |
| Security / privacy    | `125:2454` 개인정보 보호 / Locked cover        | `Features/Security/PrivacyLock.swift` `PrivacyCoverView`                     | MATCH  | Hero background + official logo + "Face ID로 열기"                                          |
| Notifications         | —                                              | `Features/Notifications/ReminderScheduler.swift`                             | n/a    | No UI beyond settings rows                                                                  |
| Widgets               | Stitch `49:1009` (reference)                   | `SuperGongikWidgets/ServiceWidgets.swift`                                    | REFINE | Uses hero tokens; fixed `.system(size:)` fonts remain (see gaps)                            |
| Global states / flows | `108:3441`, `108:3554` (page 53)               | `RootView`, `StorageNoticeBanner`, `ErrorCopy`                               | MATCH  | Copy on page 53 is the code's copy                                                          |
| Responsive            | `108:2598` (page 53)                           | `SGLayout`, `LayoutTokenTests`                                               | MATCH  | 375/390/393/402/430 pt + iPad readable width                                                |

Home hierarchy (Stitch `screen_matrix.md`, web `home-tab.tsx`): phase → D-day/live → progress → discharge date → next milestone → leave → pay → agenda → quick actions.

### Warrior theme (page 52, row "Warrior 테마") — completed 2026-10-13

Every standard state now has a Warrior frame. Frames set `SG · Color` = Warrior Light/Dark and `SG · Theme` = Warrior; components draw the ornaments. The 2026-10-07 palette-only row (`111:3277` …) is archived on page 99.

| Figma (page 52)                                                                                                                                                                                                      | SwiftUI / web                                    | Status |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | ------ |
| 오늘: `123:2854` Light, `123:3090` Dark (live), `123:3330` Attention, `123:3566` Pre-service, `123:3785` Completed, `123:3912` Loading, `123:3977` XXL                                                               | `TodayView` · web `home-tab.tsx`                 | MATCH  |
| 기록: `123:4173` Month Light, `123:4383` Month Dark, `123:4593` List, `123:4730` Editor sheet                                                                                                                        | `RecordsView`, `EventEditorSheet` · web calendar | MATCH  |
| 휴가: `123:4763` Ready Light, `123:4893` Ready Dark, `123:5023` Needs confirmation                                                                                                                                   | `LeaveView` · web leave ledger                   | MATCH  |
| 급여: `123:5122` Base Light, `123:5238` Base Dark, `123:5354` Pending                                                                                                                                                | `PayView` · web money tab                        | MATCH  |
| 더보기: `123:5436` Light, `123:5556` Dark · 온보딩: `123:5676` Light, `123:5701` Dark                                                                                                                                | `MoreView`, `OnboardingView` · web 내 정보       | MATCH  |
| 보조 화면 (Warrior Light): `125:7666` backup, `125:7740` import, `125:7794` cloud signed out, `125:7834` cloud conflict, `125:7914` profile, `125:7997` attendance, `125:8070` lock; Dark: `125:8079` cloud conflict | native `Form`s, palette only (no ornaments)      | MATCH  |
| Global states (page 53): `125:8178` Warrior Light, `125:8241` Warrior Dark                                                                                                                                           | `RootView`, `ErrorCopy`, banners                 | MATCH  |

Spec and QA record: page 55 "Warrior — Spec & QA" (`125:8485`). Component review (Standard / Warrior Light / Warrior Dark): page 51 `120:3712`.

### Stitch · Civic Codex (page 52, rows "Civic Codex 1" … "7-8") — 2026-10-13/14

Direction B from page 40 (`49:290`), drawn per [STITCH-IMPLEMENTATION-PLAN.md](./STITCH-IMPLEMENTATION-PLAN.md). Four-tab bar: page 51 `AppTabBar · 4` (`201:610`). World labels appear only in Warrior frames (`theme/world-language`, code `SGWorldEyebrow`).

| Phase                | Figma (page 52)                                                                    | SwiftUI                                                                                                       | Status |
| -------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------ |
| 1 홈                 | `202:3614` Light, `202:3847` Warrior Light, `202:3956` Warrior Dark                | `App/RootView.swift`, `Features/Today/TodayView.swift`                                                        | MATCH  |
| 2 캘린더             | `204:3938` Light, `204:4256` Warrior Light, `204:4469` Warrior Dark                | `Features/Records/RecordsView.swift`, `Features/Leave/LeaveView.swift`                                        | MATCH  |
| 3 급여               | `206:4205` Light, `206:4424` Warrior Light, `206:4539` Warrior Dark                | `Features/Pay/PayView.swift`                                                                                  | MATCH  |
| 4 내 정보            | `207:4469` Light, `207:4633` Warrior Light, `207:4728` Warrior Dark                | `Features/More/MoreView.swift`                                                                                | MATCH  |
| 5 온보딩             | `208:4628` Step 1, `208:4655` Step 2, `208:4683` Step 3, `208:4721` Step 4 (Light) | `Features/Onboarding/OnboardingView.swift`                                                                    | MATCH  |
| 6 복무 기록 요약 PDF | `209:4634` A4 1쪽                                                                  | `Features/More/RecordSummaryPDF.swift`                                                                        | MATCH  |
| 7 라이브 액티비티    | `210:4634` 잠금 화면, `210:4646` Dynamic Island compact, `210:4650` expanded       | `SuperGongikWidgets/DutyLiveActivity.swift`, `Shared/DutyActivity.swift`, `Core/DutyActivityController.swift` | MATCH  |
| 8 복무 기념 카드     | `210:4664` 앞면, `210:4672` 뒷면                                                   | `Features/More/MemorialCardView.swift`                                                                        | MATCH  |

The plan's status table records what was checked on the simulator for each phase.

On 2026-10-14 the three 내 정보 frames (`207:4469`, `207:4633`, `207:4728`) gained the rows that phases 6–8 added in code: 복무 기념 카드 under 복무 설정, a 잠금 화면 section (잠금 화면에 오늘 근무 표시) before 알림, and a 복무 기록 요약 PDF section after the backup rows, each with the code's footer text.

Stitch views marked DEPRECATE below are still not built as screens; the Warrior theme takes their palette and mood, not their layouts, sample data or out-of-scope features.

## 2. Stitch imported screens (page 40, 54 views)

Class: A production screen · B visual variant · C interaction state · D concept only · E duplicate · F web-only · G obsolete · H future feature · I sample/demo only.

| Node       | Stitch view                     | Class | Production target                      | Status    | Notes                                                                                                                            |
| ---------- | ------------------------------- | ----- | -------------------------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `49:10627` | master_synthesis                | A     | 오늘 + Warrior theme                   | MERGE     | Source of hero/stat card/agenda direction and the Warrior light palette. Journey trail FUTURE; HUD header and 4 tabs not adopted |
| `49:13596` | the_epic_duty_hero              | B     | 오늘                                   | DEPRECATE | Character titles, "칼퇴근" flavor copy                                                                                           |
| `49:9781`  | fullscreen_epic_hero_swipe_hud  | D     | —                                      | DEPRECATE | Swipe HUD concept                                                                                                                |
| `49:12192` | rpg                             | D     | —                                      | DEPRECATE | Cutscene with agent-name entry; the app does not collect a name                                                                  |
| `49:12384` | rpg_civic_odyssey               | B     | 온보딩                                 | MERGE     | Call-up date step only; "AES-256" claim dropped (not true)                                                                       |
| `49:8264`  | dark_hud_1                      | H/I   | —                                      | DEPRECATE | Collectible card binder (out of scope)                                                                                           |
| `49:2`     | direction_a_twilight_frontier   | D     | —                                      | DEPRECATE | Direction study                                                                                                                  |
| `49:290`   | direction_b_civic_codex         | D     | —                                      | DEPRECATE | Direction study                                                                                                                  |
| `49:516`   | direction_c_modern_chronicle    | D     | —                                      | DEPRECATE | Direction study                                                                                                                  |
| `49:6532`  | calendar_duty_lock_management   | A     | 기록 (month + filter)                  | MERGE     | Sick/special leave balances FUTURE (not in core)                                                                                 |
| `49:7012`  | calendar_quest_log              | A     | 기록                                   | MERGE     | Month summary strip FUTURE (needs a core read model)                                                                             |
| `49:7436`  | calendar_quest_log_dark_hud     | B     | 기록 (dark)                            | DEPRECATE | Dark is handled by tokens                                                                                                        |
| `49:4330`  | super_gongik_4                  | A     | 휴가 `UsageCard` (지각·조퇴·외출 누계) | REFINE    | Meter visual FUTURE; rule text must come from the core                                                                           |
| `49:1690`  | super_gongik_12                 | A     | 기록 편집 시트                         | MERGE     | Balances in the sheet FUTURE                                                                                                     |
| `49:13239` | supply_compensation             | A     | 급여                                   | MERGE     | Payday countdown, "VERIFIED", institution phone, 산출식 sheet not adopted (fabricated / not in core)                             |
| `49:3835`  | super_gongik_3                  | E     | 급여                                   | DEPRECATE | Duplicate of `49:13239`                                                                                                          |
| `49:6026`  | ai                              | H/I   | —                                      | DEPRECATE | AI card creation (out of scope)                                                                                                  |
| `49:6272`  | ai_dark_hud                     | E     | —                                      | DEPRECATE | Dark duplicate                                                                                                                   |
| `49:7841`  | character                       | B     | 더보기 (profile header)                | DEPRECATE | Rank/호봉 identity card; profile is a native list                                                                                |
| `49:10965` | objekt                          | H     | completed-service archive              | FUTURE    | Export/archive after discharge; cosmetics out                                                                                    |
| `49:11147` | odyssey_card_1                  | H     | completed-service archive              | FUTURE    | "Cryptographic certificate" claims not adopted                                                                                   |
| `49:11337` | odyssey_card_2                  | E     | —                                      | DEPRECATE | Duplicate                                                                                                                        |
| `49:13953` | verified_agent_1                | H     | completed-service archive              | FUTURE    |                                                                                                                                  |
| `49:13982` | verified_agent_2                | E     | —                                      | DEPRECATE | Duplicate                                                                                                                        |
| `49:10151` | genesis_character_creation      | D     | —                                      | DEPRECATE | Character classes (out of scope)                                                                                                 |
| `49:12910` | step_by_step_character_creation | D     | —                                      | DEPRECATE |                                                                                                                                  |
| `49:12015` | prologue_step_2                 | B     | 온보딩                                 | MERGE     | Date-entry idea only (defaults, 21-month standard)                                                                               |
| `49:12688` | rpg_prologue_cutscene           | D     | —                                      | DEPRECATE |                                                                                                                                  |
| `49:12771` | rpg_prologue_hud                | D     | —                                      | DEPRECATE |                                                                                                                                  |
| `49:14220` | warp_odyssey_gate               | D     | —                                      | DEPRECATE | Transition FX                                                                                                                    |
| `49:12994` | supernova_warp_fx               | E     | —                                      | DEPRECATE |                                                                                                                                  |
| `49:9640`  | final_quest_complete            | A     | 오늘 — completed                       | MERGE     | Celebrate hero kept; "공식 인증 증서" not adopted (imitates an official document)                                                |
| `49:3563`  | super_gongik_2                  | E     | —                                      | DEPRECATE | Same content as `49:14220`                                                                                                       |
| `49:2924`  | super_gongik_17                 | E     | —                                      | DEPRECATE |                                                                                                                                  |
| `49:3396`  | super_gongik_19                 | D     | —                                      | DEPRECATE | Prologue                                                                                                                         |
| `49:9059`  | dynamic_island                  | H     | Live Activity                          | FUTURE    | Needs work-hours data and a new target; "칼퇴 타이머" not a product feature                                                      |
| `49:10471` | live_activity                   | H     | Live Activity                          | FUTURE    |                                                                                                                                  |
| `49:1009`  | super_gongik_10                 | A     | Widgets                                | REFINE    | Existing small/medium/lock widgets; presets FUTURE                                                                               |
| `49:11518` | pdf_1                           | I     | —                                      | DEPRECATE | Imitates an official MMA document — must never ship                                                                              |
| `49:11802` | pdf_2                           | E     | —                                      | DEPRECATE | Duplicate of `49:9640`                                                                                                           |
| `49:4633`  | super_gongik_5                  | H/I   | —                                      | DEPRECATE | Photocard print                                                                                                                  |
| `49:8593`  | dark_hud_2                      | E     | —                                      | DEPRECATE |                                                                                                                                  |
| `49:8743`  | dark_hud_3                      | E     | —                                      | DEPRECATE |                                                                                                                                  |
| `49:800`   | super_gongik_1                  | H     | institution transfer                   | FUTURE    | Not in the domain model                                                                                                          |
| `49:1363`  | super_gongik_11                 | F/H   | —                                      | DEPRECATE | Legal "defense" scripts — out of scope                                                                                           |
| `49:2031`  | super_gongik_13                 | A     | Backup / cloud                         | MERGE     | Ideas folded into the backup/cloud flows (page 53)                                                                               |
| `49:2256`  | super_gongik_14                 | E     | —                                      | DEPRECATE | Duplicate of `49:4330`                                                                                                           |
| `49:2508`  | super_gongik_15                 | A     | 온보딩                                 | MATCH     | "복무 현황, 한눈에 챙겨요" is the shipped copy; encryption claim dropped                                                         |
| `49:2749`  | super_gongik_16                 | A     | Backup                                 | MERGE     | "IndexedDB" is web-only (F)                                                                                                      |
| `49:3196`  | super_gongik_18                 | E     | —                                      | DEPRECATE | Duplicate of `49:2031`                                                                                                           |
| `49:4944`  | super_gongik_6                  | E     | —                                      | DEPRECATE | Duplicate of `49:8264`                                                                                                           |
| `49:5261`  | super_gongik_7                  | B     | 기록 편집 시트                         | DEPRECATE | Variant of `49:1690`                                                                                                             |
| `49:5495`  | super_gongik_8                  | H     | Widgets                                | FUTURE    | Widget presets                                                                                                                   |
| `49:5785`  | super_gongik_9                  | A     | 기록 편집 시트 (type picker)           | MERGE     | Types and their labels come from the core; balances FUTURE                                                                       |

Totals: 54 views → 1 MATCH, 11 MERGE, 2 REFINE, 7 FUTURE, 33 DEPRECATE. Production targets: 오늘, 기록, 기록 편집, 휴가, 급여, 온보딩, backup/cloud and widgets.

## 3. Stitch imported controls (page 43, 51 controls)

| Stitch nodes                                                                                                                                                                                                                                           | Count | Production component                                                                                      | Status    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----- | --------------------------------------------------------------------------------------------------------- | --------- |
| `50:7` `50:23` `50:39` `50:55` `50:71` `50:476` `50:513` `50:577` `50:641` `50:719` `50:739` `50:760` `50:779` `50:801` `50:856` `50:911` `50:966` `50:1021` `50:1055` `50:1074` `50:1093` `50:1112` `50:1240` `50:1620` `50:1701` `50:1778` `50:2092` | 27    | `AppTabBar` (`105:179`) → native `TabView`                                                                | MERGE     |
| `50:1152` `50:1399` `50:1468` `50:1557` `50:2022` `50:2262` `50:2334`                                                                                                                                                                                  | 7     | `NavigationBar` (`105:180`) → native `NavigationStack` title                                              | MERGE     |
| `50:206` (각인 및 배치 완료), `50:419` (홈 둘러보기)                                                                                                                                                                                                   | 2     | `SGButton` Primary / Secondary                                                                            | MERGE     |
| `50:136` `50:271` (cloud save), `50:250` (출근일수 재산정)                                                                                                                                                                                             | 3     | `SGButton` Secondary (cloud, backup, 근무일 확인)                                                         | MERGE     |
| `50:289` (전체보기)                                                                                                                                                                                                                                    | 1     | Agenda "캘린더 보기" link row                                                                             | MERGE     |
| `50:700` (calendar day)                                                                                                                                                                                                                                | 1     | `DayCell` (RecordsView)                                                                                   | MERGE     |
| `50:338` (산출식 보기), `50:400` (PDF 내보내기), `50:305` (Apple Wallet)                                                                                                                                                                               | 3     | —                                                                                                         | FUTURE    |
| `50:155` `50:186` `50:228` `50:321` `50:365` `50:438` `50:456`                                                                                                                                                                                         | 7     | — (legal scripts, cutscene skip, sealed pay slip, social share, fake contact, card flip, photocard print) | DEPRECATE |

51 imported controls → 5 production components (`AppTabBar`, `NavigationBar`, `SGButton`, agenda link row, `DayCell`); 3 FUTURE; 7 DEPRECATE.

## 4. Rendered native QA vs canonical Figma (2026-10-07)

Evidence: CI job "iOS · app tests and simulator screenshot QA", artifact `ios-screenshots-<sha>`. It is also printed as JPEG thumbnails in the job log.

- Runtime: Xcode 26.3, iOS 26.2 Simulator.
- 27 cases:
  - iPhone 16 (393 pt): standard and Warrior, light and dark, every tab;
  - iPhone SE 3rd gen (375 pt) and iPhone 16 Plus (430 pt);
  - Accessibility XXL Dynamic Type;
  - Increase Contrast.
- Demo document: created by the shared core through the DEBUG seed.

| Finding                                                                                               | Class                         | Action                                                                                                    |
| ----------------------------------------------------------------------------------------------------- | ----------------------------- | --------------------------------------------------------------------------------------------------------- |
| Tab bar renders as the iOS 26 floating Liquid Glass bar; Figma `AppTabBar` is a full-width bar        | INTENTIONAL_NATIVE_DIFFERENCE | Figma page 52 header and `AppTabBar` description say the bar is system-owned                              |
| 기록 segmented control reads 월간 / 목록 in the app; Figma said 달력 / 목록                           | MINOR                         | Figma updated to 월간 / 목록                                                                              |
| 급여 rank line ("상병 상당 · 복무 11개월 차") can wrap inside "11개월" at Accessibility XXL           | MINOR                         | Left as is: native Korean line breaking, nothing clipped. Revisit with a stacked layout if it is reported |
| Warrior light differs from standard light mostly in accent and canvas tint                            | INTENTIONAL                   | Matches Stitch's light screens; the Warrior identity is strongest in the hero and in dark mode            |
| Hierarchy, card geometry, spacing, hero, stat cards, agenda date tiles, section headers, theme picker | MATCH                         | —                                                                                                         |
| Clipping or overflow at 375 / 430 pt or Accessibility XXL                                             | none found                    | —                                                                                                         |
| Increase Contrast: stronger borders and secondary text in both themes                                 | MATCH                         | —                                                                                                         |
| Native chrome in both themes: nav bar canvas, grouped list rows, Warrior gold selection               | MATCH                         | —                                                                                                         |

No BLOCKER or MAJOR discrepancies.

The seed's call-up date predates the verified leave rule, so 휴가 and 오늘 show the "확인 필요" attention states. That is real core output, and it exercises the warning treatment.
