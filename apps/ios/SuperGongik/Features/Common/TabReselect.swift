import SwiftUI

/// How many times the bottom-bar item of the current tab was tapped again
/// while already selected. Each tab watches it: the first re-tap closes a
/// pushed screen, the next one scrolls back to the top, as in iOS tab bars.
private struct TabReselectKey: EnvironmentKey {
    static let defaultValue = 0
}

extension EnvironmentValues {
    var tabReselect: Int {
        get { self[TabReselectKey.self] }
        set { self[TabReselectKey.self] = newValue }
    }
}
