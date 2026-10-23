import SGCore
import SGDesignSystem
import SGFoundation
import SwiftUI

/// 내 정보 (Stitch Civic Codex "CHARACTER"): a service summary card, then
/// settings, data, privacy and sources as a native grouped list. The Stitch
/// source's name, photo, rank, level, ID code and institution contacts are
/// not drawn: the app does not hold them, and ranks do not exist for social
/// service personnel.
struct MoreView: View {
    /// Same order and wording as the domain's SERVICE_DAY_METRIC_LABELS.
    static let serviceDayMetrics: [(key: String, label: String)] = [
        ("REMAINING_WORKDAYS", "남은 출근일"),
        ("REMAINING_IF_ALL_LEAVE_USED", "연가를 다 쓰면 남는 출근일"),
        ("ELAPSED_WORKDAYS", "지금까지 실제로 출근한 날"),
    ]

    @Environment(AppModel.self) private var model
    @Environment(PrivacyLock.self) private var lock
    @AppStorage(ThemePreference.key, store: ThemePreference.store) private var theme: SGTheme = .standard
    @State private var showingProfile = false
    @State private var showingCloud = Self.debugOpenCloud
    @State private var showingCard = Self.debugFlag("SGOpenMemorialCard")
    @State private var showingWidgetStyle = Self.debugFlag("SGOpenWidgetStyle")
    @AppStorage(WidgetPreset.key, store: ThemePreference.store) private var widgetPreset = WidgetPreset.twilight.rawValue
    @State private var activityOn = DutyActivityController.isRunning

