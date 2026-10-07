# Design system mapping — Figma ↔ SGDesignSystem

- Updated: 2026-10-07
- Swift: `apps/ios/Packages/SuperGongikKit/Sources/SGDesignSystem` (`Tokens.swift`, `Palette.swift`, `Components.swift`, `Patterns.swift`, `EventCategoryMark.swift`)
- Figma: page 50 (foundations, `101:1565`), page 51 (components, `101:1566`)
- Code wins on any mismatch. Every Figma variable used by iOS carries an **iOS code syntax** naming its Swift symbol; read it in Figma's variable panel or Dev Mode.

## Variables

| Figma collection        | Modes        | Swift                                         | Notes                                                                                                                          |
| ----------------------- | ------------ | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `SG · Primitives`       | Value        | `RGB(0x…)` literals in `Palette.swift`        | Hidden (no scopes). `alpha/*` added for hero track/line/border                                                                 |
| `SG · Color`            | Light / Dark | `SGColor.*`, `SGBrand.*`, `SGEventCategory.*` | Semantic aliases of primitives. High-contrast values exist only in Swift (`SGToken(highContrast:)`), tested in `ContrastTests` |
| `SG · Layout`           | Value        | `SGSpacing`, `SGRadius`, `SGLayout`, `SGSize` | Scoped to GAP / CORNER_RADIUS / WIDTH_HEIGHT                                                                                   |
| `SG · Motion`           | Value        | `SGMotion`                                    | Milliseconds; curve `cubic-bezier(0.2, 0.8, 0.2, 1)`; Reduce Motion → no interpolation                                         |
| `stitch.withgoogle.com` | Mode 1       | —                                             | Imported with Stitch. Reference only; never bind production nodes to it                                                        |

Web-only variables in `SG · Color`/`SG · Layout` without iOS code syntax (`surface/hover`, `accent/hover`, `focus/ring`, `border/emphasis`, `desktop/backdrop`, `hero/final*`, `hero/focus`, `rail/width`, `tabbar/h`, `radius/pill`) stay for the web; iOS uses the system equivalents (hover/focus rings, tab bar height, `Capsule`).

### Themes

`SGTheme` (`Theme.swift`) is read from the environment (`\.sgTheme`, set at the app root from `@AppStorage(SGTheme.storageKey)`). Views keep writing `.sg(token)`; that now returns `SGStyle`, a `ShapeStyle` that resolves per view from theme, color scheme and Increase Contrast (`SGToken.rgb(theme:dark:highContrast:)`). A Warrior value, when present, wins over the standard and high-contrast values.

| Token                                            | Warrior light                     | Warrior dark                      |
| ------------------------------------------------ | --------------------------------- | --------------------------------- |
| `background`                                     | `#FBF8FF`                         | `#090C1C`                         |
| `backgroundElevated`                             | `#F3F0FD`                         | `#0C0F28`                         |
| `surface` / `surfaceRaised`                      | `#FFFFFF` / `#FFFFFF`             | `#13173D` / `#1B204E`             |
| `surfaceInteractive`                             | `#EEECFF`                         | `#282D5E`                         |
| `border` / `borderStrong`                        | `#E3DFFF` / `#C9C3F0`             | `#282D5E` / `#3B4178`             |
| `textPrimary` / `textSecondary` / `textTertiary` | `#14173E` / `#454651` / `#5E5F6B` | `#FEF1D3` / `#CBD5E1` / `#94A3B8` |
| `accent` / `accentSecondary` / `onAccent`        | `#4F48A3` / `#000C3F` / `#FFFFFF` | `#FDCF7C` / `#C7D2FE` / `#090C1C` |
| `selectedBackground` / `selectedBorder`          | `#E7E6FF` / `#9D97E0`             | `#1E2568` / `#FDCF7C`             |

