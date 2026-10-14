# Stitch fidelity audit (2026-10-14)

The owner asked whether the app matches the Stitch project "Super Gongik RPG
Redesign" exactly. Source: the 54 Stitch views exported to Figma page 40
(`17:12`). The Stitch canvas itself only renders in a visible browser tab, so
page 40 is the readable copy of the same export.

The rules in [STITCH-IMPLEMENTATION-PLAN.md](./STITCH-IMPLEMENTATION-PLAN.md)
still apply. "Same as Stitch" means the same structure, components, colours,
type and wording, except where Stitch shows something the app cannot make
true.

Legend:

- **match**: already the same.
- **fixed**: changed in this pass.
- **rule**: excluded by the plan's rules.
- **no data**: the shared core has no rule or data for it, so showing it would
  invent a value.
- **native**: an intentional iOS difference.

## 홈 (Stitch `49:290` direction B, `49:10627` master synthesis)

| Stitch element                                                     | App                                                                                                                | Status                                       |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------- |
| Header: mark, SUPER GONGIK, status line                            | same; the mark is the app's own artwork instead of Stitch's placeholder shield                                     | match                                        |
| D-day pill with a clock glyph                                      | clock glyph added                                                                                                  | fixed                                        |
| Profile button at the trailing edge                                | generic person glyph in a navy circle; opens 내 정보                                                               | fixed                                        |
| "LVL.02 SGT" chip, "CHAPTER 02 · 지평선의 관문"                    | not drawn                                                                                                          | rule (level and rank, invented chapters)     |
| Countdown card: tag, D-day, discharge date, progress, percent pill | same (world tag in Warrior only)                                                                                   | match                                        |
| 51.927361 % precise percent                                        | the live readout shows seconds only when the user turns it on                                                      | match                                        |
| Milestone chips, each a bordered card                              | every chip now has a border; the next one keeps the accent border                                                  | fixed                                        |
| Leave card: remaining / granted, bar                               | same                                                                                                               | match                                        |
| Leave card: "병가 잔여 28일"                                       | not drawn                                                                                                          | no data (the core has no sick-leave balance) |
| Pay card: amount and the 기본급 · 식비 · 교통비 line               | same; the line comes from the core's caption when the components are known                                         | match                                        |
| Pay card: "검증 완료", "10일 입금 예정"                            | not drawn                                                                                                          | rule (verified state, payday)                |
| Agenda card                                                        | same                                                                                                               | match                                        |
| Buttons: 근무기록 추가 (secondary), 연가 사용 (primary, airplane)  | the app had 연가 내역 / 휴가·근태 기록; now 근무기록 추가 opens the editor and 연가 사용 opens it with 연가 chosen | fixed                                        |
| Tab bar with world sub-labels                                      | four tabs; sub-labels in Warrior only                                                                              | match (rule for the labels)                  |

## 캘린더 (Stitch `49:7012`, `49:7436`)

| Stitch element                                                                | App                                                                  | Status                                                   |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------------- | -------------------------------------------------------- |
| "오늘" button at the top trailing edge                                        | moved from the month card to the toolbar, always shown in month view | fixed                                                    |
| Month switcher with tinted chevron tiles                                      | same                                                                 | match                                                    |
| Saturday in blue, Sunday in red                                               | Saturday was plain                                                   | fixed                                                    |
| Rounded-square day tiles; days with records tinted with their category colour | circles before; now rounded squares and a 16 % category tint         | fixed                                                    |
| Neighbouring months' days, muted                                              | blank before; now drawn muted and not tappable                       | fixed                                                    |
| Public holidays in red, "공휴일 (OFF)" in the legend                          | not drawn                                                            | no data (the core intentionally has no holiday calendar) |
| Month counts: "이번 달 복무 20일 · 사용 연가 2.5일"                           | the app counts records; day totals stay in the leave ledger          | native (decided in phase 2)                              |
| Selected-day card: "CONFIRMED", "결재 완료 / 승인됨", "AUTH:SC-2025-081"      | not drawn                                                            | rule (approval states and numbers)                       |
| Upcoming list with date badges and category chips                             | same                                                                 | match                                                    |
| "CIVIC INVENTORY" summary strip                                               | same (InventoryStrip); 잔여 병가 is not shown                        | match / no data                                          |
| 월간 · 목록 segmented control                                                 | the app keeps a list view Stitch does not draw                       | native                                                   |

## 급여 (Stitch `49:13239`, `49:3835`)

| Stitch element                                                          | App                                                    | Status                             |
| ----------------------------------------------------------------------- | ------------------------------------------------------ | ---------------------------------- |
| Summary card: month, amount, three component tiles, estimate note       | same                                                   | match                              |
| "실수령 예상액"                                                         | the app says 예상 보수: it does not compute deductions | rule (would be untrue)             |
| "검증 완료 (VERIFIED)", "지급 D-5 (3.25)", "서초구청 복무지원과" header | not drawn                                              | rule                               |
| 장병내일준비적금 매칭 tile and card                                     | not drawn                                              | rule (no rule in `packages/rules`) |
| Itemised component cards                                                | same                                                   | match                              |
| Pay-band roadmap                                                        | same; "사회복무요원은 계급이 없어요" note kept         | match                              |
| Institution contact row with phone number                               | not drawn                                              | rule                               |

## 내 정보 (Stitch `49:7841` character)

Most of the Stitch character sheet is name, photo, 식별코드, rank, institution
contacts and a map. None of it is drawn (rule). The app keeps the summary card
and the settings list. Figma 52 now also has the phase 6–8 rows.

## 온보딩 (Stitch 06 group)

Stitch asks for a name, a "hero title", an ID code and a class. None of it is
drawn (rule). The app's four steps (call-up date → discharge date → 분야 →
confirm) and the static intro are the implementation.

## Widgets and Live Activity (Stitch 07 group)

- Live Activity: compact and expanded Dynamic Island and the lock screen were
  checked on 2026-10-14 (see the plan's status table). The Stitch long-press
  menu (판타지 업무 기록, 규정 방어 치트) is not built (rule: fake missions).
- Home-screen widgets: Stitch shows a widget gallery with three presets
  (황혼 나이트, 에픽 골드, 미니멀 블랙) and small, medium and large widgets.
  - The large widget carries a name, an ID code and a rank, so it is not built
    (rule).
  - "초정밀 실시간 복무율 52.038433%" is not drawn: a widget cannot update
    every second, and the widget code says so.
  - The preset gallery is built as 내 정보 › 홈 화면 위젯 › 위젯 스타일
    (Figma page 52 `234:4634`). It offers 황혼 나이트 (the app's night sky,
    the default), 에픽 골드 and 미니멀 블랙. The small and medium faces moved
    to `Shared/WidgetPreset.swift`, so the screen previews exactly what the
    widget draws. Personal-team builds have no App Group: there the widget
    cannot read the app's data or the preset (as before), and only the
    in-app preview changes.

## Second pass (2026-10-14)

- The app header (mark, SUPER GONGIK, state, D-day pill, profile button) is
  now on 캘린더, 급여 and 내 정보 too, with the screen title under it, as in
  Stitch. The navigation bar is hidden on those roots; 캘린더's 오늘, 기록
  추가 and 연가 내역 moved to the title row, and 급여's month switcher sits on
  its title row under "SUPPLY // yyyy.mm PAYROLL" (Warrior only).
- 내 정보 rows carry leading icons, like the Stitch character sheet.

## Remaining gaps

- Tab bar glyphs: Stitch uses Material icons (crossed swords, wallet,
  trophy) with no SF Symbols equivalent; the Figma `AppTabBar · 4` glyphs
  stay (native).
