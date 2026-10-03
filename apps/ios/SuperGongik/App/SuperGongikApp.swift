import SwiftUI

@main
struct SuperGongikApp: App {
    @State private var model = AppModel()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(model)
                .task { await model.start() }
                .onChange(of: scenePhase) { _, phase in
                    switch phase {
                    case .active: Task { await model.sceneBecameActive() }
                    case .background: model.sceneEnteredBackground()
                    default: break
                    }
                }
        }
    }
}
