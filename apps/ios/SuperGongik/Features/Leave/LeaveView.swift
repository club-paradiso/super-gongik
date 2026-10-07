import SGCore
import SGDesignSystem
import SGFoundation
import SwiftUI

/// 휴가: the annual-leave ledger. Every figure and every sentence of
/// explanation comes from the shared ledger (`buildLeaveLedger`) and is
/// formatted by the core exactly as the web does. Assumptions and warnings
/// are always visible, never collapsed away.
struct LeaveView: View {
    @Environment(AppModel.self) private var model
    @State private var confirming: LeaveLedger.Credit?
    @State private var addingCorrection = false
    @State private var message: String?

    var body: some View {
        NavigationStack {
            ScrollView {
                if let ledger = model.projection?.ledger, let text = model.projection?.leaveText {
                    VStack(alignment: .leading, spacing: SGSpacing.md) {
                        BalanceCard(ledger: ledger, text: text)
                        if !ledger.warnings.isEmpty {
                            VStack(spacing: SGSpacing.xs) {
                                ForEach(ledger.warnings, id: \.self) { SGNotice(.warning, title: $0) }
                            }
                        }
                        if let message { SGNotice(.success, title: message) }
                        CreditsCard(ledger: ledger, text: text, onConfirm: { confirming = $0 })
                        ReconciliationCard(ledger: ledger, text: text, onApply: applyReconciliation)
                        CorrectionsCard(adjustments: corrections, onAdd: { addingCorrection = true }, onDelete: deleteAdjustment)
                        UsageCard(ledger: ledger, text: text)
                        AssumptionsCard(items: ledger.assumptions + (ledger.reconciliation.assumptions ?? []))
                    }
                    .padding(.horizontal, SGSpacing.gutter)
                    .padding(.bottom, SGSpacing.xxl)
                    .frame(maxWidth: SGLayout.readableWidth)
                    .frame(maxWidth: .infinity)
                } else {
                    SGLoadingState()
                }
            }
            .background(.sg(SGColor.background))
            .sgScreenChrome()
            .navigationTitle("휴가")
            .sheet(item: $confirming) { credit in
                ConfirmCreditSheet(credit: credit) { message = "\(credit.label) 부여 일수를 저장했어요." }
            }
            .sheet(isPresented: $addingCorrection) {
                CorrectionSheet { message = "보정을 저장했어요." }
            }
        }
    }

    private var corrections: [LeaveAdjustment] {
        (model.document?.leaveAdjustments ?? []).filter { $0.kind == "CORRECTION" && $0.deletedAt == nil }
            .sorted { $0.effectiveDate > $1.effectiveDate }
    }

    /// "기관 기록에 맞추기": a correction of exactly the reported difference,
    /// as the web ledger panel records it.
    private func applyReconciliation() {
        guard let ledger = model.projection?.ledger, let difference = ledger.reconciliation.difference,
              let comparedAt = ledger.reconciliation.comparedAt else { return }
        Task {
            let issues = await model.run("addLeaveCorrection", [.object([
                "effectiveDate": .string(comparedAt.description),
                "halfDays": .number(Double(difference.halfDays)),
                "minutes": .number(Double(difference.minutes)),
                "reason": .string("기관 자료(\(comparedAt) 기준)에 맞춤"),
            ])])
            message = issues.isEmpty ? "기관 기록에 맞춰 보정했어요." : issues.first?.message
        }
    }

    private func deleteAdjustment(_ adjustment: LeaveAdjustment) {
        Task {
            let issues = await model.run("deleteLeaveAdjustment", [.string(adjustment.id)])
            message = issues.isEmpty ? "보정을 지웠어요." : issues.first?.message
        }
    }
}

private struct BalanceCard: View {
    let ledger: LeaveLedger
    let text: LeaveText

