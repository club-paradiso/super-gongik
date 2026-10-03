import Foundation

/// The two dates every progress figure depends on.
public struct ServicePeriod: Hashable, Sendable, Codable {
    public let callUpDate: CivilDate
    public let expectedDischargeDate: CivilDate

    public init(callUpDate: CivilDate, expectedDischargeDate: CivilDate) {
        self.callUpDate = callUpDate
        self.expectedDischargeDate = expectedDischargeDate
    }
}

public enum ServiceState: String, Sendable, Codable {
    case notStarted = "NOT_STARTED"
    case inService = "IN_SERVICE"
    case completed = "COMPLETED"
}

/// Mirror of `ServiceProgress` from `packages/domain/src/service/progress.ts`.
///
/// This is one of the few calculations ported to Swift instead of being run
/// through the JavaScript core: widgets and the live countdown need it
/// without starting JavaScriptCore. `contracts/fixtures/service-progress.json`
/// is the shared truth.
public struct ServiceProgress: Hashable, Sendable, Codable {
    public let state: ServiceState
    public let today: CivilDate
    public let totalServiceDays: Int
    public let elapsedDays: Int
    public let remainingDays: Int
    public let dDay: Int
    /// One decimal, rounded like `Number(x.toFixed(1))`.
    public let completionPercentage: Double

    public enum Failure: Error, Equatable { case callUpAfterDischarge }

    /// `calculateServiceProgress(profile, today)`.
    public static func calculate(_ period: ServicePeriod, today: CivilDate) throws -> ServiceProgress {
        guard period.callUpDate <= period.expectedDischargeDate else {
            throw Failure.callUpAfterDischarge
        }
        let total = max(0, CivilDate.daysBetween(period.expectedDischargeDate, period.callUpDate))

        if today < period.callUpDate {
            return ServiceProgress(
                state: .notStarted, today: today, totalServiceDays: total, elapsedDays: 0,
                remainingDays: total,
                dDay: CivilDate.daysBetween(period.expectedDischargeDate, today),
                completionPercentage: 0)
        }
        if today >= period.expectedDischargeDate || total == 0 {
            return ServiceProgress(
                state: .completed, today: today, totalServiceDays: total, elapsedDays: total,
                remainingDays: 0, dDay: 0, completionPercentage: 100)
        }
        let elapsed = min(max(CivilDate.daysBetween(today, period.callUpDate), 0), total)
        let remaining = total - elapsed
        return ServiceProgress(
            state: .inService, today: today, totalServiceDays: total, elapsedDays: elapsed,
            remainingDays: remaining, dDay: remaining,
            completionPercentage: JSNumberFormat.roundedLikeToFixed(
                Double(elapsed) / Double(total) * 100, 1))
    }

    /// `floorPercent` from the web home model: one decimal, floored, so the
    /// display reaches 100.0 only when service is complete.
    public var flooredPercent: Double {
        state == .completed ? 100 : floorPercent(elapsed: elapsedDays, total: totalServiceDays)
    }
}

/// Mirror of `calculateLiveServiceProgress` (apps/web/src/lib/live-service-progress.ts)
/// and `continuousServiceCompletion` (packages/domain/src/service/milestones.ts).
///
/// Only the in-app hero ticks every second, and only while visible. Widgets
/// use the day model above: iOS does not refresh widgets every second.
public struct LiveServiceProgress: Hashable, Sendable, Codable {
    public struct Countdown: Hashable, Sendable, Codable {
        public let days: Int
        public let hours: Int
        public let minutes: Int
        public let seconds: Int
    }

    public let remainingMilliseconds: Int64
    public let completionPercentage: Double
    public let countdown: Countdown

    public static func calculate(_ period: ServicePeriod, nowMilliseconds now: Int64) -> LiveServiceProgress {
        let start = SeoulClock.startOfDayMilliseconds(period.callUpDate)
        let end = SeoulClock.startOfDayMilliseconds(period.expectedDischargeDate)
        let total = max(0, end - start)
        let elapsed = min(total, max(0, now - start))
        let remaining = max(0, end - now)
        let totalSeconds = remaining / 1000
        let percentage =
            total == 0 ? 100 : min(100, max(0, Double(elapsed) / Double(total) * 100))
        return LiveServiceProgress(
            remainingMilliseconds: remaining,
            completionPercentage: percentage,
            countdown: Countdown(
                days: Int(totalSeconds / 86_400),
                hours: Int((totalSeconds % 86_400) / 3_600),
                minutes: Int((totalSeconds % 3_600) / 60),
                seconds: Int(totalSeconds % 60)))
    }

    public static func calculate(_ period: ServicePeriod, now: Date) -> LiveServiceProgress {
        calculate(period, nowMilliseconds: Int64((now.timeIntervalSince1970 * 1000).rounded(.down)))
    }

    /// `formatLiveCompletionPercentage`: floored, never rounded up.
    public func formattedPercentage(fractionDigits: Int = 6) -> String {
        let scale = pow(10, Double(fractionDigits))
        let value = (completionPercentage * scale).rounded(.down) / scale
        return JSNumberFormat.toFixed(value, fractionDigits) + "%"
    }

    /// `formatLiveCountdown`: "527일 03:04:05".
    public var formattedCountdown: String {
        let days = KoreanNumber.grouped(countdown.days)
        return String(format: "%@일 %02d:%02d:%02d", days, countdown.hours, countdown.minutes, countdown.seconds)
    }
}

/// `continuousServiceCompletion` as a fraction in [0, 1].
public func continuousServiceCompletion(_ period: ServicePeriod, nowMilliseconds now: Int64) -> Double {
    let start = SeoulClock.startOfDayMilliseconds(period.callUpDate)
    let end = SeoulClock.startOfDayMilliseconds(period.expectedDischargeDate)
    if end <= start { return now >= start ? 1 : 0 }
    return min(1, max(0, Double(now - start) / Double(end - start)))
}

/// `toLocaleString("ko-KR")` for integers: comma thousands separators.
public enum KoreanNumber {
    public static func grouped(_ value: Int) -> String {
        let digits = String(abs(value))
        var out = ""
        for (index, character) in digits.enumerated() {
            if index > 0 && (digits.count - index) % 3 == 0 { out.append(",") }
            out.append(character)
        }
        return value < 0 ? "-" + out : out
    }

    public static func won(_ amount: Int) -> String { grouped(amount) + "원" }
}

/// `floorPercent(elapsed, total)` from the web home model.
public func floorPercent(elapsed: Int, total: Int) -> Double {
    if total <= 0 { return 100 }
    return (Double(elapsed) / Double(total) * 1000).rounded(.down) / 10
}

/// D-Day wording shared with the web home model and the widgets.
public enum DDayFormat {
    /// `formatDdayNumber`: "D-Day" on the day, otherwise "D-1,234".
    public static func number(_ days: Int) -> String {
        days == 0 ? "D-Day" : "D-\(KoreanNumber.grouped(days))"
    }
}
