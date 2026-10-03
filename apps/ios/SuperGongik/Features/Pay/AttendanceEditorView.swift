import SGCore
import SGDesignSystem
import SGFoundation
import SwiftUI

/// 이 달 근무일 확인: the web money tab's attendance editor. Which days are
/// offered, what is saved and how records-derived non-payable dates merge
/// come from the shared money model (`attendanceEditorDays`,
/// `attendanceMonthInput`); this view only collects the answers.
struct AttendanceEditorView: View {
    struct Day: Decodable, Sendable, Hashable, Identifiable {
        let date: CivilDate
        let kind: String
        let requiresDecision: Bool
        var id: CivilDate { date }
    }

    struct Override: Codable, Sendable, Hashable {
        let date: CivilDate
        var mealEligible: Bool?
        var transportEligible: Bool?
    }

    struct Existing: Decodable, Sendable {
        let nonWorkingDates: [CivilDate]
        let dayOverrides: [Override]
        let hadNonPayableAbsence: Bool
        let nonPayableDates: [CivilDate]?
        let nonPayableDatesConfirmed: Bool?
        let roundingPolicy: String?
    }

    struct Editor: Decodable, Sendable {
        let existing: Existing?
        let days: [Day]
        let scheduled: [Day]
        let decisionDays: [Day]
        let derivedNonPayableDates: [CivilDate]
        let mealEligibleDays: Double?
        let transportEligibleDays: Double?
        let needsReconfirmation: Bool
        let dayKindLabels: [String: String]
    }

    let month: CivilDate
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var editor: Editor?
    @State private var loaded = false
    @State private var nonWorking: Set<CivilDate> = []
    @State private var decisions: [CivilDate: Override] = [:]
    @State private var hadAbsence = false
    @State private var nonPayable: Set<CivilDate> = []
    @State private var nonPayableConfirmed = false
    @State private var rounding = ""
    @State private var message: (SGTone, String)?

    private var monthText: String { String(format: "%04d-%02d", month.year, month.month) }

