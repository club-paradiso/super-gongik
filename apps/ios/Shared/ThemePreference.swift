import Foundation
import SGDesignSystem

/// The visual theme preference (더보기 › 화면 › 화면 테마), shared with the
/// widget through the App Group's UserDefaults.
///
/// Presentation only: it is never written to the synced document, never read
/// by the core, and the widget only reads it. When the App Group is not
/// provisioned (unsigned or personal-team builds) the suite still works inside
/// the app and the widget falls back to `.standard`.
enum ThemePreference {
    static let key = SGTheme.storageKey

    /// One instance for the process lifetime. `@AppStorage` observes the
    /// defaults object it is given, so the app root and the 더보기 picker must
    /// share this exact instance for a selection to re-render the root at once.
    static let store: UserDefaults = UserDefaults(suiteName: WidgetSnapshot.appGroup) ?? .standard

    /// The stored theme; `.standard` when nothing (or an unknown value) is stored.
    static func load(from defaults: UserDefaults = store) -> SGTheme {
        defaults.string(forKey: key).flatMap(SGTheme.init(rawValue:)) ?? .standard
    }
}
