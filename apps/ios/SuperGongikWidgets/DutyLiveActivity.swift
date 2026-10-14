import ActivityKit
import SGDesignSystem
import SwiftUI
import WidgetKit

/// Lock screen and Dynamic Island for the 오늘 근무 Live Activity. Only the
/// D-day, the progress and the time to the user's own work end appear;
/// never a record, a note or a leave type.
struct DutyLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: DutyActivityAttributes.self) { context in
            LockScreenView(state: context.state, dischargeLine: context.attributes.dischargeLine)
                .activityBackgroundTint(Color(red: 0.07, green: 0.09, blue: 0.24))
                .activitySystemActionForegroundColor(.white)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("소집해제까지").font(.caption2).foregroundStyle(.white.opacity(0.7))
                        Text(context.state.headline).font(.title2.weight(.heavy)).monospacedDigit()
                    }
                }
                DynamicIslandExpandedRegion(.trailing) {
                    VStack(alignment: .trailing, spacing: 2) {
                        Text("진행률").font(.caption2).foregroundStyle(.white.opacity(0.7))
                        Text(context.state.percentLabel).font(.title3.weight(.bold)).monospacedDigit()
                            .foregroundStyle(gold)
                    }
                }
                DynamicIslandExpandedRegion(.bottom) {
                    VStack(alignment: .leading, spacing: 6) {
                        ProgressView(value: context.state.percent, total: 100).tint(gold)
                        Group {
                            if let offDuty = context.state.offDuty, offDuty > .now {
                                HStack {
                                    Text("퇴근까지").font(.caption).foregroundStyle(.white.opacity(0.7))
                                    Text(timerInterval: Date.now...offDuty, countsDown: true)
                                        .font(.caption.weight(.semibold)).monospacedDigit()
                                }
                            } else {
                                Text(context.attributes.dischargeLine).font(.caption).foregroundStyle(.white.opacity(0.7))
                            }
                        }
                        // The island's lower corners clip the first glyph of
                        // the last line (seen on iPhone 16, iOS 26.3).
                        .padding(.leading, 8)
                    }
                }
            } compactLeading: {
                Text(context.state.headline).font(.caption.weight(.heavy)).monospacedDigit()
            } compactTrailing: {
                Text(context.state.percentLabel).font(.caption.weight(.semibold)).monospacedDigit()
                    .foregroundStyle(gold)
            } minimal: {
                Image(systemName: "flag.fill").foregroundStyle(gold)
            }
        }
    }

    private var gold: Color { Color(red: 0.99, green: 0.81, blue: 0.49) }
}

private struct LockScreenView: View {
    let state: DutyActivityAttributes.ContentState
    let dischargeLine: String
    private let gold = Color(red: 0.99, green: 0.81, blue: 0.49)

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                if let offDuty = state.offDuty, offDuty > .now {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("퇴근까지").font(.caption).foregroundStyle(.white.opacity(0.7))
                        Text(timerInterval: Date.now...offDuty, countsDown: true)
                            .font(.system(size: 34, weight: .heavy)).monospacedDigit()
                            .foregroundStyle(.white)
                    }
                } else {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("소집해제까지").font(.caption).foregroundStyle(.white.opacity(0.7))
                        Text(state.headline).font(.system(size: 34, weight: .heavy)).monospacedDigit()
                            .foregroundStyle(.white)
                    }
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 2) {
                    Text(state.offDuty == nil ? "진행률" : state.headline)
                        .font(.caption).foregroundStyle(.white.opacity(0.7)).monospacedDigit()
                    Text(state.percentLabel).font(.title3.weight(.bold)).monospacedDigit().foregroundStyle(gold)
                }
            }
            ProgressView(value: state.percent, total: 100).tint(gold)
            Text(dischargeLine).font(.caption2).foregroundStyle(.white.opacity(0.6))
        }
        .padding(16)
        .accessibilityElement(children: .combine)
    }
}
