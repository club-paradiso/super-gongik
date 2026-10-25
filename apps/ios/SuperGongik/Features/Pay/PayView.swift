import SGCore
import SGDesignSystem
import SGFoundation
import SwiftUI

/// 급여: monthly compensation as the shared rules evaluate it
/// (`evaluateMoneyMonth`). A total appears only when the rules return one,
/// i.e. when every component is calculated; otherwise the screen shows which
/// inputs are missing. Legal bases and sources are always shown.
///
/// Loading, loaded and failed are distinct (`LoadCycle`): a failed evaluation
/// shows a notice with 다시 시도 instead of a spinner, and a failed refresh
/// keeps the month's last result on screen under the notice.
struct PayView: View {
    @Environment(AppModel.self) private var model
    let openTab: (AppTab) -> Void
    @State private var month: CivilDate = SeoulClock.today(at: .now)
    @State private var load = LoadCycle<MoneyMonth>()
    @State private var retries = 0
    @State private var showingProfile = false
    @State private var showingAttendance = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: SGSpacing.md) {
                    // Stitch: the app header, then the title with the month
                    // switcher on its row (the navigation bar is hidden).
                    AppHeader(hero: model.projection?.home?.hero, openProfile: { openTab(.profile) })
                    // Stitch: "SUPPLY // yyyy.mm PAYROLL" sits above the title.
                    VStack(alignment: .leading, spacing: SGSpacing.xxxs) {
                        SGWorldEyebrow(String(format: "SUPPLY // %04d.%02d PAYROLL", month.year, month.month),
                                       tint: SGColor.accent)
                        ScreenTitle(title: "급여") { monthSwitcher }
                    }
                    if case .failed(let failure) = load.phase {
                        LoadFailureNotice(failure: failure, hasResult: shownMoney != nil, retry: retry)
                    }
                    if let money = shownMoney {
                        SummaryCard(money: money, isCurrentMonth: isCurrentMonth)
                        if !money.compensation.unresolved.isEmpty {
                            UnresolvedCard(items: money.compensation.unresolved) { showingProfile = true }
                        }
                        Button {
                            showingAttendance = true
                        } label: {
                            Label("\(month.month)월 근무일 확인", systemImage: "calendar.badge.checkmark")
                        }
                        .buttonStyle(SGSecondaryButtonStyle())
                        .disabled(model.isReadOnly)
                        ComponentsSection(components: money.compensation.components)
                        PayBandsCard(schedule: money.schedule, today: model.today)
                        AssumptionsCard(items: (money.compensation.assumptions ?? []) + (money.compensation.warnings ?? []),
                                        title: "계산 기준과 주의")
                        if let rule = money.compensation.rule { RuleCard(rule: rule) }
                    } else if !isFailed {
                        SGLoadingState()
                    }
                }
                .padding(.horizontal, SGSpacing.gutter)
                .padding(.bottom, SGSpacing.xxl)
                .frame(maxWidth: SGLayout.readableWidth)
                .frame(maxWidth: .infinity)
            }
            .background(.sg(SGColor.background))
            .sgScreenChrome()
            .navigationTitle("급여")
            .toolbar(.hidden, for: .navigationBar)
            .task(id: TaskKey(month: monthText, revision: model.document?.documentRevision ?? 0, today: model.today, retries: retries)) {
                await loadMonth()
            }
            .sheet(isPresented: $showingProfile) {
                NavigationStack { ProfileEditView() }
            }
            .onAppear {
                #if DEBUG
                // Screenshot hook: `-SGOpenAttendance YES` (DEBUG builds only).
                if UserDefaults.standard.bool(forKey: "SGOpenAttendance") { showingAttendance = true }
                #endif
            }
            .sheet(isPresented: $showingAttendance) {
                NavigationStack { AttendanceEditorView(month: month) }
            }
        }
    }

    struct TaskKey: Equatable {
        let month: String
        let revision: Int
        let today: CivilDate
        let retries: Int
    }

    private var isCurrentMonth: Bool { month.year == model.today.year && month.month == model.today.month }
    private var monthText: String { String(format: "%04d-%02d", month.year, month.month) }
    /// This month's latest result, or its last good one while a refresh failed.
    private var shownMoney: MoneyMonth? { load.value(for: monthText) }
    private var isFailed: Bool { if case .failed = load.phase { true } else { false } }

    private func retry() { retries += 1 }

    /// The month between tinted chevron tiles, on the title row.
    private var monthSwitcher: some View {
        HStack(spacing: SGSpacing.xxs) {
            tile("chevron.left", label: "이전 달") { shift(-1) }
            Text("\(month.month)월").font(SGTypography.title3).monospacedDigit()
                .padding(.horizontal, SGSpacing.xxs)
                .accessibilityLabel(Formatters.month(month))
            tile("chevron.right", label: "다음 달") { shift(1) }
        }
    }

    private func tile(_ symbol: String, label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(SGTypography.label)
                .foregroundStyle(.sg(SGColor.accent))
                .frame(width: 36, height: 36)
                .background(.sg(SGColor.selectedBackground), in: RoundedRectangle(cornerRadius: SGRadius.control, style: .continuous))
                .frame(width: SGSpacing.minimumHitTarget, height: SGSpacing.minimumHitTarget)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }

    private func shift(_ amount: Int) {
        month = CivilDate(year: month.year, month: month.month, day: 1)!.adding(months: amount)
    }

    private func loadMonth() async {
        guard model.profile != nil, let runtime = model.core else { load.idle(); return }
        let key = monthText
        let attempt = load.begin()
        do {
            #if DEBUG
            // Screenshot/QA hook: `-SGFailMoneyMonth YES` makes every evaluation
            // fail so the failure notice and retry can be seen (DEBUG only).
            if UserDefaults.standard.bool(forKey: "SGFailMoneyMonth") {
                throw CoreError.javaScript("injected by -SGFailMoneyMonth")
            }
            #endif
            let result = try await runtime.moneyMonth(key, today: model.today)
            guard !Task.isCancelled else { return }
            load.succeed(attempt, key: key, result)
        } catch {
            guard !Task.isCancelled else { return }
            AppLog.error("money month failed: \(error)")
            load.fail(attempt, key: key, error: error, message: ErrorCopy.payUnavailable)
        }
    }
}

