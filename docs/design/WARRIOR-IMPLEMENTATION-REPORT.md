# Warrior theme — implementation report

- Date: 2026-10-13 · branch `feat/warrior-theme-completion` (from `main` @ `6247351`)
- Figma: [SUPER GONGIK · MASTER](https://www.figma.com/design/hy0KYmsJxVzj2JwJtbfIpS)
- Related: [WARRIOR-COMPLETION-MATRIX.md](./WARRIOR-COMPLETION-MATRIX.md) (audit, matrix, direction), [FIGMA-SOURCE-OF-TRUTH.md](./FIGMA-SOURCE-OF-TRUTH.md), [SCREEN-MAP.md](./SCREEN-MAP.md), [DESIGN-SYSTEM-MAPPING.md](./DESIGN-SYSTEM-MAPPING.md)

This is presentation work. No file in `packages/domain`, `packages/rules`, `packages/importer` or `packages/native-core` changed, and no number, rule, schema or persisted document changed. The theme stays a per-device (iOS) or per-browser (web) preference outside the synced document.

## 1. What changed and why

Before: Warrior was a palette swap on iOS (Warrior Light was hard to tell from standard light), had 7 of 16 states in Figma, and did not exist on the web.

| Area           | Before                                           | After                                                                                                                                                                                 |
| -------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity       | Palette only; light nearly identical to standard | Vellum canvas + lavender hairlines (light), midnight + gold (dark); crest-framed hero with halo arcs; banner section heads; sigil icon tiles; gilded today ring; quarter markers      |
| Figma coverage | 7 Warrior frames, placeholder icons              | 21 Warrior screen states + 8 Warrior secondary flows + 2 state boards; 7 new Standard secondary flows; 35 icon components; theme-driven components                                    |
| iOS            | `SGTheme` palette, eyebrows                      | + ornament tokens (`SGToken(warriorOnly:)`), `SGTheme.showsOrnaments`, `SGHeroCrest`, ornaments inside `SGSectionHeader`/`SGIconTile`/`SGDateTile`/`SGProgressBar`/`SGHeroBackground` |
| Web            | No theme                                         | `data-theme` (boot script, no flash), picker in 내 정보 › 화면 설정, `theme-warrior.css`, `WorldEyebrow`                                                                              |

## 2. Figma (node links)

All links are `https://www.figma.com/design/hy0KYmsJxVzj2JwJtbfIpS?node-id=<id with - for :>`.

| What                          | Where                                                                                                                                          |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Variables                     | `SG · Color` + 4 ornament variables; Warrior Light canvas refined; new collection `SG · Theme` (Standard/Warrior)                              |
| Components changed            | page 51: `SGSectionHeader` `103:92`, `SGIconTile` `104:8` (Symbol swap), `SGDateTile` `104:16`, `SGProgressBar` `104:5`, `SGHeroCard` `105:73` |
| Icons                         | page 51 frame "Icons · SF Symbol stand-ins" (35 `Icon / <symbol>`)                                                                             |
| Component review (3 themes)   | page 51 `120:3712`                                                                                                                             |
| Warrior screens               | page 52 row "Warrior 테마" — node list in [SCREEN-MAP.md](./SCREEN-MAP.md)                                                                     |
| Secondary flows (both themes) | page 52 보조 화면 rows (`125:2039` … `125:2454`, Warrior `125:7666` … `125:8079`)                                                              |
| Warrior state boards          | page 53 `125:8178`, `125:8241`                                                                                                                 |
| Spec & QA record              | page 55 `125:8485`                                                                                                                             |
| Superseded Warrior row        | page 99, label `125:8484`                                                                                                                      |

Design QA (page 55): two pre-existing clipped rows fixed in both themes (휴가 needs-confirmation, 온보딩); remaining unbound fills are system controls only; no text under 11 pt; every frame sets its modes.

## 3. Implementation mapping

| Ornament         | Figma                                   | iOS                                     | Web                                                      |
| ---------------- | --------------------------------------- | --------------------------------------- | -------------------------------------------------------- |
| Hero crest frame | `SGHeroCard` Warrior `Crest frame`      | `SGHeroCrest` overlay in `HeroCard`     | `.hero::after`                                           |
| Hero halo arcs   | `Halo 1/2 (Warrior)`                    | `SGHeroBackground` (Warrior)            | `.hero::before` (border + outline)                       |
| Progress markers | `SGProgressBar` `Marker 25/50/75%`      | `SGProgressBar(markers:)`               | `.hero-bar::after`                                       |
| Section banner   | `SGSectionHeader` `Banner (Warrior)`    | `SGSectionHeader` when `showsOrnaments` | `h2::before` on home cards, quick actions, profile heads |
| Sigil ring       | `SGIconTile` stroke `ornament/soft`     | `SGIconTile` overlay                    | `.quick-actions__icon` inset shadow                      |
| Today ring       | `SGDateTile Today=true` stroke          | `SGDateTile` overlay                    | `.month-cell.is-today .month-cell__day`                  |
| World-language   | `Show eyebrow` + `theme/world-language` | `SGWorldEyebrow`                        | `WorldEyebrow` + `.world-eyebrow`                        |

## 4. Intentional differences

| Difference                                                                        | Why                                                                                 |
| --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| iOS tab bar is the system Liquid Glass bar; Figma `AppTabBar` is a flat reference | System-owned (unchanged from 2026-10-07)                                            |
| Web has 4 tabs (홈/캘린더/급여/내 정보), iOS 5                                    | Existing information architecture per platform; a theme never changes navigation    |
| Web stat-card eyebrows hide when the card is narrower than 220 px                 | The Korean label must stay on one line (iOS uses layout priority for the same rule) |
| Web ledger heads have no banner bar                                               | They already lead with an accent icon; a bar would be a second marker               |
| Web money tab has no SUPPLY LEDGER eyebrow                                        | The web money list has no section title to carry it                                 |
| Widgets draw the progress bar without markers                                     | Legibility at widget sizes                                                          |
| Figma icons are lucide stand-ins                                                  | Figma has no SF Symbols; names match the symbol the app renders                     |
| Figma text uses Noto Sans KR                                                      | Pretendard is not installed in the Figma environment (unchanged)                    |

## 5. Verification

Run on this branch, macOS with Xcode 26.3 and the iOS 26.3 Simulator.

| Check                                                                                                                    | Result                                                                                                                                                                                                                                        |
| ------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm lint` · `pnpm format:check` · `pnpm typecheck`                                                                     | pass                                                                                                                                                                                                                                          |
| `pnpm test`                                                                                                              | pass — domain 233, rules 119, importer 20, native-core 42, web 90 (+7 skipped integration). New: `apps/web/tests/theme.test.ts` (4)                                                                                                           |
| `pnpm build` (Next 16)                                                                                                   | pass                                                                                                                                                                                                                                          |
| `swift test` (`SuperGongikKit`)                                                                                          | pass — 51 tests in 12 suites, incl. `ContrastTests` with the new Warrior Light values and new `ThemeOrnamentTests`                                                                                                                            |
| `xcodebuild … build` (Debug, iOS Simulator)                                                                              | pass, no warnings from the changed files                                                                                                                                                                                                      |
| `xcodebuild … test` (app unit tests, iPhone 16 simulator)                                                                | pass — 12 tests in 4 suites (incl. theme preference persistence), `** TEST SUCCEEDED **`                                                                                                                                                      |
| Native screenshots, iPhone 16 (393 pt): every tab in Standard/Warrior × light/dark, Accessibility XXL, Increase Contrast | 24 + 8 recaptures reviewed; 2 defects found and fixed (XXL eyebrow clipped to "J"; month-grid today ring missing on iOS). Samples in `qa-2026/warrior/`                                                                                       |
| Web in a browser (Next dev): 320, 393, 1280 px; light/dark; theme switch and reload                                      | Warrior palette, ornaments and eyebrows render; switching applies at once and persists; Standard shows no eyebrows; no horizontal overflow at 320 px. 2 defects fixed (stat-card label wrapped by its eyebrow; double marker on ledger heads) |
| Korean UX lint (`kolint --genre ux`) on new UI strings                                                                   | 0 findings                                                                                                                                                                                                                                    |
| Figma design QA sweep (page 55)                                                                                          | see §2                                                                                                                                                                                                                                        |

Not run locally: the iPhone SE (375 pt) and iPhone 16 Plus (430 pt) rows of `apps/ios/scripts/screenshot-qa.sh`. The machine ran out of disk while creating the extra simulators; the CI job "iOS · app tests and simulator screenshot QA" runs the full 27-case matrix on the PR.

Evidence (`docs/design/qa-2026/warrior/`): `figma-warrior-light-today-before.png` / `-after.png`, `ios-*` (simulator), `web-*` (browser).

## 6. Remaining limitations

- No physical-device verification; simulator only.
- Code Connect mappings were not added (the file's plan does not allow them, unchanged from 2026-10-07).
- The journey trail from Stitch stays out: the quarter markers carry the idea without adding information Standard lacks.
- Issue #29 and the auth/sync work are out of scope.
