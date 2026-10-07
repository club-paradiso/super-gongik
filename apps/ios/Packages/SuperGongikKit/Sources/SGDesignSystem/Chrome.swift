import SwiftUI

// System-owned surfaces (navigation bar, tab bar, grouped Form/List) keep their
// native components and behavior — large titles, scroll-edge transparency,
// blur-free legibility, Dynamic Type, VoiceOver — and only take their colors
// from the theme tokens, so 일반 and 워리어 both look whole. No custom tab bar or
// navigation bar is drawn.

public extension View {
    /// Root of a tab's `NavigationStack`: the navigation bar and tab bar show
    /// the theme canvas / raised surface when content scrolls under them.
    func sgScreenChrome() -> some View {
        toolbarBackground(.sg(SGColor.background), for: .navigationBar)
            .toolbarBackground(.sg(SGColor.surfaceRaised), for: .tabBar)
    }

    /// A native `Form` or `List`: theme canvas behind the grouped sections and a
    /// matching navigation bar. Pair with `sgListRowSurface()` on its content.
    func sgGroupedChrome() -> some View {
        scrollContentBackground(.hidden)
            .background(.sg(SGColor.background))
            .toolbarBackground(.sg(SGColor.background), for: .navigationBar)
    }

    /// Row background for the sections of a grouped `Form`/`List`.
    func sgListRowSurface() -> some View {
        listRowBackground(Rectangle().fill(.sg(SGColor.surface)))
    }
}
