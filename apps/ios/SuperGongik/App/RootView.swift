import SGDesignSystem
import SwiftUI

/// Stitch Civic Codex navigation: exactly four destinations. 연가 내역 is
/// pushed from 홈 and 캘린더; 더보기 became 내 정보.
enum AppTab: Hashable {
    case home, calendar, pay, profile
}

struct RootView: View {
    @Environment(AppModel.self) private var model
    @State private var tab: AppTab = Self.initialTab

    /// DEBUG-only screenshot hook: `-SGInitialTab records` opens that tab;
    /// `leave` opens 홈 with 연가 내역 pushed. The old tab names still work so
    /// existing screenshot matrices keep running. Compiled out of release.
    private static var initialTab: AppTab {
        #if DEBUG
        switch UserDefaults.standard.string(forKey: "SGInitialTab") {
        case "records", "calendar": return .calendar
        case "pay": return .pay
        case "more", "profile": return .profile
        default: return .home
        }
        #else
        return .home
        #endif
    }

    static var opensLedgerOnLaunch: Bool {
        #if DEBUG
        UserDefaults.standard.string(forKey: "SGInitialTab") == "leave"
        #else
        false
        #endif
    }

    var body: some View {
        Group {
            switch model.phase {
            case .launching:
                LaunchView()
            case .failed(let message):
                StartupFailureView(message: message)
            case .ready:
                if model.profile == nil {
                    OnboardingView()
                } else {
                    MainTabs(tab: $tab)
                }
            }
        }
        .tint(SGStyle.sg(SGColor.accent))
        .background(.sg(SGColor.background))
    }
}

private struct MainTabs: View {
    @Environment(AppModel.self) private var model
    @Binding var tab: AppTab

    /// Tabs opened at least once. A tab is built on its first visit and then
    /// kept alive (scroll position, pushed screens), as a TabView would.
    @State private var opened: Set<AppTab> = []

    var body: some View {
        // Stitch draws its own bottom bar (glyph, Korean label, world label).
        // A TabView with `.toolbar(.hidden, for: .tabBar)` still showed the
        // iOS 26 system tab bar under the Stitch bar (seen on the Warrior
        // Dark 홈, 2026-10-20), so the tabs are a plain container: there is
        // no system tab bar left to reappear.
        ZStack {
            ForEach([AppTab.home, .calendar, .pay, .profile], id: \.self) { item in
                if opened.contains(item) || item == tab {
                    content(for: item)
                        .opacity(item == tab ? 1 : 0)
                        .allowsHitTesting(item == tab)
                        .accessibilityHidden(item != tab)
                }
            }
        }
        .safeAreaInset(edge: .bottom, spacing: 0) { StitchTabBar(selection: $tab) }
        .safeAreaInset(edge: .top, spacing: 0) {
            // Every tab hides its navigation bar behind the Stitch app header,
            // so content scrolls under the status bar; this canvas strip keeps
            // the clock readable over the 홈 hero and the cards.
            StorageNoticeBanner()
                .frame(maxWidth: .infinity)
                .background(.sg(SGColor.background), ignoresSafeAreaEdges: .top)
        }
        .onChange(of: tab, initial: true) { _, new in opened.insert(new) }
    }

    @ViewBuilder
    private func content(for item: AppTab) -> some View {
        switch item {
        case .home: TodayView(openTab: { tab = $0 }, showsLedgerInitially: RootView.opensLedgerOnLaunch)
        case .calendar: RecordsView(openTab: { tab = $0 })
        case .pay: PayView(openTab: { tab = $0 })
        case .profile: MoreView()
        }
    }
}

/// Stitch bottom navigation: four equal items, each a Material Symbols glyph,
/// the Korean name and its world label (JOURNEY, QUEST LOG, SUPPLY,
/// CHARACTER); the current one sits on a soft navy plate.
private struct StitchTabBar: View {
    @Binding var selection: AppTab
    @Environment(\.dynamicTypeSize) private var typeSize
    @Environment(\.sgTheme) private var theme

    private static let items: [(AppTab, String, String, String)] = [
        (.home, "홈", "JOURNEY", "swords"),
        (.calendar, "캘린더", "QUEST LOG", "calendar_month"),
        (.pay, "급여", "SUPPLY", "account_balance_wallet"),
        (.profile, "내 정보", "CHARACTER", "military_tech"),
    ]

