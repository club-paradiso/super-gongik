import SGCore
import SGDesignSystem
import SGFoundation
import PDFKit
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

@Suite("Theme preference")
struct ThemePreferenceTests {
    private func defaults() -> UserDefaults {
        let name = "sg.tests.\(UUID().uuidString)"
        return UserDefaults(suiteName: name)!
    }

    @Test("nothing stored falls back to the standard theme")
    func fallback() {
        #expect(ThemePreference.load(from: defaults()) == .standard)
    }

    @Test("an unknown stored value falls back to the standard theme")
    func unknownValue() {
        let store = defaults()
        store.set("neon", forKey: ThemePreference.key)
        #expect(ThemePreference.load(from: store) == .standard)
    }

    @Test("the stored theme round-trips")
    func roundTrip() {
        let store = defaults()
        for theme in SGTheme.allCases {
            store.set(theme.rawValue, forKey: ThemePreference.key)
            #expect(ThemePreference.load(from: store) == theme)
        }
    }

    /// Regression (PR #56 post-merge review): every `@AppStorage` reader must
    /// get the same defaults object, or a write from 더보기 may not invalidate
    /// the app root's theme until relaunch.
    @Test("the shared store is one instance for the process")
    func storeIdentity() {
        #expect(ThemePreference.store === ThemePreference.store)
    }

    @Test("a write through the shared store is what the widget path loads")
    func sharedStoreRoundTrip() {
        let store = ThemePreference.store
        let previous = store.object(forKey: ThemePreference.key)
        defer { store.set(previous, forKey: ThemePreference.key) }
        for theme in [SGTheme.warrior, .standard] {
            store.set(theme.rawValue, forKey: ThemePreference.key)
            #expect(ThemePreference.load() == theme)
        }
    }
}

@Suite("홈 milestone strip (Stitch route)")
struct MilestoneRouteTests {
    private func item(_ kind: String, _ value: Double, _ date: String) -> ServiceMilestoneItem {
        ServiceMilestoneItem(kind: kind, date: CivilDate(date)!, value: value, label: "")
    }

    private var list: [ServiceMilestoneItem] {
        [item("CALL_UP", 0, "2025-12-17"), item("DAYS_REMAINING", 500, "2026-05-04"),
         item("PERCENT", 25, "2026-05-20"), item("DAYS_REMAINING", 300, "2026-11-20"),
         item("PERCENT", 50, "2026-11-01"), item("DAYS_REMAINING", 200, "2027-02-28"),
         item("SERVICE_DAY", 100, "2026-03-27"), item("DISCHARGE", 0, "2027-09-16")]
            .sorted { $0.date.dayNumber < $1.date.dayNumber }
    }

    @Test("shows the last passed, the next and the one after; skips milestones off the route")
    func passedNextLater() throws {
        let route = try #require(MilestoneRoute(list, today: CivilDate("2026-10-13")!))
        #expect(route.entries.map(\.title) == ["25%", "50%", "D-300"])
        #expect(route.entries.map(\.state) == [.passed, .next, .later])
        #expect(route.daysToNext == 19)
    }

    @Test("before call-up the next milestone is 소집 and nothing is passed")
    func preService() throws {
        let route = try #require(MilestoneRoute(list, today: CivilDate("2025-12-01")!))
        #expect(route.entries.first?.title == "소집")
        #expect(route.entries.first?.state == .next)
        #expect(route.entries.count == 3)
    }

    @Test("after discharge there is nothing left to show")
    func completed() {
        #expect(MilestoneRoute(list, today: CivilDate("2027-09-17")!) == nil)
    }
}

@Suite("홈 journey trail (Stitch master synthesis)")
struct JourneyTrailTests {
    private func item(_ kind: String, _ value: Double, _ date: String) -> ServiceMilestoneItem {
        ServiceMilestoneItem(kind: kind, date: CivilDate(date)!, value: value, label: "")
    }

    private var list: [ServiceMilestoneItem] {
        [item("CALL_UP", 0, "2025-12-17"), item("DAYS_REMAINING", 500, "2026-05-04"),
         item("PERCENT", 25, "2026-05-20"), item("PERCENT", 50, "2026-11-01"),
         item("DAYS_REMAINING", 300, "2026-11-20"), item("SERVICE_DAY", 100, "2026-03-27"),
         item("DISCHARGE", 0, "2027-09-16")]
            .sorted { $0.date.dayNumber < $1.date.dayNumber }
    }

    private func hero(_ phase: String, headline: String = "D-338") throws -> HomeModel.Hero {
        try JSONDecoder().decode(HomeModel.Hero.self, from: Data("""
        {"phase":"\(phase)","eyebrow":"소집해제까지","headline":"\(headline)","headlineSpoken":"\(headline)",
         "dateLine":"","stateLabel":"복무 중","percent":47,"percentLabel":"47.0%","elapsedDays":300,
         "remainingDays":338,"totalServiceDays":638,"live":false,"next":null,"reachedToday":null}
        """.utf8))
    }

