import SGCore
import SGDesignSystem
import SGFoundation
import SwiftUI

/// 더보기: settings, data, privacy and sources. Native grouped list.
struct MoreView: View {
    @Environment(AppModel.self) private var model
    @Environment(PrivacyLock.self) private var lock
    @AppStorage(ThemePreference.key, store: ThemePreference.store) private var theme: SGTheme = .standard
    @State private var showingProfile = false
    @State private var showingCloud = Self.debugOpenCloud

    /// DEBUG-only screenshot hook: `-SGOpenCloud YES`.
    private static var debugOpenCloud: Bool {
        #if DEBUG
        UserDefaults.standard.bool(forKey: "SGOpenCloud")
        #else
        false
        #endif
    }

    var body: some View {
        NavigationStack {
            List {
                Group {
                    if let profile = model.profile {
                        Section("복무") {
                            Button {
                                showingProfile = true
                            } label: {
                                HStack {
                                    VStack(alignment: .leading, spacing: SGSpacing.xxxs) {
                                        Text("복무 설정").foregroundStyle(.sg(SGColor.textPrimary))
                                        Text("\(Formatters.longDate(profile.callUpDate)) ~ \(Formatters.longDate(profile.expectedDischargeDate))")
                                            .font(SGTypography.caption).monospacedDigit()
                                            .foregroundStyle(.sg(SGColor.textTertiary))
                                    }
                                    Spacer()
                                    Image(systemName: "chevron.right").font(.caption).foregroundStyle(.sg(SGColor.textTertiary))
                                }
                            }
                            Toggle("초 단위 진행률", isOn: Binding(
                                get: { profile.liveProgressEnabled ?? false },
                                set: { value in Task { await model.editProfile(["liveProgressEnabled": .bool(value)]) } }))
                            .disabled(model.isReadOnly)
                        }
                    }

                    Section {
                        Picker("화면 테마", selection: $theme) {
                            ForEach(SGTheme.allCases) { option in
                                VStack(alignment: .leading, spacing: SGSpacing.xxxs) {
                                    Text(option.title)
                                    Text(option.summary)
                                        .font(SGTypography.caption)
                                        .foregroundStyle(.sg(SGColor.textTertiary))
                                }
                                .tag(option)
                            }
                        }
                        .pickerStyle(.inline)
                    } header: {
                        Text("화면")
                    } footer: {
                        Text("테마는 색과 분위기만 바꿔요. 숫자와 계산, 기록은 그대로예요. 이 기기에만 저장돼요.")
                    }

                    BackupExportView()

                    CSVExportSection()

                    Section {
                        NavigationLink("백업에서 복원") { BackupRestoreView() }
                        NavigationLink("기관 기록 가져오기") { RecordImportView() }
                    }

                    Section {
                        LabeledContent("저장 위치", value: "이 기기")
                        if model.cloud.isConfigured {
                            NavigationLink {
                                CloudSyncView()
                            } label: {
                                LabeledContent("클라우드 동기화", value: model.cloud.view?.label.text ?? "로컬 전용")
                            }
                        }
                    } header: {
                        Text("저장")
                    } footer: {
                        Text(model.cloud.isConfigured
                             ? "기록은 이 기기에 먼저 저장돼요. 로그인하고 동기화를 켜야만 클라우드에 올라가요. 로그인하지 않으면 네트워크를 쓰지 않아요."
                             : "모든 기록은 이 기기에만 저장돼요. 기기를 바꿀 때는 백업 파일로 옮겨 주세요.")
                    }

                    Section {
                        ForEach(ReminderScheduler.Category.allCases) { category in
                            Toggle(isOn: Binding(
                                get: { model.reminders.isEnabled(category) },
                                set: { value in Task {
                                    await model.reminders.setEnabled(category, value)
                                    await model.reproject()
                                } })) {
                                VStack(alignment: .leading, spacing: SGSpacing.xxxs) {
                                    Text(category.title)
                                    Text(category.detail).font(SGTypography.caption).foregroundStyle(.sg(SGColor.textTertiary))
                                }
                            }
                        }
                        if model.reminders.authorizationDenied {
                            Text("알림이 꺼져 있어요. 설정 앱 > 슈퍼공익 > 알림에서 켤 수 있어요.")
                                .font(SGTypography.caption).foregroundStyle(.sg(SGColor.warning))
                        }
                    } header: {
                        Text("알림")
                    } footer: {
                        Text("잠금 화면에는 ‘휴가’·‘근태’ 같은 분류만 보여요. 메모나 병가 여부는 알림에 넣지 않아요.")
                    }

                    Section {
                        Toggle("\(lock.methodName)로 앱 잠금", isOn: Binding(
                            get: { lock.lockEnabled },
                            set: { value in Task { await lock.setLockEnabled(value) } }))
                        .disabled(!lock.isAvailable && !lock.lockEnabled)
                        Toggle("앱 전환 화면에서 내용 가리기", isOn: Binding(
                            get: { lock.coverEnabled || lock.lockEnabled },
                            set: { lock.coverEnabled = $0 }))
                        .disabled(lock.lockEnabled)
                        if let error = lock.lastError {
                            Text(error).font(SGTypography.caption).foregroundStyle(.sg(SGColor.warning))
                        }
                    } header: {
                        Text("개인정보 보호")
                    } footer: {
                        Text(lock.isAvailable
                             ? "잠금을 켜면 앱을 다시 열 때 \(lock.methodName)로 확인해요. 인식이 안 되면 기기 암호로 열 수 있어요."
                             : "기기 암호를 설정하면 앱 잠금을 쓸 수 있어요.")
                    }

                    Section("데이터") {
                        NavigationLink {
                            DataDeletionView()
                        } label: {
                            Label("이 기기의 모든 데이터 지우기", systemImage: "trash")
                                .foregroundStyle(.sg(SGColor.danger))
                        }
                    }

                    Section("정보") {
                        NavigationLink("계산 기준과 출처") { AboutView() }
                        LabeledContent("버전", value: Bundle.main.versionText)
                    }
                }
                .sgListRowSurface()
            }
            .sgGroupedChrome()
            .sgScreenChrome()
            .navigationTitle("더보기")
            .navigationDestination(isPresented: $showingCloud) { CloudSyncView() }
            .sheet(isPresented: $showingProfile) {
                NavigationStack { ProfileEditView() }
            }
        }
    }
}

