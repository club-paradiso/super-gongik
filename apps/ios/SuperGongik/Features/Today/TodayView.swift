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
    @State private var showingImport = false

    var body: some View {
        NavigationStack {
            ScrollView {
                if let projection = model.projection, let home = projection.home, let profile = projection.profile {
                    // Order follows the home hierarchy in docs/design/SCREEN-MAP.md:
                    // hero → leave/pay → agenda → quick actions (web `home-tab.tsx`).
                    VStack(alignment: .leading, spacing: SGSpacing.md) {
                        HeroCard(hero: home.hero, profile: profile, pay: home.pay)
                        if !home.completed {
                            statLayout {
                                LeaveStatCard(leave: home.leave) { openTab(.leave) }
                                PayStatCard(pay: home.pay, phase: home.hero.phase) { openTab(.pay) }
                            }
                        }
                        AgendaCard(home: home, projection: projection, openRecords: { openTab(.records) })
                        if !home.completed {
                            QuickActions(
                                readOnly: model.isReadOnly,
                                recordLeave: { editorDate = model.today },
                                openLedger: { openTab(.leave) },
                                importRecords: { showingImport = true })
                        }
                        if let error = model.lastWriteError {
                            SGNotice(.warning, title: error)
                        }
                    }
                    .padding(.horizontal, SGSpacing.gutter)
                    .padding(.bottom, SGSpacing.xl)
                    .frame(maxWidth: SGLayout.readableWidth)
                    .frame(maxWidth: .infinity)
                } else {
                    SGLoadingState()
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
            .sheet(isPresented: $showingImport) {
                NavigationStack {
                    RecordImportView()
                        .toolbar {
                            ToolbarItem(placement: .cancellationAction) {
                                Button("닫기") { showingImport = false }
                            }
                        }
                }
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
    @Environment(\.sgTheme) private var theme

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

            if theme.showsWorldLanguage {
                // Warrior theme flavor only; the Korean eyebrow above carries the meaning.
                Text(celebrates ? "FINAL QUEST" : "JOURNEY")
                    .font(SGTypography.eyebrow)
                    .tracking(2)
                    .foregroundStyle(.sg(SGColor.heroAccent))
                    .accessibilityHidden(true)
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
                        .font(SGTypography.statValue)
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
                    VStack(alignment: .leading, spacing: SGSpacing.xxxs) {
                        Text("\(hero.phase == "PRE_SERVICE" ? "이후" : "다음") · \(next.label)")
                            .font(SGTypography.label)
                            .foregroundStyle(.sg(SGColor.heroForeground))
                        if let detail = next.detail {
                            Text(detail).font(SGTypography.caption).foregroundStyle(.sg(SGColor.heroForeground3))
                        }
                    }
                    if !typeSize.isAccessibilitySize { Spacer() }
                    VStack(alignment: typeSize.isAccessibilitySize ? .leading : .trailing, spacing: SGSpacing.xxxs) {
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
        .overlay(RoundedRectangle(cornerRadius: SGRadius.hero, style: .continuous).strokeBorder(.sg(SGColor.heroBorder)))
        .sgShadow(.hero)
        .environment(\.colorScheme, .dark)
    }

    private var stateBadge: some View {
        HStack(spacing: SGSpacing.iconGap) {
            if celebrates {
                Image(systemName: "flag.fill").font(.caption2)
            } else {
                Circle().frame(width: SGSize.statusDot, height: SGSize.statusDot)
                    .accessibilityHidden(true)
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
            VStack(alignment: .leading, spacing: SGSpacing.xxxs) {
                Text(live.formattedPercentage())
                    .font(SGTypography.heroMetric)
                    .foregroundStyle(.sg(SGColor.heroAccent))
                Text(live.formattedCountdown)
                    .font(SGTypography.heroDetail)
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

/// Value line of a stat card. Attention states add a symbol so the state is
/// never carried by color alone.
private struct StatValue: View {
    enum Emphasis { case value, muted, attention }
    let text: String
    let emphasis: Emphasis

    var body: some View {
        HStack(spacing: SGSpacing.iconGap) {
            if emphasis == .attention {
                Image(systemName: SGTone.warning.symbol)
                    .font(SGTypography.label)
                    .accessibilityHidden(true)
            }
            Text(text)
                .font(SGTypography.statValue)
                .monospacedDigit()
                .minimumScaleFactor(0.7)
                .lineLimit(1)
        }
        .foregroundStyle(.sg(color))
    }

    private var color: SGToken {
        switch emphasis {
        case .value: SGColor.textPrimary
        case .muted: SGColor.textTertiary
        case .attention: SGColor.warning
        }
    }
}

private struct LeaveStatCard: View {
    let leave: HomeModel.Leave
    let action: () -> Void

    var body: some View {
        SGStatCard(title: "남은 연가", eyebrow: "REST", symbol: "list.clipboard", caption: caption, action: action) {
            // Copy mirrors the web stat card (`home-tab.tsx` HomeStats).
            switch leave.kind {
            case "READY": StatValue(text: leave.remaining ?? "–", emphasis: .value)
            case "BEFORE_SERVICE": StatValue(text: "소집 후", emphasis: .muted)
            default: StatValue(text: "확인 필요", emphasis: .attention)
            }
        }
    }

    private var caption: String {
        let lines: [String?] = leave.kind == "READY" ? [leave.caption, leave.attendance] : [leave.caption]
        return lines.compactMap { $0 }.joined(separator: "\n")
    }
}

private struct PayStatCard: View {
    let pay: HomeModel.Pay
    let phase: String
    let action: () -> Void

    var body: some View {
        SGStatCard(title: "이번 달 급여", eyebrow: "SUPPLY", symbol: "wonsign.circle", caption: caption, action: action) {
            switch pay.kind {
            case "TOTAL", "BASE_ONLY": StatValue(text: Formatters.won(pay.amount ?? 0), emphasis: .value)
            case "PENDING": StatValue(text: "확인 필요", emphasis: .attention)
            default: StatValue(text: phase == "PRE_SERVICE" ? "소집 후" : "—", emphasis: .muted)
            }
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
                SGSectionHeader("일정", eyebrow: "AGENDA")
                if home.today.isEmpty && home.upcoming.isEmpty {
                    if home.completed {
                        SGEmptyState(symbol: "flag.checkered", title: "복무를 마쳤어요. 기록은 그대로 볼 수 있어요.")
                    } else {
                        SGEmptyState(symbol: "sunrise", title: "예정된 일정이 없어요",
                                     message: "휴가를 정했다면 미리 기록해 두세요.")
                    }
                } else {
                    let items = home.today + home.upcoming
                    ForEach(items) { item in
                        AgendaRow(item: item, display: projection.eventDisplay?[item.event.id])
                        if item.id != items.last?.id { Divider() }
                    }
                }
                Button(action: openRecords) {
                    HStack {
                        Text("캘린더 보기").font(SGTypography.bodyStrong)
                        Spacer()
                        Image(systemName: "chevron.right").font(.caption.weight(.semibold))
                            .accessibilityHidden(true)
                    }
                    .foregroundStyle(.sg(SGColor.accent))
                    .padding(.horizontal, SGSpacing.sm)
                    .frame(minHeight: SGSpacing.minimumHitTarget)
                    .background(.sg(SGColor.surfaceInteractive), in: RoundedRectangle(cornerRadius: SGRadius.control, style: .continuous))
                    .contentShape(Rectangle())
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
            SGDateTile(month: item.event.startDate.month, day: item.event.startDate.day, isToday: item.isToday)
            VStack(alignment: .leading, spacing: SGSpacing.xxxs) {
                HStack(spacing: SGSpacing.iconGap) {
                    if let display, let category = SGEventCategory(rawValue: display.category) {
                        SGCategoryMark(category, size: 9)
                    }
                    Text(display?.label ?? item.event.eventType)
                        .font(SGTypography.bodyStrong)
                        .foregroundStyle(.sg(SGColor.textPrimary))
                }
                Text(subtitle)
                    .font(SGTypography.caption)
                    .foregroundStyle(.sg(SGColor.textTertiary))
            }
            Spacer(minLength: SGSpacing.xs)
            if !item.isToday {
                Text("\(KoreanNumber.grouped(item.daysUntil))일 후")
                    .font(SGTypography.caption).monospacedDigit()
                    .foregroundStyle(.sg(SGColor.textTertiary))
            }
        }
        .frame(minHeight: SGSize.rowMinHeight)
        .accessibilityElement(children: .combine)
    }

    private var subtitle: String {
        let weekday = Formatters.weekdays[item.event.startDate.weekday]
        return ([weekday + "요일", display?.categoryLabel, display?.timing].compactMap { $0 }).joined(separator: " · ")
    }
}

// MARK: Quick actions

/// "빠른 실행" (web `home-tab.tsx` QuickActions). Hidden after discharge.
private struct QuickActions: View {
    let readOnly: Bool
    let recordLeave: () -> Void
    let openLedger: () -> Void
    let importRecords: () -> Void
    @Environment(\.dynamicTypeSize) private var typeSize

    private var layout: AnyLayout {
        typeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(spacing: SGSpacing.xs))
            : AnyLayout(HStackLayout(alignment: .top, spacing: SGSpacing.xs))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: SGSpacing.sm) {
            SGSectionHeader("빠른 실행", eyebrow: "COMMAND")
            layout {
                SGQuickAction("휴가·근태 기록", symbol: "calendar.badge.plus", action: recordLeave)
                    .disabled(readOnly)
                SGQuickAction("연가 내역", symbol: "list.clipboard", action: openLedger)
                SGQuickAction("기관 기록 가져오기", symbol: "square.and.arrow.down", action: importRecords)
                    .disabled(readOnly)
            }
        }
    }
}
