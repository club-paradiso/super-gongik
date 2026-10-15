import SGCore
import SGDesignSystem
import SGFoundation
import SwiftUI

/// 홈 (Stitch Civic Codex, direction B): app header, countdown, milestones,
/// leave, pay, agenda, two actions. Everything shown is the web home model
/// (`buildHomeModel`) and the shared milestone list for today; the optional
/// seconds readout uses the Swift-native live progress and ticks only while
/// this screen is visible. World labels follow the theme (Warrior only).
struct TodayView: View {
    @Environment(AppModel.self) private var model
    let openTab: (AppTab) -> Void
    @State private var editorDate: CivilDate?
    @State private var editorType: String?
    @State private var showingLedger: Bool
    @State private var milestones: [ServiceMilestoneItem] = []

    init(openTab: @escaping (AppTab) -> Void, showsLedgerInitially: Bool = false) {
        self.openTab = openTab
        _showingLedger = State(initialValue: showsLedgerInitially)
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                if let projection = model.projection, let home = projection.home, let profile = projection.profile {
                    // Order follows Stitch screen_matrix.md "Home hierarchy":
                    // phase → D-day → progress → discharge date → next
                    // milestone → leave → compensation → agenda → actions.
                    VStack(alignment: .leading, spacing: SGSpacing.md) {
                        AppHeader(hero: home.hero, openProfile: { openTab(.profile) })
                        CountdownCard(hero: home.hero, profile: profile)
                        if !home.completed,
                           let strip = MilestoneRoute(milestones, today: model.today) {
                            MilestoneStrip(model: strip)
                        }
                        if !home.completed {
                            LeaveCard(leave: home.leave,
                                      granted: projection.leaveText?.balance.granted,
                                      remainingFraction: Self.remainingFraction(projection.ledger)) { showingLedger = true }
                            PayCard(pay: home.pay, phase: home.hero.phase) { openTab(.pay) }
                        }
                        AgendaCard(home: home, projection: projection, openCalendar: { openTab(.calendar) })
                        if !home.completed {
                            QuickActions(
                                readOnly: model.isReadOnly,
                                addRecord: { editorType = nil; editorDate = model.today },
                                useLeave: { editorType = "ANNUAL_LEAVE"; editorDate = model.today })
                        }
                        if let error = model.lastWriteError {
                            SGNotice(.warning, title: error)
                        }
                    }
                    .padding(.horizontal, SGSpacing.gutter)
                    .padding(.bottom, SGSpacing.xl)
                    .frame(maxWidth: SGLayout.readableWidth)
                    .frame(maxWidth: .infinity)
                    .task(id: profile.period) {
                        await loadMilestones(profile.period)
                        #if DEBUG
                        // Screenshot hook: `-SGStartLiveActivity YES`.
                        if UserDefaults.standard.bool(forKey: "SGStartLiveActivity") {
                            _ = await DutyActivityController.start(profile: profile, hero: home.hero)
                        }
                        #endif
                    }
                } else {
                    SGLoadingState()
                }
            }
            .background(.sg(SGColor.background))
            .sgScreenChrome()
            // The app header replaces the navigation bar on 홈 (Stitch).
            .toolbar(.hidden, for: .navigationBar)
            .navigationTitle("홈")
            .navigationDestination(isPresented: $showingLedger) { LeaveView() }
            .sheet(item: $editorDate) { date in
                EventEditorSheet(event: nil, initialDate: date, initialType: editorType)
            }
        }
    }

    /// Share of the granted leave still left after scheduled use. Minutes
    /// count against the institution's workday (8 h when unknown); only the
    /// bar uses this, the numbers stay the core's strings.
    static func remainingFraction(_ ledger: LeaveLedger?) -> Double? {
        guard let ledger, ledger.balance.status == "RESOLVED",
              let granted = ledger.balance.granted, let left = ledger.balance.remainingAfterScheduled
        else { return nil }
        let day = Double(ledger.workdayMinutes ?? 480)
        let total = Double(granted.halfDays) / 2 + Double(granted.minutes) / day
        guard total > 0 else { return nil }
        return (Double(left.halfDays) / 2 + Double(left.minutes) / day) / total
    }

    private func loadMilestones(_ period: ServicePeriod) async {
        milestones = await model.serviceMilestones(period)
    }
}

