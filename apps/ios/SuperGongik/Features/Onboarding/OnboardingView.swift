import SGCore
import SGDesignSystem
import SGFoundation
import SwiftUI

/// Guest-first onboarding in four steps (Stitch "STEP 1 OF 4"): 소집일 →
/// 소집해제 예정일 → 복무 분야 → 확인. No account, no permission prompt,
/// nothing leaves the device. The Stitch source asked for a name ("영웅
/// 칭호"); the app needs none, so it asks for none.
struct OnboardingView: View {
    @Environment(AppModel.self) private var model
    @State private var callUp = Formatters.date(from: SeoulClock.today(at: .now))
    @State private var discharge = Formatters.date(from: SeoulClock.today(at: .now).adding(months: 21))
    @State private var dischargeTouched = false
    @State private var category = ""
    @State private var issues: [EventIssue] = []
    @State private var saving = false
    @State private var showingRestore = false
    @State private var step = Self.debugInitialStep

    /// DEBUG-only screenshot hook: `-SGOnboardingStep 3` opens step 3.
    private static var debugInitialStep: Int {
        #if DEBUG
        max(0, min(3, UserDefaults.standard.integer(forKey: "SGOnboardingStep") - 1))
        #else
        0
        #endif
    }
    private static let stepCount = 4
    @State private var showingCloud = false

