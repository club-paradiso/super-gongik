import SGCore
import SGDesignSystem
import SGFoundation
import SwiftUI

/// 홈 (Stitch Civic Codex, `super_gongik_master_synthesis`): the app header,
/// a full-bleed night-sky hero with the brand artwork, the D-day, live
/// progress and the journey trail, a launchpad of three actions overlapping
/// the hero, the 2 × 2 복무 현황 ledger, the agenda and a journey note.
/// Everything shown is the web home model (`buildHomeModel`) and the shared
/// milestone list for today; the optional seconds readout uses the
/// Swift-native live progress and ticks only while this screen is visible.
/// Stitch's chapters, levels, sick-leave balance, institution and payday are
/// not drawn: the core has no data for them (STITCH-IMPLEMENTATION-PLAN).
struct TodayView: View {
    @Environment(AppModel.self) private var model
    let openTab: (AppTab) -> Void
    @State private var editorDate: CivilDate?
    @State private var editorType: String?
    @State private var editorPatch: [String: JSONValue] = [:]
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
                    // milestone → leave → compensation → agenda → actions;
                    // master synthesis lifts the actions under the hero.
                    VStack(alignment: .leading, spacing: 0) {
                        AppHeader(hero: home.hero, openProfile: { openTab(.profile) })
                            .padding(.horizontal, SGSpacing.gutter)
                            .padding(.bottom, SGSpacing.xs)
                        JourneyHero(hero: home.hero, profile: profile,
                                    trail: JourneyTrail(milestones, hero: home.hero, today: model.today))
                        VStack(alignment: .leading, spacing: SGSpacing.lg) {
                            if !home.completed {
                                QuickRecordTray(
                                    readOnly: model.isReadOnly,
                                    records: QuickRecord.all(workdayStart: profile.workdayStartTime,
                                                             workdayEnd: profile.workdayEndTime),
                                    open: { record in
                                        editorType = record?.type
                                        editorPatch = record?.patch ?? [:]
                                        editorDate = model.today
                                    })
                                    .padding(.top, -SGSpacing.sm)
                            }
                            // What is happening today or next comes before the
                            // status ledger: after the actions, the agenda is the
                            // first thing a day-to-day visit needs (IOS-06).
                            AgendaSection(home: home, projection: projection, openCalendar: { openTab(.calendar) })
                                .padding(.top, home.completed ? SGSpacing.md : 0)
                            if !home.completed {
                                LedgerGrid(home: home, projection: projection,
                                           openLedger: { showingLedger = true },
                                           openPay: { openTab(.pay) },
                                           openCalendar: { openTab(.calendar) })
                                if let workdays = home.workdays, workdays.kind != "HIDDEN" {
                                    WorkdaySection(workdays: workdays)
                                }
                            }
                            if home.hero.phase == "IN_SERVICE" {
                                JourneyNote(hero: home.hero)
                            }
                            if let error = model.lastWriteError {
                                SGNotice(.warning, title: error)
                            }
                        }
                        .padding(.horizontal, SGSpacing.gutter)
                        .padding(.bottom, SGSpacing.xl)
                    }
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
                EventEditorSheet(event: nil, initialDate: date, initialType: editorType, initialPatch: editorPatch)
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

// MARK: Hero

/// Stitch master synthesis hero: a full-bleed night sky with the app's own
/// artwork (the agent facing the S-dragon, `CardArt`) screened in at 40 %,
/// rounded only at the bottom. Every phase of the shared home model
/// (pre-service, in service, discharge day, completed) renders here.
private struct JourneyHero: View {
    let hero: HomeModel.Hero
    let profile: ServiceProfile
    let trail: JourneyTrail?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.dynamicTypeSize) private var typeSize
    @Environment(\.sgTheme) private var theme

    private var showsLive: Bool { hero.live && profile.liveProgressEnabled == true }
    private var celebrates: Bool { hero.phase == "DISCHARGE_DAY" || hero.phase == "COMPLETED" }
    private static let shape = UnevenRoundedRectangle(bottomLeadingRadius: 32, bottomTrailingRadius: 32, style: .continuous)

    private var worldTag: String {
        switch hero.phase {
        case "PRE_SERVICE": "PROLOGUE"
        case "DISCHARGE_DAY", "COMPLETED": "FINAL QUEST"
        default: "COUNTDOWN PROTOCOL"
        }
    }

    private var worldTitle: String {
        switch hero.phase {
        case "PRE_SERVICE": "DAYS TO CALL-UP"
        case "DISCHARGE_DAY", "COMPLETED": "QUEST COMPLETE"
        default: "REMAINING DUTY DAYS"
        }
    }