extension AppModel {
    /// The shared milestone list of the period (packages/domain).
    func serviceMilestones(_ period: ServicePeriod) async -> [ServiceMilestoneItem] {
        let argument = JSONValue.object([
            "callUpDate": .string(period.callUpDate.description),
            "expectedDischargeDate": .string(period.expectedDischargeDate.description),
        ])
        return await pure("listServiceMilestones", [argument], as: [ServiceMilestoneItem].self) ?? []
    }
}

extension CivilDate: @retroactive Identifiable {
    public var id: Int { dayNumber }
}

/// One entry of the shared `listServiceMilestones` (packages/domain).
struct ServiceMilestoneItem: Decodable, Sendable, Equatable {
    let kind: String
    let date: CivilDate
    let value: Double
    let label: String
}

// MARK: Header

/// Brand mark, app name, service state and the D-day chip (Stitch header).
// MARK: Countdown

/// Stitch "COUNTDOWN PROTOCOL": the hero, compact. Every phase of the shared
/// home model (pre-service, in service, discharge day, completed) renders
/// here; only the layout changed.
private struct CountdownCard: View {
    let hero: HomeModel.Hero
    let profile: ServiceProfile
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.dynamicTypeSize) private var typeSize

    private var showsLive: Bool { hero.live && profile.liveProgressEnabled == true }
    private var celebrates: Bool { hero.phase == "DISCHARGE_DAY" || hero.phase == "COMPLETED" }

    private var topLayout: AnyLayout {
        typeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: SGSpacing.xxs))
            : AnyLayout(HStackLayout(alignment: .firstTextBaseline, spacing: SGSpacing.xs))
    }

    private var mainLayout: AnyLayout {
        typeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: SGSpacing.xs))
            : AnyLayout(HStackLayout(alignment: .lastTextBaseline))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: SGSpacing.sm) {
            // Stitch row 1: the gold protocol tag and the percent pill.
            HStack(spacing: SGSpacing.xs) {
                SGWorldTag(celebrates ? "FINAL QUEST" : "COUNTDOWN PROTOCOL",
                           tint: SGColor.heroAccent, fill: SGColor.heroTagFill)
                Spacer(minLength: SGSpacing.xs)
                if !showsLive {
                    HStack(spacing: 6) {
                        if celebrates {
                            Image(systemName: "flag.fill").font(.system(size: 9, weight: .bold))
                        } else {
                            Circle().frame(width: 6, height: 6)
                        }
                        Text(hero.percentLabel)
                            .font(SGTypography.latinLabel)
                            .monospacedDigit()
                            .lineLimit(1)
                            .fixedSize()
                    }
                    .foregroundStyle(.sg(SGColor.heroAccent))
                    .padding(.horizontal, 10)
                    .padding(.vertical, 4)
                    .background(Color.white.opacity(0.15), in: Capsule())
                    .accessibilityElement(children: .combine)
                }
            }

            topLayout {
                Text(hero.eyebrow)
                    .font(SGTypography.label)
                    .foregroundStyle(.sg(SGColor.heroForeground2))
                SGWorldEyebrow(celebrates ? "// RELEASED" : "// TIME TO DISCHARGE", tint: SGColor.heroForeground3)
            }

            mainLayout {
                HStack(alignment: .lastTextBaseline, spacing: SGSpacing.xxs) {
                    Text(hero.headline)
                        .font(SGTypography.stat(hero.headline, 40, .heavy, relativeTo: .largeTitle))
                        .monospacedDigit()
                        .tracking(-1.2)
                        .foregroundStyle(.sg(SGColor.heroForeground))
                        .minimumScaleFactor(0.6)
                        .lineLimit(1)
                        .accessibilityLabel(hero.headlineSpoken)
                    if hero.phase == "IN_SERVICE" {
                        Text("일 남음")
                            .font(SGTypography.label)
                            .foregroundStyle(.sg(SGColor.heroForeground2))
                            .accessibilityHidden(true)
                    }
                }
                if !typeSize.isAccessibilitySize { Spacer(minLength: SGSpacing.xs) }
                VStack(alignment: typeSize.isAccessibilitySize ? .leading : .trailing, spacing: SGSpacing.xxxs) {
                    SGWorldEyebrow("RELEASE TARGET", tint: SGColor.heroForeground3)
                    Text("소집해제 예정")
                        .font(SGTypography.caption)
                        .foregroundStyle(.sg(SGColor.heroForeground3))
                    Text(profile.expectedDischargeDate.description.replacingOccurrences(of: "-", with: "."))
                        .font(SGTypography.latin(.display, 18, .bold, relativeTo: .title3))
                        .monospacedDigit()
                        .foregroundStyle(.sg(SGColor.heroForeground))
                }
                .accessibilityElement(children: .combine)
            }

            if showsLive {
                LiveReadout(period: profile.period)
            }

            SGProgressBar(fraction: hero.percent / 100, style: .horizon)
                .animation(SGMotion.animation(SGMotion.slow, reduceMotion: reduceMotion), value: hero.percent)
                .accessibilityLabel("복무 진행률")
                .accessibilityValue("\(hero.percentLabel), \(KoreanNumber.grouped(hero.elapsedDays))일 지남, \(KoreanNumber.grouped(hero.remainingDays))일 남음")

            if let reached = hero.reachedToday {
                Label(reached, systemImage: celebrates ? "party.popper" : "sparkles")
                    .font(SGTypography.label)
                    .foregroundStyle(.sg(SGColor.heroAccent))
            }
        }
        .padding(SGSpacing.md)
        .background { SGHeroBackground(celebrate: celebrates) }
        .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous).strokeBorder(.sg(SGColor.heroBorder)))
        .overlay { SGHeroCrest() }
        .sgShadow(.hero)
        .environment(\.colorScheme, .dark)
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

