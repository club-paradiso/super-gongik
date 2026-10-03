import Foundation
import Testing
@testable import SGFoundation
import SGTestSupport

/// The Swift-native slice (civil dates, service progress, live progress) must
/// reproduce the TypeScript reference exactly. Every case in the suites below
/// is replayed through the Swift port; the expected values were produced by
/// `packages/native-core/tests/conformance.test.ts`.
@Suite("Native Swift conformance with the TypeScript reference")
struct NativeConformanceTests {
    /// Envelope the facade returns: `{ ok: true, value }` or `{ ok: false, error }`.
    enum Outcome {
        case value(JSONValue)
        case thrown
    }

    static func period(_ value: JSONValue) -> ServicePeriod {
        ServicePeriod(
            callUpDate: CivilDate(value["callUpDate"]!.stringValue!)!,
            expectedDischargeDate: CivilDate(value["expectedDischargeDate"]!.stringValue!)!)
    }

    static func date(_ value: JSONValue) -> CivilDate? { value.stringValue.flatMap(CivilDate.init) }

    static func instantMilliseconds(_ value: JSONValue) -> Int64 {
        let iso = value["$instant"]!.stringValue!
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let parsed = formatter.date(from: iso) ?? ISO8601DateFormatter().date(from: iso)!
        return Int64((parsed.timeIntervalSince1970 * 1000).rounded())
    }

    static func progressJSON(_ progress: ServiceProgress) -> JSONValue {
        .object([
            "state": .string(progress.state.rawValue),
            "today": .string(progress.today.description),
            "totalServiceDays": .number(Double(progress.totalServiceDays)),
            "elapsedDays": .number(Double(progress.elapsedDays)),
            "remainingDays": .number(Double(progress.remainingDays)),
            "dDay": .number(Double(progress.dDay)),
            "completionPercentage": .number(progress.completionPercentage),
        ])
    }

    /// Swift implementation of each fixtured function, or nil when the
    /// function is not part of the native slice.
    static func evaluate(_ function: String, _ args: [JSONValue]) -> Outcome? {
        switch function {
        case "parseDateOnly":
            guard let parsed = date(args[0]) else { return .thrown }
            return .value(.object([
                "year": .number(Double(parsed.year)),
                "month": .number(Double(parsed.month)),
                "day": .number(Double(parsed.day)),
            ]))
        case "addDays":
            guard let start = date(args[0]) else { return .thrown }
            return .value(.string(start.adding(days: Int(args[1].numberValue!)).description))
        case "addCalendarMonths":
            guard let start = date(args[0]) else { return .thrown }
            return .value(.string(start.adding(months: Int(args[1].numberValue!)).description))
        case "differenceInCalendarDays":
            guard let later = date(args[0]), let earlier = date(args[1]) else { return .thrown }
            return .value(.number(Double(CivilDate.daysBetween(later, earlier))))
        case "dateOnlyInTimeZone":
            let instant = Date(timeIntervalSince1970: Double(instantMilliseconds(args[0])) / 1000)
            return .value(.string(SeoulClock.today(at: instant).description))
        case "seoulStartOfDay":
            guard let day = date(args[0]) else { return .thrown }
            return .value(.number(Double(SeoulClock.startOfDayMilliseconds(day))))
        case "calculateServiceProgress":
            guard let today = date(args[1]),
                  let callUp = args[0]["callUpDate"].flatMap(date),
                  let discharge = args[0]["expectedDischargeDate"].flatMap(date)
            else { return .thrown }
            let period = ServicePeriod(callUpDate: callUp, expectedDischargeDate: discharge)
            guard let progress = try? ServiceProgress.calculate(period, today: today) else { return .thrown }
            return .value(progressJSON(progress))
        case "calculateLiveServiceProgress":
            let live = LiveServiceProgress.calculate(period(args[0]), nowMilliseconds: instantMilliseconds(args[1]))
            return .value(.object([
                "remainingMilliseconds": .number(Double(live.remainingMilliseconds)),
                "completionPercentage": .number(live.completionPercentage),
                "countdown": .object([
                    "days": .number(Double(live.countdown.days)),
                    "hours": .number(Double(live.countdown.hours)),
                    "minutes": .number(Double(live.countdown.minutes)),
                    "seconds": .number(Double(live.countdown.seconds)),
                ]),
            ]))
        case "liveCompletionText":
            let live = LiveServiceProgress.calculate(period(args[0]), nowMilliseconds: instantMilliseconds(args[1]))
            return .value(.object([
                "percent": .string(live.formattedPercentage()),
                "countdown": .string(live.formattedCountdown),
            ]))
        case "continuousServiceCompletion":
            return .value(.number(continuousServiceCompletion(
                period(args[0]), nowMilliseconds: instantMilliseconds(args[1]))))
        case "floorPercent":
            return .value(.number(floorPercent(
                elapsed: Int(args[0].numberValue!), total: Int(args[1].numberValue!))))
        case "formatDdayNumber":
            return .value(.string(DDayFormat.number(Int(args[0].numberValue!))))
        default:
            return nil
        }
    }

    @Test("replays every native-engine fixture", arguments: ["dates", "service-progress", "live-progress"])
    func replay(suiteName: String) throws {
        let suite = try Fixtures.load(suiteName)
        #expect(suite.engines.contains("swift"))
        var checked = 0
        for fixture in suite.cases {
            guard let function = fixture.function,
                  let outcome = Self.evaluate(function, fixture.arguments)
            else {
                Issue.record("No Swift implementation for \(fixture.id)")
                continue
            }
            let expectedOK = fixture.expected["ok"]?.boolValue ?? false
            switch outcome {
            case .thrown:
                #expect(!expectedOK, "\(fixture.id): Swift rejected input the reference accepted")
            case .value(let value):
                #expect(expectedOK, "\(fixture.id): Swift accepted input the reference rejected")
                let expected = fixture.expected["value"] ?? .null
                let difference = value.firstDifference(from: expected)
                #expect(difference == nil, "\(fixture.id): \(difference ?? "")")
            }
            checked += 1
        }
        #expect(checked == suite.cases.count)
    }

    @Test("JavaScript toFixed tie rounding", arguments: [
        (0.25, 1, "0.3"), (1.25, 1, "1.3"), (12.25, 1, "12.3"), (0.125, 2, "0.13"),
        (1.005, 2, "1.00"), (99.95, 1, "100.0"), (0, 1, "0.0"), (-0.04, 1, "-0.0"),
        (50, 6, "50.000000"), (31.4829175, 6, "31.482917"),
    ])
    func toFixed(value: Double, digits: Int, expected: String) {
        #expect(JSNumberFormat.toFixed(value, digits) == expected)
    }
}
