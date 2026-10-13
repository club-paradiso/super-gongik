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
        TabView(selection: $tab) {
            Tab("홈", systemImage: "sun.horizon", value: AppTab.home) {
                TodayView(openTab: { tab = $0 }, showsLedgerInitially: RootView.opensLedgerOnLaunch)
            }
            Tab("캘린더", systemImage: "calendar", value: AppTab.calendar) {
                RecordsView()
            }
            Tab("급여", systemImage: "wonsign.circle", value: AppTab.pay) {
                PayView(openTab: { tab = $0 })
            }
            Tab("내 정보", systemImage: "person.crop.circle", value: AppTab.profile) {
                MoreView()
            }
        }
        .safeAreaInset(edge: .top, spacing: 0) {
            StorageNoticeBanner()
        }
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