    @Test("소집, two passed milestones, today, the next one and 소집해제")
    func nodes() throws {
        let trail = try #require(JourneyTrail(list, hero: hero("IN_SERVICE"), today: CivilDate("2026-10-13")!))
        #expect(trail.nodes.map(\.title) == ["소집 '25.12", "D-500", "25%", "현재 D-338", "50%", "소집해제"])
        #expect(trail.nodes.map(\.state) == [.passed, .passed, .passed, .current, .upcoming, .upcoming])
        #expect(trail.fill == 3.0 / 5.0)
        #expect(trail.next == "50% · 19일 후")
    }

    @Test("off-route milestones (SERVICE_DAY) never appear")
    func offRoute() throws {
        let trail = try #require(JourneyTrail(list, hero: hero("IN_SERVICE"), today: CivilDate("2026-04-01")!))
        #expect(!trail.nodes.contains { $0.kind == "SERVICE_DAY" })
        #expect(trail.nodes.first?.title == "소집 '25.12")
        #expect(trail.nodes[1].state == .current)
    }

    @Test("only while in service")
    func phases() throws {
        for phase in ["PRE_SERVICE", "DISCHARGE_DAY", "COMPLETED"] {
            #expect(JourneyTrail(list, hero: try hero(phase), today: CivilDate("2026-10-13")!) == nil)
        }
    }
}

@Suite("복무 기록 요약 PDF")
struct RecordSummaryPDFTests {
    private func decode<T: Decodable>(_ json: String) throws -> T {
        try JSONDecoder().decode(T.self, from: Data(json.utf8))
    }

