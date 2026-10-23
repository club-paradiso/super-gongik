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

    /// Cited rates for a typed 기관명 from the shared rules registry. Nothing
    /// here is a calculation: the user still confirms and saves the amounts.
    struct InstitutionRates: Decodable, Sendable {
        struct Amount: Decodable, Sendable {
            let amount: Double
            let valueKind: String
            let effectiveYear: Int
            let sourceTitle: String
            let quote: String
            let applicable: Bool
            let caution: String?
        }

        struct Note: Decodable, Sendable, Identifiable {
            let field: String
            let text: String
            let effectiveYear: Int
            let sourceTitle: String
            var id: String { "\(field)|\(text)|\(sourceTitle)" }
        }

        struct Institution: Decodable, Sendable {
            let name: String
            let scopeNote: String
        }

        struct Suggestion: Decodable, Sendable, Hashable {
            let id: String
            let name: String
        }

        let status: String
        let institution: Institution?
        let meal: Amount?
        let transport: Amount?
        let notes: [Note]?
        let suggestions: [Suggestion]?
    }

    @Environment(AppModel.self) private var model
    @Environment(\.openURL) private var openURL
    @ScaledMetric(relativeTo: .body) private var fieldScale: CGFloat = 1
    @Environment(\.dismiss) private var dismiss
    @State private var options: Options?
    @State private var draft = Draft()
    @State private var fare: FareSuggestion?
    @State private var rates: InstitutionRates?
    @State private var autoFilled = false
    @State private var customMeal = false
    @State private var lastFareApplied: String?
    @State private var issues: [EventIssue] = []
    @State private var loaded = false

    struct Draft: Equatable {
        var callUp = Date.now
        var discharge = Date.now
        var category = ""
        var institution = ""
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
                    TextField("예: 경기도교육청, 서울특별시 성북구", text: $draft.institution)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    institutionResult
                } header: {
                    Text("복무기관")
                } footer: {
                    Text("기관명을 입력하면 등록된 공식 자료에서 중식비·교통비 기준을 찾아 보여드려요. 값은 확인 후 저장해야 반영돼요.")
                }

                Section {
                    Picker("중식비", selection: Binding(get: { customMeal }, set: setCustomMeal)) {
                        Text("기본 9,000원").tag(false)
                        Text("기관이 더 줘요").tag(true)
                    }
                    .pickerStyle(.segmented)
                    if customMeal {
                        LabeledContent("기관 1일 중식비") {
                            HStack(spacing: SGSpacing.xxs) { numberField("원", $draft.meal, width: 80); Text("원") }
                        }
                    }
                } header: {
                    Text("중식비")
                } footer: {
                    Text(customMeal
                        ? "기관이 주는 1일 중식비를 넣어 주세요. 9,000원보다 낮은 금액은 쓸 수 없어요."
                        : "병무청 기준 1일 9,000원으로 매달 자동 계산해요. 기관이 더 주는 경우에만 바꾸세요.")
                }

                Section {
                    Picker("거주 지역", selection: $draft.region) {
                        Text("지역 선택").tag("")
                        ForEach(options?.residenceRegions ?? [], id: \.self) { Text($0).tag($0) }
                    }
                    LabeledContent("1일 교통비") {
                        HStack(spacing: SGSpacing.xxs) { numberField("원", $draft.commute, width: 80); Text("원") }
                    }
                    if let fare, draft.commute == String(Int(fare.dailyRoundTripFare)) {
                        Text("지역 기준(\(fare.basis))으로 채웠어요. 실제 요금이 다르면 고쳐 주세요.")
                            .font(SGTypography.caption).foregroundStyle(.sg(SGColor.textTertiary))
                    } else if !draft.region.isEmpty && fare == nil {
                        Text("이 지역은 검증된 기본운임이 아직 없어요. 직접 입력해 주세요.")
                            .font(SGTypography.caption).foregroundStyle(.sg(SGColor.textTertiary))
                    }
                } header: {
                    Text("교통비")
                } footer: {
                    Text("한 번만 정해 두면 매달 자동으로 계산해요. 병무청 기준은 시내버스 왕복 현금요금이고, 환승·지하철 장거리는 교통카드 실비예요.")
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
        .task(id: draft.institution) {
            await lookupInstitution()
        }
        .task(id: draft.region) {
            fare = draft.region.isEmpty ? nil
                : await model.pure("regionalFareSuggestion", [.string(draft.region)], as: FareSuggestion?.self) ?? nil
            // Fill the suggested fare, but never over an amount the user typed.
            if let fare, draft.commute.isEmpty || draft.commute == lastFareApplied {
                draft.commute = String(Int(fare.dailyRoundTripFare))
                lastFareApplied = draft.commute
            }
        }
    }


    private var institutionResult: some View {
        Group {
            if let rates, rates.status == "MATCHED", let institution = rates.institution {
                VStack(alignment: .leading, spacing: SGSpacing.xxs) {
                    Label(institution.name, systemImage: "checkmark.seal")
                        .font(SGTypography.label)
                    Text(institution.scopeNote).font(SGTypography.caption)
                        .foregroundStyle(.sg(SGColor.textTertiary))
                }
                if let meal = rates.meal { amountRow("중식비", meal, apply: { draft.meal = String(Int(meal.amount)); customMeal = true }, applied: draft.meal) }
                if let transport = rates.transport { amountRow("교통비", transport, apply: { draft.commute = String(Int(transport.amount)) }, applied: draft.commute) }
                if rates.meal == nil && rates.transport == nil {
                    Text("이 기관의 중식비·교통비 금액 근거는 아직 없어요. 직접 입력해 주세요.")
                        .font(SGTypography.caption).foregroundStyle(.sg(SGColor.textTertiary))
                }
                if autoFilled {
                    Text("비어 있던 칸을 기관 기준으로 채웠어요. 저장하기 전에 확인해 주세요.")
                        .font(SGTypography.caption).foregroundStyle(.sg(SGColor.textTertiary))
                }
                if let notes = rates.notes, !notes.isEmpty {
                    DisclosureGroup("이 기관의 확인된 규칙 \(notes.count)건") {
                        ForEach(notes) { note in
                            VStack(alignment: .leading, spacing: 2) {
                                Text(Self.fieldLabel(note.field)).font(SGTypography.caption.weight(.semibold))
                                Text(note.text).font(SGTypography.caption)
                                Text("\(note.effectiveYear)년 · \(note.sourceTitle)").font(SGTypography.caption)
                                    .foregroundStyle(.sg(SGColor.textTertiary))
                            }
                            .padding(.vertical, 2)
                        }
                    }
                }
            } else if let rates, rates.status == "UNKNOWN_INSTITUTION", !draft.institution.trimmingCharacters(in: .whitespaces).isEmpty {
                if let list = rates.suggestions, !list.isEmpty {
                    Text("혹시 이 기관인가요?").font(SGTypography.caption)
                    ForEach(list.prefix(5), id: \.self) { item in
                        Button(item.name) { draft.institution = item.name }
                    }
                } else {
                    Text("등록된 기관 근거가 없어요. 중식비·교통비는 직접 입력해 주세요.")
                        .font(SGTypography.caption).foregroundStyle(.sg(SGColor.textTertiary))
                }
                Button("우리 기관 기준 제보하기") { reportInstitution() }
                    .font(SGTypography.caption)
            }
        }
    }

    private func amountRow(_ label: String, _ amount: InstitutionRates.Amount, apply: @escaping () -> Void, applied: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack {
                Text("\(label) \(Formatters.won(amount.amount))").font(SGTypography.label)
                Spacer()
                if amount.applicable {
                    if applied == String(Int(amount.amount)) {
                        Text("적용됨").font(SGTypography.caption).foregroundStyle(.sg(SGColor.textTertiary))
                    } else {
                        Button("적용", action: apply)
                    }
                }
            }
            Text("\(amount.effectiveYear)년 · \(amount.sourceTitle)").font(SGTypography.caption)
                .foregroundStyle(.sg(SGColor.textTertiary))
            if let caution = amount.caution {
                Text(caution).font(SGTypography.caption).foregroundStyle(.sg(SGColor.textTertiary))
            }
        }
    }

    private static func fieldLabel(_ field: String) -> String {
        switch field {
        case "TRANSPORT_METHOD": "교통비 지급 방식"
        case "MEAL_ON_LEAVE": "휴가 시 중식비"
        case "TRANSPORT_ON_LEAVE": "휴가 시 교통비"
        case "MEAL_ON_ABSENCE": "결근 시 중식비"
        case "TRANSPORT_ON_ABSENCE": "결근 시 교통비"
        case "MEAL_ON_PARTIAL_DAY": "반일·시간 단위 중식비"
        case "ROUNDING": "단수처리"
        case "PAY_DAY": "급여 지급일"
        case "WORK_DAYS_RULE": "근무일수 규칙"
        default: "그 밖의 규칙"
        }
    }

    /// Looks the typed name up and, the first time a registered institution
    /// matches, fills only the amounts the user has not entered. Applicable
    /// amounts only: nothing below the 2026 minimum, nothing invented.
    private func lookupInstitution() async {
        let name = draft.institution.trimmingCharacters(in: .whitespaces)
        guard !name.isEmpty else { rates = nil; return }
        try? await Task.sleep(for: .milliseconds(350))
        guard !Task.isCancelled else { return }
        let year = Calendar.seoul.component(.year, from: .now)
        let result = await model.pure("suggestInstitutionRates", [.string(name), .number(Double(year))], as: InstitutionRates.self)
        guard !Task.isCancelled else { return }
        rates = result
        guard let result, result.status == "MATCHED" else { return }
        var filled = false
        if draft.meal.isEmpty, let meal = result.meal, meal.applicable, meal.amount > 9000 {
            draft.meal = String(Int(meal.amount)); customMeal = true; filled = true
        }
        if draft.commute.isEmpty, let transport = result.transport, transport.applicable {
            draft.commute = String(Int(transport.amount)); filled = true
        }
        if filled { autoFilled = true }
    }

    /// Opens a prefilled public GitHub issue. Only what the user typed on this
    /// form goes into it, and they review and submit it themselves.
    private func reportInstitution() {
        let name = draft.institution.trimmingCharacters(in: .whitespaces)
        let body = """
        기관명: \(name)
        1일 중식비: \(draft.meal.isEmpty ? "(모름)" : draft.meal + "원")
        1일 교통비: \(draft.commute.isEmpty ? "(모름)" : draft.commute + "원")
        휴가·결근일 식비/교통비 지급 여부:
        단수처리(예: 10원 미만 절사):
        급여 지급일:
        근거 자료(공문·지침 링크나 문서명, 게시일):

        ※ 개인정보(이름, 계좌, 소집일 등)는 적지 마세요. 이 글은 공개돼요.
        """
        var components = URLComponents(string: "https://github.com/club-paradiso/super-gongik/issues/new")!
        components.queryItems = [
            URLQueryItem(name: "title", value: "기관 규칙 제보: \(name)"),
            URLQueryItem(name: "body", value: body),
            URLQueryItem(name: "labels", value: "institution-rules"),
        ]
        if let url = components.url { openURL(url) }
    }

    private func setCustomMeal(_ on: Bool) {
        customMeal = on
        if !on {
            draft.meal = ""
        } else if draft.meal.isEmpty, let meal = rates?.meal, meal.applicable, meal.amount > 9000 {
            draft.meal = String(Int(meal.amount))
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
        draft.institution = profile.institutionName ?? ""
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
        customMeal = !draft.meal.isEmpty
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
            "institutionName": optionalString(draft.institution.trimmingCharacters(in: .whitespaces)),
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
