import Foundation
import Observation
import SGCore
import SGFoundation
import UserNotifications

/// Local reminders for things a user could otherwise miss. No server, no
/// marketing, nothing scheduled until the user turns a category on (which is
/// also when permission is requested — never at first launch).
///
/// Lock-screen text is deliberately generic: a category label ("휴가",
/// "근태"), never a note, a title or that a leave is sick leave.
@MainActor
@Observable
final class ReminderScheduler {
    enum Category: String, CaseIterable, Identifiable {
        case upcomingRecord, backup

        var id: String { rawValue }
        var title: String {
            switch self {
            case .upcomingRecord: "다음 날 일정 알림"
            case .backup: "백업 알림"
            }
        }
        var detail: String {
            switch self {
            case .upcomingRecord: "휴가·근태 기록 전날 저녁 8시에 알려요."
            case .backup: "마지막 백업 후 30일이 지나면 한 번 알려요."
            }
        }
    }

    nonisolated static let identifierPrefix = "sg.reminder."
    nonisolated private static let maxRecordReminders = 20
    private let center = UNUserNotificationCenter.current()

    private(set) var enabled: Set<Category>
    private(set) var authorizationDenied = false

    init() {
        let stored = UserDefaults.standard.stringArray(forKey: "SGReminderCategories") ?? []
        enabled = Set(stored.compactMap(Category.init(rawValue:)))
    }

    func isEnabled(_ category: Category) -> Bool { enabled.contains(category) }

    func setEnabled(_ category: Category, _ on: Bool) async {
        if on {
            let granted = (try? await center.requestAuthorization(options: [.alert, .sound])) ?? false
            authorizationDenied = !granted
            guard granted else { return }
            enabled.insert(category)
        } else {
            enabled.remove(category)
        }
        UserDefaults.standard.set(enabled.map(\.rawValue).sorted(), forKey: "SGReminderCategories")
    }

    /// Records that a backup file was saved (resets the backup reminder).
    static func noteBackupSaved(at date: Date = .now) {
        UserDefaults.standard.set(date, forKey: "SGLastBackupAt")
    }

    /// Replaces every pending reminder of ours with the current plan.
    func reschedule(projection: Projection?, now: Date = .now) async {
        let pending = await center.pendingNotificationRequests()
        center.removePendingNotificationRequests(withIdentifiers: pending.map(\.identifier).filter { $0.hasPrefix(Self.identifierPrefix) })
        guard let projection, projection.profile != nil else { return }
        for request in Self.plan(projection: projection, enabled: enabled, now: now,
                                 lastBackup: UserDefaults.standard.object(forKey: "SGLastBackupAt") as? Date) {
            try? await center.add(request)
        }
    }

    /// Pure planning, unit-tested: which reminders to schedule and when.
    nonisolated static func plan(projection: Projection, enabled: Set<Category>, now: Date, lastBackup: Date?) -> [UNNotificationRequest] {
        var requests: [UNNotificationRequest] = []
        let today = SeoulClock.today(at: now)

        if enabled.contains(.upcomingRecord) {
            let upcoming = (projection.liveEvents ?? [])
                .filter { $0.startDate > today }
                .sorted { $0.startDate < $1.startDate }
            var seenDates = Set<CivilDate>()
            for event in upcoming where seenDates.insert(event.startDate).inserted {
                guard requests.count < maxRecordReminders else { break }
                let eve = event.startDate.adding(days: -1)
                guard let fire = seoulDate(eve, hour: 20), fire > now else { continue }
                let label = genericLabel(projection.eventDisplay?[event.id])
                let content = UNMutableNotificationContent()
                content.title = "내일 \(label) 일정이 있어요"
                content.body = "\(event.startDate.month)월 \(event.startDate.day)일 기록을 확인해 보세요."
                content.sound = .default
                content.threadIdentifier = "upcoming"
                requests.append(UNNotificationRequest(
                    identifier: "\(identifierPrefix)record.\(event.startDate)",
                    content: content,
                    trigger: calendarTrigger(fire)))
            }
        }

        if enabled.contains(.backup) {
            let base = lastBackup ?? now
            if let due = Calendar.current.date(byAdding: .day, value: 30, to: base) {
                let fire = max(due, now.addingTimeInterval(60))
                let content = UNMutableNotificationContent()
                content.title = "백업한 지 30일이 지났어요"
                content.body = "기기를 잃어버려도 기록을 지킬 수 있게 더보기에서 백업 파일을 만들어 두세요."
                content.threadIdentifier = "backup"
                requests.append(UNNotificationRequest(
                    identifier: "\(identifierPrefix)backup", content: content, trigger: calendarTrigger(fire)))
            }
        }
        return requests
    }

    nonisolated private static func genericLabel(_ display: EventDisplay?) -> String {
        guard let display else { return "기록" }
        switch display.category {
        case "sick", "note": return "기록"
        default: return display.categoryLabel
        }
    }

    nonisolated private static func seoulDate(_ date: CivilDate, hour: Int) -> Date? {
        var components = DateComponents()
        components.year = date.year
        components.month = date.month
        components.day = date.day
        components.hour = hour
        return Calendar.seoul.date(from: components)
    }

    nonisolated private static func calendarTrigger(_ date: Date) -> UNCalendarNotificationTrigger {
        let components = Calendar.seoul.dateComponents([.year, .month, .day, .hour, .minute], from: date)
        var withZone = components
        withZone.timeZone = SeoulClock.timeZone
        return UNCalendarNotificationTrigger(dateMatching: withZone, repeats: false)
    }
}