    var body: some View {
        Form {
            if let editor {
                Section {
                    LabeledContent("중식비 대상", value: editor.mealEligibleDays.map { "\(Int($0))일" } ?? "?일")
                    LabeledContent("교통비 대상", value: editor.transportEligibleDays.map { "\(Int($0))일" } ?? "?일")
                } footer: {
                    Text("공휴일 달력은 앱에 넣지 않았어요. 쉬는 날을 직접 표시하고 저장해야 중식비·교통비 일수를 세요."
                         + (editor.needsReconfirmation ? " 확인한 뒤 기록이 바뀌어 다시 저장해야 해요." : ""))
                }

                Section("근무 요일 중 쉬는 날 (공휴일·기관 휴무)") {
                    ForEach(editor.scheduled) { day in
                        Toggle(isOn: Binding(
                            get: { nonWorking.contains(day.date) },
                            set: { on in
                                if on { nonWorking.insert(day.date) } else { nonWorking.remove(day.date) }
                                Task { await reload() }
                            })) {
                            dayLabel(day, editor)
                        }
                    }
                }

                if !editor.decisionDays.isEmpty {
                    Section {
                        ForEach(editor.decisionDays) { day in
                            VStack(alignment: .leading, spacing: SGSpacing.xs) {
                                dayLabel(day, editor)
                                HStack {
                                    choice("중식비", day.date, \.mealEligible)
                                    choice("교통비", day.date, \.transportEligible)
                                }
                            }
                        }
                    } header: {
                        Text("중식비·교통비 지급 여부를 정할 날")
                    } footer: {
                        Text("휴가·외출·지각·조퇴·교육·훈련 날의 중식비·교통비 지급 여부는 법령과 병무청 지급 기준에 휴가 종류별로 정해져 있지 않아요. 복무기관 기준대로 둘 다 골라야 그날이 계산에 들어가요. 하나라도 미정이면 합계를 내지 않아요.")
                    }
                }

                Section {
                    let derived = Set(editor.derivedNonPayableDates)
                    ForEach(editor.days.filter { $0.kind != "OUTSIDE_SERVICE" }) { day in
                        Toggle(isOn: Binding(
                            get: { nonPayable.contains(day.date) || derived.contains(day.date) },
                            set: { on in if on { nonPayable.insert(day.date) } else { nonPayable.remove(day.date) } })) {
                            HStack {
                                Text("\(day.date.month)/\(day.date.day) (\(Formatters.weekdays[day.date.weekday]))").monospacedDigit()
                                Spacer()
                                Text(derived.contains(day.date) ? "기록에서 자동 도출" : nonPayable.contains(day.date) ? "미지급" : "지급")
                                    .font(SGTypography.caption).foregroundStyle(.sg(SGColor.textTertiary))
                            }
                        }
                        .disabled(derived.contains(day.date))
                    }
                    Toggle("이 달의 기본 보수 미지급 날짜를 전부 확인했어요", isOn: $nonPayableConfirmed)
                    Toggle("정확한 날짜를 아직 모르는 미지급 사유가 남아 있어요", isOn: $hadAbsence)
                } header: {
                    Text("기본 보수 미지급 날짜")
                } footer: {
                    Text("복무중단·복무이탈·연가 초과 결근·보수 미지급 병가처럼 기본 보수를 받지 않는 날짜만 표시하세요. 중식비·교통비 판단과는 별개예요."
                         + (editor.derivedNonPayableDates.isEmpty ? "" : " 복무 기록에서 \(editor.derivedNonPayableDates.count)일을 자동 도출했어요. 자동 도출 날짜는 원본 복무 기록을 수정해야 바뀌어요."))
                }

                Section {
                    Picker("기본 보수 끝수 처리", selection: $rounding) {
                        Text("아직 확인하지 않음").tag("")
                        Text("국고금 관리법 제47조 적용 확인 (10원 미만 버림)").tag("NATIONAL_TREASURY_ARTICLE_47")
                        Text("기관에서 10원 미만 절사 적용을 직접 확인").tag("INSTITUTION_CONFIRMED_TRUNCATE_SUB_10")
                        Text("기관이 다른 방식 사용 / 정확한 방식 미확인").tag("INSTITUTION_OTHER_OR_UNKNOWN")
                    }
                    .pickerStyle(.navigationLink)
                } footer: {
                    Text("국가기관 이름만 보고 자동 선택하지 않아요. 지급 회계 기준을 실제로 확인한 경우에만 선택하세요.")
                }

                if let message {
                    Section { SGNotice(message.0, title: message.1) }
                        .listRowBackground(Color.clear).listRowInsets(EdgeInsets())
                }
            } else {
                ProgressView()
            }
        }
        .navigationTitle("\(month.month)월 근무일 확인")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) { Button("닫기") { dismiss() } }
            ToolbarItem(placement: .confirmationAction) {
                Button("저장") { Task { await save() } }.disabled(editor == nil || model.isReadOnly)
            }
        }
        .task {
            guard !loaded else { return }
            loaded = true
            await reload()
            if let existing = editor?.existing {
                nonWorking = Set(existing.nonWorkingDates)
                decisions = Dictionary(uniqueKeysWithValues: existing.dayOverrides.map { ($0.date, $0) })
                hadAbsence = existing.hadNonPayableAbsence
                nonPayable = Set(existing.nonPayableDates ?? [])
                nonPayableConfirmed = existing.nonPayableDatesConfirmed ?? false
                rounding = existing.roundingPolicy ?? ""
                await reload()
            }
        }
    }

    private func dayLabel(_ day: Day, _ editor: Editor) -> some View {
        HStack {
            Text("\(day.date.month)/\(day.date.day) (\(Formatters.weekdays[day.date.weekday]))").monospacedDigit()
            Spacer()
            Text(editor.dayKindLabels[day.kind] ?? day.kind)
                .font(SGTypography.caption).foregroundStyle(.sg(SGColor.textTertiary))
        }
    }

    private func choice(_ title: String, _ date: CivilDate, _ field: WritableKeyPath<Override, Bool?>) -> some View {
        Picker(title, selection: Binding<Int>(
            get: {
                switch decisions[date]?[keyPath: field] {
                case .some(true): 1
                case .some(false): 2
                case .none: 0
                }
            },
            set: { value in
                var item = decisions[date] ?? Override(date: date)
                item[keyPath: field] = value == 0 ? nil : value == 1
                decisions[date] = item
            })) {
            Text("\(title) 미정").tag(0)
            Text("\(title) 받음").tag(1)
            Text("\(title) 안 받음").tag(2)
        }
        .pickerStyle(.menu)
    }

    private func reload() async {
        guard let runtime = model.core else { return }
        do {
            let nonWorkingJSON = JSONValue.array(nonWorking.map { .string($0.description) }).jsonText
            let data = try await runtime.callJSON("attendanceEditor", [monthText, nonWorkingJSON, model.today.description])
            editor = try JSONDecoder().decode(Editor.self, from: data)
        } catch {
            AppLog.error("attendance editor failed: \(error)")
        }
    }

    private func save() async {
        guard let runtime = model.core else { return }
        let draft: JSONValue = .object([
            "month": .string(monthText),
            "nonWorkingDates": .array(nonWorking.sorted().map { .string($0.description) }),
            "decisions": (try? JSONValue.from(Array(decisions.values))) ?? .array([]),
            "hadNonPayableAbsence": .bool(hadAbsence),
            "nonPayableDates": .array(nonPayable.sorted().map { .string($0.description) }),
            "nonPayableDatesConfirmed": .bool(nonPayableConfirmed),
            "roundingPolicy": rounding.isEmpty ? .null : .string(rounding),
        ])
        do {
            let outcome = try await runtime.decode(
                RunOutcome.self, from: await runtime.callJSONAsync("saveAttendance", [draft.jsonText, model.today.description]))
            await model.reloadAfterExternalWrite()
            if outcome.ok {
                message = (.success, "이 달 근무일 확인을 저장했어요.")
                await reload()
            } else {
                message = (.danger, outcome.errors?.first?.message ?? "저장하지 못했어요.")
            }
        } catch {
            AppLog.error("attendance save failed: \(error)")
            message = (.danger, ErrorCopy.saveFailed)
        }
    }
}