// MARK: Milestones

/// Which milestones the 홈 strip shows: the last one passed, the next one
/// and the one after, on Stitch's route only (START → D-500 → 25% → D-300 →
/// 50% → D-100 → 75% → D-30 → 90% → D-7 → FINAL). Milestones outside the
/// term never appear because the shared list only holds dates inside it.
struct MilestoneRoute: Equatable {
    enum State { case passed, next, later }
    struct Entry: Equatable, Identifiable {
        let title: String
        let detail: String
        let state: State
        let date: CivilDate
        var id: Int { date.dayNumber * 10 + (state == .passed ? 0 : state == .next ? 1 : 2) }
    }
    let entries: [Entry]
    let daysToNext: Int

    static let route: Set<String> = [
        "CALL_UP", "DISCHARGE",
        "DAYS_REMAINING:500", "PERCENT:25", "DAYS_REMAINING:300", "PERCENT:50",
        "DAYS_REMAINING:100", "PERCENT:75", "DAYS_REMAINING:30", "PERCENT:90", "DAYS_REMAINING:7",
    ]

    init?(_ all: [ServiceMilestoneItem], today: CivilDate) {
        let route = all.filter { item in
            let key = item.kind == "CALL_UP" || item.kind == "DISCHARGE" ? item.kind : "\(item.kind):\(Int(item.value))"
            return Self.route.contains(key)
        }
        guard let nextIndex = route.firstIndex(where: { $0.date.dayNumber >= today.dayNumber }) else { return nil }
        var entries: [Entry] = []
        if nextIndex > 0 {
            let passed = route[nextIndex - 1]
            entries.append(Entry(title: Self.title(passed), detail: "지남", state: .passed, date: passed.date))
        }
        for (offset, item) in route[nextIndex...].prefix(entries.isEmpty ? 3 : 2).enumerated() {
            entries.append(Entry(title: Self.title(item), detail: Formatters.shortDate(item.date),
                                 state: offset == 0 ? .next : .later, date: item.date))
        }
        self.entries = entries
        daysToNext = route[nextIndex].date.dayNumber - today.dayNumber
    }

    static func title(_ item: ServiceMilestoneItem) -> String {
        switch item.kind {
        case "CALL_UP": "소집"
        case "DISCHARGE": "소집해제"
        case "PERCENT": "\(Int(item.value))%"
        default: "D-\(Int(item.value))"
        }
    }
}