/// The evaluation failed: what happened, that records are untouched, a retry,
/// and a privacy-free diagnosis. With an older result still on screen the
/// notice says that result is the last successful one.
private struct LoadFailureNotice: View {
    let failure: LoadCycle<MoneyMonth>.Failure
    let hasResult: Bool
    let retry: () -> Void

    var body: some View {
        SGCard {
            VStack(alignment: .leading, spacing: SGSpacing.sm) {
                SGNotice(.warning, title: hasResult ? ErrorCopy.payStale : failure.message,
                         message: hasResult ? "기록은 그대로 있어요. 다시 시도해 주세요." : nil)
                Button("다시 시도", systemImage: "arrow.clockwise", action: retry)
                    .buttonStyle(SGSecondaryButtonStyle())
                Text("진단: \(failure.diagnosis)")
                    .font(SGTypography.micro).monospacedDigit()
                    .foregroundStyle(.sg(SGColor.textTertiary))
            }
        }
        .accessibilityElement(children: .contain)
    }
}

/// Stitch summary: month, state badge, amount, the three components as
/// tiles, and the app's estimate disclaimer. The source's "검증 완료",
/// payday and statute citation are not drawn: the app cannot know them.
private struct SummaryCard: View {
    let money: MoneyMonth
    let isCurrentMonth: Bool
    @Environment(\.dynamicTypeSize) private var typeSize

    private var base: MonthlyCompensation.Component? {
        money.compensation.components.first { $0.key == "BASE_PAY" }
    }

    private var badge: String? {
        if money.compensation.total != nil { return "계산됨" }
        if base?.status == "CALCULATED" { return "기본 보수만" }
        return nil
    }