    @Test("says on the page that it is not an official document and leaves notes out")
    func disclaimerAndNoNotes() throws {
        let profile: ServiceProfile = try decode(#"{"id":"p1","callUpDate":"2025-12-17","expectedDischargeDate":"2027-09-16","serviceCategory":"행정"}"#)
        let event: ServiceEvent = try decode(#"{"id":"e1","eventType":"ANNUAL_LEAVE","startDate":"2026-10-19","endDate":"2026-10-19","timing":{"kind":"ALL_DAY","dayCount":1},"note":"병원 진료 메모","updatedAt":"2026-10-13T00:00:00Z","source":{"kind":"MANUAL"}}"#)
        let events = Array(repeating: (event: event, display: EventDisplay?.none), count: 120)
        let data = RecordSummaryPDF.render(.init(profile: profile, hero: nil, ledger: nil, leaveText: nil,
                                                events: events, generatedOn: CivilDate("2026-10-14")!))
        let pdf = try #require(PDFDocument(data: data))
        #expect(pdf.pageCount >= 2)
        let text = (0..<pdf.pageCount).compactMap { pdf.page(at: $0)?.string }.joined(separator: "\n")
        #expect(text.contains("공식 증명서가 아니며"))
        #expect(text.contains("공식 문서 아님"))
        #expect(text.contains("기록 120건"))
        #expect(!text.contains("병원 진료 메모"))
        #expect(RecordSummaryPDF.fileName(CivilDate("2026-10-14")!) == "슈퍼공익-복무기록요약-2026-10-14.pdf")
    }
}

@Suite("오늘 근무 Live Activity")
@MainActor
struct DutyActivityTests {
    private func seoul(_ text: String) -> Date {
        let formatter = ISO8601DateFormatter()
        return formatter.date(from: text)!
    }

    @Test("the work end time is today's time in Seoul, only while it is ahead")
    func offDuty() {
        let morning = seoul("2026-10-14T00:30:00Z") // 09:30 KST
        #expect(DutyActivityController.offDuty("18:00", now: morning) == seoul("2026-10-14T09:00:00Z"))
        let evening = seoul("2026-10-14T09:30:00Z") // 18:30 KST
        #expect(DutyActivityController.offDuty("18:00", now: evening) == nil)
        #expect(DutyActivityController.offDuty(nil, now: morning) == nil)
        #expect(DutyActivityController.offDuty("25:00", now: morning) == nil)
        #expect(DutyActivityController.offDuty("오후 6시", now: morning) == nil)
    }
}

@Suite("기록 편집 저장 실패 안내")
struct EventEditorFeedbackTests {
    private func event(_ id: String, _ start: String, _ end: String, deleted: Bool = false) throws -> ServiceEvent {
        try JSONDecoder().decode(ServiceEvent.self, from: Data("""
        {"id":"\(id)","eventType":"ANNUAL_LEAVE","startDate":"\(start)","endDate":"\(end)",
         "timing":{"kind":"ALL_DAY","dayCount":1},"title":null,"note":null,
         "deletedAt":\(deleted ? "\"2026-10-20T00:00:00Z\"" : "null"),"updatedAt":"2026-10-01T00:00:00Z","source":{"kind":"MANUAL"}}
        """.utf8))
    }

    private func form(_ start: String, _ end: String, mode: String = "ALL_DAY") throws -> EventFormState {
        try JSONDecoder().decode(EventFormState.self, from: Data("""
        {"eventType":"ANNUAL_LEAVE","mode":"\(mode)","startDate":"\(start)","endDate":"\(end)","dayCount":"1",
         "dayCountTouched":false,"half":"AM","startTime":"","endTime":"","hours":"","minutes":"",
         "durationTouched":false,"sickLeaveCategory":"","title":"","note":""}
        """.utf8))
    }

    @Test("each shared validation field lands under the section that holds it")
    func areas() {
        func issue(_ field: String?) -> EventIssue { EventIssue(code: "X", message: "", field: field) }
        #expect(EventEditorFeedback.area(of: issue("startDate")) == .dates)
        #expect(EventEditorFeedback.area(of: issue("endDate")) == .dates)
        #expect(EventEditorFeedback.area(of: issue("dayCount")) == .dates)
        #expect(EventEditorFeedback.area(of: issue("durationMinutes")) == .timing)
        #expect(EventEditorFeedback.area(of: issue("timing")) == .timing)
        #expect(EventEditorFeedback.area(of: issue("sickLeaveCategory")) == .type)
        #expect(EventEditorFeedback.area(of: issue(nil)) == .other)
    }

    @Test("the summary counts, and VoiceOver hears the first reason")
    func summary() {
        let one = [EventIssue(code: "LEAVE_OVERLAP", message: "2026-10-25에 이미 연가 기록이 있어요.", field: "startDate")]
        #expect(EventEditorFeedback.summary(one) == "저장하지 못했어요. 아래 항목을 확인해 주세요.")
        #expect(EventEditorFeedback.announcement(one) == "저장하지 못했어요. 아래 항목을 확인해 주세요. 2026-10-25에 이미 연가 기록이 있어요.")
        let two = one + [EventIssue(code: "INVALID_RANGE", message: "종료일이 시작일보다 앞서요.", field: "endDate")]
        #expect(EventEditorFeedback.summary(two) == "저장하지 못했어요. 확인할 항목이 2개 있어요.")
        #expect(EventEditorFeedback.isConflict(one[0]) && !EventEditorFeedback.isConflict(two[1]))
    }

    @Test("conflict links match the validator rather than just a calendar date")
    func slotAndTypeFilters() throws {
        func stored(_ id: String, _ kind: String, _ half: String? = nil, type: String = "ANNUAL_LEAVE") throws -> ServiceEvent {
            let timing = kind == "HALF_DAY"
                ? #"{"kind":"HALF_DAY","half":"\#(half ?? "AM")"}"#
                : #"{"kind":"ALL_DAY","dayCount":1}"#
            return try JSONDecoder().decode(ServiceEvent.self, from: Data("""
            {"id":"\(id)","eventType":"\(type)","startDate":"2026-10-25","endDate":"2026-10-25",
             "timing":\(timing),"updatedAt":"2026-10-25T00:00:00Z","source":{"kind":"MANUAL"}}
            """.utf8))
        }
        let morning = try stored("am", "HALF_DAY", "AM")
        let afternoon = try stored("pm", "HALF_DAY", "PM")
        let unrelated = try stored("other", "ALL_DAY", type: "EDUCATION")
        let overlap = [EventIssue(code: "LEAVE_OVERLAP", message: "", field: "startDate")]
        #expect(EventEditorFeedback.conflicts(with: try form("2026-10-25", "2026-10-25", mode: "HALF_DAY"),
            excluding: nil, in: [morning, afternoon, unrelated], issues: overlap).map(\.id) == ["am"])
        #expect(EventEditorFeedback.conflicts(with: try form("2026-10-25", "2026-10-25"),
            excluding: nil, in: [morning, afternoon, unrelated], issues: overlap).map(\.id) == ["am", "pm"])
        let warnings = [EventIssue(code: "LEAVE_OVERLAP_UNRESOLVED", message: "", field: "startDate")]
        #expect(EventEditorFeedback.conflicts(with: try form("2026-10-25", "2026-10-25"),
            excluding: nil, in: [morning, afternoon], issues: warnings).isEmpty)
    }

    @Test("a duplicate names the stored record it collides with, never itself or a deleted one")
    func conflicts() throws {
        let events = [try event("a", "2026-10-25", "2026-10-25"), try event("b", "2026-10-27", "2026-10-29"),
                      try event("gone", "2026-10-25", "2026-10-25", deleted: true)]
        #expect(EventEditorFeedback.conflicts(with: try form("2026-10-25", "2026-10-25"), excluding: nil, in: events).map(\.id) == ["a"])
        #expect(EventEditorFeedback.conflicts(with: try form("2026-10-25", "2026-10-25"), excluding: "a", in: events).isEmpty)
        // A range that touches two records reports both, oldest first.
        #expect(EventEditorFeedback.conflicts(with: try form("2026-10-24", "2026-10-28"), excluding: nil, in: events).map(\.id) == ["a", "b"])
        // A time-based record uses its start date only, whatever endDate still holds.
        #expect(EventEditorFeedback.conflicts(with: try form("2026-10-27", "2026-10-20", mode: "PARTIAL"), excluding: nil, in: events).map(\.id) == ["b"])
        // An unparsable date cannot conflict with anything.
        #expect(EventEditorFeedback.conflicts(with: try form("", "2026-10-25"), excluding: nil, in: events).isEmpty)
    }
}