    var body: some View {
        HStack(spacing: SGSpacing.xxs) {
            ForEach(Self.items, id: \.0) { item in
                let selected = selection == item.0
                Button { selection = item.0 } label: {
                    VStack(spacing: 2) {
                        StitchIcon(item.3, size: 22, filled: selected)
                        Text(item.1)
                            .font(SGTypography.font(13, selected ? .bold : .semibold, relativeTo: .caption))
                            .lineLimit(1)
                            .minimumScaleFactor(0.7)
                        if theme.showsWorldLanguage && !typeSize.isAccessibilitySize {
                            // Whole word or nothing, and never wider than the
                            // item: a fixed-size label here once made the bar
                            // wider than the screen at larger text sizes,
                            // which pushed every tab off both edges.
                            ViewThatFits(in: .horizontal) {
                                Text(item.2)
                                    .font(SGTypography.latin(.label, 9, .bold, relativeTo: .caption2))
                                    .tracking(1.2)
                                    .lineLimit(1)
                                    .fixedSize()
                                Text(item.2)
                                    .font(SGTypography.latin(.label, 9, .bold, relativeTo: .caption2))
                                    .lineLimit(1)
                                    .minimumScaleFactor(0.6)
                            }
                            .foregroundStyle(.sg(selected ? SGColor.accent : SGColor.textTertiary))
                            .accessibilityHidden(true)
                        }
                    }
                    .foregroundStyle(.sg(selected ? SGColor.accentSecondary : SGColor.textSecondary))
                    .padding(.horizontal, SGSpacing.xxs)
                    .padding(.vertical, SGSpacing.xxs)
                    .frame(maxWidth: .infinity)
                    .background {
                        if selected {
                            // Warrior (Stitch dark HUD): the plate gets a gold
                            // edge and glow; standard keeps the soft plate.
                            RoundedRectangle(cornerRadius: 12, style: .continuous)
                                .fill(.sg(SGColor.selectedBackground))
                                .overlay {
                                    if theme == .warrior {
                                        RoundedRectangle(cornerRadius: 12, style: .continuous)
                                            .strokeBorder(SGGlow.gold.opacity(0.7), lineWidth: 1)
                                    }
                                }
                                .shadow(color: SGGlow.gold.opacity(theme == .warrior ? 0.35 : 0), radius: 8)
                        }
                    }
                    .frame(maxWidth: .infinity, minHeight: 48)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(item.1)
                .accessibilityAddTraits(selected ? [.isButton, .isSelected] : .isButton)
            }
        }
        // Even margins: the selected plate on the last tab used to touch
        // the screen edge.
        .padding(.horizontal, SGSpacing.sm)
        .padding(.top, SGSpacing.xxs)
        .padding(.bottom, 2)
        .background {
            Rectangle()
                .fill(.ultraThinMaterial)
                .overlay(Rectangle().fill(.sg(SGColor.background)).opacity(0.85))
                .overlay(alignment: .top) {
                    // Warrior: a gilded hairline along the top edge.
                    if theme == .warrior {
                        LinearGradient(colors: [.clear, SGGlow.gold.opacity(0.55), .clear],
                                       startPoint: .leading, endPoint: .trailing)
                            .frame(height: 1)
                    }
                }
                .shadow(color: Color(.sRGB, red: 8 / 255, green: 31 / 255, blue: 104 / 255, opacity: 0.06), radius: 10, y: -4)
                .ignoresSafeArea(edges: .bottom)
        }
        // Like the system tab bar, the labels stop growing at xxLarge; the
        // Accessibility sizes drop the world label instead.
        .dynamicTypeSize(...DynamicTypeSize.xxLarge)
        .accessibilityElement(children: .contain)
        .accessibilityAddTraits(.isTabBar)
    }
}

/// Matches the launch screen (brand mark on the canvas) so there is no flash.
private struct LaunchView: View {
    var body: some View {
        ZStack {
            Rectangle().fill(.sg(SGColor.background)).ignoresSafeArea()
            Image("BrandMark")
                .resizable()
                .frame(width: SGSize.brandMark, height: SGSize.brandMark)
                .accessibilityLabel("슈퍼공익")
        }
    }
}

private struct StartupFailureView: View {
    let message: String

    var body: some View {
        ContentUnavailableView {
            Label("슈퍼공익을 열지 못했어요", systemImage: "exclamationmark.triangle")
        } description: {
            Text(message)
        }
    }
}
