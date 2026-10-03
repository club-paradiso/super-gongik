import SwiftUI

@main
struct SuperGongikApp: App {
    @State private var model = AppModel()
    @State private var lock = PrivacyLock()
    @Environment(\.scenePhase) private var scenePhase

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
