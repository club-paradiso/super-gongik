import SGDesignSystem
import SwiftUI

@main
struct SuperGongikApp: App {
    @State private var model = AppModel()
    @State private var lock = PrivacyLock()
    @Environment(\.scenePhase) private var scenePhase
    /// Presentation preference (더보기 › 화면 › 화면 테마). Device-local on
    /// purpose: it lives in the App Group defaults so the widget can read it,
    /// is not part of the synced document and changes no calculation.
    @AppStorage(ThemePreference.key, store: ThemePreference.store) private var theme: SGTheme = .standard

    init() {
        #if DEBUG
        // Screenshot hook: `-SGTheme warrior` (DEBUG builds only).
        if let value = UserDefaults.standard.string(forKey: "SGTheme"), SGTheme(rawValue: value) != nil {
            ThemePreference.store.set(value, forKey: ThemePreference.key)
        }
        #endif
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(model)
                .environment(lock)
                .overlay {
                    if lock.isCovered || lock.isLocked {
                        PrivacyCoverView().environment(lock).transition(.opacity)
                    }
                }
                .environment(\.sgTheme, theme)
                .onChange(of: theme) { WidgetReloader.reload() }
                .task { await model.start() }
                .onChange(of: scenePhase) { _, phase in
                    lock.scenePhaseChanged(phase)
                    switch phase {
                    case .active: Task { await model.sceneBecameActive() }
                    case .background: model.sceneEnteredBackground()
                    default: break
                    }
                }
        }
    }
}