    var body: some View {
        VStack(spacing: SGSpacing.md) {
            topRow
            VStack(spacing: SGSpacing.xs) {
                SGWorldEyebrow(worldTitle, tint: SGColor.heroAccent)
                Text(hero.eyebrow)
                    .font(SGTypography.label)
                    .foregroundStyle(.sg(SGColor.heroForeground2))
                Text(hero.headline)
                    .font(SGTypography.stat(hero.headline, theme == .warrior ? 70 : 64, .heavy, relativeTo: .largeTitle))
                    .monospacedDigit()
                    .tracking(-1.5)
                    // Warrior: Stitch's ivory → gold → amber D-day with a
                    // wider glow and a sweep of light; standard: flat gold.
                    .foregroundStyle(theme == .warrior
                        ? AnyShapeStyle(LinearGradient(colors: [SGGlow.ivory, SGGlow.gold, SGGlow.amber],
                                                       startPoint: .top, endPoint: .bottom))
                        : AnyShapeStyle(.sg(SGColor.heroAccent)))
                    .sgShimmer(period: 4.5)
                    .shadow(color: SGGlow.gold.opacity(theme == .warrior ? 0.55 : 0.35),
                            radius: theme == .warrior ? 22 : 12, y: 4)
                    .minimumScaleFactor(0.5)
                    .lineLimit(1)
                    .accessibilityLabel(hero.headlineSpoken)
                if showsLive {
                    LiveReadout(period: profile.period, dot: celebrates ? SGGlow.gold : SGGlow.emerald)
                } else {
                    progressPill
                }
                VStack(spacing: SGSpacing.xxxs) {
                    (Text("소집해제일 ") + Text(Formatters.dottedDateWithWeekday(profile.expectedDischargeDate))
                        .foregroundStyle(.sg(SGColor.heroAccent)).fontWeight(.semibold))
                        .font(SGTypography.body)
                        .foregroundStyle(.sg(SGColor.heroForeground2))
                    Text(summaryLine)
                        .font(SGTypography.caption)
                        .foregroundStyle(.sg(SGColor.heroForeground3))
                        .monospacedDigit()
                }
                .multilineTextAlignment(.center)
                .padding(.top, SGSpacing.xxs)
                .accessibilityElement(children: .combine)
            }
            .frame(maxWidth: .infinity)

            if let trail {
                TrailPanel(trail: trail)
            } else {
                SGProgressBar(fraction: hero.percent / 100, style: .horizon)
                    .animation(SGMotion.animation(SGMotion.slow, reduceMotion: reduceMotion), value: hero.percent)
                    .accessibilityLabel("복무 진행률")
                    .accessibilityValue(hero.percentLabel)
            }

            if let reached = hero.reachedToday {
                Label(reached, systemImage: celebrates ? "party.popper" : "sparkles")
                    .font(SGTypography.label)
                    .foregroundStyle(.sg(SGColor.heroAccent))
            }
        }
        .padding(.horizontal, SGSpacing.gutter)
        .padding(.top, SGSpacing.md)
        .padding(.bottom, SGSpacing.xl + SGSpacing.xs)
        .frame(maxWidth: .infinity)
        .background { HeroSky(celebrate: celebrates) }
        .clipShape(Self.shape)
        .overlay { SGHeroCrest(cornerRadius: 32).clipShape(Self.shape) }
        .sgShadow(.hero)
        .environment(\.colorScheme, .dark)
    }

    /// Stitch: the chapter pill on the leading side, the service state on the
    /// trailing side. The pill carries the phase's world tag, not an invented
    /// chapter name.
    private var topRow: some View {
        HStack(spacing: SGSpacing.xs) {
            HStack(spacing: 6) {
                SGPulseDot(SGGlow.gold)
                SGWorldEyebrow(worldTag, tint: SGColor.heroAccent)
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 5)
            .background(Color.white.opacity(0.14), in: Capsule())
            .overlay {
                if theme == .warrior { Capsule().strokeBorder(SGGlow.gold.opacity(0.45)) }
            }
            .accessibilityHidden(true)
            Spacer(minLength: SGSpacing.xs)
            HStack(spacing: 5) {
                StitchIcon("verified_user", size: 14)
                    .foregroundStyle(.sg(SGColor.heroAccent))
                Text(hero.stateLabel)
                    .font(SGTypography.micro)
                    .foregroundStyle(.sg(SGColor.heroForeground))
                    .lineLimit(1)
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 5)
            .background(.sg(SGColor.heroBackground).opacity(0.55), in: Capsule())
            .overlay {
                if theme == .warrior { Capsule().strokeBorder(SGGlow.gold.opacity(0.3)) }
            }
        }
    }

    /// Today's percent on a dark pill. With the per-second readout on,
    /// `LiveReadout` replaces this pill, so the percent never shows twice.
    private var progressPill: some View {
        HStack(spacing: SGSpacing.xs) {
            SGPulseDot(celebrates ? SGGlow.gold : SGGlow.emerald)
            Text(hero.percentLabel)
                .font(SGTypography.latin(.display, 15, .bold, relativeTo: .subheadline))
                .monospacedDigit()
                .foregroundStyle(.sg(SGColor.heroForeground))
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 5)
        .background(.sg(SGColor.heroBackground).opacity(0.7), in: Capsule())
        .overlay {
            if theme == .warrior { Capsule().strokeBorder(SGGlow.emerald.opacity(0.35)) }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("복무 진행률")
        .accessibilityValue(hero.percentLabel)
    }

    /// "총 640일 중 334일 복무 완료 (남은 복무 306일)" from the core's
    /// counts. Other phases use the core's own date line.
    private var summaryLine: String {
        guard hero.phase == "IN_SERVICE" else { return hero.dateLine }
        let total = KoreanNumber.grouped(hero.totalServiceDays)
        let done = KoreanNumber.grouped(hero.elapsedDays)
        let left = KoreanNumber.grouped(hero.remainingDays)
        return "총 \(total)일 중 \(done)일 복무 (남은 복무 \(left)일)"
    }
}

/// The hero sky: the theme's gradient, the brand artwork screened in, and a
/// scrim that darkens toward the bottom so text and the trail stay readable.
/// Warrior (Stitch `epic_duty_hero`) shows the artwork at near full
/// strength with a slow drift and twinkling stars; standard keeps it a quiet
/// 42 % backdrop.
private struct HeroSky: View {
    let celebrate: Bool
    @Environment(\.sgTheme) private var theme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var drift = false