Warrior Increase Contrast values (light / dark): `border` `#8E86C9` / `#5A60A0`, `borderStrong` `#6F68B0` / `#7077B8`, `textSecondary` `#2E2F3A` / `#E2E8F0`, `textTertiary` `#3E3F4A` / `#CBD5E1`, `accent` `#3A338A` / `#FFE2A8`. Precedence in `SGToken.rgb(theme:dark:highContrast:)` is the theme palette first, then that palette's Increase Contrast variant. A token without Warrior values uses the standard values, including the standard high-contrast ones, in both themes.

System chrome (`Chrome.swift`):

- `sgScreenChrome()` on each tab root: navigation bar → `background`, tab bar → `surfaceRaised`, shown when content scrolls under them (native scroll-edge behavior kept).
- `sgGroupedChrome()` + `sgListRowSurface()` on every `Form`/`List`: canvas → `background`, rows → `surface`.
- Native `TabView`, `NavigationStack`, `Form` and `List` are kept; nothing is redrawn.
- World-language tags go through `SGWorldEyebrow` only, which renders inline in Warrior and is hidden from VoiceOver.

Feedback tones, event categories and hero tokens are shared by both themes. `SGHeroBackground` draws a Warrior sky (`#000C3F → #081F68 → #14173E`, violet top, gold `#FFDEA7` horizon). Stitch's light accent `#5952AD` was darkened to `#4F48A3` for AA margin.

### Color (selection)

| Figma                                                                          | Swift                                                                   |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| `background`, `background/elevated`                                            | `SGColor.background`, `.backgroundElevated`                             |
| `surface`, `surface/raised`, `surface/interactive`                             | `SGColor.surface`, `.surfaceRaised`, `.surfaceInteractive`              |
| `border`, `border/strong`                                                      | `SGColor.border`, `.borderStrong`                                       |
| `text/primary` · `/secondary` · `/tertiary`                                    | `SGColor.textPrimary` · `.textSecondary` · `.textTertiary`              |
| `accent/primary`, `accent/secondary`, `accent/warm`                            | `SGColor.accent`, `.accentSecondary`, `.accentWarm`                     |
| `on/accent`, `selected/background`, `selected/border`                          | `SGColor.onAccent`, `.selectedBackground`, `.selectedBorder`            |
| `success`/`warning`/`danger`/`info` (+ `/background`, `/border`)               | `SGColor.success…`, `SGTone.*` foreground/background                    |
| `hero/bg` `hero/fg` `hero/fg/2` `hero/fg/3` `hero/accent` `hero/accent/strong` | `SGColor.heroBackground` … `.heroAccentStrong`                          |
| `hero/track`, `hero/line`, `hero/border` (new)                                 | `SGColor.heroTrack`, `.heroLine`, `.heroBorder` (new)                   |
| `cat/<category>`, `/bg`, `/fg`                                                 | `SGEventCategory.<category>.mark`, `.chipBackground`, `.chipForeground` |
| `brand/*`                                                                      | `SGBrand.*` (logo, hero gradient, progress gradient only)               |

### Layout

| Figma                       | Value | Swift                          |
| --------------------------- | ----- | ------------------------------ |
| `space/half` (new)          | 2     | `SGSpacing.xxxs` (new)         |
| `space/1`                   | 4     | `SGSpacing.xxs`                |
| `space/icon-gap` (new)      | 6     | `SGSpacing.iconGap` (new)      |
| `space/2` … `space/8`       | 8–32  | `SGSpacing.xs` … `.xxl`        |
| `gutter`                    | 16    | `SGSpacing.gutter`             |
| `size/hit-target` (new)     | 44    | `SGSpacing.minimumHitTarget`   |
| `radius/xs` … `radius/hero` | 6–28  | `SGRadius.xs` … `.hero`        |
| `layout/readable` (new)     | 720   | `SGLayout.readableWidth` (new) |
| `layout/focused` (new)      | 560   | `SGLayout.focusedWidth` (new)  |
| `layout/action` (new)       | 280   | `SGLayout.actionWidth` (new)   |
| `size/row` (new)            | 52    | `SGSize.rowMinHeight` (new)    |
| `size/stat-card` (new)      | 112   | `SGSize.statCardMinHeight`     |
| `size/date-tile` (new)      | 44    | `SGSize.dateTile`              |
| `size/icon-tile` (new)      | 32    | `SGSize.iconTile`              |
| `size/chip` (new)           | 24    | `SGSize.chip`                  |
| `size/status-dot` (new)     | 6     | `SGSize.statusDot`             |
| `size/brand-mark` (new)     | 72    | `SGSize.brandMark`             |
| `control/h`                 | 50    | `SGSize.primaryControl`        |
| `control/h/secondary` (new) | 48    | `SGSize.control`               |

