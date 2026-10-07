import SGDesignSystem
import SwiftUI

@main
struct SuperGongikApp: App {
    @State private var model = AppModel()
    @State private var lock = PrivacyLock()
    @Environment(\.scenePhase) private var scenePhase
    /// Presentation preference (더보기 › 화면 테마). Device-local on purpose:
    /// it is not part of the synced document and changes no calculation.
    @AppStorage(SGTheme.storageKey) private var theme: SGTheme = .standard

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
