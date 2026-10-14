import SGDesignSystem
import SwiftUI

/// 내 정보 › 위젯 스타일 (Stitch "Widget Gallery"): three colour presets for
/// the home-screen widget, with the small and medium widget drawn by the same
/// views the widget uses. The Stitch large widget (name, ID code, rank) and
/// the per-second "초정밀" percentage are not built: a widget only changes at
/// midnight.
struct WidgetStyleView: View {
    @Environment(AppModel.self) private var model
    @AppStorage(WidgetPreset.key, store: ThemePreference.store) private var stored = WidgetPreset.twilight.rawValue
    @AppStorage(ThemePreference.key, store: ThemePreference.store) private var theme: SGTheme = .standard

    private var preset: WidgetPreset { WidgetPreset(rawValue: stored) ?? .twilight }

    var body: some View {
        Form {
            Section {
                VStack(alignment: .leading, spacing: SGSpacing.md) {
                    tile(width: 158) {
                        WidgetSmallFace(snapshot: snapshot, date: .now, preset: preset)
                    }
                    .accessibilityLabel("작은 위젯 미리보기")
                    tile(width: nil) {
                        WidgetMediumFace(snapshot: snapshot, date: .now, preset: preset)
                    }
                    .accessibilityLabel("중간 위젯 미리보기")
                }
                .padding(.vertical, SGSpacing.xs)
                .listRowBackground(Color.clear)
            } header: {
                Text("미리보기")
            }

            Section {
                Picker("위젯 스타일", selection: $stored) {
                    ForEach(WidgetPreset.allCases) { option in
                        VStack(alignment: .leading, spacing: SGSpacing.xxxs) {
                            Text(option.title)
                            Text(option.summary)
                                .font(SGTypography.caption)
                                .foregroundStyle(.sg(SGColor.textTertiary))
                        }
                        .tag(option.rawValue)
                    }
                }
                .pickerStyle(.inline)
                .labelsHidden()
            } header: {
                Text("스타일")
            } footer: {
                Text("홈 화면의 슈퍼공익 위젯에 바로 반영돼요. 위젯의 숫자는 하루에 한 번, 자정에 바뀌어요.")
            }
        }
        .navigationTitle("위젯 스타일")
        .navigationBarTitleDisplayMode(.inline)
        .onChange(of: stored) { WidgetReloader.reload() }
    }

    private var snapshot: WidgetSnapshot? {
        WidgetSnapshotWriter.snapshot(projection: model.projection)
    }

    /// A home-screen widget tile: 158 pt square (small) or the full row
    /// (medium), continuous corners, the preset's background.
    private func tile(width: CGFloat?, @ViewBuilder content: () -> some View) -> some View {
        content()
            .padding(16)
            .frame(width: width, height: 158)
            .frame(maxWidth: width == nil ? .infinity : nil, alignment: .leading)
            .background { WidgetPresetBackground(preset: preset) }
            .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
            // A hairline so 미니멀 블랙 stays visible on a dark screen.
            .overlay(RoundedRectangle(cornerRadius: 22, style: .continuous).strokeBorder(.white.opacity(0.14)))
            .environment(\.colorScheme, .dark)
            .environment(\.sgTheme, theme)
            .accessibilityElement(children: .combine)
    }
}
