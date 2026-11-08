import ActivityKit
import Foundation
import SGCore
import SGFoundation

/// Starts and ends the 오늘 근무 Live Activity. The work end time is the
/// profile's own `workdayEndTime` (Asia/Seoul); without one, or once it has
/// passed, the activity shows only the D-day and progress.
@MainActor
enum DutyActivityController {
    static var isRunning: Bool { !Activity<DutyActivityAttributes>.activities.isEmpty }
    static var isAvailable: Bool { ActivityAuthorizationInfo().areActivitiesEnabled }

    /// "18:00" today in Seoul, if it is still ahead.
    static func offDuty(_ endTime: String?, now: Date = .now) -> Date? {
        guard let endTime, let colon = endTime.firstIndex(of: ":"),
              let hour = Int(endTime[..<colon]), let minute = Int(endTime[endTime.index(after: colon)...]),
              (0..<24).contains(hour), (0..<60).contains(minute) else { return nil }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = SeoulClock.timeZone
        guard let date = calendar.date(bySettingHour: hour, minute: minute, second: 0, of: now), date > now else { return nil }
        return date
    }

    private static func contentState(profile: ServiceProfile, hero: HomeModel.Hero) -> DutyActivityAttributes.ContentState {
        DutyActivityAttributes.ContentState(
            offDuty: offDuty(profile.workdayEndTime), headline: hero.headline,
            percent: hero.percent, percentLabel: hero.percentLabel)
    }

    private static func dischargeLine(_ profile: ServiceProfile) -> String {
        profile.expectedDischargeDate.description.replacingOccurrences(of: "-", with: ".") + " 소집해제"
    }

    /// Keeps a running activity in step with the projection: a new day, a
    /// changed profile or a wiped store. It used to keep yesterday's D-day
    /// and stay on the lock screen after 데이터 지우기.
    static func refresh(profile: ServiceProfile?, hero: HomeModel.Hero?) async {
        let running = Activity<DutyActivityAttributes>.activities
        guard !running.isEmpty else { return }
        guard let profile, let hero else {
            await end()
            return
        }
        if running.contains(where: { $0.attributes.dischargeLine != dischargeLine(profile) }) {
            // Attributes are fixed for an activity's life: start a new one.
            _ = await start(profile: profile, hero: hero)
            return
        }
        let next = contentState(profile: profile, hero: hero)
        let stale = next.offDuty ?? SeoulClock.nextMidnight(after: .now)
        for activity in running {
            await activity.update(ActivityContent(state: next, staleDate: stale))
        }
    }

    static func start(profile: ServiceProfile, hero: HomeModel.Hero) async -> Bool {
        await end()
        let state = contentState(profile: profile, hero: hero)
        let attributes = DutyActivityAttributes(dischargeLine: dischargeLine(profile))
        let stale = state.offDuty ?? SeoulClock.nextMidnight(after: .now)
        do {
            _ = try Activity.request(attributes: attributes,
                                     content: ActivityContent(state: state, staleDate: stale),
                                     pushType: nil)
            return true
        } catch {
            AppLog.error("live activity failed: \(error)")
            return false
        }
    }

    static func end() async {
        for activity in Activity<DutyActivityAttributes>.activities {
            await activity.end(nil, dismissalPolicy: .immediate)
        }
    }
}
