import SGCore
import SGDesignSystem
import SGFoundation
import SwiftUI

/// Guest-first onboarding: two dates and an optional category. No account,
/// no permission prompt, nothing leaves the device.
struct OnboardingView: View {
    @Environment(AppModel.self) private var model
    @State private var callUp = Formatters.date(from: SeoulClock.today(at: .now))
    @State private var discharge = Formatters.date(from: SeoulClock.today(at: .now).adding(months: 21))
    @State private var dischargeTouched = false
    @State private var category = ""
    @State private var issues: [EventIssue] = []
    @State private var saving = false
    @State private var showingRestore = false

    private static let categories = ["", "사회복지", "보건의료", "교육", "행정", "기타"]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: SGSpacing.xl) {
                header
                form
                actions
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
                Text("복무 현황,\n한눈에 챙겨요")
                    .font(SGTypography.title1)
                    .foregroundStyle(.sg(SGColor.heroForeground))
                    .accessibilityAddTraits(.isHeader)
                Text("소집일만 입력하면 D-Day와 진행률을 바로 보여드려요.")
                    .font(SGTypography.body)
                    .foregroundStyle(.sg(SGColor.heroForeground2))
            }
            .padding(SGSpacing.lg)
        }
        .frame(minHeight: 240)
        .clipShape(RoundedRectangle(cornerRadius: SGRadius.hero, style: .continuous))
        .padding(.top, SGSpacing.xs)
    }

    private var form: some View {
        SGCard {
            VStack(alignment: .leading, spacing: SGSpacing.md) {
                DatePicker("소집일", selection: $callUp, displayedComponents: .date)
                    .environment(\.calendar, .seoul)
                    .environment(\.timeZone, SeoulClock.timeZone)
                Divider()
                DatePicker("소집해제 예정일", selection: Binding(
                    get: { discharge },
                    set: { discharge = $0; dischargeTouched = true }
                ), displayedComponents: .date)
                    .environment(\.calendar, .seoul)
                    .environment(\.timeZone, SeoulClock.timeZone)
                if !dischargeTouched {
                    Text("기본 복무 기간 기준으로 자동 계산해요. 연장된 경우 직접 고칠 수 있어요.")
                        .font(SGTypography.caption)
                        .foregroundStyle(.sg(SGColor.textTertiary))
                }
                Divider()
                LabeledContent("복무 분야 (선택)") {
                    Picker("복무 분야 (선택)", selection: $category) {
                        ForEach(Self.categories, id: \.self) { Text($0.isEmpty ? "나중에 정할게요" : $0) }
                    }
                    .labelsHidden()
                }
                ForEach(issues, id: \.self) { issue in
                    SGNotice(.danger, title: issue.message)
                }
            }
            .font(SGTypography.body)
        }
    }

    private var actions: some View {
        VStack(spacing: SGSpacing.sm) {
            Button {
                Task { await save() }
            } label: {
                if saving { ProgressView() } else { Text("복무 현황 보기") }
            }
            .buttonStyle(SGPrimaryButtonStyle())
            .disabled(saving)

            Button("백업 파일에서 복원하기") { showingRestore = true }
                .buttonStyle(SGSecondaryButtonStyle())
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
