import SGCore
import SGDesignSystem
import SGFoundation
import SwiftUI

/// 오늘: the glanceable dashboard. Everything shown is the web home model
/// (`buildHomeModel`) for today; the optional seconds readout uses the
/// Swift-native live progress and ticks only while this screen is visible.
struct TodayView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dynamicTypeSize) private var typeSize

    /// Side by side normally; stacked at accessibility text sizes.
    private var statLayout: AnyLayout {
        typeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(spacing: SGSpacing.sm))
            : AnyLayout(HStackLayout(alignment: .top, spacing: SGSpacing.sm))
    }
    let openTab: (AppTab) -> Void
    @State private var editorDate: CivilDate?

    var body: some View {
        NavigationStack {
            ScrollView {
                if let projection = model.projection, let home = projection.home, let profile = projection.profile {
                    VStack(alignment: .leading, spacing: SGSpacing.md) {
                        HeroCard(hero: home.hero, profile: profile, pay: home.pay)
                        statLayout {
                            LeaveStatCard(leave: home.leave) { openTab(.leave) }
                            PayStatCard(pay: home.pay) { openTab(.pay) }
                        }
                        AgendaCard(home: home, projection: projection, openRecords: { openTab(.records) })
                        if model.lastWriteError != nil {
                            SGNotice(.warning, title: model.lastWriteError ?? "")
                        }
                    }
                    .padding(.horizontal, SGSpacing.gutter)
                    .padding(.bottom, SGSpacing.xl)
                    .frame(maxWidth: 640)
                    .frame(maxWidth: .infinity)
                } else {
                    ProgressView().padding(.top, 120)
                }
            }
            .background(.sg(SGColor.background))
            .navigationTitle(Formatters.longDate(model.today))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button {
                        editorDate = model.today
                    } label: {
                        Label("기록 추가", systemImage: "plus")
                    }
                    .disabled(model.isReadOnly)
                }
            }
            .sheet(item: $editorDate) { date in
                EventEditorSheet(event: nil, initialDate: date)
            }
        }
    }
}

extension CivilDate: @retroactive Identifiable {
    public var id: Int { dayNumber }
}

// MARK: Hero

private struct HeroCard: View {
    let hero: HomeModel.Hero
    let profile: ServiceProfile
    let pay: HomeModel.Pay
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.dynamicTypeSize) private var typeSize

    private var rowLayout: AnyLayout {
        typeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: SGSpacing.xxs))
            : AnyLayout(HStackLayout(alignment: .firstTextBaseline))
    }

    private var showsLive: Bool { hero.live && profile.liveProgressEnabled == true }
    private var celebrates: Bool { hero.phase == "DISCHARGE_DAY" || hero.phase == "COMPLETED" }

    var body: some View {
        VStack(alignment: .leading, spacing: SGSpacing.sm) {
            HStack(alignment: .firstTextBaseline) {
                Text(hero.eyebrow)
                    .font(SGTypography.label)
                    .foregroundStyle(.sg(SGColor.heroForeground2))
                Spacer()
                stateBadge
            }

            Text(hero.headline)
                .font(SGTypography.display)
                .monospacedDigit()
                .tracking(-1.5)
                .foregroundStyle(.sg(SGColor.heroForeground))
                .minimumScaleFactor(0.6)
                .lineLimit(1)
                .accessibilityLabel(hero.headlineSpoken)

            Text(hero.dateLine)
                .font(SGTypography.caption)
                .foregroundStyle(.sg(SGColor.heroForeground2))

            if showsLive {
                LiveReadout(period: profile.period)
                    .padding(.top, SGSpacing.xxs)
            }

            SGProgressBar(fraction: hero.percent / 100)
                .padding(.top, SGSpacing.xs)
                .animation(SGMotion.animation(SGMotion.slow, reduceMotion: reduceMotion), value: hero.percent)

            rowLayout {
                if !showsLive {
                    Text(hero.percentLabel)
                        .font(SGTypography.font(22, .heavy, relativeTo: .title2))
                        .monospacedDigit()
                        .foregroundStyle(.sg(SGColor.heroAccent))
                }
                if !typeSize.isAccessibilitySize { Spacer() }
                // Two runs so each phrase wraps whole ("131일 남음" never
                // splits between the number and its unit).
                ViewThatFits(in: .horizontal) {
                    Text("\(KoreanNumber.grouped(hero.elapsedDays))일 지남 · \(KoreanNumber.grouped(hero.remainingDays))일 남음")
                    VStack(alignment: .leading, spacing: 0) {
                        Text("\(KoreanNumber.grouped(hero.elapsedDays))일 지남")
                        Text("\(KoreanNumber.grouped(hero.remainingDays))일 남음")
                    }
                }
                .font(SGTypography.caption)
                .monospacedDigit()
                .foregroundStyle(.sg(SGColor.heroForeground3))
            }
            .accessibilityElement(children: .combine)

            if let reached = hero.reachedToday {
                Label(reached, systemImage: celebrates ? "party.popper" : "sparkles")
                    .font(SGTypography.label)
                    .foregroundStyle(.sg(SGColor.heroAccent))
            }

            if let next = hero.next {
                Divider().overlay(.sg(SGColor.heroLine))
                rowLayout {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("\(hero.phase == "PRE_SERVICE" ? "이후" : "다음") · \(next.label)")
                            .font(SGTypography.label)
                            .foregroundStyle(.sg(SGColor.heroForeground))
                        if let detail = next.detail {
                            Text(detail).font(SGTypography.caption).foregroundStyle(.sg(SGColor.heroForeground3))
                        }
                    }
                    if !typeSize.isAccessibilitySize { Spacer() }
                    VStack(alignment: typeSize.isAccessibilitySize ? .leading : .trailing, spacing: 2) {
                        Text(Formatters.shortDate(next.date))
                            .font(SGTypography.label).monospacedDigit()
                            .foregroundStyle(.sg(SGColor.heroAccent))
                        Text(relativeDays(next.daysUntil))
                            .font(SGTypography.caption).foregroundStyle(.sg(SGColor.heroForeground3))
                    }
                }
                .accessibilityElement(children: .combine)
            }
        }
        .padding(SGSpacing.lg)
        .background {
            SGHeroBackground(celebrate: celebrates)
        }
        .clipShape(RoundedRectangle(cornerRadius: SGRadius.hero, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: SGRadius.hero, style: .continuous).strokeBorder(.white.opacity(0.08)))
        .sgShadow(.hero)
        .environment(\.colorScheme, .dark)
    }

    private var stateBadge: some View {
        HStack(spacing: 6) {
            if celebrates {
                Image(systemName: "flag.fill").font(.caption2)
            } else {
                Circle().frame(width: 6, height: 6)
            }
            Text(hero.stateLabel)
        }
        .font(SGTypography.micro)
        .foregroundStyle(.sg(SGColor.heroAccent))
        .accessibilityElement(children: .combine)
    }

    /// "오늘", "내일", "모레", "N일 후" (web `relativeDays`).
    private func relativeDays(_ days: Int) -> String {
        switch days {
        case 0: "오늘"
        case 1: "내일"
        case 2: "모레"
        default: "\(KoreanNumber.grouped(days))일 후"
        }
    }
}