    private var headerLayout: AnyLayout {
        typeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: SGSpacing.xxs))
            : AnyLayout(HStackLayout(spacing: SGSpacing.xs))
    }

    private var tileLayout: AnyLayout {
        typeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(spacing: SGSpacing.xs))
            : AnyLayout(HStackLayout(alignment: .top, spacing: SGSpacing.xs))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: SGSpacing.sm) {
            headerLayout {
                Label(isCurrentMonth ? "이번 달 예상 보수" : "\(money.asOfDate.month)월 예상 보수", systemImage: "wonsign.circle")
                    .font(SGTypography.bodyStrong).foregroundStyle(.sg(SGColor.heroForeground))
                if !typeSize.isAccessibilitySize { Spacer(minLength: SGSpacing.xs) }
                if let badge {
                    Text(badge)
                        .font(SGTypography.micro)
                        .foregroundStyle(.sg(SGColor.heroAccent))
                        .padding(.horizontal, SGSpacing.xs).padding(.vertical, SGSpacing.xxxs)
                        .background(.sg(SGColor.heroTrack), in: Capsule())
                }
            }
            if let total = money.compensation.total {
                amount(total)
            } else if let value = base?.monthlyAmount, base?.status == "CALCULATED" {
                amount(value)
                Text("식비·교통비는 확인되면 합계에 더해요.")
                    .font(SGTypography.caption).foregroundStyle(.sg(SGColor.heroForeground3))
            } else {
                Label("계산에 필요한 정보가 있어요", systemImage: SGTone.warning.symbol)
                    .font(SGTypography.title3)
                    .foregroundStyle(.sg(SGColor.heroAccent))
            }
            tileLayout {
                ForEach(money.compensation.components) { component in
                    ComponentTile(component: component, rank: component.key == "BASE_PAY" ? money.compensation.equivalentRank : nil)
                }
            }
            if let rank = money.compensation.equivalentRank, let ordinal = money.compensation.serviceMonthOrdinal {
                Text("\(rank) · 복무 \(ordinal)개월 차")
                    .font(SGTypography.label).monospacedDigit()
                    .foregroundStyle(.sg(SGColor.heroAccent))
            }
            Label {
                Text("슈퍼공익의 금액은 공개된 기준으로 계산한 추정이에요. 실제 지급액은 복무기관의 지급 내역을 확인해 주세요.")
                    .fixedSize(horizontal: false, vertical: true)
            } icon: {
                Image(systemName: "info.circle")
            }
            .font(SGTypography.caption)
            .foregroundStyle(.sg(SGColor.heroForeground2))
            .padding(SGSpacing.xs)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(.sg(SGColor.heroTrack), in: RoundedRectangle(cornerRadius: SGRadius.control, style: .continuous))
        }
        .padding(SGSpacing.lg)
        .background { SGHeroBackground(celebrate: false) }
        .clipShape(RoundedRectangle(cornerRadius: SGRadius.hero, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: SGRadius.hero, style: .continuous).strokeBorder(.sg(SGColor.heroBorder)))
        .sgShadow(.hero)
        .environment(\.colorScheme, .dark)
    }

    private func amount(_ value: Double) -> some View {
        HStack(alignment: .lastTextBaseline, spacing: SGSpacing.xxs) {
            Text(KoreanNumber.grouped(Int(value.rounded())))
                .font(SGTypography.font(34, .heavy, relativeTo: .title))
                .monospacedDigit().lineLimit(1).minimumScaleFactor(0.6)
                .foregroundStyle(.sg(SGColor.heroForeground))
            Text("원").font(SGTypography.label).foregroundStyle(.sg(SGColor.heroForeground2))
        }
        .accessibilityElement(children: .combine)
    }
}

/// One component as a tile inside the summary card.
private struct ComponentTile: View {
    let component: MonthlyCompensation.Component
    let rank: String?

    private var value: String {
        switch component.status {
        case "CALCULATED", "SUGGESTED": component.monthlyAmount.map(Formatters.won) ?? "—"
        case "NEEDS_INPUT": "입력 필요"
        case "UNSUPPORTED": "계산하지 않음"
        default: "—"
        }
    }

    private var detail: String? {
        if let rank { return rank }
        if component.status == "SUGGESTED" {
            return "제안값" + (component.eligibleDays.map { " · \(Int($0))일" } ?? "")
        }
        return nil
    }

