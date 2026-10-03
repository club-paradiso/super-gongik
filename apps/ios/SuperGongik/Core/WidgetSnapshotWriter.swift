import Foundation
import SGCore
import SGFoundation

enum WidgetSnapshotWriter {
    private static var url: URL? { WidgetSnapshot.url }

    @MainActor
    static func write(projection: Projection?, today: CivilDate) {
        guard let url else { return } // App Group not provisioned (e.g. unsigned simulator build)
        guard let projection, let profile = projection.profile else {
            clear()
            return
        }
        let leave = projection.home?.leave
        let next = projection.nextEvent
        let snapshot = WidgetSnapshot(
            callUpDate: profile.callUpDate,
            expectedDischargeDate: profile.expectedDischargeDate,
            leaveRemaining: leave?.kind == "READY" ? leave?.remaining : nil,
            nextEventDate: next?.startDate,
            nextEventLabel: next.flatMap { widgetLabel(projection.eventDisplay?[$0.id]) },
            writtenAt: .now)
        do {
            let data = try JSONEncoder().encode(snapshot)
            try data.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
            WidgetReloader.reload()
        } catch {
            AppLog.error("widget snapshot write failed: \((error as NSError).code)")
        }
    }

    /// Widgets are visible to anyone who sees the screen, so they get the
    /// generic category label only (never a user title or note). Sick leave
    /// is health-related and memos are free text: both read "일정".
    static func widgetLabel(_ display: EventDisplay?) -> String? {
        guard let display else { return nil }
        switch display.category {
        case "sick", "note": return "일정"
        default: return display.categoryLabel
        }
    }

    static func clear() {
        guard let url else { return }
        try? FileManager.default.removeItem(at: url)
        WidgetReloader.reload()
    }
}

enum WidgetReloader {
    static func reload() {
        #if canImport(WidgetKit)
        WidgetReloaderImpl.reload()
        #endif
    }
}

#if canImport(WidgetKit)
import WidgetKit

private enum WidgetReloaderImpl {
    static func reload() { WidgetCenter.shared.reloadAllTimelines() }
}
#endif
