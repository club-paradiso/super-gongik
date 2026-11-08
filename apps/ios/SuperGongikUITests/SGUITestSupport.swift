import XCTest

/// Launch helpers for the UI tests. Every launch uses the DEBUG hooks in
/// `SuperGongik/Core/DebugSeed.swift`, `Support.swift` (`AppClock`) and
/// `SuperGongikApp.swift`, so the date, the data and the appearance are fixed:
///
/// - `-SGResetStore YES`: start from an empty local store
/// - `-SGSeedFixture figma`: the Figma page 52 sample (소집 2025-03-18,
///   소집해제 예정 2027-01-14, March 2026 records)
/// - `-SGToday 2026-03-14`: the date the Figma frames are drawn on
/// - `-SGTheme`, `-SGColorScheme`, `-SGReduceMotion`, `-SGInitialTab`
@MainActor
enum SGLaunch {
    static let figmaToday = "2026-03-14"

    static func app(today: String = figmaToday,
                    reset: Bool = true,
                    fixture: Bool = true,
                    theme: String = "standard",
                    scheme: String = "light",
                    tab: String? = nil) -> XCUIApplication {
        let app = XCUIApplication()
        var arguments = ["-SGToday", today, "-SGTheme", theme, "-SGColorScheme", scheme,
                         "-SGReduceMotion", "YES"]
        if reset { arguments += ["-SGResetStore", "YES"] }
        if fixture { arguments += ["-SGSeedFixture", "figma"] }
        if let tab { arguments += ["-SGInitialTab", tab] }
        app.launchArguments = arguments
        return app
    }
}

extension XCUIApplication {
    /// A bottom-bar item. The bar is the app's own `StitchTabBar`; whether
    /// SwiftUI exposes its `.isTabBar` container as a tab bar element varies,
    /// so this takes the lowest on-screen button with the label (the header's
    /// profile button is also labelled 내 정보, but sits at the top).
    func tab(_ label: String) -> XCUIElement {
        let inBar = tabBars.firstMatch.buttons[label]
        if inBar.exists { return inBar }
        let matches = buttons.matching(NSPredicate(format: "label == %@", label)).allElementsBoundByIndex
        return matches.max(by: { $0.frame.minY < $1.frame.minY }) ?? buttons[label]
    }

    /// Waits for the main tabs (they are drawn only once a profile exists).
    @discardableResult
    func waitUntilReady(file: StaticString = #filePath, line: UInt = #line) -> Bool {
        let ready = buttons["캘린더"].waitForExistence(timeout: 40)
        XCTAssertTrue(ready, "the main tabs never appeared (launch or seed failed)", file: file, line: line)
        return ready
    }

    /// Scrolls the frontmost scroll view up until `element` is hittable.
    func reveal(_ element: XCUIElement, attempts: Int = 8) {
        var tries = 0
        while !(element.exists && element.isHittable) && tries < attempts {
            swipeUp(velocity: .slow)
            tries += 1
        }
    }
}

extension XCUIElement {
    /// A staticText or button whose label contains `text`.
    func containing(_ text: String) -> XCUIElement {
        descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", text)).firstMatch
    }
}
