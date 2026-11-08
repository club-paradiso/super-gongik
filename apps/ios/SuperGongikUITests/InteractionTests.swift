import XCTest

/// End-to-end checks of the main controls on the iOS Simulator: each test
/// drives the real UI (tap → AppModel → shared core → file store → screen).
/// The fixture and date are fixed (`SGLaunch`), so the expectations are exact.
@MainActor
final class InteractionTests: XCTestCase {
    // MARK: Navigation

    /// Every bottom-bar item opens its screen, exactly one bar is drawn, and
    /// the selected item carries the selected trait.
    func testTabsSwitchAndKeepOneTabBar() {
        let app = SGLaunch.app()
        app.launch()
        app.waitUntilReady()

        for (tab, marker) in [("캘린더", "이 날에 기록 추가"), ("급여", "이전 달"), ("내 정보", "복무 설정"), ("홈", "오늘 기록하기")] {
            app.tab(tab).tap()
            XCTAssertTrue(app.containing(marker).waitForExistence(timeout: 10), "\(tab) did not show \(marker)")
            XCTAssertTrue(app.tab(tab).isSelected, "\(tab) is not marked selected")
            XCTAssertLessThanOrEqual(app.tabBars.count, 1, "a second (system) tab bar appeared on \(tab)")
        }
    }

    /// The header's profile button opens 내 정보.
    func testHeaderProfileButtonOpensProfile() {
        let app = SGLaunch.app()
        app.launch()
        app.waitUntilReady()
        let header = app.buttons.matching(NSPredicate(format: "label == %@", "내 정보")).allElementsBoundByIndex
            .min(by: { $0.frame.minY < $1.frame.minY })
        XCTAssertNotNil(header)
        header?.tap()
        XCTAssertTrue(app.containing("복무 설정").waitForExistence(timeout: 10))
        XCTAssertTrue(app.tab("내 정보").isSelected)
    }

    /// A pushed screen survives a tab switch (tabs are kept alive).
    func testCalendarMonthSurvivesTabSwitch() {
        let app = SGLaunch.app(tab: "calendar")
        app.launch()
        app.waitUntilReady()
        XCTAssertTrue(app.staticTexts["2026년 3월"].waitForExistence(timeout: 10))
        app.buttons["다음 달"].firstMatch.tap()
        XCTAssertTrue(app.staticTexts["2026년 4월"].waitForExistence(timeout: 5))
        app.tab("홈").tap()
        app.tab("캘린더").tap()
        XCTAssertTrue(app.staticTexts["2026년 4월"].waitForExistence(timeout: 5), "the calendar lost its month after a tab switch")
    }

    // MARK: Records

    /// 연가 on a day that already has a whole-day 연가 is refused with the
    /// core's message, and the editor stays open (no silent double charge).
    func testDuplicateAnnualLeaveIsRefused() {
        let app = SGLaunch.app()
        app.launch()
        app.waitUntilReady()
        app.buttons["연가 기록"].tap()
        XCTAssertTrue(app.navigationBars["기록 추가"].waitForExistence(timeout: 10))
        saveEditor(app, expectClose: false)
        XCTAssertTrue(app.containing("두 번 차감").waitForExistence(timeout: 10), "no overlap message was shown")
        XCTAssertTrue(app.navigationBars["기록 추가"].exists, "the refused editor closed")
    }

    /// A quick record saved on a free day is listed for that day after the
    /// app is terminated and opened again (file store round trip).
    func testQuickRecordPersistsAcrossRelaunch() {
        let freeDay = "2026-03-16"  // Monday, no fixture record
        let app = SGLaunch.app(today: freeDay)
        app.launch()
        app.waitUntilReady()
        app.buttons["연가 기록"].tap()
        XCTAssertTrue(app.navigationBars["기록 추가"].waitForExistence(timeout: 10))
        saveEditor(app, expectClose: true)

        app.terminate()
        let again = SGLaunch.app(today: freeDay, reset: false, fixture: false, tab: "calendar")
        again.launch()
        again.waitUntilReady()
        let addButton = again.buttons["이 날에 기록 추가"]
        again.reveal(addButton)
        XCTAssertFalse(again.staticTexts["이 날의 기록이 없어요."].exists, "the saved record is gone after relaunch")
        XCTAssertTrue(again.containing("연가").exists)
    }

    /// Closing an edited editor asks first; 계속 편집 keeps the draft open.
    func testEditedEditorAsksBeforeClosing() {
        let app = SGLaunch.app(today: "2026-03-16")
        app.launch()
        app.waitUntilReady()
        app.buttons["연가 기록"].tap()
        XCTAssertTrue(app.navigationBars["기록 추가"].waitForExistence(timeout: 10))
        // Any edit: type a note.
        let note = app.textFields.firstMatch.exists ? app.textFields.firstMatch : app.textViews.firstMatch
        app.reveal(note)
        note.tap()
        note.typeText("메모")
        app.navigationBars["기록 추가"].buttons["닫기"].tap()
        XCTAssertTrue(app.containing("저장하지 않고 닫을까요").waitForExistence(timeout: 5), "closing an edited editor did not ask")
    }

    // MARK: Pay

    /// The month switcher moves the pay month both ways.
    func testPayMonthSwitcher() {
        let app = SGLaunch.app(tab: "pay")
        app.launch()
        app.waitUntilReady()
        XCTAssertTrue(app.staticTexts["2026년 3월"].waitForExistence(timeout: 10))
        app.buttons["다음 달"].firstMatch.tap()
        XCTAssertTrue(app.staticTexts["2026년 4월"].waitForExistence(timeout: 5))
        app.buttons["이전 달"].firstMatch.tap()
        app.buttons["이전 달"].firstMatch.tap()
        XCTAssertTrue(app.staticTexts["2026년 2월"].waitForExistence(timeout: 5))
    }

    // MARK: Helpers

    /// Taps 저장, then "확인했어요, 저장" while the core shows warnings.
    private func saveEditor(_ app: XCUIApplication, expectClose: Bool) {
        let bar = app.navigationBars["기록 추가"]
        for _ in 0..<3 {
            let save = bar.buttons.matching(NSPredicate(format: "label CONTAINS %@", "저장")).firstMatch
            guard save.exists else { break }
            save.tap()
            if !bar.waitForExistence(timeout: 2) || bar.sgWaitGone(timeout: 3) { break }
        }
        if expectClose {
            XCTAssertTrue(bar.sgWaitGone(timeout: 10), "the editor did not close after saving")
        }
    }
}

private extension XCUIElement {
    func sgWaitGone(timeout: TimeInterval) -> Bool {
        let gone = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: self)
        return XCTWaiter.wait(for: [gone], timeout: timeout) == .completed
    }
}