    var body: some View {
        let warrior = theme == .warrior
        ZStack {
            SGHeroBackground(celebrate: celebrate)
            GeometryReader { proxy in
                Image("CardArt")
                    .resizable()
                    .scaledToFill()
                    .frame(width: proxy.size.width, height: proxy.size.height, alignment: .top)
                    .scaleEffect(warrior && drift ? 1.14 : 1.05, anchor: .topTrailing)
                    .offset(x: warrior && drift ? -10 : 0)
                    .clipped()
                    .opacity(warrior ? 0.78 : 0.42)
                    .blendMode(warrior ? .normal : .screen)
            }
            LinearGradient(
                stops: [
                    .init(color: RGB(0x0C1446).color.opacity(warrior ? 0.15 : 0), location: 0),
                    .init(color: RGB(0x0C1446).color.opacity(warrior ? 0.45 : 0.55), location: 0.42),
                    .init(color: RGB(0x0C1446).color.opacity(warrior ? 0.9 : 0.92), location: 1),
                ],
                startPoint: .top, endPoint: .bottom)
            if warrior {
                // A warm horizon behind the D-day, as in the epic hero.
                RadialGradient(colors: [SGGlow.gold.opacity(0.28), .clear],
                               center: UnitPoint(x: 0.5, y: 0.34), startRadius: 0, endRadius: 190)
                // Above the artwork, which hides the background's own stars.
                SGStarfield()
            }
        }
        .onAppear {
            guard warrior, !reduceMotion else { return }
            withAnimation(.easeInOut(duration: 18).repeatForever(autoreverses: true)) { drift = true }
        }
        .accessibilityHidden(true)
    }
}

// MARK: Journey trail

/// The hero's milestone stepper (Stitch "JOURNEY TRAIL"): 소집, up to two
/// milestones passed, today, the next milestone and 소집해제, on Stitch's
/// route only. Dates come from the shared milestone list, so milestones
/// outside the term never appear.
struct JourneyTrail: Equatable {
    enum State { case passed, current, upcoming }
    struct Node: Equatable, Identifiable {
        let title: String
        let state: State
        let kind: String
        var id: String { "\(kind)-\(title)" }
    }
    let nodes: [Node]
    /// Where today sits on the track, 0…1 (the index of the current node).
    let fill: Double
    /// "50% · 19일 후" for the trailing label; nil once nothing is ahead.
    let next: String?

    init?(_ all: [ServiceMilestoneItem], hero: HomeModel.Hero, today: CivilDate) {
        guard hero.phase == "IN_SERVICE" else { return nil }
        let route = all.filter { item in
            let key = item.kind == "CALL_UP" || item.kind == "DISCHARGE" ? item.kind : "\(item.kind):\(Int(item.value))"
            return MilestoneRoute.route.contains(key)
        }
        guard let start = route.first(where: { $0.kind == "CALL_UP" }),
              let end = route.last(where: { $0.kind == "DISCHARGE" }) else { return nil }
        let middle = route.filter { $0.kind != "CALL_UP" && $0.kind != "DISCHARGE" }
        let passed = middle.filter { $0.date.dayNumber < today.dayNumber }.suffix(2)
        let ahead = middle.first { $0.date.dayNumber >= today.dayNumber }

        var nodes = [Node(title: "소집 \(Self.yearMonth(start.date))", state: .passed, kind: start.kind)]
        nodes += passed.map { Node(title: MilestoneRoute.title($0), state: .passed, kind: $0.kind) }
        let currentIndex = nodes.count
        nodes.append(Node(title: "현재 \(hero.headline)", state: .current, kind: "TODAY"))
        if let ahead { nodes.append(Node(title: MilestoneRoute.title(ahead), state: .upcoming, kind: ahead.kind)) }
        nodes.append(Node(title: "소집해제", state: .upcoming, kind: end.kind))
        self.nodes = nodes
        fill = Double(currentIndex) / Double(nodes.count - 1)

        let target = ahead ?? end
        let days = target.date.dayNumber - today.dayNumber
        let title = ahead.map(MilestoneRoute.title) ?? "소집해제"
        next = days == 0 ? "\(title) · 오늘" : "\(title) · \(KoreanNumber.grouped(days))일 후"
    }

