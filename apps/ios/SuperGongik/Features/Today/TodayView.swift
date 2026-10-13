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
                        AppHeader(hero: home.hero)
                        CountdownCard(hero: home.hero, profile: profile)
                        if !home.completed,
                           let strip = MilestoneRoute(milestones, today: model.today) {
                            MilestoneStrip(model: strip)
                        }
                        if !home.completed {
                            LeaveCard(leave: home.leave) { showingLedger = true }
                            PayCard(pay: home.pay, phase: home.hero.phase) { openTab(.pay) }
                        }
                        AgendaCard(home: home, projection: projection, openCalendar: { openTab(.calendar) })
                        if !home.completed {
                            QuickActions(
                                readOnly: model.isReadOnly,
                                recordLeave: { editorDate = model.today },
                                openLedger: { showingLedger = true })
                        }
                        if let error = model.lastWriteError {
                            SGNotice(.warning, title: error)
                        }
                    }
                    .padding(.horizontal, SGSpacing.gutter)
                    .padding(.bottom, SGSpacing.xl)
                    .frame(maxWidth: SGLayout.readableWidth)
                    .frame(maxWidth: .infinity)
                    .task(id: profile.period) { await loadMilestones(profile.period) }
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
                EventEditorSheet(event: nil, initialDate: date)
            }
        }
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
private struct AppHeader: View {
    let hero: HomeModel.Hero
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        HStack(spacing: SGSpacing.sm) {
            Image("BrandMark")
                .resizable()
                .frame(width: 40, height: 40)
                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: SGSpacing.xxxs) {
                Text("SUPER GONGIK")
                    .font(SGTypography.cardTitle)
                    .foregroundStyle(.sg(SGColor.textPrimary))
                    .lineLimit(1)
                    .minimumScaleFactor(0.5)
                HStack(spacing: SGSpacing.iconGap) {
                    Circle().fill(.sg(SGColor.success))
                        .frame(width: SGSize.statusDot, height: SGSize.statusDot)
                        .accessibilityHidden(true)
                    Text(hero.stateLabel)
                        .font(SGTypography.micro)
                        .foregroundStyle(.sg(SGColor.textSecondary))
                    SGWorldEyebrow("ACTIVE DUTY")
                }
            }
            Spacer(minLength: SGSpacing.xs)
            if !typeSize.isAccessibilitySize {
            Text(hero.headline)
                .font(SGTypography.label)
                .monospacedDigit()
                .lineLimit(1)
                .foregroundStyle(.sg(SGColor.textPrimary))
                .padding(.horizontal, SGSpacing.sm)
                .padding(.vertical, SGSpacing.xxs)
                .background(.sg(SGColor.surfaceRaised), in: Capsule())
                .overlay(Capsule().strokeBorder(.sg(SGColor.border)))
                .accessibilityHidden(true)
            }
        }
        .padding(.top, SGSpacing.xs)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
    }
}

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
            topLayout {
                SGWorldEyebrow(celebrates ? "FINAL QUEST" : "COUNTDOWN PROTOCOL", tint: SGColor.heroAccent)
                Text(hero.eyebrow)
                    .font(SGTypography.label)
                    .foregroundStyle(.sg(SGColor.heroForeground2))
                if !typeSize.isAccessibilitySize { Spacer(minLength: SGSpacing.xs) }
                if !showsLive {
                    Label(hero.percentLabel, systemImage: celebrates ? "flag.fill" : "circle.fill")
                        .labelStyle(.titleAndIcon)
                        .font(SGTypography.micro)
                        .monospacedDigit()
                        .lineLimit(1)
                        .fixedSize()
                        .foregroundStyle(.sg(SGColor.heroAccent))
                        .padding(.horizontal, SGSpacing.xs)
                        .padding(.vertical, SGSpacing.xxxs)
                        .background(.sg(SGColor.heroTrack), in: Capsule())
                }
            }

            mainLayout {
                HStack(alignment: .lastTextBaseline, spacing: SGSpacing.xxs) {
                    Text(hero.headline)
                        .font(SGTypography.font(44, .heavy, relativeTo: .largeTitle))
                        .monospacedDigit()
                        .tracking(-1)
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
                        .font(SGTypography.title3)
                        .monospacedDigit()
                        .foregroundStyle(.sg(SGColor.heroForeground))
                }
                .accessibilityElement(children: .combine)
            }

            if showsLive {
                LiveReadout(period: profile.period)
            }

            SGProgressBar(fraction: hero.percent / 100)
                .animation(SGMotion.animation(SGMotion.slow, reduceMotion: reduceMotion), value: hero.percent)
                .accessibilityLabel("복무 진행률")
                .accessibilityValue("\(hero.percentLabel), \(KoreanNumber.grouped(hero.elapsedDays))일 지남, \(KoreanNumber.grouped(hero.remainingDays))일 남음")

            if let reached = hero.reachedToday {
                Label(reached, systemImage: celebrates ? "party.popper" : "sparkles")
                    .font(SGTypography.label)
                    .foregroundStyle(.sg(SGColor.heroAccent))
            }
        }
        .padding(SGSpacing.lg)
        .background { SGHeroBackground(celebrate: celebrates) }
        .clipShape(RoundedRectangle(cornerRadius: SGRadius.hero, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: SGRadius.hero, style: .continuous).strokeBorder(.sg(SGColor.heroBorder)))
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
                SGWorldEyebrow("MILESTONES")
                Text("복무 이정표")
                    .font(SGTypography.label)
                    .foregroundStyle(.sg(SGColor.textSecondary))
                if !typeSize.isAccessibilitySize { Spacer(minLength: SGSpacing.xs) }
                Text("다음 이정표: \(relative(model.daysToNext))")
                    .font(SGTypography.micro)
                    .foregroundStyle(.sg(SGColor.accent))
            }
            rowLayout {
                ForEach(model.entries) { entry in
                    HStack(spacing: SGSpacing.xs) {
                        Image(systemName: symbol(entry.state))
                            .font(SGTypography.label)
                            .foregroundStyle(.sg(entry.state == .later ? SGColor.textTertiary : SGColor.accent))
                            .accessibilityHidden(true)
                        VStack(alignment: .leading, spacing: 0) {
                            Text(entry.title)
                                .font(SGTypography.bodyStrong)
                                .monospacedDigit()
                                .foregroundStyle(.sg(entry.state == .later ? SGColor.textSecondary : SGColor.textPrimary))
                            Text(entry.detail)
                                .font(SGTypography.micro)
                                .lineLimit(1)
                                .minimumScaleFactor(0.8)
                                .foregroundStyle(.sg(SGColor.textTertiary))
                        }
                        Spacer(minLength: 0)
                    }
                    .padding(SGSpacing.sm)
                    .frame(maxWidth: .infinity)
                    .background(.sg(entry.state == .next ? SGColor.selectedBackground : SGColor.surface),
                                in: RoundedRectangle(cornerRadius: SGRadius.control, style: .continuous))
                    .overlay {
                        if entry.state == .next {
                            RoundedRectangle(cornerRadius: SGRadius.control, style: .continuous)
                                .strokeBorder(.sg(SGColor.selectedBorder))
                        }
                    }
                    .accessibilityElement(children: .combine)
                    .accessibilityValue(entry.state == .next ? "다음 이정표" : entry.state == .passed ? "지난 이정표" : "")
                }
            }
        }
        .padding(SGSpacing.sm)
        .background(.sg(SGColor.surfaceRaised), in: RoundedRectangle(cornerRadius: SGRadius.card, style: .continuous))
    }

    private func symbol(_ state: MilestoneRoute.State) -> String {
        switch state {
        case .passed: "checkmark.circle"
        case .next: "flag"
        case .later: "circle.dashed"
        }
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
        SGCard {
            VStack(alignment: .leading, spacing: SGSpacing.sm) {
                HStack(spacing: SGSpacing.xs) {
                    SGIconTile(symbol)
                    Text(title)
                        .font(SGTypography.cardTitle)
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
        }
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
                .font(SGTypography.font(34, .heavy, relativeTo: .title))
                .monospacedDigit()
                .minimumScaleFactor(0.6)
                .lineLimit(1)
            if let unit {
                Text(unit).font(SGTypography.label).foregroundStyle(.sg(SGColor.textSecondary))
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
    let action: () -> Void

    var body: some View {
        // The value line already says 확인 필요 when it applies; no badge.
        CodexCard(title: "남은 연가", eyebrow: "LEAVE LEDGER", symbol: "list.clipboard", action: action) {
            // Copy mirrors the web stat card (`home-tab.tsx` HomeStats).
            switch leave.kind {
            case "READY": BigValue(text: leave.remaining ?? "–", emphasis: .value)
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
        CodexCard(title: "이번 달 급여", eyebrow: "COMPENSATION", symbol: "wonsign.circle", badge: badge, action: action) {
            switch pay.kind {
            case "TOTAL", "BASE_ONLY":
                BigValue(text: KoreanNumber.grouped(Int((pay.amount ?? 0).rounded())), unit: "원", emphasis: .value)
            case "PENDING": BigValue(text: "확인 필요", emphasis: .attention)
            default: BigValue(text: phase == "PRE_SERVICE" ? "소집 후" : "—", emphasis: .muted)
            }
            // The shared home model's caption already says when only base pay
            // is known ("기본 보수 · 식비·교통비는 확인 후 더해요").
            Text(pay.caption)
                .font(SGTypography.caption)
                .foregroundStyle(.sg(SGColor.textSecondary))
                .padding(SGSpacing.xs)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(.sg(SGColor.surfaceRaised), in: RoundedRectangle(cornerRadius: SGRadius.control, style: .continuous))
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
        CodexCard(title: "다가오는 일정", eyebrow: "AGENDA", symbol: "calendar") {
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
private struct QuickActions: View {
    let readOnly: Bool
    let recordLeave: () -> Void
    let openLedger: () -> Void
    @Environment(\.dynamicTypeSize) private var typeSize

    private var layout: AnyLayout {
        typeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(spacing: SGSpacing.xs))
            : AnyLayout(HStackLayout(spacing: SGSpacing.xs))
    }

    var body: some View {
        layout {
            Button(action: openLedger) {
                Label("연가 내역", systemImage: "list.clipboard")
            }
            .buttonStyle(SGSecondaryButtonStyle())
            Button(action: recordLeave) {
                Label("휴가·근태 기록", systemImage: "calendar.badge.plus")
            }
            .buttonStyle(SGPrimaryButtonStyle())
            .disabled(readOnly)
        }
    }
}
