import SGCore
import Testing
@testable import SuperGongik

/// 급여's load cycle with an injected failure: one refused load must end in a
/// visible failure, not a spinner, a retry recovers, and an older result can
/// stay on screen while the failure is reported.
@Suite("Screen load cycle (급여)")
struct LoadCycleTests {
    private struct Boom: Error {}

    @Test("one failed load is a failure, not an endless loading state")
    func failureIsVisible() {
        var cycle = LoadCycle<Int>()
        #expect(cycle.phase == .idle)
        let attempt = cycle.begin()
        #expect(cycle.phase == .loading)
        cycle.fail(attempt, key: "moneyMonth 2026-10", error: CoreError.javaScript("TypeError: x is undefined"), message: ErrorCopy.payUnavailable)
        guard case .failed(let failure) = cycle.phase else { Issue.record("expected .failed"); return }
        #expect(failure.message == ErrorCopy.payUnavailable)
        #expect(failure.diagnosis == "moneyMonth 2026-10 · JavaScript 오류")
        #expect(!failure.diagnosis.contains("TypeError"), "the core's own text never reaches the screen")
        #expect(cycle.value(for: "moneyMonth 2026-10") == nil)
    }

    @Test("a retry after a failure loads, and the value is kept across a later failure")
    func retryRecoversAndKeepsLastGood() {
        var cycle = LoadCycle<Int>()
        cycle.fail(cycle.begin(), key: "2026-10", error: Boom(), message: "x")
        let retry = cycle.begin()
        #expect(cycle.phase == .loading)
        cycle.succeed(retry, key: "2026-10", 42)
        #expect(cycle.phase == .loaded)
        #expect(cycle.value(for: "2026-10") == 42)
        // A record changes, the recomputation fails: the screen keeps the last
        // result for this month and says the refresh failed.
        cycle.fail(cycle.begin(), key: "2026-10", error: Boom(), message: "x")
        #expect(cycle.value(for: "2026-10") == 42)
        guard case .failed(let failure) = cycle.phase else { Issue.record("expected .failed"); return }
        #expect(failure.diagnosis == "2026-10 · Boom")
        // Another month has no kept value to show.
        #expect(cycle.value(for: "2026-09") == nil)
    }

    @Test("a cancelled or superseded request never changes the current state")
    func cancellationAndStaleResultsAreIgnored() {
        var cycle = LoadCycle<Int>()
        let first = cycle.begin()
        let second = cycle.begin()
        cycle.fail(first, key: "2026-10", error: Boom(), message: "x")
        #expect(cycle.phase == .loading, "the first attempt was superseded")
        cycle.succeed(first, key: "2026-10", 1)
        #expect(cycle.value(for: "2026-10") == nil)
        cycle.fail(second, key: "2026-10", error: CancellationError(), message: "x")
        #expect(cycle.phase == .loading, "cancellation is not a failure")
        cycle.succeed(second, key: "2026-10", 2)
        #expect(cycle.phase == .loaded && cycle.value(for: "2026-10") == 2)
        cycle.idle()
        #expect(cycle.phase == .idle && cycle.value(for: "2026-10") == 2)
    }
}