    /// "'24.04" as in Stitch's "소집 '24.04".
    static func yearMonth(_ date: CivilDate) -> String {
        String(format: "'%02d.%02d", date.year % 100, date.month)
    }
}

private struct TrailPanel: View {
    let trail: JourneyTrail
    @Environment(\.dynamicTypeSize) private var typeSize
    @Environment(\.sgTheme) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: SGSpacing.sm) {
            heading
            if typeSize.isAccessibilitySize {
                // Large text: a list reads better than a squeezed track.
                nodeList
            } else {
                track
            }
        }
        .padding(SGSpacing.sm)
        .background(Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous)
            .strokeBorder(theme == .warrior ? SGGlow.gold.opacity(0.35) : Color.white.opacity(0.08)))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("복무 이정표")
        .accessibilityHint(trail.next.map { "다음 \($0)" } ?? "")
        .accessibilityValue(trail.nodes.map { node in
            switch node.state {
            case .passed: "\(node.title) 지남"
            case .current: node.title
            case .upcoming: "\(node.title) 예정"
            }
        }.joined(separator: ", "))
    }

    /// "다음 50% · 19일 후" is the panel's one number worth reading: it never
    /// truncates. At large sizes it takes its own line, and the decorative
    /// JOURNEY TRAIL eyebrow is dropped before anything else is squeezed (it
    /// read as "다음 D-50…" at accessibility sizes).
    @ViewBuilder
    private var heading: some View {
        if typeSize.isAccessibilitySize {
            VStack(alignment: .leading, spacing: SGSpacing.xxs) {
                Text("복무 이정표")
                    .font(SGTypography.micro)
                    .foregroundStyle(.sg(SGColor.heroForeground2))
                if let next = trail.next { nextLabel(next) }
            }
        } else {
            ViewThatFits(in: .horizontal) {
                header(eyebrow: true)
                header(eyebrow: false)
            }
        }
    }

    private var nodeList: some View {
        VStack(alignment: .leading, spacing: SGSpacing.xxs) {
            ForEach(trail.nodes) { node in
                Label(node.title, systemImage: nodeSymbol(node))
                    .font(SGTypography.caption)
                    .foregroundStyle(.sg(node.state == .upcoming ? SGColor.heroForeground3 : SGColor.heroForeground))
            }
        }
    }

    private func nodeSymbol(_ node: JourneyTrail.Node) -> String {
        switch node.state {
        case .passed: "checkmark.circle.fill"
        case .current: "location.circle.fill"
        case .upcoming: "circle"
        }
    }

    private func header(eyebrow: Bool) -> some View {
        HStack(spacing: SGSpacing.xs) {
            if eyebrow { SGWorldEyebrow("JOURNEY TRAIL", tint: SGColor.heroForeground3) }
            Text("복무 이정표")
                .font(SGTypography.micro)
                .foregroundStyle(.sg(SGColor.heroForeground2))
                .fixedSize()
            Spacer(minLength: SGSpacing.xs)
            if let next = trail.next { nextLabel(next).fixedSize() }
        }
    }

    private func nextLabel(_ next: String) -> some View {
        Text("다음 \(next)")
            .font(SGTypography.micro)
            .foregroundStyle(.sg(SGColor.heroAccent))
            .fixedSize(horizontal: false, vertical: true)
    }

    private var track: some View {
        ZStack(alignment: .top) {
            GeometryReader { proxy in
                let inset: CGFloat = 14
                let width = proxy.size.width - inset * 2
                ZStack(alignment: .leading) {
                    Capsule().fill(Color.white.opacity(0.18)).frame(width: width, height: 4)
                    Capsule()
                        .fill(LinearGradient(colors: [RGB(0x8D86F2).color, RGB(0xFDCF7C).color],
                                             startPoint: .leading, endPoint: .trailing))
                        .frame(width: max(4, width * trail.fill), height: 4)
                        .sgShimmer()
                        .shadow(color: SGGlow.gold.opacity(theme == .warrior ? 0.6 : 0), radius: 4)
                }
                .offset(x: inset, y: 14 - 2)
            }
            .frame(height: 28)
            HStack(alignment: .top, spacing: 0) {
                ForEach(Array(trail.nodes.enumerated()), id: \.element.id) { index, node in
                    VStack(spacing: 6) {
                        dot(node)
                            .frame(height: 28)
                        Text(node.title)
                            .font(SGTypography.font(10, node.state == .current ? .bold : .medium, relativeTo: .caption2))
                            .monospacedDigit()
                            .foregroundStyle(.sg(node.state == .current ? SGColor.heroAccent
                                                 : node.state == .passed ? SGColor.heroForeground2 : SGColor.heroForeground3))
                            .lineLimit(1)
                            .minimumScaleFactor(0.7)
                            // Six labels share one row; past xLarge the
                            // labels would truncate, so they stop growing
                            // (the panel's accessibility value has them all).
                            .dynamicTypeSize(...DynamicTypeSize.xLarge)
                    }
                    .frame(maxWidth: .infinity)
                    .opacity(node.state == .upcoming ? 0.75 : 1)
                    if index < trail.nodes.count - 1 { Spacer(minLength: 0) }
                }
            }
        }
    }

    @ViewBuilder
    private func dot(_ node: JourneyTrail.Node) -> some View {
        switch node.state {
        case .passed:
            Image(systemName: node.kind == "CALL_UP" ? "flag.fill" : "checkmark")
                .font(.system(size: 10, weight: .bold))
                .foregroundStyle(.white)
                .frame(width: 24, height: 24)
                .background(RGB(0x5952AD).color, in: Circle())
        case .current:
            StitchIcon("shield", size: 16, filled: true)
                .foregroundStyle(.sg(SGColor.heroBackground))
                .frame(width: 28, height: 28)
                .background(.sg(SGColor.heroAccent), in: Circle())
                .shadow(color: SGGlow.gold.opacity(0.6), radius: 8)
                .sgBreathingGlow(radius: 10)
                .overlay {
                    if theme == .warrior {
                        Circle().strokeBorder(SGGlow.ivory.opacity(0.8), lineWidth: 1.5).padding(-4)
                    }
                }
        case .upcoming:
            Group {
                if node.kind == "DISCHARGE" {
                    StitchIcon("military_tech", size: 12)
                        .foregroundStyle(.sg(SGColor.heroForeground3))
                } else {
                    Circle().fill(.sg(SGColor.heroForeground3)).frame(width: 6, height: 6)
                }
            }
            .frame(width: 20, height: 20)
            .background(Color.white.opacity(0.22), in: Circle())
        }
    }
}

