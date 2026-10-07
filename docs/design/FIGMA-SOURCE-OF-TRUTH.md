# Figma source of truth (iOS)

- Updated: 2026-10-07
- Figma file: [SUPER GONGIK · MASTER](https://www.figma.com/design/hy0KYmsJxVzj2JwJtbfIpS) (`hy0KYmsJxVzj2JwJtbfIpS`)
- Code: `apps/ios` (SwiftUI), design system `apps/ios/Packages/SuperGongikKit/Sources/SGDesignSystem`
- Related: [SCREEN-MAP.md](./SCREEN-MAP.md), [DESIGN-SYSTEM-MAPPING.md](./DESIGN-SYSTEM-MAPPING.md), [horizon.md](./horizon.md)

## Which page is current (read this first)

**Pages 50–54 are the canonical iOS production design. Everything else is reference.**

| Page                                   | Node                             | Status        | What it is                                                                                               |
| -------------------------------------- | -------------------------------- | ------------- | -------------------------------------------------------------------------------------------------------- |
| 50 · iOS Production — Foundations      | `101:1565`                       | **CANONICAL** | Variables, text styles, effect styles; every value maps to an `SG*` Swift token (iOS code syntax is set) |
| 51 · iOS Production — Components       | `101:1566`                       | **CANONICAL** | 16 components / sets bound to variables; each description names its SwiftUI type                         |
| 52 · iOS Production — Screens          | `101:1567`                       | **CANONICAL** | 16 screens: 오늘 (7 states), 기록, 휴가, 급여, 더보기, 온보딩, 기록 편집 시트                            |
| 53 · iOS Production — Flows & States   | `101:1568`                       | **CANONICAL** | Responsive check (375–430 pt, iPad readable width), global states, primary flows                         |
| 54 · iOS Production — Handoff          | `101:1569`                       | **CANONICAL** | Figma → Swift source table and rules                                                                     |
| 99 · Archive / Deprecated              | `101:1570`                       | index         | Index of every Stitch view and source control with its classification; originals are **not** moved       |
| 00 · Master Index                      | `17:2`                           | index         | Entry page; points at 50–54                                                                              |
| 01–03 · Frontier                       | `0:1`…`2:3`                      | reference     | Original design kit                                                                                      |
| 10–10j · Legacy UX workspace           | `17:3`…                          | reference     | Earlier UX boards                                                                                        |
| 11–16 · Core System                    | `17:4`…                          | reference     | Web product system ("mobile-first 480px shell") — superseded for iOS by 50–54                            |
| 20 · Web RPG handoff, 30 · Logo        | `17:10`, `17:11`                 | reference     | Web handoff board; logo archive (brand source)                                                           |
| 40 · Stitch — Imported screens         | `17:12`                          | reference     | 54 imported HTML views, 390 px. Visual direction only; classified in [SCREEN-MAP.md](./SCREEN-MAP.md)    |
| 41–44 · Stitch assets, notes, controls | `17:13`, `17:14`, `48:2`, `70:2` | reference     | Brand art, the Stitch brief (`screen_matrix.md`, `stitch_context.md`), 51 imported controls              |

Nothing under 01–44 was deleted, moved or edited.

## Precedence when sources disagree

Behavior, data, legal and policy text:

1. Repository implementation (`apps/ios`, and the web components it mirrors)
2. TypeScript core (`packages/domain`, `packages/rules`, `packages/importer`, `packages/native-core`)
3. `docs/ios/*`
4. Core System Figma (11–16)
5. Stitch sample copy — never authoritative

Visual direction: latest Stitch screens → brand/logo archive → `SGDesignSystem` → Core System → legacy.
Where Stitch conflicts with iOS usability, accessibility or native interaction, iOS wins.

Implementation primitives: existing `SGDesignSystem` → existing SwiftUI components → system SwiftUI / SF Symbols → a new reusable `SG*` component → one-off view.

## Decisions recorded in this sync

| Conflict                                                                                                 | Decision                                                                                                                                                                                                                                                                                                                        |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Core System says "mobile-first 480px shell"; Stitch is drawn at 390 px                                   | Neither is a layout rule. Content column = screen width − 2 × `SGSpacing.gutter`, capped at `SGLayout.readableWidth` (720) and centred. Checked at 375/390/393/402/430 pt (page 53, `LayoutTokenTests`). Canonical frames use 393.                                                                                              |
| Stitch has 4 tabs (홈/캘린더/급여/내 정보) with world-language subtitles                                 | Keep the repository's 5 native tabs: 오늘 · 기록 · 휴가 · 급여 · 더보기. 휴가 is a first-class feature in code. World language never labels a tab.                                                                                                                                                                              |
| Stitch custom HUD header (`SUPER GONGIK / CIVIC OS / ACTIVE // DUTY_SYNC / D-342`)                       | Not adopted. System `NavigationStack` title. The header's D-day (342) even contradicts the hero (306) in the same Stitch frame.                                                                                                                                                                                                 |
| Stitch world-language (JOURNEY, QUEST LOG, SUPPLY, AGENDA …)                                             | Shown only in the Warrior theme, as a decorative eyebrow after a Korean title (`SGSectionHeader(eyebrow:)`, `SGStatCard(eyebrow:)`, hero JOURNEY), hidden from VoiceOver. Never on forms, money terms, leave types, destructive actions or sync choices (Stitch's own `screen_matrix.md`). The standard theme shows none.       |
| Stitch journey trail (START → D-500 → 50% → … → 소집해제)                                                | **FUTURE.** The home read model exposes only the next milestone. Needs a milestone list from the core first; the view must not derive it.                                                                                                                                                                                       |
| Stitch shows sick-leave / special-leave balances, payday countdown, "VERIFIED" pay, institution contact  | Not shown. The core does not provide them, or they would be fabricated/official-looking claims. Pay keeps its safety gates (total only when every component resolves).                                                                                                                                                          |
| Stitch AI cards, collectibles, XP, character classes, photocard print, official-looking PDF certificates | Out of scope (Stitch brief lists XP/loot/rank/fake missions as explicitly out of scope). Official-looking documents must never be imitated.                                                                                                                                                                                     |
| Font                                                                                                     | Pretendard (bundled, OFL) with system fallback in code. The Figma environment has no Pretendard, so `iOS/*` text styles use Noto Sans KR as a stand-in; sizes and Dynamic Type mapping are exact.                                                                                                                               |
| One design or two? (product owner, 2026-10-07)                                                           | **Two user-selectable themes.** 일반 (standard, HORIZON) is the default; 워리어 (Warrior, the Stitch RPG direction) is chosen in 더보기 › 화면 › 화면 테마. A theme changes color, the hero sky and the world-language eyebrows only — same screens, same numbers, same rules, same accessibility contract. See "Themes" below. |

## Themes

| Theme                    | Swift              | Figma                                                                                                | What changes                                                                                                                              |
| ------------------------ | ------------------ | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 일반 (standard, default) | `SGTheme.standard` | `SG · Color` modes **Light / Dark**                                                                  | HORIZON palette, logo night sky, no world-language                                                                                        |
| 워리어 (Warrior)         | `SGTheme.warrior`  | `SG · Color` modes **Warrior Light / Warrior Dark**; `SGHeroCard` `Theme=Warrior`; `Show eyebrow` on | Lavender/gold palette from Stitch (`49:10627`, dark HUD views), deeper sky with a gold horizon, JOURNEY / AGENDA / REST / SUPPLY eyebrows |

- The choice is a device-local presentation preference (`@AppStorage("sg.theme")`), not part of the synced document, and it never changes a value or a rule.
- Both themes pass the same WCAG AA tests in light, dark and Increase Contrast (`ContrastTests`).
- Warrior screens: page 52, row "Warrior 테마" (오늘 light/dark/completed, 기록, 휴가, 급여, 더보기 theme picker).
- Not themed yet: widgets and the system tab bar background (they follow the standard palette).

## Rules for future edits

- Change the code token first, then the Figma variable (or both in one PR). The variable's iOS code syntax must name the Swift symbol.
- A new screen goes on page 52 only when the feature exists in `apps/ios`. Concepts go to a new reference page, not 52.
- Sample numbers in Figma (D-306, 1,284,500원, dates) are samples. The app always shows values from the shared core.
- A new color token gets a Warrior value (or deliberately inherits the standard one) and a contrast-test pair.
- Status is always color + symbol + text (`SGNotice`, `SGStatusBadge`, attention values).
- Every interactive element ≥ 44 pt (`SGSpacing.minimumHitTarget`).
