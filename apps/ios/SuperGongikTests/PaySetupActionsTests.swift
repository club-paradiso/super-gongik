import Foundation
import SGCore
import Testing
@testable import SuperGongik

/// 급여's "계산에 필요한 정보" shortcuts come from the evaluation's structured
/// fields, one per place the input is entered; a complete month has none.
@Suite("급여 setup shortcuts")
struct PaySetupActionsTests {
    private func compensation(components: String, serviceDays: String = "null") throws -> MonthlyCompensation {
        try JSONDecoder().decode(MonthlyCompensation.self, from: Data("""
        {"status":"PARTIAL","month":"2026-10","asOfDate":"2026-10-25","serviceMonthOrdinal":null,"equivalentRank":null,
         "components":\(components),"total":null,"rule":null,"headline":"h","unresolved":["x"],
         "assumptions":[],"warnings":[],"serviceDays":\(serviceDays)}
        """.utf8))
    }

    private func component(_ key: String, _ status: String, rate: Double? = nil, explanation: String = "") -> String {
        """
        {"key":"\(key)","label":"\(key)","status":"\(status)","monthlyAmount":null,
         "dailyRate":\(rate.map { String($0) } ?? "null"),"eligibleDays":null,"rateSource":null,"basis":"b","explanation":"\(explanation)"}
        """
    }

    private func days(_ status: String, missing: [String]) -> String {
        """
        {"month":"2026-10","status":"\(status)","missing":[\(missing.map { "\"\($0)\"" }.joined(separator: ","))],
         "days":[],"undecidedDates":[],"mealEligibleDays":null,"transportEligibleDays":null,"explanation":"e"}
        """
    }

    @Test("a fresh profile: work pattern, prior service, transport, and the month confirmation")
    func freshProfile() throws {
        let money = try compensation(
            components: "[\(component("BASE_PAY", "NEEDS_INPUT")),\(component("MEAL", "NEEDS_INPUT", rate: 9000)),\(component("TRANSPORT", "NEEDS_INPUT"))]",
            serviceDays: days("NEEDS_INPUT", missing: ["WORK_PATTERN", "MONTH_CONFIRMATION"]))
        let targets = PaySetupActions.actions(for: money).map(\.target)
        #expect(targets == [.profile(.workPattern), .attendance, .profile(.priorService), .profile(.transport)])
        // Meal has a rate (the 9,000 won default): only the day count blocks it, which the attendance action covers.
        #expect(!targets.contains(.profile(.meal)))
    }

    @Test("each missing input alone opens exactly its own form")
    func singleInputs() throws {
        #expect(PaySetupActions.actions(for: try compensation(components: "[\(component("BASE_PAY", "NEEDS_INPUT"))]")).map(\.target) == [.profile(.priorService)])
        #expect(PaySetupActions.actions(for: try compensation(components: "[\(component("MEAL", "NEEDS_INPUT"))]")).map(\.target) == [.profile(.meal)])
        #expect(PaySetupActions.actions(for: try compensation(components: "[\(component("TRANSPORT", "NEEDS_INPUT"))]")).map(\.target) == [.profile(.transport)])
        #expect(PaySetupActions.actions(for: try compensation(components: "[]", serviceDays: days("NEEDS_INPUT", missing: ["MONTH_RECONFIRMATION"]))).map(\.target) == [.attendance])
        #expect(PaySetupActions.actions(for: try compensation(components: "[]", serviceDays: days("NEEDS_INPUT", missing: ["WORK_WEEKDAYS"]))).map(\.target) == [.profile(.workPattern)])
        #expect(PaySetupActions.actions(for: try compensation(components: "[]", serviceDays: days("UNSUPPORTED", missing: []))).map(\.target) == [.profile(.workPattern)])
    }

    @Test("base pay gates: a partial credited month goes to the profile, non-payable dates to the month")
    func basePayGates() throws {
        let partial = try compensation(components: "[\(component("BASE_PAY", "GATED", explanation: "인정 기간이 개월 단위로 떨어지지 않으면 계산하지 않아요."))]")
        #expect(PaySetupActions.actions(for: partial).map(\.target) == [.profile(.priorService)])
        let dates = try compensation(components: "[\(component("BASE_PAY", "GATED", explanation: "기본 보수 미지급 날짜를 모두 확인해야 계산할 수 있어요."))]")
        #expect(PaySetupActions.actions(for: dates).map(\.target) == [.attendance])
    }

    @Test("a complete month has no shortcuts, and duplicates collapse")
    func completeAndDuplicates() throws {
        let complete = try compensation(
            components: "[\(component("BASE_PAY", "CALCULATED", rate: 1)),\(component("MEAL", "CALCULATED", rate: 9000)),\(component("TRANSPORT", "CALCULATED", rate: 3000))]",
            serviceDays: days("READY", missing: []))
        #expect(PaySetupActions.actions(for: complete).isEmpty)
        let twice = try compensation(components: "[]", serviceDays: days("NEEDS_INPUT", missing: ["WORK_PATTERN", "WORK_WEEKDAYS", "DAY_DECISIONS", "MONTH_CONFIRMATION"]))
        #expect(PaySetupActions.actions(for: twice).map(\.target) == [.profile(.workPattern), .attendance])
    }
}
