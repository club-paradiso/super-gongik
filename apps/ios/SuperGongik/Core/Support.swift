import Foundation
import os
import SGCore
import SGFoundation

/// Developer diagnostics. Never pass record content, notes, tokens or
/// imported document text; messages are logged `.private` regardless.
enum AppLog {
    private static let logger = Logger(subsystem: "app.supergongik", category: "app")

    static func error(_ message: String) { logger.error("\(message, privacy: .private)") }
    static func info(_ message: String) { logger.info("\(message, privacy: .private)") }
}

/// User-facing error copy. Raw core, HTTP or JSON errors are never shown;
/// each message says what happened and what is (or is not) affected.
enum ErrorCopy {
    static let startup = "앱을 시작하지 못했어요. 이 기기에 저장된 기록은 그대로 있어요. 앱을 다시 열어 주세요."
    static let saveFailed = "저장하지 못했어요. 바뀐 내용은 없어요. 다시 시도해 주세요."
    static let readOnly = "새 버전 앱에서 저장한 데이터라 이 버전에서는 바꿀 수 없어요. 앱을 업데이트해 주세요."
}

enum Formatters {
    static let weekdays = ["일", "월", "화", "수", "목", "금", "토"]

    /// "10.7 (수)"
    static func shortDate(_ date: CivilDate) -> String {
        "\(date.month).\(date.day) (\(weekdays[date.weekday]))"
    }

    /// "2026년 10월 7일 (수)"
    static func longDate(_ date: CivilDate) -> String {
        "\(date.year)년 \(date.month)월 \(date.day)일 (\(weekdays[date.weekday]))"
    }

    /// "2026년 10월"
    static func month(_ date: CivilDate) -> String { "\(date.year)년 \(date.month)월" }

    static func won(_ amount: Double) -> String {
        KoreanNumber.won(Int(amount.rounded()))
    }

    static func civilDate(from date: Date) -> CivilDate { SeoulClock.today(at: date) }

    /// Seoul-midnight `Date` for a civil date, for `DatePicker` bindings.
    static func date(from civil: CivilDate) -> Date { SeoulClock.startOfDay(civil) }
}

extension Calendar {
    /// Gregorian calendar in Asia/Seoul, for date pickers.
    static let seoul: Calendar = {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = SeoulClock.timeZone
        calendar.locale = Locale(identifier: "ko_KR")
        return calendar
    }()
}