    /// DEBUG-only screenshot hook: `-SGOpenMemorialCard YES`.
    private static func debugFlag(_ key: String) -> Bool {
        #if DEBUG
        UserDefaults.standard.bool(forKey: key)
        #else
        false
        #endif
    }

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
                    // Stitch: the app header and the screen title replace the
                    // navigation bar (no profile button on 내 정보 itself).
                    Section {
                        VStack(alignment: .leading, spacing: SGSpacing.md) {
                            AppHeader(hero: model.projection?.home?.hero)
                            ScreenTitle(title: "내 정보", world: "CHARACTER")
                        }
                    }
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets())
                    if let profile = model.profile, let hero = model.projection?.home?.hero {
                        Section {
                            CharacterCard(profile: profile, hero: hero)
                        }
                        .listRowBackground(Color.clear)
                        .listRowInsets(EdgeInsets())
                    }
                    if let profile = model.profile {
                        Section {
                            Button {
                                showingProfile = true
                            } label: {
                                HStack {
                                    Label {
                                        VStack(alignment: .leading, spacing: SGSpacing.xxxs) {
                                            Text("복무 설정").foregroundStyle(.sg(SGColor.textPrimary))
                                            Text("\(Formatters.longDate(profile.callUpDate)) ~ \(Formatters.longDate(profile.expectedDischargeDate))")
                                                .font(SGTypography.caption).monospacedDigit()
                                                .foregroundStyle(.sg(SGColor.textTertiary))
                                        }
                                    } icon: {
                                        Image(systemName: "slider.horizontal.3").foregroundStyle(.sg(SGColor.accent))
                                    }
                                    Spacer()
                                    Image(systemName: "chevron.right").font(.caption).foregroundStyle(.sg(SGColor.textTertiary))
                                }
                            }
                            NavigationLink { MemorialCardView() } label: { Label("복무 기념 카드", systemImage: "sparkles.rectangle.stack") }
                            Toggle(isOn: Binding(
                                get: { profile.liveProgressEnabled ?? false },
                                set: { value in Task { await model.editProfile(["liveProgressEnabled": .bool(value)]) } })) { Label("초 단위 진행률", systemImage: "timer") }
                            .disabled(model.isReadOnly)
                        } header: {
                            header("복무", world: "PROFILE")
                        }

                        Section {
                            ForEach(Self.serviceDayMetrics, id: \.key) { metric in
                                Toggle(metric.label, isOn: Binding(
                                    get: { (profile.serviceDayMetrics ?? Self.serviceDayMetrics.map(\.key)).contains(metric.key) },
                                    set: { on in
                                        let current = profile.serviceDayMetrics ?? Self.serviceDayMetrics.map(\.key)
                                        let next = Self.serviceDayMetrics.map(\.key).filter {
                                            $0 == metric.key ? on : current.contains($0)
                                        }
                                        Task { await model.editProfile(["serviceDayMetrics": .array(next.map { .string($0) })]) }
                                    }))
                                .disabled(model.isReadOnly)
                            }
                        } header: {
                            header("실질 복무일수", world: "WORKDAYS")
                        } footer: {
                            Text("홈 화면에 보여 줄 값을 고르세요. 주말·공휴일(한국천문연구원 특일 정보)과 휴가·결근일을 빼고 세요. 급여 계산은 이 공휴일을 쓰지 않고, 달마다 확인한 휴무일을 그대로 써요.")
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

                    RecordSummarySection()

                    Section {
                        NavigationLink { BackupRestoreView() } label: { Label("백업에서 복원", systemImage: "arrow.counterclockwise") }
                        NavigationLink { RecordImportView() } label: { Label("기관 기록 가져오기", systemImage: "tray.and.arrow.down") }
                    }

                    Section {
                        LabeledContent { Text("이 기기") } label: { Label("저장 위치", systemImage: "internaldrive") }
                        if model.cloud.isConfigured {
                            NavigationLink {
                                CloudSyncView()
                            } label: {
                                LabeledContent { Text(model.cloud.view?.label.text ?? "로컬 전용") } label: { Label("클라우드 동기화", systemImage: "icloud") }
                            }
                        }
                    } header: {
                        header("저장", world: "DATA ARCHIVE")
                    } footer: {
                        Text(model.cloud.isConfigured
                             ? "기록은 이 기기에 먼저 저장돼요. 로그인하고 동기화를 켜야만 클라우드에 올라가요. 로그인하지 않으면 네트워크를 쓰지 않아요."
                             : "모든 기록은 이 기기에만 저장돼요. 기기를 바꿀 때는 백업 파일로 옮겨 주세요.")
                    }

                    if let profile = model.profile, let hero = model.projection?.home?.hero {
                        Section {
                            Toggle(isOn: Binding(
                                get: { activityOn },
                                set: { value in Task {
                                    if value {
                                        activityOn = await DutyActivityController.start(profile: profile, hero: hero)
                                    } else {
                                        await DutyActivityController.end()
                                        activityOn = false
                                    }
                                } })) { Label("잠금 화면에 오늘 근무 표시", systemImage: "lock.display") }
                            .disabled(!DutyActivityController.isAvailable && !activityOn)
                        } header: {
                            header("잠금 화면", world: "LIVE HUD")
                        } footer: {
                            Text(profile.workdayEndTime == nil
                                 ? "다이내믹 아일랜드와 잠금 화면에 D-day와 진행률을 보여요. 복무 설정에 근무 종료 시각을 넣으면 퇴근까지 남은 시간도 보여요. 기록 내용은 나오지 않아요."
                                 : "다이내믹 아일랜드와 잠금 화면에 퇴근까지 남은 시간, D-day, 진행률을 보여요. 기록 내용은 나오지 않아요.")
                        }
                    }

                    Section {
                        NavigationLink {
                            WidgetStyleView()
                        } label: {
                            LabeledContent { Text((WidgetPreset(rawValue: widgetPreset) ?? .twilight).title) } label: { Label("위젯 스타일", systemImage: "square.grid.2x2") }
                        }
                    } header: {
                        header("홈 화면 위젯", world: "WIDGET HUD")
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
                        Toggle(isOn: Binding(
                            get: { lock.lockEnabled },
                            set: { value in Task { await lock.setLockEnabled(value) } })) { Label("\(lock.methodName)로 앱 잠금", systemImage: "lock") }
                        .disabled(!lock.isAvailable && !lock.lockEnabled)
                        Toggle(isOn: Binding(
                            get: { lock.coverEnabled || lock.lockEnabled },
                            set: { lock.coverEnabled = $0 })) { Label("앱 전환 화면에서 내용 가리기", systemImage: "eye.slash") }
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

                    Section {
                        NavigationLink { AboutView() } label: { Label("계산 기준과 출처", systemImage: "book.closed") }
                        LabeledContent { Text(Bundle.main.versionText) } label: { Label("버전", systemImage: "info.circle") }
                        // Build provenance: which commit and channel this
                        // install came from, so an old build on a phone is
                        // never mistaken for the current design. No secrets.
                        LabeledContent { Text(Bundle.main.buildText).monospaced() } label: { Label("빌드", systemImage: "hammer") }
                        LabeledContent { Text(theme.title) } label: { Label("화면 테마", systemImage: "paintpalette") }
                    } header: {
                        header("정보", world: "CIVIC CODEX")
                    }
                }
                .sgListRowSurface()
            }
            .sgGroupedChrome()
            // A grouped List starts ~35 pt lower than a ScrollView; without
            // this the app header sat lower on 내 정보 than on the other tabs.
            .contentMargins(.top, 0, for: .scrollContent)
            .sgScreenChrome()
            .navigationTitle("내 정보")
            .toolbar(.hidden, for: .navigationBar)
            .navigationDestination(isPresented: $showingCloud) { CloudSyncView() }
            .navigationDestination(isPresented: $showingCard) { MemorialCardView() }
            .navigationDestination(isPresented: $showingWidgetStyle) { WidgetStyleView() }
            .sheet(isPresented: $showingProfile) {
                NavigationStack { ProfileEditView() }
            }
        }
    }
}