    var body: some View {
        SGCard(padding: SGSpacing.lg) {
            VStack(alignment: .leading, spacing: SGSpacing.sm) {
                Text("예정까지 반영한 남은 연가")
                    .font(SGTypography.label)
                    .foregroundStyle(.sg(SGColor.textSecondary))
                Text(text.balance.remainingAfterScheduled)
                    .font(SGTypography.title1)
                    .monospacedDigit()
                    .foregroundStyle(.sg(SGColor.textPrimary))
                    .accessibilityAddTraits(.isHeader)
                if ledger.balance.status != "RESOLVED" {
                    SGNotice(.warning, title: "확인되지 않은 항목이 있어 잔여가 달라질 수 있어요.")
                }
                Divider()
                Grid(alignment: .leading, horizontalSpacing: SGSpacing.md, verticalSpacing: SGSpacing.xs) {
                    row("부여", text.balance.granted)
                    row("사용", text.balance.used)
                    row("예정", text.balance.scheduled)
                    row("보정", text.balance.corrections)
                    row("지금 남은 연가", text.balance.available)
                    row("앞으로 부여 예정", text.balance.upcomingCredits)
                }
                Text("\(Formatters.longDate(ledger.balance.asOf)) 기준")
                    .font(SGTypography.caption)
                    .foregroundStyle(.sg(SGColor.textTertiary))
            }
        }
    }

    private func row(_ label: String, _ value: String) -> some View {
        GridRow {
            Text(label).font(SGTypography.body).foregroundStyle(.sg(SGColor.textSecondary))
            Text(value).font(SGTypography.bodyStrong).monospacedDigit()
                .foregroundStyle(.sg(SGColor.textPrimary))
                .gridColumnAlignment(.trailing)
                .frame(maxWidth: .infinity, alignment: .trailing)
        }
        .accessibilityElement(children: .combine)
    }
}

private struct CreditsCard: View {
    let ledger: LeaveLedger
    let text: LeaveText
    let onConfirm: (LeaveLedger.Credit) -> Void
    @Environment(AppModel.self) private var model

    var body: some View {
        SGCard {
            VStack(alignment: .leading, spacing: SGSpacing.sm) {
                SGSectionHeader("연가 부여", eyebrow: "LEAVE LEDGER")
                ForEach(Array(ledger.credits.enumerated()), id: \.element.id) { index, credit in
                    let shown = index < text.credits.count ? text.credits[index] : nil
                    VStack(alignment: .leading, spacing: SGSpacing.xxs) {
                        HStack(alignment: .firstTextBaseline) {
                            Text(credit.label).font(SGTypography.bodyStrong)
                            Spacer()
                            stateLabel(credit)
                        }
                        Text("\(Formatters.longDate(credit.grantDate)) 부여 · \(shown?.amount ?? "미확인")")
                            .font(SGTypography.caption).monospacedDigit()
                            .foregroundStyle(.sg(SGColor.textSecondary))
                        Text(shown?.explanation ?? credit.explanation)
                            .font(SGTypography.caption)
                            .foregroundStyle(.sg(SGColor.textTertiary))
                            .fixedSize(horizontal: false, vertical: true)
                        if credit.state == "PENDING_CONFIRMATION" || credit.state == "CONFIRMED_BY_USER" {
                            Button(credit.state == "CONFIRMED_BY_USER" ? "부여 일수 고치기" : "기관 부여 일수 입력") { onConfirm(credit) }
                                .font(SGTypography.label)
                                .disabled(model.isReadOnly)
                                .padding(.top, SGSpacing.xxs)
                        }
                    }
                    .padding(.vertical, SGSpacing.xxs)
                    if credit.id != ledger.credits.last?.id { Divider() }
                }
            }
        }
    }

    @ViewBuilder
    private func stateLabel(_ credit: LeaveLedger.Credit) -> some View {
        let (text, tone): (String, SGTone) = switch credit.state {
        case "COUNTED": ("규칙 확인", .success)
        case "CONFIRMED_BY_USER": ("직접 확인", .success)
        case "PENDING_CONFIRMATION": ("확인 필요", .warning)
        case "UPCOMING": ("부여 예정", .neutral)
        default: (credit.state, .neutral)
        }
        Label(text, systemImage: tone.symbol)
            .font(SGTypography.micro)
            .foregroundStyle(.sg(tone.foreground))
    }
}

private struct ReconciliationCard: View {
    let ledger: LeaveLedger
    let text: LeaveText
    let onApply: () -> Void
    @Environment(AppModel.self) private var model