`SGLayout.loadingInset` (120) is code-only.

### Responsive rule

There is no design width. A tab screen is `ScrollView { VStack { … }.padding(.horizontal, SGSpacing.gutter).frame(maxWidth: SGLayout.readableWidth).frame(maxWidth: .infinity) }`. On every iPhone (375–430 pt) the column is full width; on iPad / landscape it stops at 720 pt and centres. Two-up rows switch to stacked with `AnyLayout` at accessibility text sizes. Figma frames are drawn at 393 pt and checked at 375/390/393/402/430 on page 53; `LayoutTokenTests` guards the rule.

### Typography

| Figma text style   | Swift                  | Pretendard weight / size | Relative to    |
| ------------------ | ---------------------- | ------------------------ | -------------- |
| `iOS/display`      | `SGTypography.display` | ExtraBold 60             | `.largeTitle`  |
| `iOS/title1`       | `.title1`              | ExtraBold 26             | `.title`       |
| `iOS/title2`       | `.title2`              | Bold 22                  | `.title2`      |
| `iOS/title3`       | `.title3`              | Bold 18                  | `.title3`      |
| `iOS/sectionTitle` | `.sectionTitle`        | ExtraBold 20             | `.title3`      |
| `iOS/cardTitle`    | `.cardTitle`           | ExtraBold 17             | `.headline`    |
| `iOS/body`         | `.body`                | Regular 15               | `.subheadline` |
| `iOS/bodyStrong`   | `.bodyStrong`          | SemiBold 15              | `.subheadline` |
| `iOS/label`        | `.label`               | SemiBold 14              | `.subheadline` |
| `iOS/caption`      | `.caption`             | Medium 13                | `.footnote`    |
| `iOS/micro`        | `.micro`               | Bold 12                  | `.caption`     |
| `iOS/statValue`    | `.statValue`           | ExtraBold 22             | `.title2`      |
| `iOS/heroMetric`   | `.heroMetric` (new)    | ExtraBold 20             | `.title3`      |
| `iOS/heroDetail`   | `.heroDetail` (new)    | SemiBold 17              | `.headline`    |
| `iOS/eyebrow`      | `.eyebrow` (new)       | Bold 11, tracking 0.8    | `.caption2`    |

Figma uses Noto Sans KR as a stand-in (Pretendard is not installed in the Figma environment; SemiBold → Bold, ExtraBold → Black). The legacy `SG/*` text styles belong to the web Core System and are left untouched. Numbers that change use `.monospacedDigit()`.

### Elevation

| Figma effect style  | Swift                | SwiftUI radius / y / opacity |
| ------------------- | -------------------- | ---------------------------- |
| `iOS/shadow/small`  | `.sgShadow(.small)`  | 1 / 1 / 0.06                 |
| `iOS/shadow/card`   | `.sgShadow(.card)`   | 7 / 4 / 0.05                 |
| `iOS/shadow/raised` | `.sgShadow(.raised)` | 20 / 16 / 0.18               |
| `iOS/shadow/hero`   | `.sgShadow(.hero)`   | 20 / 18 / 0.35               |

Figma blur = SwiftUI radius × 2. Dark mode draws no shadow (borders separate layers).

## Components (page 51)

Figma Code Connect needs a Dev or Full seat on an Organization or Enterprise plan; this file's plan does not have one, so the mapping call was refused. Traceability instead: every component's description ends with `Source: club-paradiso/super-gongik/<path>`, page 54 lists the same table, and every variable carries iOS code syntax. When the plan allows it, map the nodes below with the SwiftUI label.

