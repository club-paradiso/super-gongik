import SGDesignSystem
import SwiftUI

@main
struct SuperGongikApp: App {
    @State private var model = AppModel()
    @State private var lock = PrivacyLock()
    @State private var coverWindow = PrivacyCoverWindow()
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

    /// DEBUG-only: `-SGColorScheme dark|light` pins the appearance so UI tests
    /// can capture both modes without `simctl ui`. Release follows the system.
    private static var debugColorScheme: ColorScheme? {
        #if DEBUG
        switch UserDefaults.standard.string(forKey: "SGColorScheme") {
        case "dark": return .dark
        case "light": return .light
        default: return nil
        }
        #else
        return nil
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
                .preferredColorScheme(Self.debugColorScheme)
                .modifier(DebugReduceMotion())
                .onChange(of: theme) { WidgetReloader.reload() }
                .onChange(of: lock.isCovered || lock.isLocked, initial: true) { _, visible in
                    coverWindow.update(visible: visible, lock: lock, theme: theme)
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

/// DEBUG-only: `-SGReduceMotion YES` renders every view as if Reduce Motion
/// were on, so screenshot comparisons are not disturbed by the Warrior drift,
/// stars and sweeps, and the resting state is what gets checked.
private struct DebugReduceMotion: ViewModifier {
    func body(content: Content) -> some View {
        #if DEBUG
        if UserDefaults.standard.bool(forKey: "SGReduceMotion") {
            content.environment(\.accessibilityReduceMotion, true)
        } else {
            content
        }
        #else
        content
        #endif
    }
}
