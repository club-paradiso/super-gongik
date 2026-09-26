# Competitive UX audit, 2026

Research date: **2026-09-26**. Fixture date for SUPER GONGIK screenshots: 2026-10-14 09:00 KST.

## 0. Evidence rules and limits

- The build environment's egress proxy **blocked direct fetches** of apps.apple.com, play.google.com, goondori.com, holy.kiwi, gongik-human.imweb.me, platum.kr, startupn.kr, dcinside, mwm.ai and similar hosts. Only `github.com` / `raw.githubusercontent.com` could be fetched.
- Competitor claims therefore come from **web-search result snippets** for the cited URL. They are labelled `(snippet)`: the claim appeared in search results for that page, but the page was not read first-hand. `(fetched)` means the page was read.
- **No competitor screenshots could be viewed.** This audit makes no claim about competitor visual layouts beyond what store descriptions state in words. Visual comparisons in section 4 are limited to SUPER GONGIK's own rendered screens.
- Ratings and download counts are approximate marketing or aggregator figures. Treat them as unverified.
- Anything not found is marked **DATA MISSING**. Nothing was inferred to fill a gap.

## 1. Products examined

| Product                                  | Type                                                                | Primary source(s)                                                                                                                                                                                                                | Notes                                                                                                                       |
| ---------------------------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| 공익인간                                 | 사회복무요원 app (iOS/Android)                                      | https://apps.apple.com/kr/app/%EA%B3%B5%EC%9D%B5%EC%9D%B8%EA%B0%84/id1551639457 (snippet); https://play.google.com/store/apps/details?id=com.project.realproject (snippet)                                                       | Free, with a premium purchase. Around "3.8/5, 50k+" (snippet, store unverified).                                            |
| 군돌이                                   | Discharge D-day app for active duty; also covers 사회복무요원 dates | https://apps.apple.com/kr/app/%EA%B5%B0%EB%8F%8C%EC%9D%B4-%EA%B5%B0%EB%8C%80-%EC%A0%84%EC%97%AD%EC%9D%BC%EA%B3%84%EC%82%B0%EA%B8%B0/id1435166687 (snippet); https://play.google.com/store/apps/details?id=com.goondori (snippet) | App Store 4.7 (snippet). Android 5.5.0 released 2026-06-21 per https://goondori.en.uptodown.com/android/versions (snippet). |
| 공익생활                                 | New 사회복무요원 app                                                | https://github.com/ParkMyungJae/gongiklife **(fetched)**                                                                                                                                                                         | © 2026. Built by a serving 사회복무요원.                                                                                    |
| 공익 성적표                              | 사회복무요원 progress and pay app with a widget                     | https://play.google.com/store/apps/details?id=com.glacier.sscalculator (snippet)                                                                                                                                                 | Designed to be screenshotted and shared.                                                                                    |
| 공익매니저 (SSAMS)                       | Pay-check calculator                                                | https://play.google.com/store/apps/details?id=com.dj.agent (snippet)                                                                                                                                                             | Checks whether the month's pay arrived correctly ("월급이 제대로 들어왔는지").                                              |
| 행정반                                   | Military all-in-one (includes 공익)                                 | https://apps.apple.com/kr/app/id1499123725 (snippet)                                                                                                                                                                             | Calendar, leave, salary, widget, community.                                                                                 |
| 사회복무포털 / 병무청 app / 나라사랑포털 | Official services                                                   | https://www.mma.go.kr/contents.do?mc=mma0001006 (snippet); https://namu.wiki/w/사회복무요원/휴가 (snippet)                                                                                                                       | Administration only. No personal leave or pay ledger was found.                                                             |

## 2. Findings per competitor

### 공익인간 (all snippet unless noted)

- **Home:** one dashboard with "근무 현황, 진급일, 훈련 기간, 월급, 휴가" (App Store description).
- **D-day and progress:** D-day and promotion dates "대시보드에서 직관적으로 확인" (mwm.ai). Percentage is "실시간으로 증가하는 복무율 퍼센트" (App Store). The visual form of the progress indicator is **DATA MISSING**.
- **Salary:** calculated automatically from registered leave, with 기본급·식비·교통비 shown separately and "계산 과정까지 자세히". Training-period pay is added to the next month. Payday notification. The 월급 계산 시작일 setting is under 프로필 > 급여•휴가 (developer reply).
- **Leave:**
  - Eleven types: 연가, 오전/후 반가, 외출, 병가, 오전지참, 오후조퇴, 병가외출, 특별휴가, 청원휴가, 공가.
  - Remaining leave is shown "최소 10분 단위까지".
