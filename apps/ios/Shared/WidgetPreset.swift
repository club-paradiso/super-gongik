import SGDesignSystem
import SGFoundation
import SwiftUI

/// Home-screen widget colour preset (Stitch "Widget Gallery": 황혼 나이트,
/// 에픽 골드, 미니멀 블랙). Presentation only, like `ThemePreference`: stored
/// in the App Group defaults, read-only in the widget, never synced. Without
/// a provisioned App Group (personal-team builds) the widget falls back to
/// `.twilight`.
enum WidgetPreset: String, CaseIterable, Identifiable, Sendable {
    case twilight, epicGold, minimalBlack

    static let key = "widgetPreset"

    var id: String { rawValue }

    var title: String {
        switch self {
        case .twilight: "황혼 나이트"
        case .epicGold: "에픽 골드"
        case .minimalBlack: "미니멀 블랙"
        }
    }

    var summary: String {
        switch self {
        case .twilight: "앱 첫 화면과 같은 밤하늘"
        case .epicGold: "어두운 바탕에 금색 강조"
        case .minimalBlack: "검은 바탕에 흰 글씨만"
        }
    }

    static func load(from defaults: UserDefaults = ThemePreference.store) -> WidgetPreset {
        defaults.string(forKey: key).flatMap(WidgetPreset.init(rawValue:)) ?? .twilight
    }

    // MARK: Palette

    var primary: Color {
        switch self {
        case .twilight: SGColor.heroForeground.light.color
        case .epicGold: Color(red: 0.98, green: 0.95, blue: 0.88)
        case .minimalBlack: .white
        }
    }

    var secondary: Color {
        switch self {
        case .twilight: SGColor.heroForeground2.light.color
        case .epicGold: Color(red: 0.80, green: 0.76, blue: 0.66)
        case .minimalBlack: Color(white: 0.72)
        }
    }

    var tertiary: Color {
        switch self {
        case .twilight: SGColor.heroForeground3.light.color
        case .epicGold: Color(red: 0.66, green: 0.62, blue: 0.54)
        case .minimalBlack: Color(white: 0.55)
        }
    }

    var accent: Color {
        switch self {
        case .twilight: SGColor.heroAccent.light.color
        case .epicGold: Color(red: 0.96, green: 0.76, blue: 0.31)
        case .minimalBlack: .white
        }
    }
}

/// The widget's background for a preset. 황혼 나이트 is the app's hero
/// background (it follows the app theme); the others are flat.
struct WidgetPresetBackground: View {
    let preset: WidgetPreset

    var body: some View {
        switch preset {
        case .twilight:
            SGHeroBackground()
        case .epicGold:
            ZStack {
                LinearGradient(colors: [Color(red: 0.05, green: 0.06, blue: 0.13), Color(red: 0.10, green: 0.08, blue: 0.17)],
                               startPoint: .top, endPoint: .bottom)
                RadialGradient(colors: [preset.accent.opacity(0.22), .clear],
                               center: UnitPoint(x: 1, y: 0), startRadius: 0, endRadius: 220)
            }
        case .minimalBlack:
            Color.black
        }
    }
}

/// Progress bar for a preset: 황혼 나이트 keeps the app's gradient bar.
struct WidgetPresetBar: View {
    let preset: WidgetPreset
    let fraction: Double

    var body: some View {
        if preset == .twilight {
            SGProgressBar(fraction: fraction, height: 6, markers: false)
        } else {
            GeometryReader { proxy in
                ZStack(alignment: .leading) {
                    Capsule().fill(preset.primary.opacity(0.18))
                    Capsule().fill(preset.accent)
                        .frame(width: proxy.size.width * min(1, max(0, fraction)))
                }
            }
            .frame(height: 6)
            .accessibilityHidden(true)
        }
    }
}

// MARK: Faces (drawn by the widget and by the app's preview)

struct WidgetEmptyFace: View {
    let preset: WidgetPreset

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Image("BrandMark").resizable().frame(width: 28, height: 28).clipShape(RoundedRectangle(cornerRadius: 7))
            Text("슈퍼공익을 열어\n소집일을 입력해 주세요")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(preset.primary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    }
}

struct WidgetSmallFace: View {
    let snapshot: WidgetSnapshot?
    let date: Date
    let preset: WidgetPreset

    var body: some View {
        if let model = WidgetModel(snapshot: snapshot, date: date) {
            VStack(alignment: .leading, spacing: 4) {
                Text(model.caption)
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(preset.secondary)
                Text(model.headline)
                    .font(.system(size: 34, weight: .heavy))
                    .monospacedDigit()
                    .minimumScaleFactor(0.6)
                    .lineLimit(1)
                    .foregroundStyle(preset == .epicGold ? preset.accent : preset.primary)
                Spacer(minLength: 0)
                Text(model.percentText)
                    .font(.system(size: 15, weight: .bold))
                    .monospacedDigit()
                    .foregroundStyle(preset.accent)
                WidgetPresetBar(preset: preset, fraction: model.percent / 100)
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("\(model.caption) \(model.headline), 복무 \(model.percentText)")
        } else {
            WidgetEmptyFace(preset: preset)
        }
    }
}

struct WidgetMediumFace: View {
    let snapshot: WidgetSnapshot?
    let date: Date
    let preset: WidgetPreset

    var body: some View {
        if let model = WidgetModel(snapshot: snapshot, date: date), let snapshot {
            HStack(alignment: .top, spacing: 16) {
                WidgetSmallFace(snapshot: snapshot, date: date, preset: preset)
                VStack(alignment: .leading, spacing: 10) {
                    if let leave = snapshot.leaveRemaining {
                        info("남은 연가", leave)
                    }
                    if let next = snapshot.nextEventDate, let label = snapshot.nextEventLabel,
                       next >= SeoulClock.today(at: date) {
                        info("다음 일정", "\(next.month)/\(next.day) \(label)")
                    } else {
                        info("다음 일정", "없음")
                    }
                    Spacer(minLength: 0)
                    Text("\(KoreanNumber.grouped(model.progress.elapsedDays))일째 복무")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(preset.tertiary)
                }
                .privacySensitive()
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        } else {
            WidgetEmptyFace(preset: preset)
        }
    }

    private func info(_ title: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title).font(.system(size: 11, weight: .semibold)).foregroundStyle(preset.tertiary)
            Text(value).font(.system(size: 16, weight: .bold)).monospacedDigit()
                .foregroundStyle(preset.primary).lineLimit(1).minimumScaleFactor(0.7)
        }
        .accessibilityElement(children: .combine)
    }
}