extension Bundle {
    var versionText: String {
        let version = infoDictionary?["CFBundleShortVersionString"] as? String ?? "-"
        let build = infoDictionary?["CFBundleVersion"] as? String ?? "-"
        return "\(version) (\(build))"
    }
}

/// Wipe this device's records and recovery copies. Typed confirmation, and
/// the backup export is offered first.
struct DataDeletionView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var typed = ""
    @State private var failed = false
    private let phrase = "모두 지우기"

    var body: some View {
        Form {
            Group {
                Section {
                    Text("이 기기에 저장된 복무 프로필, 모든 기록, 연가 보정, 가져오기 이력과 복구용 사본을 지워요. 되돌릴 수 없어요.")
                        .font(SGTypography.body)
                }
                BackupExportView()
                Section {
                    TextField("‘\(phrase)’를 입력하세요", text: $typed)
                        .autocorrectionDisabled()
                    Button("이 기기의 모든 데이터 지우기", role: .destructive) {
                        Task {
                            if await model.wipeAllLocalData() { dismiss() } else { failed = true }
                        }
                    }
                    .disabled(typed != phrase || model.isReadOnly)
                } footer: {
                    if failed {
                        Text("일부를 지우지 못했어요. 앱을 다시 열고 시도해 주세요.").foregroundStyle(.sg(SGColor.danger))
                    }
                }
            }
            .sgListRowSurface()
        }
        .sgGroupedChrome()
        .navigationTitle("데이터 지우기")
        .navigationBarTitleDisplayMode(.inline)
    }
}

/// Sources and calculation principles, from the shared rules.
struct AboutView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        List {
            Group {
                Section("계산 원칙") {
                    ForEach([
                        "날짜는 Asia/Seoul의 달력 날짜로 계산해요.",
                        "정책은 기록·지급 대상 날짜에 시행 중이던 기준으로 골라요. 과거 기록에 최신 기준을 덮어쓰지 않아요.",
                        "확인되지 않은 정책값은 자동으로 계산하지 않아요. 필요한 값이 없으면 합계를 보여 주지 않아요.",
                        "웹 슈퍼공익과 같은 계산 코드를 써요. 두 앱의 결과가 같도록 공용 테스트로 확인해요.",
                    ], id: \.self) { Text($0).font(SGTypography.body) }
                }
                if let rule = model.projection?.compensation?.rule {
                    Section("보수 기준 \(rule.version)") {
                        ForEach(rule.sources) { source in
                            if let text = source.url, let url = URL(string: text) {
                                Link(source.title, destination: url)
                            } else {
                                Text(source.title)
                            }
                        }
                    }
                }
                if let credits = model.projection?.ledger?.credits, !credits.isEmpty {
                    Section("연가 기준") {
                        ForEach(credits) { credit in
                            Text(credit.explanation).font(SGTypography.caption)
                        }
                    }
                }
                Section {
                    Text("슈퍼공익은 공개된 법령과 지침을 바탕으로 한 참고용 도구예요. 실제 복무·보수 관리는 복무기관과 병무청 안내를 따라 주세요.")
                        .font(SGTypography.caption)
                        .foregroundStyle(.sg(SGColor.textSecondary))
                }
                Section("오픈소스") {
                    Text("Pretendard — SIL Open Font License 1.1").font(SGTypography.caption)
                }
            }
            .sgListRowSurface()
        }
        .sgGroupedChrome()
        .navigationTitle("계산 기준과 출처")
    }
}
