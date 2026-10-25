import SGCore
import SGDesignSystem
import SGFoundation
import SwiftUI

/// Create or edit a service record. The form state is the web editor's
/// `FormState`; every edit goes through the shared `applyFormPatch`, and the
/// draft, validation and automatic classification come from the shared
/// `eventFormEvaluate`. This view only lays them out.
///
/// A refused save is reported at the top of the form (summary, scrolled into
/// view and announced to VoiceOver) and next to the section it concerns; the
/// draft stays as typed. A duplicate or overlap also names the stored record
/// and opens it in a second sheet, leaving this one untouched.
struct EventEditorSheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    let event: ServiceEvent?
    let initialDate: CivilDate
    /// A new record's type when a button already names it (홈 "연가 사용").
    var initialType: String? = nil

    @State private var form: EventFormState?
    @State private var evaluation: EventFormEvaluation?
    @State private var submitErrors: [EventIssue] = []
    @State private var acknowledgedWarnings: String?
    @State private var saving = false
    @State private var confirmingDelete = false
    /// Bumped on every refused save so the form scrolls to the summary.
    @State private var feedbackRevision = 0
    @State private var viewingConflict: ServiceEvent?
    @AccessibilityFocusState private var feedbackFocused: Bool
    /// The form as loaded; closing with a different form asks first.
    @State private var original: EventFormState?
    @State private var saved = false
    @State private var confirmingDiscard = false

    private static let feedbackAnchor = "event-editor-feedback"

    var body: some View {
        NavigationStack {
            Group {
                if let form {
                    content(form)
                } else {
                    ProgressView()
                }
            }
            .navigationTitle(event == nil ? "기록 추가" : "기록 수정")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("닫기") {
                        if hasUnsavedChanges { confirmingDiscard = true } else { dismiss() }
                    }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(showsWarnings ? "확인했어요, 저장" : "저장") { Task { await save() } }
                        .disabled(saving || form == nil || model.isReadOnly)
                        .fontWeight(.semibold)
                }
            }
            .sheet(item: $viewingConflict) { existing in
                EventEditorSheet(event: existing, initialDate: existing.startDate)
            }
        }
        .presentationDetents([.large])
        // Pulling the sheet down with unsaved edits is blocked so 닫기 can ask;
        // without edits it closes as before (IOS-08).
        .interactiveDismissDisabled(hasUnsavedChanges)
        .discardChangesDialog(isPresented: $confirmingDiscard) { dismiss() }
        .task { await load() }
    }

    private var warningsKey: String {
        evaluation?.validation.warnings.map(\.message).joined(separator: "|") ?? ""
    }

    private var showsWarnings: Bool {
        !(evaluation?.validation.warnings.isEmpty ?? true) && acknowledgedWarnings == warningsKey
    }

    private var hasUnsavedChanges: Bool {
        EditorDismissGuard.needsConfirmation(original: original, current: form, saved: saved)
    }

    /// Stored records the refused save collides with (only for conflict codes).
    private var conflicts: [ServiceEvent] {
        guard let form, submitErrors.contains(where: EventEditorFeedback.isConflict) else { return [] }
        return EventEditorFeedback.conflicts(with: form, excluding: event?.id, in: model.document?.liveEvents ?? [])
    }

    @ViewBuilder
    private func content(_ form: EventFormState) -> some View {
        let evaluation = self.evaluation
        let annual = evaluation?.isAnnualCharge ?? false
        ScrollViewReader { proxy in
            Form {
                Group {
                    if !submitErrors.isEmpty || showsWarnings {
                        feedbackSection
                    }

                    Section {
                        Picker("종류", selection: binding(\.eventType)) {
                            ForEach(model.taxonomy?.typeGroups ?? []) { group in
                                Section(group.label) {
                                    ForEach(group.types, id: \.self) { type in
                                        Text(model.label(for: type)).tag(type)
                                    }
                                }
                            }
                        }
                        if form.eventType == "SICK_LEAVE" {
                            Picker("병가 구분", selection: binding(\.sickLeaveCategory)) {
                                Text("공무 외 질병·부상").tag("ORDINARY")
                                Text("공무수행상 질병·부상").tag("PUBLIC_DUTY")
                                Text("아직 확인하지 못함").tag("UNKNOWN")
                                if form.sickLeaveCategory.isEmpty { Text("선택").tag("") }
                            }
                        }
                    } footer: {
                        fieldHints(.type)
                    }

                    Section {
                        Picker("기록 단위", selection: binding(\.mode)) {
                            Text(annual ? "종일 연가" : "하루 단위").tag("ALL_DAY")
                            if form.eventType == "ANNUAL_LEAVE" {
                                Text(annual ? "반가" : "반일").tag("HALF_DAY")
                            }
                            if !(evaluation?.isNonPayable ?? false) {
                                Text(annual ? "시간 사용" : "시간 단위").tag("PARTIAL")
                            }
                        }
                        .pickerStyle(.segmented)
                        .listRowSeparator(.hidden)
                    } header: {
                        Text("기록 단위")
                    } footer: {
                        if evaluation?.isNonPayable == true {
                            Text("이 기록은 기본 보수 미지급일 근거로 쓰이므로 하루 단위로만 저장해요.")
                        } else if form.eventType != "ANNUAL_LEAVE" && !annual {
                            Text("반일은 연가(반가)에만 쓸 수 있어요.")
                        } else if form.mode == "HALF_DAY" {
                            Text("반가는 단순한 4시간 사용이 아니에요. 오전·오후 반일 승인 단위이며 14:00를 기준으로 구분해요.")
                        }
                    }

                    Section {
                        switch form.mode {
                        case "ALL_DAY":
                            datePicker("시작일", \.startDate)
                            datePicker("종료일", \.endDate)
                            Stepper(value: dayCountBinding, in: 1...365) {
                                LabeledContent(evaluation?.isLeave == true ? "차감 일수" : "일수") {
                                    Text("\(form.dayCount)일").monospacedDigit()
                                }
                            }
                        case "HALF_DAY":
                            datePicker("날짜", \.startDate)
                            Picker("오전 또는 오후", selection: binding(\.half)) {
                                Text("오전").tag("AM")
                                Text("오후").tag("PM")
                            }
                            .pickerStyle(.segmented)
                        default:
                            datePicker("날짜", \.startDate)
                            clockField("시작 시각 (선택)", \.startTime)
                            clockField("종료 시각 (선택)", \.endTime)
                            DurationField(hours: form.hours, minutes: form.minutes) { hours, minutes in
                                // Same result as `applyFormPatch` for a touched
                                // duration, without a round trip per keystroke.
                                self.form?.hours = hours
                                self.form?.minutes = minutes
                                self.form?.durationTouched = true
                                Task { await evaluate() }
                            }
                        }
                    } footer: {
                        VStack(alignment: .leading, spacing: SGSpacing.xxs) {
                            fieldHints(.dates)
                            fieldHints(.timing)
                        }
                    }

                    if let classification = evaluation?.classification {
                        Section {
                            VStack(alignment: .leading, spacing: SGSpacing.xxs) {
                                Text("자동 구분: \(classification.label)").font(SGTypography.bodyStrong)
                                Text(classification.reason).font(SGTypography.caption)
                                if classification.kind == "LATE_ARRIVAL" {
                                    Text("입력 시간이 4시간이어도 14:00 반일 경계와 맞지 않으면 반가로 바꾸지 않고 허가지각으로 저장해요. 누계 8시간은 연가 1일로 공제해요.")
                                        .font(SGTypography.caption)
                                } else if classification.kind == "HALF_DAY" && form.mode == "PARTIAL" {
                                    Text("입력 구간이 14:00 반일 경계와 정확히 맞아 반가로 저장해요.").font(SGTypography.caption)
                                }
                            }
                            .foregroundStyle(.sg(SGColor.info))
                            .accessibilityElement(children: .combine)
                        }
                    }

                    Section("메모 (선택)") {
                        TextField("예: 가족 행사", text: binding(\.note), axis: .vertical)
                            .lineLimit(2...5)
                    }

                    if let event {
                        Section {
                            Button("이 기록 삭제", role: .destructive) { confirmingDelete = true }
                                .frame(maxWidth: .infinity)
                                .confirmationDialog("이 기록을 삭제할까요?", isPresented: $confirmingDelete, titleVisibility: .visible) {
                                    Button("삭제", role: .destructive) { Task { await delete(event) } }
                                } message: {
                                    Text("최근 삭제한 기록에서 되돌릴 수 있어요.")
                                }
                        }
                    }
                }
                .sgListRowSurface()
            }
            .sgGroupedChrome()
            .scrollDismissesKeyboard(.interactively)
            .onChange(of: feedbackRevision) {
                // The summary is the first row; a refused save brings it back
                // into view however far the form was scrolled, then moves
                // VoiceOver to it.
                withAnimation(.easeInOut) { proxy.scrollTo(Self.feedbackAnchor, anchor: .top) }
                feedbackFocused = true
            }
        }
    }

    /// The refusal summary and every message, first in the form. A conflict
    /// also lists the stored records it collides with; opening one shows it in
    /// its own sheet and leaves this draft as typed.
    private var feedbackSection: some View {
        Section {
            VStack(alignment: .leading, spacing: SGSpacing.xs) {
                if !submitErrors.isEmpty {
                    SGNotice(.danger, title: EventEditorFeedback.summary(submitErrors),
                             message: submitErrors.map(\.message).joined(separator: "\n"))
                        .accessibilityFocused($feedbackFocused)
                    ForEach(conflicts) { existing in
                        conflictRow(existing)
                    }
                }
                if showsWarnings {
                    ForEach(evaluation?.validation.warnings ?? [], id: \.self) { warning in
                        SGNotice(.warning, title: warning.message)
                    }
                }
            }
            .id(Self.feedbackAnchor)
        }
        .listRowBackground(Color.clear)
        .listRowInsets(EdgeInsets())
    }

    private func conflictRow(_ existing: ServiceEvent) -> some View {
        let display = model.projection?.eventDisplay?[existing.id]
        let range = existing.endDate != existing.startDate
            ? "\(Formatters.shortDate(existing.startDate)) ~ \(Formatters.shortDate(existing.endDate))"
            : Formatters.shortDate(existing.startDate)
        return Button {
            viewingConflict = existing
        } label: {
            HStack(spacing: SGSpacing.sm) {
                VStack(alignment: .leading, spacing: SGSpacing.xxxs) {
                    Text("기존 기록 보기").font(SGTypography.label).foregroundStyle(.sg(SGColor.accent))
                    Text("\(display?.label ?? model.label(for: existing.eventType)) · \(range) · \(display?.timing ?? "")")
                        .font(SGTypography.caption).foregroundStyle(.sg(SGColor.textSecondary))
                        .multilineTextAlignment(.leading)
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.right").font(.caption).foregroundStyle(.sg(SGColor.textTertiary))
                    .accessibilityHidden(true)
            }
            .padding(SGSpacing.sm)
            .frame(minHeight: SGSpacing.minimumHitTarget)
            .background(.sg(SGColor.surfaceRaised), in: RoundedRectangle(cornerRadius: SGRadius.control, style: .continuous))
        }
        .buttonStyle(.plain)
        .accessibilityHint("지금 입력한 내용은 그대로 두고 기존 기록을 열어요")
    }

    /// The messages of one form section, under that section.
    @ViewBuilder
    private func fieldHints(_ area: EventEditorFeedback.Area) -> some View {
        let hints = EventEditorFeedback.issues(submitErrors, in: area)
        if !hints.isEmpty {
            VStack(alignment: .leading, spacing: SGSpacing.xxxs) {
                ForEach(hints, id: \.self) { issue in
                    Label(issue.message, systemImage: SGTone.danger.symbol)
                        .foregroundStyle(.sg(SGColor.danger))
                }
            }
            .fixedSize(horizontal: false, vertical: true)
        }
    }

    // MARK: Bindings through the shared form model

    private func binding(_ keyPath: WritableKeyPath<EventFormState, String>) -> Binding<String> {
        Binding(
            get: { form?[keyPath: keyPath] ?? "" },
            set: { newValue in
                if keyPath == \.note || keyPath == \.title {
                    // Free text passes through `applyFormPatch` unchanged;
                    // set it locally so typing never waits on the core.
                    form?[keyPath: keyPath] = newValue
                    Task { await evaluate() }
                } else {
                    apply([Self.key(keyPath): .string(newValue)])
                }
            })
    }

    private var dayCountBinding: Binding<Int> {
        Binding(
            get: { Int(form?.dayCount ?? "1") ?? 1 },
            set: { apply(["dayCount": .string(String($0)), "dayCountTouched": .bool(true)]) })
    }

    private func datePicker(_ title: String, _ keyPath: WritableKeyPath<EventFormState, String>) -> some View {
        DatePicker(title, selection: Binding(
            get: { Formatters.date(from: CivilDate(form?[keyPath: keyPath] ?? "") ?? model.today) },
            set: { apply([Self.key(keyPath): .string(Formatters.civilDate(from: $0).description)]) }
        ), displayedComponents: .date)
        .environment(\.calendar, .seoul)
        .environment(\.timeZone, SeoulClock.timeZone)
    }

    private func clockField(_ title: String, _ keyPath: WritableKeyPath<EventFormState, String>) -> some View {
        ClockField(title: title, value: form?[keyPath: keyPath] ?? "") { value in
            apply([Self.key(keyPath): .string(value)])
        }
    }

    private static func key(_ keyPath: WritableKeyPath<EventFormState, String>) -> String {
        switch keyPath {
        case \.eventType: "eventType"
        case \.mode: "mode"
        case \.startDate: "startDate"
        case \.endDate: "endDate"
        case \.half: "half"
        case \.startTime: "startTime"
        case \.endTime: "endTime"
        case \.sickLeaveCategory: "sickLeaveCategory"
        case \.title: "title"
        default: "note"
        }
    }

    // MARK: Core calls

    private func load() async {
        guard let runtime = model.core else { return }
        form = try? await runtime.eventFormInitial(eventId: event?.id, date: initialDate)
        if event == nil, let initialType, let current = form, let json = try? JSONValue.from(current),
           let typed = await model.pure("eventFormPatch", [json, .object(["eventType": .string(initialType)])],
                                        as: EventFormState.self) {
            form = typed
        }
        original = form
        await evaluate()
    }

    private func apply(_ patch: [String: JSONValue]) {
        guard let current = form, let currentJSON = try? JSONValue.from(current) else { return }
        submitErrors = []
        Task {
            if let next = await model.pure("eventFormPatch", [currentJSON, .object(patch)], as: EventFormState.self) {
                form = next
                await evaluate()
            }
        }
    }

    /// Draft, validation and classification against the stored profile and
    /// events (read inside the core, never re-encoded from Swift models).
    private func evaluate() async {
        guard let form, let runtime = model.core else { return }
        do {
            evaluation = try await runtime.eventFormEvaluate(form, editingId: event?.id)
        } catch {
            AppLog.error("event form evaluate failed: \(error)")
        }
    }

    private func save() async {
        guard let evaluation else { return }
        if !evaluation.validation.errors.isEmpty {
            refuse(evaluation.validation.errors)
            return
        }
        if !evaluation.validation.warnings.isEmpty && acknowledgedWarnings != warningsKey {
            acknowledgedWarnings = warningsKey
            feedbackRevision += 1
            UIAccessibility.post(notification: .announcement,
                                 argument: "확인이 필요해요. " + evaluation.validation.warnings.map(\.message).joined(separator: " "))
            return
        }
        saving = true
        defer { saving = false }
        let issues: [EventIssue]
        if let event {
            issues = await model.run("updateServiceEvent", [.string(event.id), evaluation.draft])
        } else {
            issues = await model.run("createServiceEvent", [evaluation.draft])
        }
        if issues.isEmpty {
            saved = true
            UIAccessibility.post(notification: .announcement, argument: "저장했어요")
            dismiss()
        } else {
            refuse(issues)
        }
    }

    /// Keeps the draft, shows the issues first in the form and tells VoiceOver.
    private func refuse(_ issues: [EventIssue]) {
        submitErrors = issues
        feedbackRevision += 1
        UIAccessibility.post(notification: .announcement, argument: EventEditorFeedback.announcement(issues))
    }

    private func delete(_ event: ServiceEvent) async {
        if await model.run("deleteServiceEvent", [.string(event.id)]).isEmpty {
            saved = true
            dismiss()
        }
    }
}

