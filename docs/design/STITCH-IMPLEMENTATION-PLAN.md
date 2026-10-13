# Stitch → iOS implementation plan

Decision (2026-10-13, owner): implement the Stitch RPG redesign in the iOS
app "as far as possible", with **direction B · Civic Codex** as the base.
This replaces the earlier rule that the Stitch pages are reference only.

"As drawn" means the Stitch screens **and** the rules Stitch shipped with them
(`42 · Stitch — Source Notes` → `screen_matrix.md`, `stitch_context.md`):

- Four destinations: 홈 · 캘린더 · 급여 · 내 정보. World labels (JOURNEY,
  QUEST LOG, SUPPLY, CHARACTER) are secondary only.
- World language may be an eyebrow, subtitle, chapter label, milestone title
  or caption. It never replaces form labels, destructive actions, financial
  terms, leave type names, sync conflict choices or backup semantics.
- Milestones use only domain-supported dates and hide those outside the
  user's term: `START → D-500 → 25% → D-300 → 50% → D-100 → 75% → D-30 →
  90% → D-7 → FINAL`.
- Explicitly out of scope (Stitch's own list): XP, streaks, loot, coins,
  leaderboards, multiplayer/social, **military rank system**, community,
  fake missions, monetized cosmetics.

Also excluded because the app cannot make them true: official seals ("구청장
직인 날인본"), "verified agent" identity cards, "영구 보관", filing 소명 or any
request with an institution, real institution phone numbers. Numbers, rules,
storage and sync stay exactly as the shared core computes them.

## Mapping (page 40, 54 views)

| Section | Views | Becomes | Phase |
| --- | --- | --- | --- |
| 02 Direction Studies | B civic_codex (base); A, C | Home layout; C's milestone trail and A's timeline nodes feed the milestone row | 1 |
| 01 Main & Home | master_synthesis, epic_duty_hero, fullscreen_epic_hero_swipe_hud, rpg, rpg_civic_odyssey, dark_hud_1 | Home states (pre-service, in service, D-30, D-7, discharge day, completed); hero illustration; dark → Warrior Dark | 1 |
| — | navigation in every view | 4 tabs + world sub-labels; 휴가 moves under 홈 (card) and 캘린더; 더보기 becomes 내 정보 | 1 |
| 03 Calendar & Duty | calendar_quest_log (+ dark), duty_lock_management, _4, _12 | 캘린더: month + agenda "QUEST LOG", leave ledger entry, editor sheet | 2 |
| 04 Compensation | supply_compensation, _3 | 급여 "SUPPLY" with verification gates | 3 |
| 04 Compensation | ai, ai_dark | **Not built:** needs an LLM backend and new content. Recorded as a later decision | — |
| 05 Character | character | 내 정보 "CHARACTER": profile, settings, theme, backup, cloud, import | 4 |
| 05 Character | objekt, odyssey_card_1/2, verified_agent_1/2 | 복무 기념 카드: a shareable image of the user's own dates and progress, marked 비공식. No rank, no ID number, no "verified". Apple Wallet needs a paid pass certificate → blocked | 8 |
| 06 Onboarding | genesis_character_creation, step_by_step_character_creation, prologue_step_2, rpg_prologue_hud, _2, _17, _19 | Step-by-step onboarding (dates → 분야 → 확인) with the account sign-in entry | 5 |
| 06 Onboarding | rpg_prologue_cutscene, warp_odyssey_gate, supernova_warp_fx | Short static/fade intro on first launch; respects Reduce Motion. No new animation system | 5 |
| 06 Onboarding | final_quest_complete | Discharge-day and completed-service home states | 6 |
| 08 PDF & Print | pdf_1, pdf_2, _5, dark_hud_2/3 | 복무 기록 PDF export (dates, leave ledger, records) without seals or "official" wording | 6 |
| 07 Widgets & Live Activity | dynamic_island, live_activity, _10 | Widget presets + Live Activity / Dynamic Island countdown (ActivityKit in the widget target) | 7 |
| 09 Additional Variations | 11 views | Alternates; pulled in per phase where a state is missing | per phase |

## Process per phase

1. Draw the production frames on Figma page 52 (Standard + Warrior Light/Dark)
   from the Stitch source, with the rules above.
2. Implement in SwiftUI with the existing design system and core values.
3. Verify: `swift test`, simulator build and screenshots, kolint on new
   Korean strings.
4. One PR per phase.
