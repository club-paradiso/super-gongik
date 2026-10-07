import SGCore
import SGDesignSystem
import SGFoundation
import SwiftUI

/// 급여: monthly compensation as the shared rules evaluate it
/// (`evaluateMoneyMonth`). A total appears only when the rules return one,
/// i.e. when every component is calculated; otherwise the screen shows which
/// inputs are missing. Legal bases and sources are always shown.
struct PayView: View {
    @Environment(AppModel.self) private var model
    let openTab: (AppTab) -> Void
    @State private var month: CivilDate = SeoulClock.today(at: .now)
    @State private var money: MoneyMonth?
    @State private var showingProfile = false
    @State private var showingAttendance = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: SGSpacing.md) {
                    monthSwitcher
                    if let money {
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
                        ComponentsCard(components: money.compensation.components)
                        PayBandsCard(schedule: money.schedule)
                        AssumptionsCard(items: (money.compensation.assumptions ?? []) + (money.compensation.warnings ?? []),
                                        title: "계산 기준과 주의")
                        if let rule = money.compensation.rule { RuleCard(rule: rule) }
                        Text("슈퍼공익의 금액은 공개된 기준으로 계산한 추정이에요. 실제 지급액은 복무기관의 지급 내역을 확인해 주세요.")
                            .font(SGTypography.caption)
                            .foregroundStyle(.sg(SGColor.textTertiary))
                    } else {
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
            .task(id: TaskKey(month: month.description, revision: model.document?.documentRevision ?? 0, today: model.today)) {
                await load()
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
    }

    private var isCurrentMonth: Bool { month.year == model.today.year && month.month == model.today.month }

    private var monthSwitcher: some View {
        HStack {
            Button { shift(-1) } label: { Image(systemName: "chevron.left").frame(width: SGSpacing.minimumHitTarget, height: SGSpacing.minimumHitTarget) }
                .accessibilityLabel("이전 달")
            Spacer()
            Text(Formatters.month(month)).font(SGTypography.title3).monospacedDigit()
            Spacer()
            Button { shift(1) } label: { Image(systemName: "chevron.right").frame(width: SGSpacing.minimumHitTarget, height: SGSpacing.minimumHitTarget) }
                .accessibilityLabel("다음 달")
        }
    }

    private func shift(_ amount: Int) {
        month = CivilDate(year: month.year, month: month.month, day: 1)!.adding(months: amount)
    }

    private func load() async {
        guard model.profile != nil, let runtime = model.core else { return }
        let monthText = String(format: "%04d-%02d", month.year, month.month)
        do {
            money = try await runtime.moneyMonth(monthText, today: model.today)
        } catch {
            AppLog.error("money month failed: \(error)")
            money = nil
        }
    }
}

private struct SummaryCard: View {
    let money: MoneyMonth
    let isCurrentMonth: Bool

    private var base: MonthlyCompensation.Component? {
        money.compensation.components.first { $0.key == "BASE_PAY" }
    }

    var body: some View {
        SGCard(padding: SGSpacing.lg) {
            VStack(alignment: .leading, spacing: SGSpacing.xs) {
                Text(isCurrentMonth ? "이번 달 예상 급여" : "예상 급여")
                    .font(SGTypography.label).foregroundStyle(.sg(SGColor.textSecondary))
                if let total = money.compensation.total {
                    Text(Formatters.won(total))
                        .font(SGTypography.title1).monospacedDigit()
                        .foregroundStyle(.sg(SGColor.textPrimary))
                } else if let amount = base?.monthlyAmount, base?.status == "CALCULATED" {
                    Text(Formatters.won(amount))
                        .font(SGTypography.title1).monospacedDigit()
                        .foregroundStyle(.sg(SGColor.textPrimary))
                    // Warning tone: symbol and color agree, so the state is
                    // never carried by color alone.
                    Label("기본 보수만이에요. 합계는 모든 항목이 확인돼야 보여요.", systemImage: SGTone.warning.symbol)
                        .font(SGTypography.caption).foregroundStyle(.sg(SGColor.warning))
                } else {
                    Label("계산에 필요한 정보가 있어요", systemImage: SGTone.warning.symbol)
                        .font(SGTypography.title3)
                        .foregroundStyle(.sg(SGColor.warning))
                }
                Text(money.compensation.headline)
                    .font(SGTypography.caption).foregroundStyle(.sg(SGColor.textTertiary))
                    .fixedSize(horizontal: false, vertical: true)
                if let rank = money.compensation.equivalentRank {
                    HStack(spacing: SGSpacing.xs) {
                        Text(rank)
                        if let ordinal = money.compensation.serviceMonthOrdinal {
                            Text("· 복무 \(ordinal)개월 차").monospacedDigit()
                        }
                    }
                    .font(SGTypography.label)
                    .foregroundStyle(.sg(SGColor.accent))
                }
            }
        }
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

private struct ComponentsCard: View {
    let components: [MonthlyCompensation.Component]

    var body: some View {
        SGCard {
            VStack(alignment: .leading, spacing: SGSpacing.sm) {
                SGSectionHeader("항목별", eyebrow: "SUPPLY LEDGER")
                ForEach(components) { component in
                    VStack(alignment: .leading, spacing: SGSpacing.xxs) {
                        HStack(alignment: .firstTextBaseline) {
                            Text(component.label).font(SGTypography.bodyStrong)
                            Spacer()
                            if let amount = component.monthlyAmount, component.status == "CALCULATED" {
                                Text(Formatters.won(amount)).font(SGTypography.bodyStrong).monospacedDigit()
                            } else {
                                statusLabel(component.status)
                            }
                        }
                        if let rate = component.dailyRate {
                            Text("1일 \(Formatters.won(rate))\(component.eligibleDays.map { " × \(Int($0))일" } ?? "")\(component.rateSource == "USER_INPUT" ? " (직접 입력)" : "")")
                                .font(SGTypography.caption).monospacedDigit()
                                .foregroundStyle(.sg(SGColor.textSecondary))
                        }
                        Text(component.explanation)
                            .font(SGTypography.caption).foregroundStyle(.sg(SGColor.textSecondary))
                            .fixedSize(horizontal: false, vertical: true)
                        Text("근거: \(component.basis)")
                            .font(SGTypography.caption).foregroundStyle(.sg(SGColor.textTertiary))
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .accessibilityElement(children: .combine)
                    if component.id != components.last?.id { Divider() }
                }
            }
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

private struct PayBandsCard: View {
    let schedule: PayBandSchedule

    var body: some View {
        SGCard {
            VStack(alignment: .leading, spacing: SGSpacing.sm) {
                SGSectionHeader("급여 단계")
                if schedule.status != "READY" {
                    Text(schedule.reason ?? "급여 단계를 계산할 수 없어요.")
                        .font(SGTypography.body).foregroundStyle(.sg(SGColor.textSecondary))
                } else {
                    ForEach(schedule.steps ?? []) { step in
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                HStack(spacing: 6) {
                                    Text(step.label).font(SGTypography.bodyStrong)
                                    if step.equivalentRank == schedule.current?.equivalentRank {
                                        Text("지금")
                                            .font(SGTypography.micro)
                                            .foregroundStyle(.sg(SGColor.onAccent))
                                            .padding(.horizontal, SGSpacing.iconGap).padding(.vertical, SGSpacing.xxxs)
                                            .background(.sg(SGColor.accent), in: Capsule())
                                    }
                                }
                                Text("\(Formatters.longDate(step.startDate))부터 · \(step.fromServiceMonthOrdinal)개월 차")
                                    .font(SGTypography.caption).monospacedDigit()
                                    .foregroundStyle(.sg(SGColor.textTertiary))
                            }
                            Spacer()
                            Text(step.monthlyAmount.map(Formatters.won) ?? "확정 전")
                                .font(SGTypography.body).monospacedDigit()
                                .foregroundStyle(.sg(step.monthlyAmount == nil ? SGColor.textTertiary : SGColor.textPrimary))
                        }
                        .accessibilityElement(children: .combine)
                    }
                }
            }
        }
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
