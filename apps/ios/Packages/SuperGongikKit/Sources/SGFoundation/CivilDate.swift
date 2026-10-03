import Foundation

/// A calendar date with no time and no zone, mirroring `DateOnly`
/// (`YYYY-MM-DD`) in `packages/domain/src/service/date-only.ts`.
///
/// Arithmetic is proleptic Gregorian on day numbers, which is exactly what the
/// TypeScript reference does with `Date.UTC`. Conformance fixtures in
/// `contracts/fixtures/dates.json` pin the two implementations together.
public struct CivilDate: Hashable, Comparable, Sendable, CustomStringConvertible {
    public let year: Int
    public let month: Int
    public let day: Int

    /// Fails for anything `parseDateOnly` rejects (wrong shape or an impossible
    /// calendar date such as 2026-02-30). Years 0–99 are rejected too: the
    /// reference validates through `Date.UTC`, which maps them to 1900–1999.
    public init?(year: Int, month: Int, day: Int) {
        guard (100...9999).contains(year), (1...12).contains(month), day >= 1,
              day <= CivilDate.daysInMonth(year: year, month: month)
        else { return nil }
        self.year = year
        self.month = month
        self.day = day
    }

    /// Parses `YYYY-MM-DD` exactly like `parseDateOnly` (four, two and two
    /// ASCII digits, nothing else).
    public init?(_ text: String) {
        let bytes = Array(text.utf8)
        guard bytes.count == 10, bytes[4] == UInt8(ascii: "-"), bytes[7] == UInt8(ascii: "-") else {
            return nil
        }
        func number(_ range: Range<Int>) -> Int? {
            var value = 0
            for index in range {
                let byte = bytes[index]
                guard byte >= UInt8(ascii: "0"), byte <= UInt8(ascii: "9") else { return nil }
                value = value * 10 + Int(byte - UInt8(ascii: "0"))
            }
            return value
        }
        guard let year = number(0..<4), let month = number(5..<7), let day = number(8..<10) else {
            return nil
        }
        self.init(year: year, month: month, day: day)
    }

    /// Days since 1970-01-01 (negative before).
    public var dayNumber: Int {
        CivilDate.daysFromCivil(year: year, month: month, day: day)
    }

    public init(dayNumber: Int) {
        let (year, month, day) = CivilDate.civilFromDays(dayNumber)
        self.year = year
        self.month = month
        self.day = day
    }

    /// `formatDateOnly`.
    public var description: String {
        String(format: "%04d-%02d-%02d", year, month, day)
    }

    public static func < (lhs: CivilDate, rhs: CivilDate) -> Bool {
        lhs.dayNumber < rhs.dayNumber
    }

    /// `addDays`.
    public func adding(days: Int) -> CivilDate {
        CivilDate(dayNumber: dayNumber + days)
    }

    /// `addCalendarMonths`: clamps the day to the target month's length.
    public func adding(months: Int) -> CivilDate {
        let absolute = year * 12 + (month - 1) + months
        let targetYear = Int((Double(absolute) / 12).rounded(.down))
        let targetMonth = absolute - targetYear * 12 + 1
        let lastDay = CivilDate.daysInMonth(year: targetYear, month: targetMonth)
        return CivilDate(unchecked: targetYear, targetMonth, min(day, lastDay))
    }

    /// `differenceInCalendarDays(later, earlier)`.
    public static func daysBetween(_ later: CivilDate, _ earlier: CivilDate) -> Int {
        later.dayNumber - earlier.dayNumber
    }

    /// `dayOfWeek`: 0 = Sunday … 6 = Saturday.
    public var weekday: Int {
        let value = (dayNumber + 4) % 7 // 1970-01-01 was a Thursday.
        return value < 0 ? value + 7 : value
    }

    public static func daysInMonth(year: Int, month: Int) -> Int {
        switch month {
        case 1, 3, 5, 7, 8, 10, 12: return 31
        case 4, 6, 9, 11: return 30
        default:
            let leap = (year % 4 == 0 && year % 100 != 0) || year % 400 == 0
            return leap ? 29 : 28
        }
    }

    private init(unchecked year: Int, _ month: Int, _ day: Int) {
        self.year = year
        self.month = month
        self.day = day
    }

    // Howard Hinnant's days_from_civil / civil_from_days.
    static func daysFromCivil(year: Int, month: Int, day: Int) -> Int {
        let y = month <= 2 ? year - 1 : year
        let era = (y >= 0 ? y : y - 399) / 400
        let yoe = y - era * 400
        let mp = (month + 9) % 12
        let doy = (153 * mp + 2) / 5 + day - 1
        let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy
        return era * 146_097 + doe - 719_468
    }

    static func civilFromDays(_ days: Int) -> (Int, Int, Int) {
        let z = days + 719_468
        let era = (z >= 0 ? z : z - 146_096) / 146_097
        let doe = z - era * 146_097
        let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365
        let y = yoe + era * 400
        let doy = doe - (365 * yoe + yoe / 4 - yoe / 100)
        let mp = (5 * doy + 2) / 153
        let d = doy - (153 * mp + 2) / 5 + 1
        let m = mp < 10 ? mp + 3 : mp - 9
        return (m <= 2 ? y + 1 : y, m, d)
    }
}

extension CivilDate: Codable {
    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        let text = try container.decode(String.self)
        guard let value = CivilDate(text) else {
            throw DecodingError.dataCorruptedError(
                in: container, debugDescription: "Invalid date-only value: \(text)")
        }
        self = value
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(description)
    }
}

/// Asia/Seoul calendar semantics shared by the app, widgets and notifications.
public enum SeoulClock {
    public static let timeZone = TimeZone(identifier: "Asia/Seoul")!

    /// Fixed UTC+9 offset used by `seoulStartOfDay` and the live countdown.
    /// Korea has not observed DST since 1988, and the TypeScript reference
    /// deliberately uses the fixed offset here.
    public static let fixedOffsetMilliseconds: Int64 = 9 * 60 * 60 * 1000

    private static let calendar: Calendar = {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        return calendar
    }()

    /// `dateOnlyInTimeZone(instant, "Asia/Seoul")`: the civil date in Seoul
    /// according to the tz database (like `Intl.DateTimeFormat`).
    public static func today(at instant: Date) -> CivilDate {
        let parts = calendar.dateComponents([.year, .month, .day], from: instant)
        return CivilDate(year: parts.year!, month: parts.month!, day: parts.day!)!
    }

    /// `seoulStartOfDay`: epoch milliseconds of 00:00 (fixed UTC+9).
    public static func startOfDayMilliseconds(_ date: CivilDate) -> Int64 {
        Int64(date.dayNumber) * 86_400_000 - fixedOffsetMilliseconds
    }

    public static func startOfDay(_ date: CivilDate) -> Date {
        Date(timeIntervalSince1970: Double(startOfDayMilliseconds(date)) / 1000)
    }

    /// The next Seoul midnight strictly after `instant`; widget timelines and
    /// day-change refreshes are scheduled on it.
    public static func nextMidnight(after instant: Date) -> Date {
        startOfDay(today(at: instant).adding(days: 1))
    }
}