/// Second-level progress. `TimelineView` only produces entries while the
/// view is on screen and the app is active, so nothing ticks in the
/// background. With Reduce Motion the value still updates every second
/// (accuracy matters); only interpolation is off, as on the web.
private struct LiveReadout: View {
    let period: ServicePeriod

    var body: some View {
        TimelineView(.periodic(from: .now, by: 1)) { context in
            let live = LiveServiceProgress.calculate(period, now: context.date)
            VStack(alignment: .leading, spacing: 2) {
                Text(live.formattedPercentage())
                    .font(SGTypography.font(20, .heavy, relativeTo: .title3))
                    .foregroundStyle(.sg(SGColor.heroAccent))
                Text(live.formattedCountdown)
                    .font(SGTypography.font(17, .semibold, relativeTo: .headline))
                    .foregroundStyle(.sg(SGColor.heroForeground2))
            }
            .monospacedDigit()
            .contentTransition(.identity)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("실시간 진행률")
        .accessibilityValue(Text(LiveServiceProgress.calculate(period, now: .now).formattedPercentage()))
    }
}

// MARK: Stat cards

private struct StatCard<Value: View>: View {
    let title: String
    let symbol: String
    let caption: String
    let action: () -> Void
    @ViewBuilder let value: Value

    var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: SGSpacing.xs) {
                HStack {
                    Label(title, systemImage: symbol)
                        .font(SGTypography.label)
                        .foregroundStyle(.sg(SGColor.textSecondary))
                        .labelStyle(TintedIconLabelStyle())
                    Spacer(minLength: 0)
                    Image(systemName: "chevron.right")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.sg(SGColor.textTertiary))
                        .accessibilityHidden(true)
                }
                value
                Text(caption)
                    .font(SGTypography.caption)
                    .foregroundStyle(.sg(SGColor.textTertiary))
                    .fixedSize(horizontal: false, vertical: true)
                    .multilineTextAlignment(.leading)
            }
            .padding(SGSpacing.md)
            .frame(maxWidth: .infinity, minHeight: 112, alignment: .topLeading)
            .background(.sg(SGColor.surface), in: RoundedRectangle(cornerRadius: SGRadius.card, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: SGRadius.card, style: .continuous).strokeBorder(.sg(SGColor.border)))
            .sgShadow(.small)
        }
        .buttonStyle(PressableStyle())
    }
}

struct TintedIconLabelStyle: LabelStyle {
    func makeBody(configuration: Configuration) -> some View {
        HStack(spacing: 6) {
            configuration.icon.foregroundStyle(.sg(SGColor.accent))
            configuration.title
        }
    }
}

struct PressableStyle: ButtonStyle {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed && !reduceMotion ? 0.98 : 1)
            .animation(SGMotion.animation(SGMotion.fast, reduceMotion: reduceMotion), value: configuration.isPressed)
    }
}

