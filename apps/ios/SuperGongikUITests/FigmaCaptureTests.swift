import XCTest

/// Captures the four Civic Codex screens with the Figma page 52 sample data
/// (`SGLaunch`: 2026-03-14, D-306 fixture) for `scripts/figma-compare.py`.
///
/// Each screen is captured top first, then in fixed-distance scroll steps, in
/// the theme × appearance pairs that Figma draws (standard light, Warrior
/// light, Warrior dark) plus standard dark. Reduce Motion is forced so the
/// Warrior effects rest. PNGs go to `$SG_SHOT_DIR` when it is set (CI passes
/// `TEST_RUNNER_SG_SHOT_DIR`) and are always attached to the test result.
///
/// Not a pass/fail check of the design: the comparison report classifies the
/// differences. The test fails only if a screen cannot be opened.
@MainActor
final class FigmaCaptureTests: XCTestCase {
    private static let screens: [(slug: String, tab: String, marker: String)] = [
        ("home", "today", "오늘 기록하기"),
        ("calendar", "calendar", "이 날에 기록 추가"),
        ("pay", "pay", "이전 달"),
        ("profile", "profile", "복무 설정"),
    ]
    private static let looks: [(theme: String, scheme: String)] = [
        ("standard", "light"), ("warrior", "light"), ("warrior", "dark"), ("standard", "dark"),
    ]
    private static let maxSegments = 4

    func testCaptureFigmaScreens() throws {
        let directory = ProcessInfo.processInfo.environment["SG_SHOT_DIR"].map { URL(fileURLWithPath: $0) }
        if let directory {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        }
        for look in Self.looks {
            for screen in Self.screens {
                let app = SGLaunch.app(theme: look.theme, scheme: look.scheme, tab: screen.tab)
                app.launch()
                guard app.waitUntilReady() else { continue }
                XCTAssertTrue(app.containing(screen.marker).waitForExistence(timeout: 15),
                              "\(screen.slug) did not open (\(look.theme) \(look.scheme))")
                sleep(2)  // fonts, images and the first projection settle
                var previous: Data?
                for segment in 0..<Self.maxSegments {
                    let png = XCUIScreen.main.screenshot().pngRepresentation
                    if let previous, previous == png { break }  // reached the bottom
                    let name = "\(screen.slug)-\(look.theme)-\(look.scheme)-\(segment).png"
                    let attachment = XCTAttachment(data: png, uniformTypeIdentifier: "public.png")
                    attachment.name = name
                    attachment.lifetime = .keepAlways
                    add(attachment)
                    if let directory {
                        try png.write(to: directory.appendingPathComponent(name))
                    }
                    previous = png
                    scrollOneStep(app)
                }
                app.terminate()
            }
        }
    }

    /// A slow, fixed drag (about 45 % of the screen) with a hold at the end,
    /// so there is no momentum and each step lands at the same offset.
    private func scrollOneStep(_ app: XCUIApplication) {
        let start = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.72))
        let end = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.27))
        start.press(forDuration: 0.05, thenDragTo: end, withVelocity: .slow, thenHoldForDuration: 0.4)
        sleep(1)
    }
}