- **Rank / pay step:** countdown to the next promotion; the default date can be overridden.
- **Calendar:** DATA MISSING.
- **Widgets:** DATA MISSING.
- **Other features:** dark mode; community; workplace reviews scored on five axes.
- **Complaints:**
  - Leave records were lost after a reset and reinstall; the user asked for backup. The developer promised to add it. Whether it shipped is **unverified**.
  - A user could not find the salary start-date setting.

### 군돌이 (all snippet)

- **Hero:** "D-day와 계급을 한눈에", "실시간으로 변하는 퍼센트", a "복무 게이지", and "다음 계급, 다음 호봉까지 얼마나 남았는지".
- **Widgets:** several sizes with transparency.
- **Personalisation:**
  - Themes, some shown only to some users for a limited time.
  - Up to 12 tracked people, with photos.
- **Leave:** "남은 휴가와 캘린더를 함께 보며", i.e. calendar-based leave management.
- **Offline:** offline use with retained login ("이제 오프라인에서도 사용할 수 있으며 …").
- **Recent changes:**
  - New home screen: "홈 화면이 새로워졌으며 …".
  - Member system with identity verification.
  - Content tab.
- **Ads (2024 ad deck):**
  - A launch popup (임팩트 메인팝업).
  - A floating sticker on the home screen.
  - Native banners.
  - Full-screen popups.
  - Premium is ₩1,500/month or ₩9,000 lifetime (https://www.holy.kiwi/goondori/premium-faq-android).
- **Complaints (App Store review snippets):**
  - After an update the app showed a stranger's D-day.
  - **After the UI redesign the D-day no longer changed at midnight**: "11:59에서 00:00으로 바뀌면 화면에서 바로 반영" used to work, but now the user must leave to the home screen and come back.
  - The widget showed another person's D-day.
  - A server outage lost leave data; recovery went through a Google Form (https://www.holy.kiwi/186be645-5d93-80fa-a395-ca43eb7a48ad).
- **사회복무요원 support:** "사회복무요원 군복무단축 적용" (dates). No evidence of 사회복무요원 식비·교통비 or partial-day leave (**DATA MISSING**).

### Others

- **공익생활 (fetched README):** 소집해제 D-day; real-time 복무율; promotion dates; 12 leave types; pay by rank with 식비·교통비; 장병내일준비적금 projection; payday alerts; chat; posting reviews.
- **공익 성적표 (snippet):** "복무율, 남은 복무일, 월급 등 필요한 정보만 한눈에"; built to be screenshotted; a simple widget.
- **SSAMS (snippet):** a pay-verification framing.
- **행정반 (snippet):** calendar, leave, salary, widget, couple linking.

## 3. Current SUPER GONGIK (before this change) — audit of the rendered app

Rendered at 320, 375, 390, 393, 430, 768 and 1440 px with six seeded states (`apps/web/tests/fixtures/service-scenarios.ts`). Evidence: `docs/design/qa-2026/`.

| #   | Finding (before)                                                                                                                                                                                                                                   | Severity                                |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| 1   | **Completed service read "소집해제까지 D-Day"** for months after discharge, alongside "남은 연가 23일" and a note inviting the user to add upcoming leave.                                                                                         | High: wrong primary answer              |
| 2   | **Before call-up the hero said "소집해제까지 D-657" with "0일 복무 · 638일 남음"**: two different remaining counts in one card, and not the question the user has (how long until call-up). "남은 연가 0일" was shown before any leave is granted. | High                                    |
| 3   | **The D-day never changed at midnight while the app stayed open.** `today` was computed only during render, and nothing re-renders at 00:00 KST. This is the exact regression 군돌이 users complained about.                                       | High                                    |
| 4   | Percentage precision jumped between states ("52%" vs "39.9%") because a one-decimal value lost its trailing zero. It could also round up to 100% on the last day.                                                                                  | Medium                                  |
| 5   | The pay row said "확인된 항목만 금액을 보여요…" **even when base pay (₩1,200,000) was already calculated.** The money tab's largest text was "아직 합계 없음".                                                                                     | Medium: the loudest text was a negative |
| 6   | No next milestone and no pay-step countdown. These are table stakes at 군돌이 and 공익인간 (section 2).                                                                                                                                            | Medium                                  |
| 7   | The page header "홈 / 오늘의 복무 현황을 확인해요." spent about 60 px of first-screen height on content with no information.                                                                                                                       | Low                                     |
| 8   | `--text-3` captions measured **3.18:1** on the canvas and 3.51:1 on cards; white-on-teal primary buttons measured **3.48:1**. Both fail WCAG AA for body-size text.                                                                                | Medium (a11y)                           |
| 9   | Calendar: a multi-day leave rendered as unrelated dots. The leave balance was not visible while planning, so the user had to switch views.                                                                                                         | Low–Medium                              |
| 10  | Desktop: the hero stretched to 700 px beside two small tiles, with large empty areas.                                                                                                                                                              | Low                                     |
| 11  | `prettier --check` failed at `HEAD` (`money-tab.tsx`), so CI was red before this work.                                                                                                                                                             | CI                                      |

No domain calculation defect was found. Findings 1–5 were presentation bugs over correct domain values. `calculateServiceProgress` already returned `COMPLETED` / `NOT_STARTED` correctly; the old hero ignored the state.

## 4. Competitive matrix

Legend: ✅ strong · ◑ partial · ✕ absent · ? DATA MISSING. Competitor cells cite section 2 (snippet level unless noted).

| Capability                         | SUPER GONGIK (before)                                          | SUPER GONGIK (after)                                                                                             | 공익인간                                          | 군돌이                                          | Others                                   | Opportunity / decision                                                                                                       |
| ---------------------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | ----------------------------------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| D-day clarity                      | ◑ correct in service; wrong before call-up and after discharge | ✅ phase-aware (소집까지 / 소집해제까지 / D-Day / 복무 완료); gate asserts it sits in the top half of the screen | ✅ dashboard D-day                                | ✅ D-day hero                                   | ✅ (공익생활, 성적표)                    | Must be correct in every phase, not only "in service".                                                                       |
| Emotional impact                   | ◑ static card                                                  | ✅ milestone of the day, final-stretch colour at D-30, discharge-day state; restrained                           | ?                                                 | ✅ themes, photos                               | ◑                                        | Calm celebration instead of themes and confetti.                                                                             |
| Service completion %               | ◑ one decimal, inconsistent                                    | ✅ live 4-decimal % consistent with the day model; floored, so it never reads 100% early                         | ✅ "실시간 복무율"                                | ✅ "실시간 퍼센트"                              | ✅                                       | Parity, plus provable consistency with the day count.                                                                        |
| Time remaining                     | ✅ days                                                        | ✅ days elapsed and remaining; relative "n일 후"                                                                 | ✅                                                | ✅                                              | ✅                                       | —                                                                                                                            |
| Milestones                         | ✕                                                              | ✅ D-500…D-1, 25–99 %, 100일째, 1주년, next pay step                                                             | ◑ promotion countdown                             | ✅ next rank / 호봉                             | ◑                                        | Pay step is derived from the verified 병역법 시행령 제62조① band table, never guessed.                                       |
| Salary / pay                       | ◑ correct, but hidden behind negative copy                     | ✅ leads with the confirmed amount; still never sums a partial total; shows current and next pay step            | ✅ 기본급·식비·교통비 breakdown, payday alert     | ◑ rank pay only                                 | ✅ (공익생활, SSAMS)                     | Keep the verified-only rule as the trust differentiator. A payday alert is out of scope: pay dates are institution-specific. |
| Leave                              | ✅ ledger with 8-hour accumulation                             | ✅ plus the attendance total on home and a balance strip in the calendar                                         | ✅ 11 types, 10-minute units                      | ◑ calendar-based                                | ✅ 12 types                              | SUPER GONGIK is already rule-accurate; this change surfaces that accuracy.                                                   |
| Calendar                           | ◑                                                              | ✅ multi-day range bars, leave strip, quick create from home                                                     | ?                                                 | ✅                                              | ✅ (행정반)                              | —                                                                                                                            |
| Widgets / PWA                      | ✕                                                              | ✕ (PWA install only)                                                                                             | ?                                                 | ✅ several sizes                                | ✅ (성적표)                              | **Competitors remain stronger.** A PWA cannot place home-screen widgets.                                                     |
| Information density                | ◑                                                              | ✅ three tiers, five blocks, one dark surface                                                                    | ?                                                 | ? (ad inventory on home)                        | ?                                        | —                                                                                                                            |
| Navigation                         | ✅ 4 tabs                                                      | ✅ same 4 tabs; contextual deep links (record leave → editor, leave → ledger, import → 내 정보)                  | ◑ settings hard to find (complaint)               | ?                                               | ?                                        | Fewer screen switches.                                                                                                       |
| Personalisation                    | ✕                                                              | ✕                                                                                                                | ◑ dark mode                                       | ✅ themes, photos, 12 people                    | ◑                                        | **Competitors remain stronger.** Not attempted; see limitations.                                                             |
| Visual polish                      | ◑                                                              | ✅ token-based system, type scale                                                                                | ?                                                 | ?                                               | ?                                        | No visual comparison was possible (section 0).                                                                               |
| Accessibility                      | ◑ contrast failures                                            | ✅ AA tokens, spoken D-day, progress `aria-valuetext`, reduced motion, ≥44 px targets checked by the gate        | ?                                                 | ?                                               | ?                                        | —                                                                                                                            |
| Offline resilience                 | ✅ local-first PWA                                             | ✅ unchanged                                                                                                     | ◑ device-only; data lost on reinstall (complaint) | ✅ offline mode; ✕ server outage lost data      | ?                                        | Local-first plus backup plus optional sync avoids both failure modes seen in the market.                                     |
| Privacy                            | ✅ no account needed, no analytics                             | ✅ unchanged; no tracking added                                                                                  | ◑ community / accounts                            | ◑ accounts, identity verification, ads          | ◑                                        | —                                                                                                                            |
| Speed                              | ✅                                                             | ✅ no new dependencies; ticking isolated to one memoised element and paused when hidden                          | ?                                                 | ?                                               | ?                                        | —                                                                                                                            |
| Data accuracy                      | ✅ verified rules, provenance                                  | ✅ unchanged; new schedule cross-checked against the monthly evaluation                                          | ? (no source provenance seen)                     | ✕ wrong-person D-day, midnight bug (complaints) | ? ("2021년 개정 규정" apps may be stale) | Midnight rollover is now a CI gate.                                                                                          |
| Social-service-specific usefulness | ✅ deep but buried                                             | ✅ surfaced: 근태 누계, pay step, confirmed base pay, institution import                                         | ✅                                                | ◑                                               | ✅                                       | —                                                                                                                            |
| Community / reviews                | ✕                                                              | ✕                                                                                                                | ✅                                                | ✅                                              | ✅                                       | Out of scope on purpose: moderation cost and a crowded market.                                                               |
| Ads                                | none                                                           | none                                                                                                             | ?                                                 | heavy (launch popup, floating sticker)          | ?                                        | No ads on the core screen is a differentiator.                                                                               |

## 5. Competitor-based acceptance

**Better than 공익인간 now**

- Every home phase is handled: before call-up, in service, final stretch, discharge day, completed.
- The next milestone and the next pay step are shown on home, and the pay step is derived from the cited 2026 rule with explicit "금액 미확정" wording for 2027.
- Midnight rollover is verified in CI.
- Backup, export and optional sync already existed. This addresses 공익인간's reinstall data-loss complaint, which may or may not still be open (unverified).
- Every number on the pay card traces to a cited source file.

**Better than 군돌이 now**

- The D-day turns over at 00:00 KST while the app stays open. This is tested end to end, and a sabotaged hook makes the gate fail.
- No ads on the core screen.
- 사회복무요원-specific administration (leave ledger with 8-hour accumulation, 급여 gates, institution import) that 군돌이 is not evidenced to have.

**Where competitors remain stronger**

- Native home-screen and lock-screen widgets (군돌이, 공익 성적표).
- Themes, photos and multi-person tracking (군돌이).
- Community and workplace reviews (공익인간, 공익생활).
- Payday push notifications (공익인간, 공익생활).
- Store presence and installed base.

These are not closed by this change.