private struct LeaveStatCard: View {
    let leave: HomeModel.Leave
    let action: () -> Void

    var body: some View {
        StatCard(title: "남은 연가", symbol: "list.clipboard", caption: caption, action: action) {
            Text(leave.kind == "READY" ? (leave.remaining ?? "–") : "확인 필요")
                .font(SGTypography.statValue)
                .monospacedDigit()
                .foregroundStyle(.sg(leave.kind == "READY" ? SGColor.textPrimary : SGColor.warning))
                .minimumScaleFactor(0.7)
                .lineLimit(1)
        }
    }

    private var caption: String {
        [leave.caption, leave.attendance].compactMap { $0 }.joined(separator: "\n")
    }
}

private struct PayStatCard: View {
    let pay: HomeModel.Pay
    let action: () -> Void

    var body: some View {
        StatCard(title: "이번 달 급여", symbol: "wonsign.circle", caption: caption, action: action) {
            Group {
                switch pay.kind {
                case "TOTAL", "BASE_ONLY":
                    Text(Formatters.won(pay.amount ?? 0))
                        .foregroundStyle(.sg(SGColor.textPrimary))
                case "PENDING":
                    Text("입력 필요").foregroundStyle(.sg(SGColor.warning))
                default:
                    Text("–").foregroundStyle(.sg(SGColor.textTertiary))
                }
            }
            .font(SGTypography.statValue)
            .monospacedDigit()
            .minimumScaleFactor(0.7)
            .lineLimit(1)
        }
    }

    private var caption: String {
        // The shared home model's caption already says when only base pay is
        // known ("기본 보수 · 식비·교통비는 확인 후 더해요").
        pay.caption + (pay.band.map { "\n\($0)" } ?? "")
    }
}

// MARK: Agenda

private struct AgendaCard: View {
    let home: HomeModel
    let projection: Projection
    let openRecords: () -> Void

    var body: some View {
        SGCard {
            VStack(alignment: .leading, spacing: SGSpacing.sm) {
                SGSectionHeader("일정")
                if home.today.isEmpty && home.upcoming.isEmpty {
                    HStack(spacing: SGSpacing.sm) {
                        Image(systemName: "sunrise").foregroundStyle(.sg(SGColor.textTertiary))
                            .accessibilityHidden(true)
                        Text(home.completed ? "복무를 마쳤어요. 기록은 그대로 볼 수 있어요." : "다가오는 휴가·근태 기록이 없어요.")
                            .font(SGTypography.body)
                            .foregroundStyle(.sg(SGColor.textSecondary))
                    }
                    .padding(.vertical, SGSpacing.xs)
                } else {
                    ForEach(home.today + home.upcoming) { item in
                        AgendaRow(item: item, display: projection.eventDisplay?[item.event.id])
                        if item.id != (home.today + home.upcoming).last?.id { Divider() }
                    }
                }
                Button(action: openRecords) {
                    HStack {
                        Text("캘린더 보기").font(SGTypography.bodyStrong)
                        Spacer()
                        Image(systemName: "chevron.right").font(.caption.weight(.semibold))
                    }
                    .foregroundStyle(.sg(SGColor.accent))
                    .padding(.horizontal, SGSpacing.sm)
                    .frame(minHeight: SGSpacing.minimumHitTarget)
                    .background(.sg(SGColor.surfaceInteractive), in: RoundedRectangle(cornerRadius: SGRadius.control, style: .continuous))
                }
                .buttonStyle(.plain)
            }
        }
    }
}

struct AgendaRow: View {
    let item: HomeModel.AgendaItem
    let display: EventDisplay?

    var body: some View {
        HStack(spacing: SGSpacing.sm) {
            VStack(spacing: 2) {
                Text(item.isToday ? "오늘" : "\(item.event.startDate.month).\(item.event.startDate.day)")
                    .font(SGTypography.label).monospacedDigit()
                    .foregroundStyle(.sg(item.isToday ? SGColor.accent : SGColor.textPrimary))
                Text(Formatters.weekdays[item.event.startDate.weekday])
                    .font(SGTypography.micro)
                    .foregroundStyle(.sg(SGColor.textTertiary))
            }
            .frame(width: 44)
            if let display, let category = SGEventCategory(rawValue: display.category) {
                SGCategoryMark(category, size: 9)
            }
            VStack(alignment: .leading, spacing: 2) {
                Text(display?.label ?? item.event.eventType)
                    .font(SGTypography.bodyStrong)
                    .foregroundStyle(.sg(SGColor.textPrimary))
                Text([display?.categoryLabel, display?.timing].compactMap { $0 }.joined(separator: " · "))
                    .font(SGTypography.caption)
                    .foregroundStyle(.sg(SGColor.textTertiary))
            }
            Spacer()
            if !item.isToday {
                Text("\(KoreanNumber.grouped(item.daysUntil))일 후")
                    .font(SGTypography.caption).monospacedDigit()
                    .foregroundStyle(.sg(SGColor.textTertiary))
            }
        }
        .frame(minHeight: 52)
        .accessibilityElement(children: .combine)
    }
}