    var body: some View {
        VStack(alignment: .leading, spacing: SGSpacing.xxxs) {
            Text(component.label).font(SGTypography.micro).foregroundStyle(.sg(SGColor.heroForeground3))
            Text(value).font(SGTypography.bodyStrong).monospacedDigit()
                .lineLimit(1).minimumScaleFactor(0.7)
                .foregroundStyle(.sg(component.status == "NEEDS_INPUT" ? SGColor.heroAccent : SGColor.heroForeground))
            if let detail {
                Text(detail).font(SGTypography.micro).foregroundStyle(.sg(SGColor.heroForeground3))
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(SGSpacing.xs)
        .background(.sg(SGColor.heroTrack), in: RoundedRectangle(cornerRadius: SGRadius.control, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

private struct UnresolvedCard: View {
    let items: [String]
    let onOpenProfile: () -> Void

    var body: some View {
        SGCard {
            VStack(alignment: .leading, spacing: SGSpacing.sm) {
                SGSectionHeader("계산에 필요한 정보")
                ForEach(items, id: \.self) { item in
                    Label {
                        Text(item).font(SGTypography.body).fixedSize(horizontal: false, vertical: true)
                    } icon: {
                        Image(systemName: "exclamationmark.circle").foregroundStyle(.sg(SGColor.warning))
                    }
                }
                Button("복무 설정 열기", action: onOpenProfile)
                    .buttonStyle(SGSecondaryButtonStyle())

            }
        }
    }
}

/// Stitch "항목별 세부 보급 명세": one card per component with its amount,
/// rate and the shared explanation and basis.
private struct ComponentsSection: View {
    let components: [MonthlyCompensation.Component]

    var body: some View {
        VStack(alignment: .leading, spacing: SGSpacing.sm) {
            HStack(spacing: SGSpacing.xs) {
                Image(systemName: "doc.text").foregroundStyle(.sg(SGColor.accent)).accessibilityHidden(true)
                Text("항목별 명세").font(SGTypography.sectionTitle).foregroundStyle(.sg(SGColor.textPrimary))
                Spacer()
                SGWorldEyebrow("LEDGER // \(components.count) ITEMS")
            }
            .accessibilityAddTraits(.isHeader)
            ForEach(components) { component in
                SGCard {
                    VStack(alignment: .leading, spacing: SGSpacing.xs) {
                        HStack(alignment: .firstTextBaseline, spacing: SGSpacing.xs) {
                            Circle().fill(.sg(tone(component.status).foreground))
                                .frame(width: 8, height: 8)
                                .accessibilityHidden(true)
                            Text(component.label).font(SGTypography.cardTitle)
                            Spacer()
                            if let amount = component.monthlyAmount, component.status == "CALCULATED" {
                                Text(Formatters.won(amount)).font(SGTypography.cardTitle).monospacedDigit()
                            } else {
                                statusLabel(component.status)
                            }
                        }
                        if let rate = component.dailyRate {
                            Text("1일 \(Formatters.won(rate))\(component.eligibleDays.map { " × \(Int($0))일" } ?? "")\(component.rateSource == "USER_INPUT" ? " (직접 입력)" : "")")
                                .font(SGTypography.caption).monospacedDigit()
                                .foregroundStyle(.sg(SGColor.textSecondary))
                        }
                        VStack(alignment: .leading, spacing: SGSpacing.xxxs) {
                            Text(component.explanation)
                                .foregroundStyle(.sg(SGColor.textSecondary))
                            Text("근거: \(component.basis)")
                                .foregroundStyle(.sg(SGColor.textTertiary))
                        }
                        .font(SGTypography.caption)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(SGSpacing.xs)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(.sg(SGColor.surfaceRaised), in: RoundedRectangle(cornerRadius: SGRadius.control, style: .continuous))
                    }
                    .accessibilityElement(children: .combine)
                }
            }
        }
    }

    private func tone(_ status: String) -> SGTone {
        switch status {
        case "CALCULATED": .success
        case "SUGGESTED": .info
        case "NEEDS_INPUT": .warning
        default: .neutral
        }
    }

    @ViewBuilder
    private func statusLabel(_ status: String) -> some View {
        let (text, tone): (String, SGTone) = switch status {
        case "NEEDS_INPUT": ("입력 필요", .warning)
        case "UNSUPPORTED": ("계산하지 않음", .neutral)
        case "SUGGESTED": ("제안값", .info)
        default: (status, .neutral)
        }
        Label(text, systemImage: tone.symbol)
            .font(SGTypography.micro)
            .foregroundStyle(.sg(tone.foreground))
    }
}

/// Stitch "복무 단계별 보수 로드맵": the pay bands as steps, from the shared
/// schedule (verified rule amounts). Social service personnel hold no rank:
/// "상당" only names the pay band, and the card says so.
private struct PayBandsCard: View {
    let schedule: PayBandSchedule
    let today: CivilDate
    @Environment(\.dynamicTypeSize) private var typeSize

    private var layout: AnyLayout {
        typeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(spacing: SGSpacing.xs))
            : AnyLayout(HStackLayout(alignment: .top, spacing: SGSpacing.xs))
    }

    var body: some View {
        SGCard {
            VStack(alignment: .leading, spacing: SGSpacing.sm) {
                HStack(spacing: SGSpacing.xs) {
                    Image(systemName: "flag").foregroundStyle(.sg(SGColor.accent)).accessibilityHidden(true)
                    Text("복무 단계별 보수").font(SGTypography.cardTitle)
                    Spacer()
                    if let index = currentIndex { SGWorldEyebrow(String(format: "STEP %02d", index + 1)) }
                }
                .accessibilityAddTraits(.isHeader)
                if schedule.status != "READY" {
                    Text(schedule.reason ?? "급여 단계를 계산할 수 없어요.")
                        .font(SGTypography.body).foregroundStyle(.sg(SGColor.textSecondary))
                } else {
                    let steps = schedule.steps ?? []
                    layout {
                        ForEach(Array(steps.enumerated()), id: \.element.id) { index, step in
                            stepView(step, index: index, steps: steps)
                        }
                    }
                }
                Text("사회복무요원은 계급이 없어요. ‘상당’은 보수를 정하는 기준일 뿐이에요.")
                    .font(SGTypography.caption).foregroundStyle(.sg(SGColor.textTertiary))
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private var currentIndex: Int? {
        schedule.steps?.firstIndex { $0.equivalentRank == schedule.current?.equivalentRank }
    }

    private func stepView(_ step: PayBandSchedule.Step, index: Int, steps: [PayBandSchedule.Step]) -> some View {
        let isCurrent = index == currentIndex
        let isPassed = !isCurrent && step.startDate.dayNumber <= today.dayNumber
        let next = index + 1 < steps.count ? steps[index + 1] : nil
        let months = next.map { "\(step.fromServiceMonthOrdinal)~\($0.fromServiceMonthOrdinal - 1)개월" } ?? "\(step.fromServiceMonthOrdinal)개월~"
        return VStack(spacing: SGSpacing.xxxs) {
            Image(systemName: isCurrent ? "star.circle.fill" : isPassed ? "checkmark.circle" : "circle.dashed")
                .foregroundStyle(.sg(isCurrent || isPassed ? SGColor.accent : SGColor.textTertiary))
                .accessibilityHidden(true)
            Text(step.label).font(SGTypography.micro).foregroundStyle(.sg(SGColor.textPrimary))
            Text(months).font(SGTypography.micro).foregroundStyle(.sg(SGColor.textTertiary))
            Text(step.monthlyAmount.map { KoreanNumber.grouped(Int($0 / 10_000)) + "만" } ?? "확정 전")
                .font(SGTypography.bodyStrong).monospacedDigit()
                .foregroundStyle(.sg(isCurrent ? SGColor.accent : SGColor.textPrimary))
            Text(isCurrent ? "지금" : isPassed ? "지남" : Formatters.shortDate(step.startDate))
                .font(SGTypography.micro).foregroundStyle(.sg(SGColor.textTertiary))
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, SGSpacing.xs)
        .background(.sg(isCurrent ? SGColor.selectedBackground : SGColor.surfaceRaised),
                    in: RoundedRectangle(cornerRadius: SGRadius.control, style: .continuous))
        .overlay {
            if isCurrent {
                RoundedRectangle(cornerRadius: SGRadius.control, style: .continuous).strokeBorder(.sg(SGColor.selectedBorder))
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(step.label), \(months), \(step.monthlyAmount.map(Formatters.won) ?? "확정 전")\(isCurrent ? ", 지금" : "")")
    }
}

private struct RuleCard: View {
    let rule: MonthlyCompensation.Rule

    var body: some View {
        SGCard {
            VStack(alignment: .leading, spacing: SGSpacing.xs) {
                Label("적용 기준", systemImage: "doc.text")
                    .font(SGTypography.label).foregroundStyle(.sg(SGColor.textSecondary))
                Text("\(rule.version) 기준\(rule.effectiveFrom.map { " · \($0)부터" } ?? "")\(rule.effectiveUntil.map { " \($0)까지" } ?? "")\(rule.verifiedAt.map { " · \($0) 확인" } ?? "")")
                    .font(SGTypography.caption).monospacedDigit()
                    .foregroundStyle(.sg(SGColor.textSecondary))
                ForEach(rule.sources) { source in
                    if let text = source.url, let url = URL(string: text) {
                        Link(destination: url) {
                            Label(source.title, systemImage: "arrow.up.right.square")
                                .font(SGTypography.caption)
                                .multilineTextAlignment(.leading)
                        }
                    } else {
                        Text("· \(source.title)").font(SGTypography.caption)
                    }
                }
            }
        }
    }
}
