import SGCore
import SGFoundation
import UserNotifications
import Testing
@testable import SuperGongik

@Suite("App layer")
struct AppTests {
    @Test("widgets never show health-related or free-text labels")
    func widgetLabelPrivacy() throws {
        func display(_ category: String, _ label: String) -> EventDisplay {
            try! JSONDecoder().decode(EventDisplay.self, from: Data("""
            {"category":"\(category)","categoryLabel":"\(category == "leave" ? "휴가" : category)","label":"\(label)","timing":"종일"}
            """.utf8))
        }
        #expect(WidgetSnapshotWriter.widgetLabel(display("sick", "병가")) == "일정")
        #expect(WidgetSnapshotWriter.widgetLabel(display("note", "병원 예약")) == "일정")
        // A user title must not leak; only the generic category label is used.
        #expect(WidgetSnapshotWriter.widgetLabel(display("leave", "할머니 병문안")) == "휴가")
    }

    @Test("backup file names use Seoul time")
    func backupFileName() {
        let date = Date(timeIntervalSince1970: 1_790_000_000) // 2026-09-21T14:13:20Z = 23:13 KST
        #expect(BackupDocument.fileName(at: date) == "super-gongik-backup-20260921-2313.json")
    }
}

@Suite("Reminder planning")
struct ReminderPlanTests {
    static func projection() throws -> Projection {
        let json = """
        {"today":"2026-10-03","profile":{"id":"p","callUpDate":"2025-05-12","expectedDischargeDate":"2027-02-11"},
         "liveEvents":[
           {"id":"a","eventType":"ANNUAL_LEAVE","startDate":"2026-10-07","endDate":"2026-10-07","timing":{"kind":"ALL_DAY","dayCount":1},"title":"할머니 병문안","note":"비밀","deletedAt":null,"updatedAt":"2026-10-01T00:00:00Z","source":{"kind":"MANUAL"}},
           {"id":"b","eventType":"SICK_LEAVE","startDate":"2026-10-09","endDate":"2026-10-09","timing":{"kind":"ALL_DAY","dayCount":1},"title":null,"note":null,"deletedAt":null,"updatedAt":"2026-10-01T00:00:00Z","source":{"kind":"MANUAL"}},
           {"id":"c","eventType":"ANNUAL_LEAVE","startDate":"2026-10-01","endDate":"2026-10-01","timing":{"kind":"ALL_DAY","dayCount":1},"title":null,"note":null,"deletedAt":null,"updatedAt":"2026-10-01T00:00:00Z","source":{"kind":"MANUAL"}}],
         "eventDisplay":{"a":{"category":"leave","categoryLabel":"휴가","label":"할머니 병문안","timing":"종일"},
                         "b":{"category":"sick","categoryLabel":"병가","label":"병가","timing":"종일"}}}
        """
        return try JSONDecoder().decode(Projection.self, from: Data(json.utf8))
    }

    @Test("reminders fire the evening before, with generic text only")
    func upcoming() throws {
        let now = ISO8601DateFormatter().date(from: "2026-10-03T03:00:00Z")!
        let requests = ReminderScheduler.plan(projection: try Self.projection(), enabled: [.upcomingRecord], now: now, lastBackup: nil)
        #expect(requests.count == 2, "past records are not scheduled")
        let leave = try #require(requests.first)
        #expect(leave.content.title == "내일 휴가 일정이 있어요")
        #expect(!leave.content.body.contains("병문안") && !leave.content.body.contains("비밀"))
        let trigger = try #require(leave.trigger as? UNCalendarNotificationTrigger)
        #expect(trigger.dateComponents.day == 6 && trigger.dateComponents.hour == 20)
        #expect(requests[1].content.title == "내일 기록 일정이 있어요", "sick leave is not named on the lock screen")
    }

    @Test("nothing is planned for disabled categories")
    func disabled() throws {
        #expect(ReminderScheduler.plan(projection: try Self.projection(), enabled: [], now: .now, lastBackup: nil).isEmpty)
    }
}

@Suite("Widget model")
struct WidgetModelTests {
    func snapshot() -> WidgetSnapshot {
        WidgetSnapshot(callUpDate: CivilDate("2026-05-04")!, expectedDischargeDate: CivilDate("2028-02-03")!,
                       leaveRemaining: nil, nextEventDate: nil, nextEventLabel: nil, writtenAt: .now)
    }

    func model(at iso: String) -> WidgetModel? {
        WidgetModel(snapshot: snapshot(), date: ISO8601DateFormatter().date(from: iso)!)
    }

    @Test("D-Day changes at Seoul midnight, not UTC midnight")
    func seoulMidnight() throws {
        // 14:59:59Z on 10/3 is 23:59:59 KST on 10/3; one second later is 10/4.
        #expect(try #require(model(at: "2026-10-03T14:59:59Z")).headline == "D-488")
        #expect(try #require(model(at: "2026-10-03T15:00:00Z")).headline == "D-487")
    }

    @Test("pre-service, discharge day and completed states")
    func states() throws {
        let before = try #require(model(at: "2026-05-01T00:00:00Z"))
        #expect(before.caption == "소집까지" && before.headline == "D-3")
        let discharge = try #require(model(at: "2028-02-03T03:00:00Z"))
        #expect(discharge.headline == "D-Day" && discharge.percentText == "100.0%")
        let after = try #require(model(at: "2028-06-01T03:00:00Z"))
        #expect(after.headline == "복무 완료")
        #expect(WidgetModel(snapshot: nil, date: .now) == nil, "no profile → empty state")
    }

    @Test("widget percentage is floored like the home hero")
    func floored() throws {
        // 152/640 = 23.75 % → the hero and widget show 23.7 %, never 23.8 %.
        #expect(try #require(model(at: "2026-10-03T03:00:00Z")).percentText == "23.7%")
    }
}
