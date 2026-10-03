import SGCore
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
        let date = Date(timeIntervalSince1970: 1_790_000_000) // 2026-09-21T13:33:20Z
        #expect(BackupDocument.fileName(at: date) == "super-gongik-backup-20260921-2233.json")
    }
}
