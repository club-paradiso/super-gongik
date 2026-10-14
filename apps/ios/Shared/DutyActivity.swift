import ActivityKit
import Foundation

/// The 오늘 근무 Live Activity (Stitch "Dynamic Island & Live Activity",
/// phase 7): the time left until the user's own work end time, the D-day
/// and the progress. Shared by the app (starts and ends it) and the widget
/// extension (draws it). The lock screen shows no record content.
struct DutyActivityAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        /// Today's work end in Asia/Seoul, when the profile has one and it
        /// has not passed yet.
        var offDuty: Date?
        /// "D-338", "D-Day" … (the shared home model's headline).
        var headline: String
        /// 0…100.
        var percent: Double
        var percentLabel: String
    }

    /// "2027.09.16 소집해제".
    var dischargeLine: String
}
