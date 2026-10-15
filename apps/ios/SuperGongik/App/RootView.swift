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

    var body: some View {
        // Stitch draws its own bottom bar (glyph, Korean label, world label),
        // so the system tab bar is hidden and `StitchTabBar` is inset on each
        // tab. The TabView still keeps every tab's state alive.
        TabView(selection: $tab) {
            Tab("홈", systemImage: "sun.horizon", value: AppTab.home) {
                TodayView(openTab: { tab = $0 }, showsLedgerInitially: RootView.opensLedgerOnLaunch)
                    .stitchTabBar($tab)
            }
            Tab("캘린더", systemImage: "calendar", value: AppTab.calendar) {
                RecordsView(openTab: { tab = $0 })
                    .stitchTabBar($tab)
            }
            Tab("급여", systemImage: "wonsign.circle", value: AppTab.pay) {
                PayView(openTab: { tab = $0 })
                    .stitchTabBar($tab)
            }
            Tab("내 정보", systemImage: "person.crop.circle", value: AppTab.profile) {
                MoreView()
                    .stitchTabBar($tab)
            }
        }
        .safeAreaInset(edge: .top, spacing: 0) {
            StorageNoticeBanner()
        }
    }
}

private extension View {
    func stitchTabBar(_ tab: Binding<AppTab>) -> some View {
        toolbar(.hidden, for: .tabBar)
            .safeAreaInset(edge: .bottom, spacing: 0) { StitchTabBar(selection: tab) }
    }
}

/// Stitch bottom navigation: four equal items, each a Material Symbols glyph,
/// the Korean name and its world label (JOURNEY, QUEST LOG, SUPPLY,
/// CHARACTER); the current one sits on a soft navy plate.
private struct StitchTabBar: View {
    @Binding var selection: AppTab
    @Environment(\.dynamicTypeSize) private var typeSize

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
                        if !typeSize.isAccessibilitySize {
                            Text(item.2)
                                .font(SGTypography.latin(.label, 9, .bold, relativeTo: .caption2))
                                .tracking(1.2)
                                .foregroundStyle(.sg(selected ? SGColor.accent : SGColor.textTertiary))
                                .lineLimit(1)
                                .fixedSize()
                                .accessibilityHidden(true)
                        }
                    }
                    .foregroundStyle(.sg(selected ? SGColor.accentSecondary : SGColor.textSecondary))
                    .padding(.horizontal, SGSpacing.sm)
                    .padding(.vertical, SGSpacing.xxs)
                    .background {
                        if selected {
                            RoundedRectangle(cornerRadius: 12, style: .continuous)
                                .fill(.sg(SGColor.selectedBackground))
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
        .padding(.horizontal, SGSpacing.xxs)
        .padding(.top, SGSpacing.xxs)
        .padding(.bottom, 2)
        .background {
            Rectangle()
                .fill(.ultraThinMaterial)
                .overlay(Rectangle().fill(.sg(SGColor.background)).opacity(0.85))
                .shadow(color: Color(.sRGB, red: 8 / 255, green: 31 / 255, blue: 104 / 255, opacity: 0.06), radius: 10, y: -4)
                .ignoresSafeArea(edges: .bottom)
        }
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
