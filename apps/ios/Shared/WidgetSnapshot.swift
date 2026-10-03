import Foundation
import SGFoundation

/// Minimal data for widgets, written to the shared App Group container after
/// every change. Widgets never open the document store (ADR 0004): this file
/// holds only what a widget displays, and nothing about notes, health-related
/// leave details or imported documents.
struct WidgetSnapshot: Codable, Equatable {
    static let appGroup = "group.app.supergongik.shared"
    static let fileName = "widget-snapshot.json"

    var callUpDate: CivilDate
    var expectedDischargeDate: CivilDate
    /// Formatted by the core exactly as the home screen shows it ("12일").
    var leaveRemaining: String?
    /// Next upcoming record: date and the generic type label only.
    var nextEventDate: CivilDate?
    var nextEventLabel: String?
    var writtenAt: Date
}


extension WidgetSnapshot {
    static var url: URL? {
        FileManager.default
            .containerURL(forSecurityApplicationGroupIdentifier: appGroup)?
            .appendingPathComponent(fileName)
    }

    static func load() -> WidgetSnapshot? {
        guard let url, let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder().decode(WidgetSnapshot.self, from: data)
    }

    var period: ServicePeriod {
        ServicePeriod(callUpDate: callUpDate, expectedDischargeDate: expectedDischargeDate)
    }
}

/// What a widget shows for one date, derived only from the two service dates.
struct WidgetModel {
    let progress: ServiceProgress
    let headline: String
    let caption: String
    let percent: Double

    init?(snapshot: WidgetSnapshot?, date: Date) {
        guard let snapshot,
              let progress = try? ServiceProgress.calculate(snapshot.period, today: SeoulClock.today(at: date))
        else { return nil }
        self.progress = progress
        percent = progress.flooredPercent
        switch progress.state {
        case .notStarted:
            headline = DDayFormat.number(CivilDate.daysBetween(snapshot.callUpDate, progress.today))
            caption = "소집까지"
        case .inService:
            headline = DDayFormat.number(progress.dDay)
            caption = "소집해제까지"
        case .completed:
            headline = progress.today == snapshot.expectedDischargeDate ? "D-Day" : "복무 완료"
            caption = progress.today == snapshot.expectedDischargeDate ? "오늘 소집해제" : "수고 많으셨어요"
        }
    }

    var percentText: String { JSNumberFormat.toFixed(percent, 1) + "%" }
}