    var body: some View {
        let reconciliation = ledger.reconciliation
        SGCard {
            VStack(alignment: .leading, spacing: SGSpacing.sm) {
                SGSectionHeader("기관 기록과 비교")
                switch reconciliation.status {
                case "NO_SNAPSHOT":
                    Text("기관 복무기록을 가져오면 기관 잔여 연가와 비교해 드려요.")
                        .font(SGTypography.body).foregroundStyle(.sg(SGColor.textSecondary))
                case "NOT_COMPARABLE":
                    SGNotice(.warning, title: "비교할 수 없어요", message: reconciliation.reason)
                default:
                    if let compared = reconciliation.comparedAt, let rec = text.reconciliation {
                        Grid(alignment: .leading, verticalSpacing: SGSpacing.xs) {
                            GridRow { Text("기관 잔여"); Text(rec.institutionRemaining).monospacedDigit() }
                            GridRow { Text("앱 계산"); Text(rec.appRemaining).monospacedDigit() }
                            GridRow { Text("차이"); Text(rec.difference).monospacedDigit().fontWeight(.bold) }
                        }
                        .font(SGTypography.body)
                        Text("\(Formatters.longDate(compared)) 기관 기록 기준")
                            .font(SGTypography.caption).foregroundStyle(.sg(SGColor.textTertiary))
                        if reconciliation.status == "MATCH" {
                            SGNotice(.success, title: "기관 기록과 같아요.")
                        } else {
                            SGNotice(.warning, title: "차이 \(rec.difference)",
                                     message: "기록이 빠졌거나 중복됐는지 먼저 확인해 주세요. 기관 기록이 맞다면 보정으로 맞출 수 있어요.")
                            Button("기관 기록에 맞추기", action: onApply)
                                .buttonStyle(SGSecondaryButtonStyle())
                                .disabled(model.isReadOnly)
                        }
                    }
                }
            }
        }
    }
}

private struct CorrectionsCard: View {
    let adjustments: [LeaveAdjustment]
    let onAdd: () -> Void
    let onDelete: (LeaveAdjustment) -> Void
    @Environment(AppModel.self) private var model

    var body: some View {
        SGCard {
            VStack(alignment: .leading, spacing: SGSpacing.sm) {
                SGSectionHeader("보정")
                if adjustments.isEmpty {
                    Text("보정한 내역이 없어요.").font(SGTypography.body).foregroundStyle(.sg(SGColor.textSecondary))
                }
                ForEach(adjustments) { item in
                    HStack {
                        VStack(alignment: .leading, spacing: SGSpacing.xxxs) {
                            Text(item.reason).font(SGTypography.bodyStrong)
                            Text("\(Formatters.longDate(item.effectiveDate)) · 반일 \(item.amountHalfDays) · \(item.amountMinutes)분")
                                .font(SGTypography.caption).monospacedDigit()
                                .foregroundStyle(.sg(SGColor.textTertiary))
                        }
                        Spacer()
                        Button(role: .destructive) { onDelete(item) } label: {
                            Image(systemName: "trash")
                        }
                        .accessibilityLabel("이 보정 지우기")
                        .disabled(model.isReadOnly)
                    }
                    .frame(minHeight: SGSpacing.minimumHitTarget)
                }
                Button("보정 추가", action: onAdd)
                    .buttonStyle(SGSecondaryButtonStyle())
                    .disabled(model.isReadOnly)
            }
        }
    }
}

private struct UsageCard: View {
    let ledger: LeaveLedger
    let text: LeaveText

    var body: some View {
        SGCard {
            VStack(alignment: .leading, spacing: SGSpacing.sm) {
                SGSectionHeader("종류별 사용")
                let used = Array(zip(ledger.byType, text.byType)).filter { $0.0.count > 0 }
                if used.isEmpty {
                    Text("아직 사용한 기록이 없어요.").font(SGTypography.body).foregroundStyle(.sg(SGColor.textSecondary))
                }
                ForEach(used, id: \.0.eventType) { item, total in
                    HStack {
                        Text(item.label).font(SGTypography.body)
                        Spacer()
                        Text("\(item.count)건 · \(total)").font(SGTypography.bodyStrong).monospacedDigit()
                    }
                    .accessibilityElement(children: .combine)
                    if item.unresolvedCount > 0 {
                        Text("사용 시간이 확인되지 않은 기록 \(item.unresolvedCount)건").font(SGTypography.caption)
                            .foregroundStyle(.sg(SGColor.warning))
                    }
                }
                Divider()
                HStack {
                    VStack(alignment: .leading, spacing: SGSpacing.xxxs) {
                        Text("허가외출·지각·조퇴 누계").font(SGTypography.body)
                        Text("누계 8시간을 연가 1일로 공제해요.").font(SGTypography.caption)
                            .foregroundStyle(.sg(SGColor.textTertiary))
                    }
                    Spacer()
                    Text(text.attendanceTotal).font(SGTypography.bodyStrong).monospacedDigit()
                }
                .accessibilityElement(children: .combine)
            }
        }
    }
}

