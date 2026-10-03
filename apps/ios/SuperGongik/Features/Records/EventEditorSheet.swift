import SGCore
import SGDesignSystem
import SGFoundation
import SwiftUI

/// Create or edit a service record. The form state is the web editor's
/// `FormState`; every edit goes through the shared `applyFormPatch`, and the
/// draft, validation and automatic classification come from the shared
/// `eventFormEvaluate`. This view only lays them out.
struct EventEditorSheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    let event: ServiceEvent?
    let initialDate: CivilDate

    @State private var form: EventFormState?
    @State private var evaluation: EventFormEvaluation?
    @State private var submitErrors: [EventIssue] = []
    @State private var acknowledgedWarnings: String?
    @State private var saving = false
    @State private var confirmingDelete = false

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
                    Button("닫기") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(showsWarnings ? "확인했어요, 저장" : "저장") { Task { await save() } }
                        .disabled(saving || form == nil || model.isReadOnly)
                        .fontWeight(.semibold)
                }
            }
        }
        .presentationDetents([.large])
        .task { await load() }
    }

    private var warningsKey: String {
        evaluation?.validation.warnings.map(\.message).joined(separator: "|") ?? ""
    }

    private var showsWarnings: Bool {
        !(evaluation?.validation.warnings.isEmpty ?? true) && acknowledgedWarnings == warningsKey
    }

    @ViewBuilder
    private func content(_ form: EventFormState) -> some View {
        let evaluation = self.evaluation
        let annual = evaluation?.isAnnualCharge ?? false
        Form {
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

            let errors = submitErrors.isEmpty ? [] : submitErrors
            if !errors.isEmpty || showsWarnings {
                Section {
                    ForEach(errors, id: \.self) { SGNotice(.danger, title: $0.message) }
                    if showsWarnings {
                        ForEach(evaluation?.validation.warnings ?? [], id: \.self) { SGNotice(.warning, title: $0.message) }
                    }
                }
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets())
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
        .scrollDismissesKeyboard(.interactively)
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
            submitErrors = evaluation.validation.errors
            return
        }
        if !evaluation.validation.warnings.isEmpty && acknowledgedWarnings != warningsKey {
            acknowledgedWarnings = warningsKey
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
            UIAccessibility.post(notification: .announcement, argument: "저장했어요")
            dismiss()
        } else {
            submitErrors = issues
        }
    }

    private func delete(_ event: ServiceEvent) async {
        if await model.run("deleteServiceEvent", [.string(event.id)]).isEmpty {
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

    var body: some View {
        LabeledContent("사용 시간") {
            HStack(spacing: SGSpacing.xs) {
                TextField("0", text: Binding(get: { hours }, set: { onChange(digits($0), minutes) }))
                    .keyboardType(.numberPad)
                    .multilineTextAlignment(.trailing)
                    .frame(width: 44)
                    .accessibilityLabel("시간")
                Text("시간")
                TextField("0", text: Binding(get: { minutes }, set: { onChange(hours, digits($0)) }))
                    .keyboardType(.numberPad)
                    .multilineTextAlignment(.trailing)
                    .frame(width: 44)
                    .accessibilityLabel("분")
                Text("분")
            }
            .monospacedDigit()
        }
    }

    private func digits(_ text: String) -> String { String(text.filter(\.isNumber).prefix(4)) }
}
