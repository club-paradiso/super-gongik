import SGCore
import SGDesignSystem
import SGFoundation
import SwiftUI

/// 복무 설정: the same fields as the web profile form. Saving patches the
/// stored profile through the core; the shared schema validates it.
struct ProfileEditView: View {
    struct Options: Decodable, Sendable {
        struct Basis: Decodable, Sendable, Hashable {
            let value: String
            let label: String
        }

        let residenceRegions: [String]
        let priorServiceBases: [Basis]
        let standardServiceMonths: Int
    }

    struct FareSuggestion: Decodable, Sendable {
        let dailyRoundTripFare: Double
        let basis: String
        let verifiedAt: String
    }

    @Environment(AppModel.self) private var model
    @ScaledMetric(relativeTo: .body) private var fieldScale: CGFloat = 1
    @Environment(\.dismiss) private var dismiss
    @State private var options: Options?
    @State private var draft = Draft()
    @State private var fare: FareSuggestion?
    @State private var issues: [EventIssue] = []
    @State private var loaded = false

    struct Draft: Equatable {
        var callUp = Date.now
        var discharge = Date.now
        var category = ""
        var workHours = ""
        var workMinutes = ""
        var startTime = ""
        var endTime = ""
        var workPattern = ""
        var weekdays: Set<Int> = []
        var priorCredit = ""
        var priorBasis = ""
        var priorMonths = ""
        var priorPartial = false
        var meal = ""
        var region = ""
        var commute = ""
        var live = false
    }

    private static let categories = ["", "사회복지", "보건의료", "교육", "행정", "기타"]
    private static let patterns: [(String, String)] = [
        ("WEEKDAY_DAYTIME", "주간 출퇴근"),
        ("NIGHT_SHIFT_ROTATION", "주·야간 교대(24시간 근무지)"),
        ("RESIDENTIAL", "합숙 근무"),
        ("OTHER", "그 밖의 형태"),
        ("", "아직 모르겠어요"),
    ]