/// Second-level progress. `TimelineView` only produces entries while the
/// view is on screen and the app is active, so nothing ticks in the
/// background. With Reduce Motion the value still updates every second
/// (accuracy matters); only interpolation is off, as on the web.
private struct LiveReadout: View {
    let period: ServicePeriod
    let dot: Color

    var body: some View {
        TimelineView(.periodic(from: .now, by: 1)) { context in
            let live = LiveServiceProgress.calculate(period, now: context.date)
            let percent = live.formattedPercentage()
            VStack(spacing: 2) {
                // Pulse dot + ticking percent; the countdown sits under it.
                // Full-strength digits on the same dark glass as the pill.
                HStack(spacing: SGSpacing.xs) {
                    SGPulseDot(dot)
                    Text(percent)
                        .font(SGTypography.heroMetric)
                        .foregroundStyle(.sg(SGColor.heroAccent))
                }
                Text(live.formattedCountdown)
                    .font(SGTypography.heroDetail)
                    .foregroundStyle(.sg(SGColor.heroForeground))
            }
            .padding(.horizontal, SGSpacing.md)
            .padding(.vertical, SGSpacing.xs)
            .background(.sg(SGColor.heroBackground).opacity(0.7), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .strokeBorder(Color.white.opacity(0.2))
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

/// Which milestones a strip shows: the last one passed, the next one and the
/// one after, on Stitch's route only (START → D-500 → 25% → D-300 → 50% →
/// D-100 → 75% → D-30 → 90% → D-7 → FINAL). Milestones outside the term
/// never appear because the shared list only holds dates inside it. 캘린더
/// uses the next entry for its 다음 이정표 count.
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

// MARK: Quick record

/// 홈 빠른 기록: the records a 사회복무요원 actually files, one tap each,
/// already set to today and to the right unit. The editor still opens so
/// the date, half or times can be checked before saving; nothing is saved
/// from here. Times come from the confirmed workday (내 정보 › 근무 시각)
/// and stay empty when it is unknown — the app does not guess them.
struct QuickRecord: Identifiable, Equatable {
    let id: String
    let title: String
    let hint: String
    let category: SGEventCategory
    let type: String
    let patch: [String: JSONValue]

    static func all(workdayStart: String?, workdayEnd: String?) -> [QuickRecord] {
        var late: [String: JSONValue] = ["mode": .string("PARTIAL")]
        if let workdayStart { late["startTime"] = .string(workdayStart) }
        var early: [String: JSONValue] = ["mode": .string("PARTIAL")]
        if let workdayEnd { early["endTime"] = .string(workdayEnd) }
        return [
            QuickRecord(id: "annual", title: "연가", hint: "종일", category: .leave,
                        type: "ANNUAL_LEAVE", patch: [:]),
            QuickRecord(id: "half", title: "반가", hint: "오전·오후", category: .leave,
                        type: "ANNUAL_LEAVE", patch: ["mode": .string("HALF_DAY")]),
            QuickRecord(id: "sick", title: "병가", hint: "종일", category: .sick,
                        type: "SICK_LEAVE", patch: [:]),
            QuickRecord(id: "late", title: "지각", hint: "허가지각", category: .attendance,
                        type: "LATE_ARRIVAL", patch: late),
            QuickRecord(id: "early", title: "조퇴", hint: "허가조퇴", category: .attendance,
                        type: "EARLY_LEAVE", patch: early),
            QuickRecord(id: "outing", title: "외출", hint: "허가외출", category: .attendance,
                        type: "OUTING", patch: ["mode": .string("PARTIAL")]),
        ]
    }

    static func == (lhs: QuickRecord, rhs: QuickRecord) -> Bool { lhs.id == rhs.id }
}

/// The white tray under the hero: six one-tap records and "다른 기록".
/// Replaces the earlier 연가 사용 / 급여 명세 / 근무기록 추가 row: 급여 stays
/// one tap away in the tab bar and the 이번 달 급여 tile.
private struct QuickRecordTray: View {
    let readOnly: Bool
    let records: [QuickRecord]
    let open: (QuickRecord?) -> Void
    @Environment(\.dynamicTypeSize) private var typeSize

    private var columns: [GridItem] {
        Array(repeating: GridItem(.flexible(), spacing: SGSpacing.xs),
              count: typeSize.isAccessibilitySize ? 2 : 3)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: SGSpacing.xs) {
            HStack(alignment: .firstTextBaseline) {
                Text("오늘 기록하기")
                    .font(SGTypography.label)
                    .foregroundStyle(.sg(SGColor.textPrimary))
                    .accessibilityAddTraits(.isHeader)
                Spacer(minLength: SGSpacing.xs)
                Button { open(nil) } label: {
                    HStack(spacing: 4) {
                        Text("다른 기록")
                        StitchIcon("edit_calendar", size: 14)
                    }
                    .font(SGTypography.caption)
                    .foregroundStyle(.sg(SGColor.accent))
                    .frame(minHeight: 44)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .disabled(readOnly)
                .accessibilityLabel("다른 기록 추가")
            }
            LazyVGrid(columns: columns, spacing: SGSpacing.xs) {
                ForEach(records) { record in
                    Button { open(record) } label: { QuickRecordLabel(record: record) }
                        .buttonStyle(QuickRecordButtonStyle(category: record.category))
                        .disabled(readOnly)
                        .accessibilityLabel("\(record.title) 기록")
                        .accessibilityHint("오늘 날짜로 \(record.title) 기록 화면을 열어요")
                }
            }
        }
        .padding(.horizontal, SGSpacing.sm)
        .padding(.top, SGSpacing.xxs)
        .padding(.bottom, SGSpacing.sm)
        .background(.sg(SGColor.surface), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .sgShadow(.card)
        .sgWarriorFrame(cornerRadius: 18, emphasis: 1.2)
    }
}

private struct QuickRecordLabel: View {
    let record: QuickRecord

    var body: some View {
        VStack(spacing: 2) {
            HStack(spacing: 5) {
                SGCategoryMark(record.category, size: 7)
                Text(record.title)
                    .font(SGTypography.bodyStrong)
                    .lineLimit(1)
            }
            Text(record.hint)
                .font(SGTypography.font(11, .medium, relativeTo: .caption2))
                .opacity(0.8)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
        }
        .frame(maxWidth: .infinity, minHeight: 52)
    }
}

private struct QuickRecordButtonStyle: ButtonStyle {
    let category: SGEventCategory
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .foregroundStyle(.sg(category.chipForeground))
            .background(.sg(category.chipBackground), in: RoundedRectangle(cornerRadius: 13, style: .continuous))
            .opacity(isEnabled ? (configuration.isPressed ? 0.8 : 1) : 0.45)
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
            .contentShape(Rectangle())
    }
}

// MARK: Ledger

/// Stitch section header: a short accent bar, the Korean title, a world tag
/// and an optional trailing control. Drawn in both themes.
private struct CodexSectionHeader<Trailing: View>: View {
    let title: String
    let world: String
    @ViewBuilder var trailing: Trailing
    @Environment(\.sgTheme) private var theme

    var body: some View {
        HStack(spacing: 6) {
            Capsule()
                .fill(theme == .warrior
                      ? AnyShapeStyle(LinearGradient(colors: [SGGlow.gold, SGGlow.amber], startPoint: .top, endPoint: .bottom))
                      : AnyShapeStyle(.sg(SGColor.accent)))
                .frame(width: 4, height: 15)
                .shadow(color: SGGlow.gold.opacity(theme == .warrior ? 0.7 : 0), radius: 4)
                .accessibilityHidden(true)
            Text(title)
                .font(SGTypography.title3)
                .foregroundStyle(.sg(SGColor.textPrimary))
                .accessibilityAddTraits(.isHeader)
                .layoutPriority(1)
            SGWorldTag(world)
            Spacer(minLength: SGSpacing.xs)
            trailing
        }
    }
}

/// Stitch "복무 현황 원장": four tiles in a 2 × 2 grid — leave, pay,
/// service progress and the next milestone. Values are the core's; Stitch's
/// sick-leave and institution tiles are replaced by data the app has.
private struct LedgerGrid: View {
    let home: HomeModel
    let projection: Projection
    let openLedger: () -> Void
    let openPay: () -> Void
    let openCalendar: () -> Void
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        VStack(alignment: .leading, spacing: SGSpacing.sm) {
            CodexSectionHeader(title: "복무 현황", world: "CIVIC LEDGER") { EmptyView() }
            let columns = typeSize.isAccessibilitySize
                ? [GridItem(.flexible())]
                : [GridItem(.flexible(), spacing: SGSpacing.sm), GridItem(.flexible(), spacing: SGSpacing.sm)]
            LazyVGrid(columns: columns, spacing: SGSpacing.sm) {
                leaveTile
                payTile
                progressTile
                milestoneTile
            }
        }
    }

    private var leaveTile: some View {
        let leave = home.leave
        let granted = projection.leaveText?.balance.granted
        return LedgerTile(symbol: "event_available", iconTint: SGColor.accent,
                          badge: leave.kind == "READY" ? (.info, "확정") : nil,
                          title: "남은 연가", world: "REST", action: openLedger) {
            switch leave.kind {
            case "READY": TileValue(text: leave.remaining ?? "–")
            case "BEFORE_SERVICE": TileValue(text: "소집 후", emphasis: .muted)
            default: TileValue(text: "확인 필요", emphasis: .attention)
            }
        } footer: {
            if leave.kind == "READY", let granted {
                TileFooter(leading: "부여 \(granted)", trailing: TodayView.remainingFraction(projection.ledger)
                    .map { "\(Int(($0 * 100).rounded()))% 남음" })
            } else {
                TileFooter(leading: leave.caption, trailing: nil)
            }
        }
    }

    private var payTile: some View {
        let pay = home.pay
        // The app never says "verified": it computes from the user's inputs.
        let badge: (SGTone, String)? = switch pay.kind {
        case "TOTAL": (.success, "계산됨")
        case "BASE_ONLY": (.info, "기본 보수만")
        default: nil
        }
        return LedgerTile(symbol: "account_balance_wallet", iconTint: SGColor.warning,
                          badge: badge, title: "이번 달 급여", world: "SUPPLY", action: openPay) {
            switch pay.kind {
            case "TOTAL", "BASE_ONLY":
                TileValue(text: KoreanNumber.grouped(Int((pay.amount ?? 0).rounded())), unit: "원", size: 21)
            case "PENDING": TileValue(text: "확인 필요", emphasis: .attention)
            default: TileValue(text: home.hero.phase == "PRE_SERVICE" ? "소집 후" : "—", emphasis: .muted)
            }
        } footer: {
            // The band ("상병 상당 3호봉") when known; the badge already says
            // 기본 보수만, and 급여 has the full caption.
            TileFooter(leading: pay.band ?? pay.caption, trailing: nil)
        }
    }

    private var progressTile: some View {
        let hero = home.hero
        return LedgerTile(symbol: "shield", iconTint: SGColor.accent,
                          badge: (.success, hero.stateLabel),
                          title: "복무한 날", world: "PROGRESS", action: nil) {
            if hero.phase == "PRE_SERVICE" {
                TileValue(text: "소집 전", emphasis: .muted)
            } else {
                TileValue(text: KoreanNumber.grouped(hero.elapsedDays), unit: "일")
            }
        } footer: {
            TileFooter(leading: "총 \(KoreanNumber.grouped(hero.totalServiceDays))일 중", trailing: hero.percentLabel)
        }
    }

    private var milestoneTile: some View {
        let next = home.hero.next
        return LedgerTile(symbol: "flag", iconTint: SGColor.accentSecondary,
                          badge: next.map { (.info, $0.daysUntil == 0 ? "오늘" : "\(KoreanNumber.grouped($0.daysUntil))일 후") },
                          title: "다음 이정표", world: "NEXT", action: openCalendar) {
            TileValue(text: next?.label ?? "소집해제", size: 19)
        } footer: {
            TileFooter(leading: (next?.date ?? projection.profile?.expectedDischargeDate).map(Formatters.dottedDateWithWeekday) ?? "",
                       trailing: nil)
        }
    }
}

private struct LedgerTile<Value: View, Footer: View>: View {
    let symbol: String
    let iconTint: SGToken
    let badge: (SGTone, String)?
    let title: String
    let world: String
    let action: (() -> Void)?
    @ViewBuilder let value: Value
    @ViewBuilder let footer: Footer

    var body: some View {
        if let action {
            Button(action: action) { tile }
                .buttonStyle(SGPressableStyle())
                .accessibilityHint("자세히 보기")
        } else {
            tile
        }
    }

    private var tile: some View {
        VStack(alignment: .leading, spacing: SGSpacing.sm) {
            HStack(alignment: .center) {
                StitchIcon(symbol, size: 16)
                    .foregroundStyle(.sg(iconTint))
                    .frame(width: 30, height: 30)
                    .background(.sg(SGColor.surfaceInteractive), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                Spacer(minLength: SGSpacing.xxs)
                if let badge {
                    Text(badge.1)
                        .font(SGTypography.font(11, .bold, relativeTo: .caption2))
                        .foregroundStyle(.sg(badge.0.foreground))
                        .lineLimit(1)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 3)
                        .background(.sg(badge.0.background), in: RoundedRectangle(cornerRadius: 5, style: .continuous))
                }
            }
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 4) {
                    Text(title)
                        .font(SGTypography.font(12, .semibold, relativeTo: .caption))
                        .foregroundStyle(.sg(SGColor.textSecondary))
                        .layoutPriority(1)
                    SGWorldEyebrow("· \(world)")
                }
                value
            }
            Spacer(minLength: 0)
            footer
        }
        .padding(SGSpacing.sm + 2)
        .frame(maxWidth: .infinity, minHeight: 150, alignment: .topLeading)
        .background(.sg(SGColor.surface), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .sgShadow(.small)
        .sgWarriorFrame(cornerRadius: 14)
        .accessibilityElement(children: .combine)
    }
}

/// 실질 복무일수: the figures the user chose in 더보기, from the core's
/// `HomeWorkdays`. Values arrive formatted ("19일", "—").
private struct WorkdaySection: View {
    let workdays: HomeModel.Workdays
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        VStack(alignment: .leading, spacing: SGSpacing.sm) {
            CodexSectionHeader(title: "실질 복무일수", world: "WORKDAYS") { EmptyView() }
            if let items = workdays.items, !items.isEmpty {
                let columns = typeSize.isAccessibilitySize
                    ? [GridItem(.flexible())]
                    : [GridItem(.flexible(), spacing: SGSpacing.sm), GridItem(.flexible(), spacing: SGSpacing.sm)]
                LazyVGrid(columns: columns, spacing: SGSpacing.sm) {
                    ForEach(items) { item in tile(item) }
                }
            }
            if let text = workdays.note ?? workdays.caption {
                Text(text)
                    .font(SGTypography.caption)
                    .foregroundStyle(.sg(SGColor.textTertiary))
            }
        }
    }

    private func tile(_ item: HomeModel.Workdays.Item) -> some View {
        let number = item.value.hasSuffix("일") ? String(item.value.dropLast()) : item.value
        return VStack(alignment: .leading, spacing: SGSpacing.xxs) {
            Text(item.label)
                .font(SGTypography.font(12, .semibold, relativeTo: .caption))
                .foregroundStyle(.sg(SGColor.textSecondary))
            TileValue(text: number, unit: item.value.hasSuffix("일") ? "일" : nil,
                      emphasis: item.value == "—" ? .muted : .value)
            Text(item.caption)
                .font(SGTypography.caption)
                .foregroundStyle(.sg(SGColor.textTertiary))
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(SGSpacing.sm + 2)
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .background(.sg(SGColor.surface), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .sgShadow(.small)
        .accessibilityElement(children: .combine)
    }
}

/// A tile's big value. Attention adds a symbol so the state is never colour only.
private struct TileValue: View {
    enum Emphasis { case value, muted, attention }
    let text: String
    var unit: String?
    var size: CGFloat = 26
    var emphasis: Emphasis = .value

    var body: some View {
        HStack(alignment: .lastTextBaseline, spacing: 3) {
            if emphasis == .attention {
                Image(systemName: SGTone.warning.symbol)
                    .font(SGTypography.label)
                    .accessibilityHidden(true)
            }
            Text(text)
                .font(SGTypography.stat(text, emphasis == .value ? size : 19, .heavy, relativeTo: .title2))
                .monospacedDigit()
                .tracking(-0.5)
                .minimumScaleFactor(0.6)
                .lineLimit(1)
            if let unit {
                Text(unit).font(SGTypography.font(13, .medium, relativeTo: .footnote))
                    .foregroundStyle(.sg(SGColor.textSecondary))
            }
        }
        .foregroundStyle(.sg(emphasis == .value ? SGColor.accentSecondary
                             : emphasis == .muted ? SGColor.textTertiary : SGColor.warning))
    }
}

private struct TileFooter: View {
    let leading: String
    let trailing: String?

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: SGSpacing.xxs) {
            Text(leading)
                .foregroundStyle(.sg(SGColor.textTertiary))
                .lineLimit(2)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: SGSpacing.xxs)
            if let trailing {
                Text(trailing)
                    .fontWeight(.semibold)
                    .foregroundStyle(.sg(SGColor.textPrimary))
                    .lineLimit(1)
                    .monospacedDigit()
            }
        }
        .font(SGTypography.font(11, .medium, relativeTo: .caption2))
    }
}