| Figma component (node)       | Variants / properties                                                           | SwiftUI                                                                                           | Traceability |
| ---------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------ |
| `SGButton` (`103:20`)        | Style = Primary/Secondary/Destructive × State = Default/Pressed/Disabled; Label | `SGPrimaryButtonStyle`, `SGSecondaryButtonStyle`, `SGDestructiveButtonStyle` (`Components.swift`) | description  |
| `SGNotice` (`103:51`)        | Tone = Info/Success/Warning/Danger/Neutral; Title, Message, Show message        | `SGNotice` (`Components.swift`)                                                                   | description  |
| `SGStatusBadge` (`103:72`)   | Tone × 5                                                                        | `SGStatusBadge` (`Patterns.swift`, new)                                                           | description  |
| `SGCategoryChip` (`103:91`)  | Category = leave/sick/attendance/duty/nonpayable/note                           | `SGCategoryChip`, `SGCategoryMark` (`EventCategoryMark.swift`)                                    | description  |
| `SGSectionHeader` (`103:92`) | Title, Eyebrow, Detail (+ visibility)                                           | `SGSectionHeader` (`Components.swift`, `eyebrow:` new)                                            | description  |
| `SGCard` (`104:2`)           | content slot                                                                    | `SGCard`                                                                                          | description  |
| `SGProgressBar` (`104:5`)    | —                                                                               | `SGProgressBar`                                                                                   | description  |
| `SGIconTile` (`104:8`)       | —                                                                               | `SGIconTile` (new)                                                                                | description  |
| `SGDateTile` (`104:16`)      | Today = true/false                                                              | `SGDateTile` (new)                                                                                | description  |
| `SGStatCard` (`104:55`)      | State = Value/Muted/Attention; Title, Caption                                   | `SGStatCard` (new) + `StatValue` (`TodayView.swift`)                                              | description  |
| `SGQuickAction` (`104:56`)   | Title                                                                           | `SGQuickAction` (new)                                                                             | description  |
| `SGEmptyState` (`104:61`)    | Title, Message                                                                  | `SGEmptyState` (new)                                                                              | description  |
| `SGAgendaRow` (`104:67`)     | Title, Subtitle, Days                                                           | `AgendaRow` (`Features/Today/TodayView.swift`)                                                    | description  |
| `SGHeroCard` (`105:73`)      | Phase = In service/Celebrate × Live = On/Off                                    | `HeroCard` + `SGHeroBackground` (`TodayView.swift`, `Components.swift`)                           | description  |
| `AppTabBar` (`105:179`)      | Selected = 오늘/기록/휴가/급여/더보기                                           | native `TabView` (`App/RootView.swift`)                                                           | description  |
| `NavigationBar` (`105:180`)  | Title                                                                           | native `NavigationStack` title                                                                    | description  |

Code-only helpers without a Figma component: `SGPressableStyle`, `SGTintedIconLabelStyle`, `SGLoadingState` (system `ProgressView`), `SGHeroBackground` (drawn inside `SGHeroCard`).

Icons in Figma are placeholders named `sf:<symbol>`; the code uses that SF Symbol name.

## Accessibility contract

- 44 pt minimum for every interactive element (`SGSpacing.minimumHitTarget`, `SGSize.control`).
- All type scales with Dynamic Type (`relativeTo`); tiles use `@ScaledMetric`; two-up layouts stack at accessibility sizes.
- Status = color + SF Symbol + text. Event categories also differ by mark shape.
- WCAG AA text contrast in light, dark and Increase Contrast, verified by `ContrastTests` (pairs added for date tile, icon tile and attention values).
- Reduce Motion removes interpolation (`SGMotion.animation`, `SGPressableStyle`) but never hides information.
- Decorative world-language eyebrows (Warrior theme only) and icon tiles are hidden from VoiceOver; cards and rows read as one element.