    var body: some View {
        Form {
            Group {
                Section {
                    datePicker("소집일", $draft.callUp)
                    datePicker("소집해제 예정일", $draft.discharge)
                    Picker("복무 분야", selection: $draft.category) {
                        ForEach(Self.categories, id: \.self) { Text($0.isEmpty ? "나중에 정할게요" : $0) }
                    }
                } header: {
                    Text("복무 기간")
                } footer: {
                    Text("소집해제 예정일이 연장 등으로 바뀌었다면 직접 고쳐 주세요.")
                }

                Section {
                    LabeledContent("1일 근무시간") {
                        HStack(spacing: SGSpacing.xxs) {
                            numberField("시간", $draft.workHours, width: 36)
                            Text("시간")
                            numberField("분", $draft.workMinutes, width: 36)
                            Text("분")
                        }
                    }
                    clock("평소 근무 시작", $draft.startTime)
                    clock("평소 근무 종료", $draft.endTime)
                } header: {
                    Text("근무 시간")
                } footer: {
                    Text("근무시간은 시간 단위 휴가를 일수와 합칠 때만 써요. 근무 시각은 시간 연가를 허가지각·허가조퇴·허가외출로 자동 구분할 때 쓰는 기준이에요. 직접 확인한 값만 넣어 주세요.")
                }

                Section {
                    Picker("복무형태", selection: $draft.workPattern) {
                        ForEach(Self.patterns, id: \.0) { Text($0.1).tag($0.0) }
                    }
                    if draft.workPattern == "WEEKDAY_DAYTIME" {
                        WeekdayPicker(selection: $draft.weekdays)
                    }
                } header: {
                    Text("복무형태")
                } footer: {
                    Text("중식비·교통비 근무일 계산은 주간 출퇴근만 지원해요. 야간 교대는 근무일수를 2일로 보는 별도 규정이 있어 계산하지 않아요.")
                }

                Section {
                    Picker("이전 복무 경력 인정", selection: $draft.priorCredit) {
                        Text("없어요").tag("NONE")
                        Text("있어요").tag("HAS_PRIOR_SERVICE")
                        Text("잘 모르겠어요").tag("")
                    }
                    if draft.priorCredit == "HAS_PRIOR_SERVICE" {
                        Picker("해당하는 경우 (제62조제2항)", selection: $draft.priorBasis) {
                            Text("선택해 주세요").tag("")
                            ForEach(options?.priorServiceBases ?? [], id: \.value) { Text($0.label).tag($0.value) }
                        }
                        LabeledContent("인정 기간") {
                            HStack(spacing: SGSpacing.xxs) { numberField("개월", $draft.priorMonths, width: 44); Text("개월") }
                        }
                        Toggle("1개월 미만 기간이 있어요", isOn: $draft.priorPartial)
                    }
                } header: {
                    Text("이전 복무 경력(현역 등)이 보수 등급에 인정되나요?")
                } footer: {
                    Text("병역법 시행령 제62조제2항의 7가지 경우에만 기간이 합산돼요. ‘잘 모르겠어요’면 기본 보수를 계산하지 않아요. 기간은 복무기관에 확인한 값을 넣어 주세요.")
                }

                Section {
                    LabeledContent("1일 중식비 (기관이 더 줄 때만)") {
                        HStack(spacing: SGSpacing.xxs) { numberField("원", $draft.meal, width: 80); Text("원") }
                    }
                    Picker("거주 지역", selection: $draft.region) {
                        Text("지역 선택").tag("")
                        ForEach(options?.residenceRegions ?? [], id: \.self) { Text($0).tag($0) }
                    }
                    LabeledContent("1일 교통비") {
                        HStack(spacing: SGSpacing.xxs) { numberField("원", $draft.commute, width: 80); Text("원") }
                    }
                    if let fare {
                        Button("제안 금액 \(Formatters.won(fare.dailyRoundTripFare)) 넣기") {
                            draft.commute = String(Int(fare.dailyRoundTripFare))
                        }
                        Text("\(fare.basis) · \(fare.verifiedAt) 확인").font(SGTypography.caption)
                            .foregroundStyle(.sg(SGColor.textTertiary))
                    } else if !draft.region.isEmpty {
                        Text("이 지역은 현재 검증된 기본운임 자동값이 없어 직접 입력해야 해요.")
                            .font(SGTypography.caption).foregroundStyle(.sg(SGColor.textTertiary))
                    }
                } header: {
                    Text("중식비·교통비")
                } footer: {
                    Text("병무청 2026년 지급 기준은 1일 중식비 9,000원이 최소이고, 기관이 예산 범위에서 더 줄 수 있어요. 더 받는 경우에만 그 금액을 넣으세요.")
                }

                Section {
                    Toggle("초 단위 진행률", isOn: $draft.live)
                } header: {
                    Text("표시")
                } footer: {
                    Text("켜면 오늘 화면이 열려 있는 동안 1초마다 남은 시간과 복무율을 갱신해요. 위젯은 이렇게 자주 갱신되지 않아요.")
                }

                if !issues.isEmpty {
                    Section { ForEach(issues, id: \.self) { SGNotice(.danger, title: $0.message) } }
                        .listRowBackground(Color.clear)
                }
            }
            .sgListRowSurface()
        }
        .sgGroupedChrome()
        .navigationTitle("복무 설정")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                Button("저장") { Task { await save() } }.disabled(model.isReadOnly)
            }
            ToolbarItem(placement: .cancellationAction) {
                Button("닫기") { dismiss() }
            }
        }
        .task {
            guard !loaded else { return }
            loaded = true
            options = await model.pure("profileOptions", [], as: Options.self)
            loadDraft()
        }
        .task(id: draft.region) {
            fare = draft.region.isEmpty ? nil
                : await model.pure("regionalFareSuggestion", [.string(draft.region)], as: FareSuggestion?.self) ?? nil
        }
    }

    private func datePicker(_ title: String, _ value: Binding<Date>) -> some View {
        DatePicker(title, selection: value, displayedComponents: .date)
            .environment(\.calendar, .seoul)
            .environment(\.timeZone, SeoulClock.timeZone)
    }

    private func numberField(_ label: String, _ text: Binding<String>, width: CGFloat) -> some View {
        TextField("", text: Binding(get: { text.wrappedValue }, set: { text.wrappedValue = String($0.filter(\.isNumber).prefix(7)) }))
            .keyboardType(.numberPad)
            .multilineTextAlignment(.trailing)
            // Grows with Dynamic Type so digits never clip at accessibility sizes.
            .frame(width: width * fieldScale)
            .accessibilityLabel(label)
    }

    private func clock(_ title: String, _ value: Binding<String>) -> some View {
        HStack {
            if value.wrappedValue.isEmpty {
                Text(title)
                Spacer()
                Button("입력") { value.wrappedValue = title.contains("시작") ? "09:00" : "18:00" }
            } else {
                DatePicker(title, selection: Binding(
                    get: {
                        let parts = value.wrappedValue.split(separator: ":").compactMap { Int($0) }
                        return Calendar.seoul.date(from: DateComponents(hour: parts.first, minute: parts.last)) ?? .now
                    },
                    set: {
                        let parts = Calendar.seoul.dateComponents([.hour, .minute], from: $0)
                        value.wrappedValue = String(format: "%02d:%02d", parts.hour ?? 0, parts.minute ?? 0)
                    }), displayedComponents: .hourAndMinute)
                .environment(\.timeZone, SeoulClock.timeZone)
                Button { value.wrappedValue = "" } label: { Image(systemName: "xmark.circle.fill") }
                    .buttonStyle(.plain).foregroundStyle(.sg(SGColor.textTertiary))
                    .accessibilityLabel("\(title) 지우기")
            }
        }
    }

    private func loadDraft() {
        guard let profile = model.profile else { return }
        draft.callUp = Formatters.date(from: profile.callUpDate)
        draft.discharge = Formatters.date(from: profile.expectedDischargeDate)
        draft.category = profile.serviceCategory ?? ""
        if let minutes = profile.workdayMinutes {
            draft.workHours = String(minutes / 60)
            draft.workMinutes = String(minutes % 60)
        }
        draft.startTime = profile.workdayStartTime ?? ""
        draft.endTime = profile.workdayEndTime ?? ""
        draft.workPattern = profile.workPattern ?? ""
        draft.weekdays = Set(profile.workWeekdays ?? (profile.workPattern == "WEEKDAY_DAYTIME" ? [1, 2, 3, 4, 5] : []))
        draft.priorCredit = profile.priorServiceCredit ?? ""
        draft.priorBasis = profile.priorServiceBasis ?? ""
        draft.priorMonths = profile.priorServiceCreditedMonths.map(String.init) ?? ""
        draft.priorPartial = profile.priorServiceCreditHasPartialMonth ?? false
        draft.meal = profile.defaultMealAllowanceOverride.map { String(Int($0)) } ?? ""
        draft.region = profile.residenceRegion ?? ""
        draft.commute = profile.defaultCommuteCost.map { String(Int($0)) } ?? ""
        draft.live = profile.liveProgressEnabled ?? false
    }

    private func save() async {
        func optionalString(_ value: String) -> JSONValue { value.isEmpty ? .null : .string(value) }
        func optionalNumber(_ value: String) -> JSONValue { Double(value).map(JSONValue.number) ?? .null }
        let hours = Int(draft.workHours) ?? 0, minutes = Int(draft.workMinutes) ?? 0
        let workday: JSONValue = draft.workHours.isEmpty && draft.workMinutes.isEmpty ? .null : .number(Double(hours * 60 + minutes))
        let hasPrior = draft.priorCredit == "HAS_PRIOR_SERVICE"
        issues = await model.editProfile([
            "callUpDate": .string(Formatters.civilDate(from: draft.callUp).description),
            "expectedDischargeDate": .string(Formatters.civilDate(from: draft.discharge).description),
            "serviceCategory": optionalString(draft.category),
            "workdayMinutes": workday,
            "workdayStartTime": optionalString(draft.startTime),
            "workdayEndTime": optionalString(draft.endTime),
            "workPattern": optionalString(draft.workPattern),
            "workWeekdays": draft.workPattern == "WEEKDAY_DAYTIME"
                ? .array(draft.weekdays.sorted().map { .number(Double($0)) }) : .null,
            "priorServiceCredit": optionalString(draft.priorCredit),
            "priorServiceBasis": hasPrior ? optionalString(draft.priorBasis) : .null,
            "priorServiceCreditedMonths": hasPrior ? optionalNumber(draft.priorMonths) : .null,
            "priorServiceCreditHasPartialMonth": .bool(hasPrior && draft.priorPartial),
            "defaultMealAllowanceOverride": optionalNumber(draft.meal),
            "residenceRegion": optionalString(draft.region),
            "defaultCommuteCost": optionalNumber(draft.commute),
            "liveProgressEnabled": .bool(draft.live),
        ])
        if issues.isEmpty { dismiss() }
    }
}

private struct WeekdayPicker: View {
    @Binding var selection: Set<Int>

    var body: some View {
        HStack(spacing: SGSpacing.iconGap) {
            ForEach([1, 2, 3, 4, 5, 6, 0], id: \.self) { day in
                let on = selection.contains(day)
                Button {
                    if on { selection.remove(day) } else { selection.insert(day) }
                } label: {
                    Text(Formatters.weekdays[day])
                        .font(SGTypography.label)
                        .frame(maxWidth: .infinity, minHeight: SGSpacing.minimumHitTarget)
                        .foregroundStyle(.sg(on ? SGColor.onAccent : SGColor.textSecondary))
                        .background(.sg(on ? SGColor.accent : SGColor.surfaceInteractive),
                                    in: RoundedRectangle(cornerRadius: SGRadius.small, style: .continuous))
                }
                .buttonStyle(.plain)
                .accessibilityLabel("\(Formatters.weekdays[day])요일")
                .accessibilityAddTraits(on ? .isSelected : [])
            }
        }
        .padding(.vertical, SGSpacing.xxs)
    }
}