/// Stitch "MILESTONES // 퀘스트 이정표": the last milestone passed, the next
/// one and the one after, from the shared milestone list. Only Stitch's
/// route is shown (START → D-500 → 25% → D-300 → 50% → D-100 → 75% → D-30
/// → 90% → D-7 → FINAL); milestones outside the term never appear because
/// the shared list only contains dates inside it.
private struct MilestoneStrip: View {
    let model: MilestoneRoute
    @Environment(\.dynamicTypeSize) private var typeSize

    private var rowLayout: AnyLayout {
        typeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(spacing: SGSpacing.xs))
            : AnyLayout(HStackLayout(spacing: SGSpacing.xs))
    }

    private var headerLayout: AnyLayout {
        typeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: SGSpacing.xxs))
            : AnyLayout(HStackLayout(spacing: SGSpacing.iconGap))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: SGSpacing.sm) {
            headerLayout {
                HStack(spacing: 4) {
                    SGWorldEyebrow("MILESTONES //", tint: SGColor.textSecondary)
                    Text("복무 이정표")
                        .font(SGTypography.micro)
                        .foregroundStyle(.sg(SGColor.textSecondary))
                }
                if !typeSize.isAccessibilitySize { Spacer(minLength: SGSpacing.xs) }
                Text("다음 이정표: \(relative(model.daysToNext))")
                    .font(SGTypography.micro)
                    .foregroundStyle(.sg(SGColor.accent))
            }
            .padding(.horizontal, 4)
            rowLayout {
                ForEach(model.entries) { entry in
                    // Stitch chip: glyph + title on the leading side, the
                    // state word (지남 / NEXT / date) on the trailing side.
                    HStack(spacing: 6) {
                        Group {
                            switch entry.state {
                            case .passed: StitchIcon("check_circle", size: 16, filled: true)
                            case .next: StitchIcon("flag", size: 16)
                            case .later: Image(systemName: "circle.dashed").font(.system(size: 13, weight: .semibold))
                            }
                        }
                        .foregroundStyle(.sg(entry.state == .later ? SGColor.textTertiary : SGColor.accent))
                        .accessibilityHidden(true)
                        Text(entry.title)
                            .font(SGTypography.stat(entry.title, 14, .bold, relativeTo: .subheadline))
                            .monospacedDigit()
                            .lineLimit(1)
                            .minimumScaleFactor(0.7)
                            .foregroundStyle(.sg(entry.state == .later ? SGColor.textSecondary : SGColor.textPrimary))
                            .layoutPriority(1)
                        Spacer(minLength: 2)
                        // Stitch: 완료/도달 on passed chips, NEXT on the next
                        // one. The dates stay in VoiceOver and in 캘린더.
                        switch entry.state {
                        case .passed:
                            Text(entry.detail)
                                .font(SGTypography.font(10, .bold, relativeTo: .caption2))
                                .lineLimit(1)
                                .fixedSize()
                                .foregroundStyle(.sg(SGColor.textSecondary))
                        case .next:
                            Text("NEXT")
                                .font(SGTypography.eyebrow)
                                .foregroundStyle(.sg(SGColor.accentSecondary))
                                .padding(.horizontal, 4)
                                .padding(.vertical, 2)
                                .background(.sg(SGColor.surfaceInteractive), in: RoundedRectangle(cornerRadius: 4, style: .continuous))
                                .fixedSize()
                                .accessibilityHidden(true)
                        case .later:
                            EmptyView()
                        }
                    }
                    .padding(SGSpacing.xs)
                    .frame(maxWidth: .infinity, minHeight: 44)
                    .background(.sg(entry.state == .next ? SGColor.selectedBackground : SGColor.surface),
                                in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                    .sgShadow(.small)
                    .accessibilityElement(children: .combine)
                    .accessibilityValue(entry.state == .next ? "다음 이정표, \(entry.detail)"
                                        : entry.state == .passed ? "지난 이정표" : entry.detail)
                }
            }
        }
        .padding(SGSpacing.sm)
        .background(.sg(SGColor.surfaceInteractive).opacity(0.6), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    private func relative(_ days: Int) -> String {
        switch days {
        case 0: "오늘"
        case 1: "내일"
        default: "\(KoreanNumber.grouped(days))일 후"
        }
    }
}

// MARK: Cards

/// Full-width card with an icon tile, a Korean title, an optional world
/// label and an optional state badge (Stitch leave, pay and agenda cards).
private struct CodexCard<Content: View>: View {
    let title: String
    let eyebrow: String
    /// Material Symbols name (`StitchIcon`).
    let symbol: String
    var badge: (SGTone, String)?
    var action: (() -> Void)?
    @ViewBuilder let content: Content

    var body: some View {
        if let action {
            Button(action: action) { card }
                .buttonStyle(.plain)
                .accessibilityHint("자세히 보기")
        } else {
            card
        }
    }

    private var card: some View {
        VStack(alignment: .leading, spacing: SGSpacing.xs) {
                HStack(spacing: 6) {
                    StitchIcon(symbol, size: 18)
                        .foregroundStyle(.sg(SGColor.accent))
                    Text(title)
                        .font(SGTypography.font(17, .bold, relativeTo: .headline))
                        .foregroundStyle(.sg(SGColor.textPrimary))
                    SGWorldEyebrow(eyebrow)
                    Spacer(minLength: SGSpacing.xs)
                    if let badge { SGStatusBadge(badge.0, badge.1) }
                    if action != nil {
                        Image(systemName: "chevron.right")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(.sg(SGColor.textTertiary))
                            .accessibilityHidden(true)
                    }
                }
                content
        }
        .padding(SGSpacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.sg(SGColor.surface), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .sgShadow(.small)
    }
}

/// Big value line. Attention adds a symbol so the state is never color only.
private struct BigValue: View {
    enum Emphasis { case value, muted, attention }
    let text: String
    var unit: String?
    let emphasis: Emphasis

    var body: some View {
        HStack(alignment: .lastTextBaseline, spacing: SGSpacing.xxs) {
            if emphasis == .attention {
                Image(systemName: SGTone.warning.symbol)
                    .font(SGTypography.title3)
                    .accessibilityHidden(true)
            }
            Text(text)
                .font(SGTypography.stat(text, 30, .heavy, relativeTo: .title))
                .monospacedDigit()
                .minimumScaleFactor(0.6)
                .lineLimit(1)
            if let unit {
                Text(unit).font(SGTypography.font(15, .medium, relativeTo: .subheadline))
                    .foregroundStyle(.sg(SGColor.textSecondary))
            }
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

private struct LeaveCard: View {
    let leave: HomeModel.Leave
    /// Granted leave and its share still left, from the core's ledger, for
    /// Stitch's "9.5 / 15일" line and bar. Nil until the grant is confirmed.
    let granted: String?
    let remainingFraction: Double?
    let action: () -> Void

    var body: some View {
        // Stitch shows 확정 once the balance is resolved; otherwise the value
        // line already says 확인 필요.
        CodexCard(title: "남은 연가", eyebrow: "LEAVE LEDGER", symbol: "event_available",
                  badge: leave.kind == "READY" ? (.info, "확정") : nil, action: action) {
            // Copy mirrors the web stat card (`home-tab.tsx` HomeStats).
            switch leave.kind {
            case "READY":
                HStack(alignment: .lastTextBaseline, spacing: SGSpacing.xxs) {
                    BigValue(text: leave.remaining ?? "–", emphasis: .value)
                    if let granted {
                        Text("/ \(granted)")
                            .font(SGTypography.font(15, .medium, relativeTo: .subheadline))
                            .foregroundStyle(.sg(SGColor.textSecondary))
                    }
                }
                if let remainingFraction {
                    GeometryReader { proxy in
                        ZStack(alignment: .leading) {
                            Capsule().fill(.sg(SGColor.surfaceInteractive))
                            Capsule().fill(.sg(SGColor.accent))
                                .frame(width: max(6, proxy.size.width * min(1, max(0, remainingFraction))))
                        }
                    }
                    .frame(height: 6)
                    .padding(.top, SGSpacing.xxxs)
                    .accessibilityHidden(true)
                }
            case "BEFORE_SERVICE": BigValue(text: "소집 후", emphasis: .muted)
            default: BigValue(text: "확인 필요", emphasis: .attention)
            }
            ForEach([leave.caption] + (leave.kind == "READY" ? [leave.attendance].compactMap { $0 } : []), id: \.self) {
                Text($0).font(SGTypography.caption).foregroundStyle(.sg(SGColor.textSecondary))
            }
        }
    }
}

private struct PayCard: View {
    let pay: HomeModel.Pay
    let phase: String
    let action: () -> Void

    /// The app never says "verified": it computes from the user's inputs.
    private var badge: (SGTone, String)? {
        switch pay.kind {
        case "TOTAL": (.success, "계산됨")
        case "BASE_ONLY": (.info, "기본 보수만")
        default: nil // PENDING: the value line says 확인 필요
        }
    }

    var body: some View {
        CodexCard(title: "이번 달 급여", eyebrow: "COMPENSATION", symbol: "payments", badge: badge, action: action) {
            switch pay.kind {
            case "TOTAL", "BASE_ONLY":
                BigValue(text: KoreanNumber.grouped(Int((pay.amount ?? 0).rounded())), unit: "원", emphasis: .value)
            case "PENDING": BigValue(text: "확인 필요", emphasis: .attention)
            default: BigValue(text: phase == "PRE_SERVICE" ? "소집 후" : "—", emphasis: .muted)
            }
            // The shared home model's caption already says when only base pay
            // is known ("기본 보수 · 식비·교통비는 확인 후 더해요").
            // Stitch: the components on one tinted line, "•"-separated.
            Text(pay.caption.replacingOccurrences(of: " + ", with: " • "))
                .font(SGTypography.font(12, .regular, relativeTo: .caption))
                .foregroundStyle(.sg(SGColor.textSecondary))
                .padding(.horizontal, 10)
                .padding(.vertical, 6)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(.sg(SGColor.surfaceInteractive).opacity(0.6), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            if let band = pay.band {
                Text(band).font(SGTypography.caption).foregroundStyle(.sg(SGColor.textTertiary))
            }
        }
    }
}

// MARK: Agenda

private struct AgendaCard: View {
    let home: HomeModel
    let projection: Projection
    let openCalendar: () -> Void

    var body: some View {
        CodexCard(title: "다가오는 일정", eyebrow: "AGENDA", symbol: "schedule") {
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
            Button(action: openCalendar) {
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

/// Stitch's two actions: 연가 내역 (secondary) and 휴가·근태 기록 (primary).
/// 기관 기록 가져오기 lives in 내 정보. Hidden after discharge.
/// Stitch: 근무기록 추가 (secondary) and 연가 사용 (primary). 연가 내역 stays
/// one tap away on the leave card and the 캘린더 menu.
private struct QuickActions: View {
    let readOnly: Bool
    let addRecord: () -> Void
    let useLeave: () -> Void
    @Environment(\.dynamicTypeSize) private var typeSize

    private var layout: AnyLayout {
        typeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(spacing: SGSpacing.xs))
            : AnyLayout(HStackLayout(spacing: SGSpacing.xs))
    }

    var body: some View {
        layout {
            Button(action: addRecord) {
                Label { Text("근무기록 추가") } icon: {
                    StitchIcon("edit_calendar", size: 18).foregroundStyle(.sg(SGColor.accent))
                }
            }
            .buttonStyle(SGSecondaryButtonStyle())
            .disabled(readOnly)
            Button(action: useLeave) {
                Label { Text("연가 사용") } icon: {
                    StitchIcon("flight_takeoff", size: 18).foregroundStyle(.sg(SGColor.heroAccent))
                }
            }
            .buttonStyle(NavyButtonStyle())
            .disabled(readOnly)
        }
    }
}

/// Stitch's primary action on 홈: the hero navy, not the accent.
private struct NavyButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(SGTypography.bodyStrong)
            .foregroundStyle(.white)
            .frame(maxWidth: .infinity, minHeight: SGSize.control)
            .padding(.horizontal, SGSpacing.sm)
            .background(.sg(SGColor.heroBackground), in: RoundedRectangle(cornerRadius: SGRadius.control, style: .continuous))
            .opacity(isEnabled ? (configuration.isPressed ? 0.85 : 1) : 0.45)
            .contentShape(Rectangle())
    }
}
