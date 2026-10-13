import SGCore
import SGDesignSystem
import SGFoundation
import SwiftUI

/// 복무 기념 카드 (Stitch "Character & Collectibles", phase 8): the app's
/// artwork on the front, the user's own service dates and progress on the
/// back, shareable as images. The Stitch source added a name, a "VERIFIED"
/// serial, a hash, an edition number and "S-RANK QUEST CLEAR"; none of that
/// is drawn. Apple Wallet needs a paid pass certificate and is not offered.
struct MemorialCardView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var showingBack = false
    @State private var images: [CardImage] = []

    struct CardImage: Transferable, Identifiable {
        let id = UUID()
        let image: Image
        let name: String
        static var transferRepresentation: some TransferRepresentation {
            ProxyRepresentation(exporting: \.image)
        }
    }

    var body: some View {
        ScrollView {
            if let profile = model.profile, let hero = model.projection?.home?.hero {
                VStack(spacing: SGSpacing.md) {
                    Picker("면", selection: $showingBack) {
                        Text("앞면").tag(false)
                        Text("뒷면 · 복무 기록").tag(true)
                    }
                    .pickerStyle(.segmented)

                    ZStack {
                        MemorialCardFace(hero: hero, profile: profile, back: false)
                            .opacity(showingBack ? 0 : 1)
                            .rotation3DEffect(.degrees(showingBack ? 180 : 0), axis: (0, 1, 0))
                        MemorialCardFace(hero: hero, profile: profile, back: true)
                            .opacity(showingBack ? 1 : 0)
                            .rotation3DEffect(.degrees(showingBack ? 0 : -180), axis: (0, 1, 0))
                    }
                    .animation(reduceMotion ? nil : .easeInOut(duration: 0.45), value: showingBack)
                    .onTapGesture { showingBack.toggle() }
                    .accessibilityAddTraits(.isButton)
                    .accessibilityHint("두 번 탭해 카드를 뒤집어요")

                    Button {
                        showingBack.toggle()
                    } label: {
                        Label("카드 뒤집기", systemImage: "arrow.triangle.2.circlepath")
                    }
                    .buttonStyle(SGSecondaryButtonStyle())

                    if images.count == 2 {
                        ShareLink(items: images, preview: { SharePreview($0.name, image: $0.image) }) {
                            Label("이미지로 저장·공유 (앞면·뒷면)", systemImage: "square.and.arrow.up")
                        }
                        .buttonStyle(SGPrimaryButtonStyle())
                    }

                    SGNotice(.info, title: "기념용 카드예요",
                             message: "복무를 기념하는 이미지예요. 공문서나 병적증명서가 아니에요.")
                }
                .padding(.horizontal, SGSpacing.gutter)
                .padding(.bottom, SGSpacing.xxl)
                .frame(maxWidth: SGLayout.focusedWidth)
                .frame(maxWidth: .infinity)
                .task { render(hero: hero, profile: profile) }
            } else {
                SGLoadingState()
            }
        }
        .background(.sg(SGColor.background))
        .navigationTitle("복무 기념 카드")
        .navigationBarTitleDisplayMode(.inline)
    }

    /// Print-size renders (3×) of both faces for the share sheet.
    @MainActor
    private func render(hero: HomeModel.Hero, profile: ServiceProfile) {
        images = [false, true].compactMap { back in
            let renderer = ImageRenderer(content: MemorialCardFace(hero: hero, profile: profile, back: back)
                .frame(width: 330).environment(\.colorScheme, .dark))
            renderer.scale = 3
            guard let ui = renderer.uiImage else { return nil }
            return CardImage(image: Image(uiImage: ui), name: back ? "복무 기념 카드 뒷면" : "복무 기념 카드 앞면")
        }
    }
}

/// One face of the card.
struct MemorialCardFace: View {
    let hero: HomeModel.Hero
    let profile: ServiceProfile
    let back: Bool
    private let gold = Color(red: 0.99, green: 0.81, blue: 0.49)

    private func dotted(_ date: CivilDate) -> String { date.description.replacingOccurrences(of: "-", with: ".") }
    private var completed: Bool { hero.phase == "COMPLETED" || hero.phase == "DISCHARGE_DAY" }

    var body: some View {
        VStack(alignment: .leading, spacing: SGSpacing.sm) {
            HStack {
                Text("SUPER GONGIK").font(.caption.weight(.heavy)).foregroundStyle(gold)
                Spacer()
                Text("복무 기념 카드").font(.caption.weight(.bold)).foregroundStyle(.white.opacity(0.8))
            }
            if back {
                Spacer(minLength: SGSpacing.xs)
                Text(completed ? "복무를 마쳤어요" : "복무 중")
                    .font(.title2.weight(.heavy)).foregroundStyle(.white)
                row("소집일", dotted(profile.callUpDate))
                row(completed ? "소집해제" : "소집해제 예정", dotted(profile.expectedDischargeDate))
                row("함께한 날", "\(KoreanNumber.grouped(hero.elapsedDays))일")
                row("진행률", hero.percentLabel)
                ProgressView(value: hero.percent, total: 100).tint(gold)
                Spacer(minLength: SGSpacing.xs)
                Text("기념용 이미지예요. 공문서나 병적증명서가 아니에요.")
                    .font(.caption2).foregroundStyle(.white.opacity(0.6))
            } else {
                Image("CardArt")
                    .resizable()
                    .aspectRatio(contentMode: .fill)
                    .frame(maxWidth: .infinity)
                    .frame(height: 300)
                    .clipShape(RoundedRectangle(cornerRadius: SGRadius.card, style: .continuous))
                    .accessibilityHidden(true)
                Text(completed ? "소집해제 \(dotted(profile.expectedDischargeDate))" : hero.headline)
                    .font(.title.weight(.heavy)).monospacedDigit().foregroundStyle(.white)
                Text(profile.serviceCategory.map { "사회복무요원 · \($0)" } ?? "사회복무요원")
                    .font(.subheadline).foregroundStyle(.white.opacity(0.8))
            }
        }
        .padding(SGSpacing.lg)
        .frame(maxWidth: .infinity, minHeight: 480, alignment: .topLeading)
        .background {
            RoundedRectangle(cornerRadius: SGRadius.hero, style: .continuous)
                .fill(LinearGradient(colors: [Color(red: 0.07, green: 0.09, blue: 0.27), Color(red: 0.16, green: 0.12, blue: 0.36)],
                                     startPoint: .top, endPoint: .bottom))
        }
        .overlay(RoundedRectangle(cornerRadius: SGRadius.hero, style: .continuous).strokeBorder(gold.opacity(0.7), lineWidth: 1.5))
        .accessibilityElement(children: .combine)
    }

    private func row(_ title: String, _ value: String) -> some View {
        HStack {
            Text(title).font(.subheadline).foregroundStyle(.white.opacity(0.7))
            Spacer()
            Text(value).font(.subheadline.weight(.bold)).monospacedDigit().foregroundStyle(.white)
        }
    }
}