/// "HH:MM" clock entry with an explicit clear, matching the web's optional
/// time inputs (empty means "not given").
private struct ClockField: View {
    let title: String
    let value: String
    let onChange: (String) -> Void

    var body: some View {
        HStack {
            if value.isEmpty {
                Text(title).foregroundStyle(.sg(SGColor.textSecondary))
                Spacer()
                Button("입력") { onChange("09:00") }
            } else {
                DatePicker(title, selection: Binding(
                    get: { Self.date(from: value) },
                    set: { onChange(Self.text(from: $0)) }
                ), displayedComponents: .hourAndMinute)
                .environment(\.timeZone, SeoulClock.timeZone)
                Button {
                    onChange("")
                } label: {
                    Image(systemName: "xmark.circle.fill").foregroundStyle(.sg(SGColor.textTertiary))
                }
                .buttonStyle(.plain)
                .accessibilityLabel("\(title) 지우기")
            }
        }
    }

    static func date(from text: String) -> Date {
        let parts = text.split(separator: ":").compactMap { Int($0) }
        var components = DateComponents()
        components.hour = parts.first ?? 9
        components.minute = parts.count > 1 ? parts[1] : 0
        return Calendar.seoul.date(from: components) ?? .now
    }

    static func text(from date: Date) -> String {
        let parts = Calendar.seoul.dateComponents([.hour, .minute], from: date)
        return String(format: "%02d:%02d", parts.hour ?? 0, parts.minute ?? 0)
    }
}

private struct DurationField: View {
    let hours: String
    let minutes: String
    let onChange: (String, String) -> Void
    /// Two-digit field width that grows with Dynamic Type.
    @ScaledMetric(relativeTo: .body) private var fieldWidth: CGFloat = 44

    var body: some View {
        LabeledContent("사용 시간") {
            HStack(spacing: SGSpacing.xs) {
                TextField("0", text: Binding(get: { hours }, set: { onChange(digits($0), minutes) }))
                    .keyboardType(.numberPad)
                    .multilineTextAlignment(.trailing)
                    .frame(width: fieldWidth)
                    .accessibilityLabel("시간")
                Text("시간")
                TextField("0", text: Binding(get: { minutes }, set: { onChange(hours, digits($0)) }))
                    .keyboardType(.numberPad)
                    .multilineTextAlignment(.trailing)
                    .frame(width: fieldWidth)
                    .accessibilityLabel("분")
                Text("분")
            }
            .monospacedDigit()
        }
    }

    private func digits(_ text: String) -> String { String(text.filter(\.isNumber).prefix(4)) }
}
