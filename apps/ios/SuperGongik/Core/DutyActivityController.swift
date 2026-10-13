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

    static func start(profile: ServiceProfile, hero: HomeModel.Hero) async -> Bool {
        await end()
        let state = DutyActivityAttributes.ContentState(
            offDuty: offDuty(profile.workdayEndTime), headline: hero.headline,
            percent: hero.percent, percentLabel: hero.percentLabel)
        let attributes = DutyActivityAttributes(
            dischargeLine: profile.expectedDischargeDate.description.replacingOccurrences(of: "-", with: ".") + " 소집해제")
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
