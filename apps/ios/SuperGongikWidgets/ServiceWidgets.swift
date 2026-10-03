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

private struct EmptyWidgetView: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Image("BrandMark").resizable().frame(width: 28, height: 28).clipShape(RoundedRectangle(cornerRadius: 7))
            Text("슈퍼공익을 열어\n소집일을 입력해 주세요")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(.sg(SGColor.heroForeground))
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    }
}

struct SmallServiceView: View {
    let entry: ServiceEntry

    var body: some View {
        if let model = WidgetModel(snapshot: entry.snapshot, date: entry.date) {
            VStack(alignment: .leading, spacing: 4) {
                Text(model.caption)
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(.sg(SGColor.heroForeground2))
                Text(model.headline)
                    .font(.system(size: 34, weight: .heavy))
                    .monospacedDigit()
                    .minimumScaleFactor(0.6)
                    .lineLimit(1)
                    .foregroundStyle(.sg(SGColor.heroForeground))
                Spacer(minLength: 0)
                Text(model.percentText)
                    .font(.system(size: 15, weight: .bold))
                    .monospacedDigit()
                    .foregroundStyle(.sg(SGColor.heroAccent))
                SGProgressBar(fraction: model.percent / 100, height: 6)
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("\(model.caption) \(model.headline), 복무 \(model.percentText)")
        } else {
            EmptyWidgetView()
        }
    }
}

struct MediumServiceView: View {
    let entry: ServiceEntry

    var body: some View {
        if let model = WidgetModel(snapshot: entry.snapshot, date: entry.date), let snapshot = entry.snapshot {
            HStack(alignment: .top, spacing: 16) {
                SmallServiceView(entry: entry)
                VStack(alignment: .leading, spacing: 10) {
                    if let leave = snapshot.leaveRemaining {
                        info("남은 연가", leave)
                    }
                    if let date = snapshot.nextEventDate, let label = snapshot.nextEventLabel,
                       date >= SeoulClock.today(at: entry.date) {
                        info("다음 일정", "\(date.month)/\(date.day) \(label)")
                    } else {
                        info("다음 일정", "없음")
                    }
                    Spacer(minLength: 0)
                    Text("\(KoreanNumber.grouped(model.progress.elapsedDays))일째 복무")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(.sg(SGColor.heroForeground3))
                }
                .privacySensitive()
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        } else {
            EmptyWidgetView()
        }
    }

    private func info(_ title: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title).font(.system(size: 11, weight: .semibold)).foregroundStyle(.sg(SGColor.heroForeground3))
            Text(value).font(.system(size: 16, weight: .bold)).monospacedDigit()
                .foregroundStyle(.sg(SGColor.heroForeground)).lineLimit(1).minimumScaleFactor(0.7)
        }
        .accessibilityElement(children: .combine)
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
                SGHeroBackground()
            } else {
                AccessoryWidgetBackground()
            }
        }
        .environment(\.colorScheme, family == .systemSmall || family == .systemMedium ? .dark : .light)
    }
}

@main
struct SuperGongikWidgetBundle: WidgetBundle {
    var body: some Widget {
        ServiceProgressWidget()
    }
}
