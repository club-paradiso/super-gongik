import SGDesignSystem
import SwiftUI

enum AppTab: Hashable {
    case today, records, leave, pay, more
}

struct RootView: View {
    @Environment(AppModel.self) private var model
    @State private var tab: AppTab = Self.initialTab

    /// DEBUG-only screenshot hook: `-SGInitialTab records` opens that tab.
    /// Compiled out of release builds.
    private static var initialTab: AppTab {
        #if DEBUG
        switch UserDefaults.standard.string(forKey: "SGInitialTab") {
        case "records": return .records
        case "leave": return .leave
        case "pay": return .pay
        case "more": return .more
        default: return .today
        }
        #else
        return .today
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
            Tab("오늘", systemImage: "sun.horizon", value: AppTab.today) {
                TodayView(openTab: { tab = $0 })
            }
            Tab("기록", systemImage: "calendar", value: AppTab.records) {
                RecordsView()
            }
            Tab("휴가", systemImage: "list.clipboard", value: AppTab.leave) {
                LeaveView()
            }
            Tab("급여", systemImage: "wonsign.circle", value: AppTab.pay) {
                PayView(openTab: { tab = $0 })
            }
            Tab("더보기", systemImage: "ellipsis.circle", value: AppTab.more) {
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