extension MoreView {
    private func header(_ title: String, world: String) -> some View {
        HStack(spacing: SGSpacing.xs) {
            Text(title)
            SGWorldEyebrow(world)
        }
    }
}

/// Stitch "CHARACTER" card, limited to what the app knows: the service
/// category, progress, dates and days left (shared home model values).
private struct CharacterCard: View {
    let profile: ServiceProfile
    let hero: HomeModel.Hero
    @Environment(\.dynamicTypeSize) private var typeSize

    private var columns: [GridItem] {
        Array(repeating: GridItem(.flexible(), spacing: SGSpacing.xs, alignment: .topLeading),
              count: typeSize.isAccessibilitySize ? 1 : 2)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: SGSpacing.sm) {
            HStack(spacing: SGSpacing.sm) {
                Image("BrandMark")
                    .resizable()
                    .frame(width: 52, height: 52)
                    .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: SGSpacing.xxxs) {
                    SGWorldEyebrow("CHARACTER", tint: SGColor.heroAccent)
                    Text("내 복무")
                        .font(SGTypography.cardTitle)
                        .foregroundStyle(.sg(SGColor.heroForeground))
                    Text(profile.serviceCategory.map { "사회복무요원 · \($0)" } ?? "사회복무요원")
                        .font(SGTypography.caption)
                        .foregroundStyle(.sg(SGColor.heroForeground2))
                }
                Spacer(minLength: 0)
                Text(hero.percentLabel)
                    .font(SGTypography.title3).monospacedDigit()
                    .foregroundStyle(.sg(SGColor.heroAccent))
            }
            SGProgressBar(fraction: hero.percent / 100)
            LazyVGrid(columns: columns, alignment: .leading, spacing: SGSpacing.xs) {
                stat("소집일", profile.callUpDate.description.replacingOccurrences(of: "-", with: "."))
                stat("소집해제 예정", profile.expectedDischargeDate.description.replacingOccurrences(of: "-", with: "."))
                stat("남은 복무일", "\(KoreanNumber.grouped(hero.remainingDays))일")
                stat("지난 복무일", "\(KoreanNumber.grouped(hero.elapsedDays))일")
            }
        }
        .padding(SGSpacing.lg)
        .background { SGHeroBackground(celebrate: false) }
        .clipShape(RoundedRectangle(cornerRadius: SGRadius.hero, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: SGRadius.hero, style: .continuous).strokeBorder(.sg(SGColor.heroBorder)))
        .environment(\.colorScheme, .dark)
        .accessibilityElement(children: .combine)
    }

    private func stat(_ title: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: SGSpacing.xxxs) {
            Text(title).font(SGTypography.micro).foregroundStyle(.sg(SGColor.heroForeground3))
            Text(value).font(SGTypography.bodyStrong).monospacedDigit().foregroundStyle(.sg(SGColor.heroForeground))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(SGSpacing.xs)
        .background(.sg(SGColor.heroTrack), in: RoundedRectangle(cornerRadius: SGRadius.control, style: .continuous))
    }
}

extension Bundle {
    var versionText: String {
        let version = infoDictionary?["CFBundleShortVersionString"] as? String ?? "-"
        let build = infoDictionary?["CFBundleVersion"] as? String ?? "-"
        return "\(version) (\(build))"
    }

    /// "Beta · 9f86409": the build channel and the short Git SHA stamped at
    /// build time (`SG_BUILD_CHANNEL`, `SG_BUILD_COMMIT`; Config/Base.xcconfig).
    var buildText: String {
        let channel = infoDictionary?["SGBuildChannel"] as? String ?? "-"
        let commit = infoDictionary?["SGBuildCommit"] as? String ?? "-"
        return "\(channel) · \(commit)"
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