    private static let categories = ["", "사회복지", "보건의료", "교육", "행정", "기타"]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: SGSpacing.lg) {
                progress
                header
                stepContent
                stepActions
                Text("입력한 내용은 이 기기에만 저장돼요. 로그인하지 않으면 네트워크를 쓰지 않아요.")
                    .font(SGTypography.caption)
                    .foregroundStyle(.sg(SGColor.textTertiary))
                    .frame(maxWidth: .infinity, alignment: .center)
                    .multilineTextAlignment(.center)
            }
            .padding(.horizontal, SGSpacing.gutter)
            .padding(.bottom, SGSpacing.xxl)
            .frame(maxWidth: SGLayout.focusedWidth)
            .frame(maxWidth: .infinity)
        }
        .background(.sg(SGColor.background))
        .sheet(isPresented: $showingRestore) {
            NavigationStack { BackupRestoreView(onboarding: true) }
        }
        // A new device signs in before it has a profile: making one first
        // would be a different 복무 프로필, which sync never merges. When the
        // cloud profile arrives, RootView leaves onboarding and the sheet goes.
        .sheet(isPresented: $showingCloud) {
            NavigationStack {
                CloudSyncView()
                    .toolbar {
                        ToolbarItem(placement: .cancellationAction) {
                            Button("닫기") { showingCloud = false }
                        }
                    }
            }
        }
        .task(id: callUp) { await suggestDischarge() }
    }

    private var header: some View {
        ZStack(alignment: .bottomLeading) {
            SGHeroBackground()
            VStack(alignment: .leading, spacing: SGSpacing.sm) {
                HStack(spacing: SGSpacing.sm) {
                    Image("BrandMark").resizable().frame(width: 44, height: 44)
                        .accessibilityHidden(true)
                    Text("SUPER-GONGIK")
                        .font(SGTypography.font(17, .heavy, relativeTo: .headline))
                        .tracking(0.4)
                        .foregroundStyle(.sg(SGColor.heroForeground))
                }
                Spacer(minLength: SGSpacing.xl)
                SGWorldEyebrow(["PROLOGUE", "CHAPTER 01", "CLASS", "GENESIS"][step], tint: SGColor.heroAccent)
                Text(stepTitle)
                    .font(SGTypography.title1)
                    .foregroundStyle(.sg(SGColor.heroForeground))
                    .accessibilityAddTraits(.isHeader)
                Text(stepSubtitle)
                    .font(SGTypography.body)
                    .foregroundStyle(.sg(SGColor.heroForeground2))
            }
            .padding(SGSpacing.lg)
        }
        .frame(minHeight: step == 0 ? 240 : 180)
        .clipShape(RoundedRectangle(cornerRadius: SGRadius.hero, style: .continuous))
        .padding(.top, SGSpacing.xs)
    }

    private var stepTitle: String {
        ["복무 현황,\n한눈에 챙겨요", "소집해제 예정일을\n확인해요", "복무 분야를\n알려 주세요", "이대로\n시작할까요?"][step]
    }

    private var stepSubtitle: String {
        [
            "소집일만 입력하면 D-Day와 진행률을 바로 보여드려요.",
            "기본 복무 기간으로 계산했어요. 연장된 경우 직접 고칠 수 있어요.",
            "나중에 정해도 돼요. 급여·연가 계산에는 쓰지 않아요.",
            "언제든 내 정보 › 복무 설정에서 고칠 수 있어요.",
        ][step]
    }

    /// "STEP n OF 4" with a progress bar (Stitch onboarding header).
    private var progress: some View {
        VStack(alignment: .leading, spacing: SGSpacing.xs) {
            HStack {
                if step > 0 {
                    Button { step -= 1 } label: {
                        Image(systemName: "chevron.left").font(SGTypography.label)
                            .frame(width: SGSpacing.minimumHitTarget, height: SGSpacing.minimumHitTarget)
                    }
                    .accessibilityLabel("이전 단계")
                }
                Text("\(step + 1)/\(Self.stepCount)단계")
                    .font(SGTypography.label).monospacedDigit()
                    .foregroundStyle(.sg(SGColor.textSecondary))
                SGWorldEyebrow("STEP \(step + 1) OF \(Self.stepCount)")
                Spacer()
            }
            ProgressView(value: Double(step + 1), total: Double(Self.stepCount))
                .tint(SGStyle.sg(SGColor.accent))
                .accessibilityHidden(true)
        }
        .padding(.top, SGSpacing.xs)
    }

    @ViewBuilder
    private var stepContent: some View {
        switch step {
        case 0:
            SGCard {
                DatePicker("소집일", selection: $callUp, displayedComponents: .date)
                    .environment(\.calendar, .seoul)
                    .environment(\.timeZone, SeoulClock.timeZone)
                    .font(SGTypography.body)
            }
        case 1:
            SGCard {
                VStack(alignment: .leading, spacing: SGSpacing.sm) {
                    LabeledContent("소집일", value: Formatters.longDate(Formatters.civilDate(from: callUp)))
                        .font(SGTypography.body)
                    Divider()
                    DatePicker("소집해제 예정일", selection: Binding(
                        get: { discharge },
                        set: { discharge = $0; dischargeTouched = true }
                    ), displayedComponents: .date)
                        .environment(\.calendar, .seoul)
                        .environment(\.timeZone, SeoulClock.timeZone)
                        .font(SGTypography.body)
                    // The step subtitle already explains the suggestion.
                }
            }
        case 2:
            SGCard(padding: SGSpacing.xs) {
                VStack(spacing: 0) {
                    ForEach(Self.categories, id: \.self) { option in
                        Button { category = option } label: {
                            HStack {
                                Text(option.isEmpty ? "나중에 정할게요" : option)
                                    .font(SGTypography.body)
                                    .foregroundStyle(.sg(SGColor.textPrimary))
                                Spacer()
                                if category == option {
                                    Image(systemName: "checkmark").foregroundStyle(.sg(SGColor.accent))
                                }
                            }
                            .padding(.horizontal, SGSpacing.sm)
                            .frame(minHeight: SGSpacing.minimumHitTarget)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityAddTraits(category == option ? .isSelected : [])
                        if option != Self.categories.last { Divider() }
                    }
                }
            }
        default:
            SGCard {
                VStack(alignment: .leading, spacing: SGSpacing.sm) {
                    LabeledContent("소집일", value: Formatters.longDate(Formatters.civilDate(from: callUp)))
                    Divider()
                    LabeledContent("소집해제 예정일", value: Formatters.longDate(Formatters.civilDate(from: discharge)))
                    Divider()
                    LabeledContent("복무 분야", value: category.isEmpty ? "나중에 정할게요" : category)
                    ForEach(issues, id: \.self) { issue in
                        SGNotice(.danger, title: issue.message)
                    }
                }
                .font(SGTypography.body)
            }
        }
    }

    private var stepActions: some View {
        VStack(spacing: SGSpacing.sm) {
            if step < Self.stepCount - 1 {
                Button("다음") { step += 1 }
                    .buttonStyle(SGPrimaryButtonStyle())
            } else {
                Button {
                    Task { await save() }
                } label: {
                    if saving { ProgressView() } else { Text("복무 현황 보기") }
                }
                .buttonStyle(SGPrimaryButtonStyle())
                .disabled(saving)
            }
            if step == 0 {
                Button("백업 파일에서 복원하기") { showingRestore = true }
                    .buttonStyle(SGSecondaryButtonStyle())
                if model.config.isCloudConfigured {
                    Button("계정으로 로그인") { showingCloud = true }
                        .buttonStyle(SGSecondaryButtonStyle())
                }
            }
        }
    }

    /// Discharge date suggestion comes from the shared domain
    /// (`calculateExpectedDischargeDate`), never from a Swift constant.
    private func suggestDischarge() async {
        guard !dischargeTouched else { return }
        let callUpDate = Formatters.civilDate(from: callUp)
        if let suggested = await model.pure(
            "calculateExpectedDischargeDate", [.string(callUpDate.description)], as: CivilDate.self)
        {
            discharge = Formatters.date(from: suggested)
        }
    }

    private func save() async {
        saving = true
        defer { saving = false }
        issues = await model.run("createProfile", [.object([
            "callUpDate": .string(Formatters.civilDate(from: callUp).description),
            "expectedDischargeDate": .string(Formatters.civilDate(from: discharge).description),
            "serviceCategory": category.isEmpty ? .null : .string(category),
            "workplaceType": .null,
            "defaultCommuteCost": .null,
            "defaultMealAllowanceOverride": .null,
            "timezone": .string("Asia/Seoul"),
        ])])
    }
}