// MARK: Agenda

/// Stitch "다음 예정 일정 AGENDA": each item a white row card with its date
/// tile, and 전체보기 opening 캘린더.
private struct AgendaSection: View {
    let home: HomeModel
    let projection: Projection
    let openCalendar: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: SGSpacing.sm) {
            CodexSectionHeader(title: "다가오는 일정", world: "AGENDA") {
                Button(action: openCalendar) {
                    HStack(spacing: 2) {
                        Text("전체보기")
                        Image(systemName: "chevron.right").font(.caption2.weight(.bold))
                    }
                    .font(SGTypography.micro)
                    .foregroundStyle(.sg(SGColor.accent))
                    .frame(minHeight: SGSpacing.minimumHitTarget)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("캘린더 보기")
            }
            let items = home.today + home.upcoming
            if items.isEmpty {
                Group {
                    if home.completed {
                        SGEmptyState(symbol: "flag.checkered", title: "복무를 마쳤어요. 기록은 그대로 볼 수 있어요.")
                    } else {
                        SGEmptyState(symbol: "sunrise", title: "예정된 일정이 없어요",
                                     message: "휴가를 정했다면 미리 기록해 두세요.")
                    }
                }
                .frame(maxWidth: .infinity)
                .padding(SGSpacing.md)
                .background(.sg(SGColor.surface), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                .sgShadow(.small)
            } else {
                ForEach(items) { item in
                    AgendaRow(item: item, display: projection.eventDisplay?[item.event.id])
                        .padding(.horizontal, SGSpacing.sm)
                        .padding(.vertical, SGSpacing.xxs)
                        .background(.sg(SGColor.surface), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                        .sgShadow(.small)
                        .sgWarriorFrame(cornerRadius: 14, emphasis: 0.6)
                }
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
                Text("D-\(item.daysUntil)")
                    .font(SGTypography.latin(.display, 15, .bold, relativeTo: .subheadline))
                    .monospacedDigit()
                    .foregroundStyle(.sg(SGColor.accent))
                    .accessibilityLabel("\(KoreanNumber.grouped(item.daysUntil))일 후")
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

// MARK: Journey note

/// Stitch "HONORABLE STATUS" banner, with the user's own progress instead of
/// a status claim: how far along the term they are and what is left.
private struct JourneyNote: View {
    let hero: HomeModel.Hero

    var body: some View {
        HStack(alignment: .center, spacing: SGSpacing.sm) {
            VStack(alignment: .leading, spacing: SGSpacing.xxs) {
                HStack(spacing: 6) {
                    SGWorldEyebrow("JOURNEY NOTE", tint: SGColor.heroAccent)
                    Text("복무 기록")
                        .font(SGTypography.micro)
                        .foregroundStyle(.sg(SGColor.heroForeground3))
                }
                Text("전체 복무의 \(hero.percentLabel)를 지나왔어요")
                    .font(SGTypography.font(17, .bold, relativeTo: .headline))
                    .foregroundStyle(.sg(SGColor.heroForeground))
                    .fixedSize(horizontal: false, vertical: true)
                Text("소집해제까지 \(KoreanNumber.grouped(hero.remainingDays))일, 오늘도 한 걸음이에요.")
                    .font(SGTypography.caption)
                    .foregroundStyle(.sg(SGColor.heroForeground2))
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
            StitchIcon("military_tech", size: 26, filled: true)
                .foregroundStyle(.sg(SGColor.heroAccent))
                .sgBreathingGlow(radius: 6)
                .frame(width: 52, height: 52)
                .background(Color.white.opacity(0.12), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        }
        .padding(SGSpacing.md)
        .background {
            LinearGradient(colors: [RGB(0x0C1446).color, RGB(0x2A2A7A).color, RGB(0x5952AD).color],
                           startPoint: .topLeading, endPoint: .bottomTrailing)
        }
        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
        .sgShadow(.card)
        .sgWarriorFrame(cornerRadius: 18, emphasis: 1.4)
        .environment(\.colorScheme, .dark)
        .accessibilityElement(children: .combine)
    }
}
