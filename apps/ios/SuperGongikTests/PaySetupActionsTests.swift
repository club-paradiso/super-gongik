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

    private func component(_ key: String, _ status: String, rate: Double? = nil, gate: String? = nil) -> String {
        """
        {"key":"\(key)","label":"\(key)","status":"\(status)","monthlyAmount":null,
         "dailyRate":\(rate.map { String($0) } ?? "null"),"eligibleDays":null,"rateSource":null,"basis":"b","explanation":"e",
         "gate":\(gate.map { "\"\($0)\"" } ?? "null")}
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

    @Test("base pay gates route on the gate code, not the Korean explanation")
    func basePayGates() throws {
        func targets(_ gate: String?) throws -> [PaySetupActions.Target] {
            PaySetupActions.actions(for: try compensation(components: "[\(component("BASE_PAY", "GATED", gate: gate))]")).map(\.target)
        }
        #expect(try targets("PRIOR_SERVICE_PARTIAL_MONTH") == [.profile(.priorService)])
        #expect(try targets("NON_PAYABLE_DATES") == [.attendance])
        #expect(try targets("ROUNDING_POLICY") == [.attendance])
        // An unknown or missing reason opens nothing rather than a guessed form.
        #expect(try targets("SOMETHING_NEW").isEmpty)
        #expect(try targets(nil).isEmpty)
    }

    @Test("a component without a gate key still decodes (older snapshots)")
    func gateKeyOptional() throws {
        let money = try compensation(components: """
        [{"key":"BASE_PAY","label":"l","status":"CALCULATED","monthlyAmount":1,"dailyRate":null,"eligibleDays":null,
          "rateSource":null,"basis":"b","explanation":"e"}]
        """)
        #expect(money.components.first?.gate == nil)
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