struct AssumptionsCard: View {
    let items: [String]
    var title = "계산 기준"

    var body: some View {
        if !items.isEmpty {
            SGCard {
                VStack(alignment: .leading, spacing: SGSpacing.xs) {
                    Label(title, systemImage: "info.circle")
                        .font(SGTypography.label)
                        .foregroundStyle(.sg(SGColor.textSecondary))
                    ForEach(items, id: \.self) { item in
                        Text("· \(item)")
                            .font(SGTypography.caption)
                            .foregroundStyle(.sg(SGColor.textSecondary))
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
        }
    }
}

// MARK: Sheets

private struct ConfirmCreditSheet: View {
    let credit: LeaveLedger.Credit
    let onSaved: () -> Void
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var halfDays: Int
    @State private var issues: [EventIssue] = []

    init(credit: LeaveLedger.Credit, onSaved: @escaping () -> Void) {
        self.credit = credit
        self.onSaved = onSaved
        // Same default as the web form: the saved confirmation, else the
        // rule's reference days.
        let days = credit.confirmation.map { Double($0.amountHalfDays) / 2 } ?? credit.referenceDays ?? 0
        _halfDays = State(initialValue: Int((days * 2).rounded()))
    }

    var body: some View {
        NavigationStack {
            Form {
                Group {
                    Section {
                        Stepper(value: $halfDays, in: 0...120) {
                            LabeledContent("부여 일수") {
                                Text(halfDays % 2 == 0 ? "\(halfDays / 2)일" : "\(halfDays / 2).5일").monospacedDigit()
                            }
                        }
                    } footer: {
                        Text("기관이 알려 준 \(credit.label) 일수를 반일 단위로 입력해 주세요. \(credit.explanation)")
                    }
                    ForEach(issues, id: \.self) { SGNotice(.danger, title: $0.message) }
                }
                .sgListRowSurface()
            }
            .sgGroupedChrome()
            .navigationTitle(credit.label)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("취소") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("저장") {
                        Task {
                            issues = await model.run("confirmLeaveCredit", [.object([
                                "creditKey": .string(credit.key),
                                "grantDate": .string(credit.grantDate.description),
                                "days": .number(Double(halfDays) / 2),
                                "reason": .string("기관 부여 일수 직접 확인"),
                            ])])
                            if issues.isEmpty { onSaved(); dismiss() }
                        }
                    }
                }
            }
        }
        .presentationDetents([.medium])
    }
}

private struct CorrectionSheet: View {
    let onSaved: () -> Void
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var subtract = true
    @State private var halfDays = 0
    @State private var minutes = 0
    @State private var reason = ""
    @State private var date = Date.now
    @State private var issues: [EventIssue] = []

    var body: some View {
        NavigationStack {
            Form {
                Group {
                    Picker("방향", selection: $subtract) {
                        Text("빼기").tag(true)
                        Text("더하기").tag(false)
                    }
                    .pickerStyle(.segmented)
                    Stepper("반일 \(halfDays)개", value: $halfDays, in: 0...120)
                    Stepper("\(minutes)분", value: $minutes, in: 0...2400, step: 10)
                    DatePicker("적용일", selection: $date, displayedComponents: .date)
                        .environment(\.calendar, .seoul)
                        .environment(\.timeZone, SeoulClock.timeZone)
                    TextField("사유 (예: 기관 기록 반영)", text: $reason)
                    ForEach(issues, id: \.self) { SGNotice(.danger, title: $0.message) }
                }
                .sgListRowSurface()
            }
            .sgGroupedChrome()
            .navigationTitle("보정 추가")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("취소") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("저장") {
                        Task {
                            let sign = subtract ? -1.0 : 1.0
                            issues = await model.run("addLeaveCorrection", [.object([
                                "effectiveDate": .string(Formatters.civilDate(from: date).description),
                                "halfDays": .number(sign * Double(halfDays)),
                                "minutes": .number(sign * Double(minutes)),
                                "reason": .string(reason.trimmingCharacters(in: .whitespaces)),
                            ])])
                            if issues.isEmpty { onSaved(); dismiss() }
                        }
                    }
                    .disabled(reason.trimmingCharacters(in: .whitespaces).isEmpty || (halfDays == 0 && minutes == 0))
                }
            }
        }
    }
}
