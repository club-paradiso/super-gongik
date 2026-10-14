import SGDesignSystem
import SGFoundation
import SwiftUI
import WidgetKit

/// Widget timeline. Values change only at Seoul midnight (D-Day, day-based
/// percentage), so the timeline has one entry per midnight for a week and
/// then asks for a new one. Nothing here refreshes per second, and no copy
/// suggests it does. Calculations are the conformance-locked Swift slice.
struct ServiceEntry: TimelineEntry {
    let date: Date
    let snapshot: WidgetSnapshot?
    /// The app's theme preference (App Group defaults), read-only here.
    var theme: SGTheme = ThemePreference.load()
    /// 내 정보 › 위젯 스타일 (App Group defaults), read-only here.
    var preset: WidgetPreset = WidgetPreset.load()
}

struct ServiceTimelineProvider: TimelineProvider {
    func placeholder(in context: Context) -> ServiceEntry {
        ServiceEntry(date: .now, snapshot: WidgetSnapshot(
            callUpDate: CivilDate("2025-05-12")!, expectedDischargeDate: CivilDate("2027-02-11")!,
            leaveRemaining: "12일", nextEventDate: nil, nextEventLabel: nil, writtenAt: .now))
    }

    func getSnapshot(in context: Context, completion: @escaping (ServiceEntry) -> Void) {
        completion(context.isPreview ? placeholder(in: context) : ServiceEntry(date: .now, snapshot: WidgetSnapshot.load()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<ServiceEntry>) -> Void) {
        let snapshot = WidgetSnapshot.load()
        var entries = [ServiceEntry(date: .now, snapshot: snapshot)]
        var midnight = SeoulClock.nextMidnight(after: .now)
        for _ in 0..<7 {
            entries.append(ServiceEntry(date: midnight, snapshot: snapshot))
            midnight = SeoulClock.nextMidnight(after: midnight)
        }
        completion(Timeline(entries: entries, policy: .after(midnight)))
    }
}

// The small and medium faces live in Shared/WidgetPreset.swift so the app's
// 위젯 스타일 screen previews exactly what the widget draws.
struct SmallServiceView: View {
    let entry: ServiceEntry

    var body: some View {
        WidgetSmallFace(snapshot: entry.snapshot, date: entry.date, preset: entry.preset)
    }
}

struct MediumServiceView: View {
    let entry: ServiceEntry

    var body: some View {
        WidgetMediumFace(snapshot: entry.snapshot, date: entry.date, preset: entry.preset)
    }
}

/// Lock Screen: D-Day and percentage only. No leave balance or schedule,
/// which anyone near the phone could read.
struct AccessoryServiceView: View {
    @Environment(\.widgetFamily) private var family
    let entry: ServiceEntry

    var body: some View {
        if let model = WidgetModel(snapshot: entry.snapshot, date: entry.date) {
            switch family {
            case .accessoryCircular:
                Gauge(value: model.percent, in: 0...100) {
                    Text("복무")
                } currentValueLabel: {
                    Text(model.progress.state == .inService ? "\(model.progress.dDay)" : model.headline)
                        .monospacedDigit()
                        .minimumScaleFactor(0.5)
                }
                .gaugeStyle(.accessoryCircularCapacity)
                .accessibilityLabel("\(model.caption) \(model.headline)")
            case .accessoryInline:
                Text("\(model.caption) \(model.headline) · \(model.percentText)")
            default:
                VStack(alignment: .leading, spacing: 2) {
                    Text(model.caption).font(.caption2)
                    Text(model.headline).font(.headline).monospacedDigit()
                    Gauge(value: model.percent, in: 0...100) { EmptyView() }
                        .gaugeStyle(.accessoryLinearCapacity)
                }
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("\(model.caption) \(model.headline), 복무 \(model.percentText)")
            }
        } else {
            Text("슈퍼공익")
        }
    }
}

struct ServiceProgressWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "ServiceProgress", provider: ServiceTimelineProvider()) { entry in
            WidgetBody(entry: entry)
        }
        .configurationDisplayName("복무 현황")
        .description("소집해제까지 남은 날과 복무 진행률을 보여요. 하루에 한 번, 자정에 바뀌어요.")
        .supportedFamilies([.systemSmall, .systemMedium, .accessoryCircular, .accessoryRectangular, .accessoryInline])
    }
}

private struct WidgetBody: View {
    @Environment(\.widgetFamily) private var family
    let entry: ServiceEntry

    var body: some View {
        Group {
            switch family {
            case .systemSmall: SmallServiceView(entry: entry)
            case .systemMedium: MediumServiceView(entry: entry)
            default: AccessoryServiceView(entry: entry)
            }
        }
        .containerBackground(for: .widget) {
            if family == .systemSmall || family == .systemMedium {
                WidgetPresetBackground(preset: entry.preset)
            } else {
                AccessoryWidgetBackground()
            }
        }
        .environment(\.colorScheme, family == .systemSmall || family == .systemMedium ? .dark : .light)
        .environment(\.sgTheme, entry.theme)
    }
}

@main
struct SuperGongikWidgetBundle: WidgetBundle {
    var body: some Widget {
        ServiceProgressWidget()
        DutyLiveActivity()
    }
}
