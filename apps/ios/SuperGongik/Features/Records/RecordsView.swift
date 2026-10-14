import SGCore
import SGDesignSystem
import SGFoundation
import SwiftUI

/// 캘린더 (Stitch Civic Codex "QUEST LOG"): month switcher, this month's
/// summary, the grid, the selected day, upcoming records and a summary strip;
/// or the agenda list. Create, edit, delete (soft, with undo) and restore all
/// go through the shared store commands. The Stitch source also showed
/// approval states ("결재 완료"), approval numbers and "자동 동기화 완료": the
/// app cannot know any of them, so they are not drawn.
struct RecordsView: View {
    enum Mode: String, CaseIterable { case month = "월간", agenda = "목록" }

    @Environment(AppModel.self) private var model
    @State private var mode: Mode = .month
    @State private var month: CivilDate = SeoulClock.today(at: .now)
    @State private var selected: CivilDate = SeoulClock.today(at: .now)
    @State private var editing: EditorTarget?
    @State private var filter: SGEventCategory?
    @State private var undo: ServiceEvent?
    @State private var milestones: [ServiceMilestoneItem] = []

    struct EditorTarget: Identifiable {
        let event: ServiceEvent?
        let date: CivilDate
        var id: String { event?.id ?? "new-\(date)" }
    }

    private var events: [ServiceEvent] { model.document?.liveEvents ?? [] }

    /// "D-300", "50%", … from the same route as the 홈 strip.
    private var nextMilestone: String? {
        MilestoneRoute(milestones, today: model.today)?.entries.first { $0.state == .next }?.title
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: SGSpacing.md) {
                    SGWorldEyebrow("QUEST LOG")
                    Picker("보기", selection: $mode) {
                        ForEach(Mode.allCases, id: \.self) { Text($0.rawValue) }
                    }
                    .pickerStyle(.segmented)

                    switch mode {
                    case .month:
                        MonthSwitcher(month: $month, selected: $selected)
                        MonthSummary(month: month, events: events, display: display, next: nextMilestone)
                        MonthCalendar(month: $month, selected: $selected, events: events, display: display)
                        DayPanel(date: selected, events: events.filter { $0.covers(selected) }, display: display,
                                 onAdd: { editing = EditorTarget(event: nil, date: selected) },
                                 onOpen: { editing = EditorTarget(event: $0, date: $0.startDate) })
                        if let home = model.projection?.home {
                            UpcomingSection(items: home.upcoming, display: { model.projection?.eventDisplay?[$0.id] },
                                            readOnly: model.isReadOnly,
                                            onAdd: { editing = EditorTarget(event: nil, date: model.today) },
                                            onOpen: { editing = EditorTarget(event: $0, date: $0.startDate) })
                            if !home.completed {
                                InventoryStrip(leave: home.leave, next: nextMilestone, headline: home.hero.headline)
                            }
                        }
                    case .agenda:
                        AgendaList(events: filtered, display: display, today: model.today,
                                   onOpen: { editing = EditorTarget(event: $0, date: $0.startDate) },
                                   onDelete: delete)
                        RecentlyDeleted(events: Array((model.document?.deletedEvents ?? [])
                            .sorted { $0.updatedAt > $1.updatedAt }.prefix(20)),
                                        label: { model.label(for: $0.eventType) },
                                        onRestore: restore)
                    }
                }
                .padding(.horizontal, SGSpacing.gutter)
                .padding(.bottom, SGSpacing.xxl)
                .frame(maxWidth: SGLayout.readableWidth)
                .frame(maxWidth: .infinity)
            }
            .background(.sg(SGColor.background))
            .sgScreenChrome()
            .navigationTitle("캘린더")
            .toolbar {
                if mode == .agenda {
                    ToolbarItem(placement: .topBarLeading) { filterMenu }
                }
                // 연가 내역 left the tab bar (Stitch: four destinations).
                ToolbarItem(placement: .secondaryAction) {
                    NavigationLink {
                        LeaveView()
                    } label: {
                        Label("연가 내역", systemImage: "list.clipboard")
                    }
                }
                // Stitch: a "오늘" button at the top trailing edge.
                if mode == .month {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button {
                            month = model.today
                            selected = model.today
                        } label: {
                            // Text, not a glyph: an iOS 26 toolbar shows a Label as its icon only.
                            Text("오늘")
                        }
                        .accessibilityLabel("오늘로 이동")
                    }
                }
                ToolbarItem(placement: .primaryAction) {
                    Button {
                        editing = EditorTarget(event: nil, date: mode == .month ? selected : model.today)
                    } label: {
                        Label("기록 추가", systemImage: "plus")
                    }
                    .disabled(model.isReadOnly)
                }
            }
            .task(id: model.projection?.profile?.period) {
                if let period = model.projection?.profile?.period {
                    milestones = await model.serviceMilestones(period)
                }
            }
            .sheet(item: $editing) { target in
                EventEditorSheet(event: target.event, initialDate: target.date)
            }
            .safeAreaInset(edge: .bottom) {
                if let undo {
                    UndoBar(label: model.label(for: undo.eventType)) {
                        Task { await restore(undo) }
                    } onDismiss: {
                        self.undo = nil
                    }
                    .padding(.horizontal, SGSpacing.gutter)
                    .padding(.bottom, SGSpacing.xs)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                }
            }
        }
    }

    private var filtered: [ServiceEvent] {
        guard let filter else { return events }
        return events.filter { display($0)?.category == filter.rawValue }
    }

    private var filterMenu: some View {
        Menu {
            Picker("분류", selection: $filter) {
                Text("전체").tag(SGEventCategory?.none)
                ForEach(SGEventCategory.allCases, id: \.self) { category in
                    Text(model.taxonomy?.categoryLabels[category.rawValue] ?? category.rawValue)
                        .tag(SGEventCategory?.some(category))
                }
            }
        } label: {
            Label(filter.map { model.taxonomy?.categoryLabels[$0.rawValue] ?? "" } ?? "전체",
                  systemImage: filter == nil ? "line.3.horizontal.decrease.circle" : "line.3.horizontal.decrease.circle.fill")
        }
        .accessibilityLabel("분류 필터")
    }

    private func display(_ event: ServiceEvent) -> EventDisplay? {
        model.projection?.eventDisplay?[event.id]
    }

    private func delete(_ event: ServiceEvent) {
        Task {
            if await model.run("deleteServiceEvent", [.string(event.id)]).isEmpty {
                withAnimation { undo = event }
                try? await Task.sleep(for: .seconds(6))
                if undo?.id == event.id { withAnimation { undo = nil } }
            }
        }
    }

    private func restore(_ event: ServiceEvent) async {
        let issues = await model.run("restoreServiceEvent", [.string(event.id)])
        if issues.isEmpty { withAnimation { undo = nil } }
    }
}

// MARK: Month grid

private struct MonthCalendar: View {
    @Binding var month: CivilDate
    @Binding var selected: CivilDate
    let events: [ServiceEvent]
    let display: (ServiceEvent) -> EventDisplay?
    @Environment(AppModel.self) private var model

    private var firstOfMonth: CivilDate { CivilDate(year: month.year, month: month.month, day: 1)! }

    /// Whole weeks: this month's days plus the neighbouring months' days that
    /// fill the first and last week (Stitch draws them muted).
    private var cells: [(date: CivilDate, inMonth: Bool)] {
        let leading = firstOfMonth.weekday
        let count = CivilDate.daysInMonth(year: month.year, month: month.month)
        let total = leading + count + (7 - (leading + count) % 7) % 7
        return (0..<total).map { index in
            let date = firstOfMonth.adding(days: index - leading)
            return (date, index >= leading && index < leading + count)
        }
    }

    var body: some View {
        SGCard(padding: SGSpacing.sm) {
            VStack(spacing: SGSpacing.xs) {
                HStack(spacing: 0) {
                    ForEach(Array(Formatters.weekdays.enumerated()), id: \.offset) { index, name in
                        Text(name)
                            .font(SGTypography.micro)
                            .foregroundStyle(.sg(index == 0 ? SGColor.danger : index == 6 ? SGColor.info : SGColor.textTertiary))
                            .frame(maxWidth: .infinity)
                    }
                }
                .accessibilityHidden(true)

                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 2), count: 7), spacing: 2) {
                    ForEach(cells, id: \.date.dayNumber) { cell in
                        if cell.inMonth {
                            DayCell(date: cell.date, isToday: cell.date == model.today, isSelected: cell.date == selected,
                                    categories: categories(on: cell.date))
                                .onTapGesture { selected = cell.date }
                                .accessibilityAddTraits(cell.date == selected ? [.isButton, .isSelected] : .isButton)
                        } else {
                            VStack(spacing: 4) {
                                Text("\(cell.date.day)")
                                    .font(SGTypography.font(15, .medium, relativeTo: .body))
                                    .monospacedDigit()
                                    .foregroundStyle(.sg(SGColor.textTertiary))
                                    .opacity(0.45)
                                    .frame(width: 32, height: 32)
                                Color.clear.frame(height: 6)
                            }
                            .frame(maxWidth: .infinity, minHeight: SGSize.rowMinHeight)
                            .accessibilityHidden(true)
                        }
                    }
                }
                .gesture(DragGesture(minimumDistance: 30).onEnded { value in
                    if value.translation.width < -50 { shift(1) } else if value.translation.width > 50 { shift(-1) }
                })
                if !legend.isEmpty {
                    // Only the categories recorded this month, with the
                    // shared labels; the mark's shape carries the category
                    // as well as its color.
                    HStack(spacing: SGSpacing.sm) {
                        ForEach(legend, id: \.0) { category, label in
                            HStack(spacing: SGSpacing.iconGap) {
                                SGCategoryMark(category, size: 8)
                                Text(label).font(SGTypography.micro).foregroundStyle(.sg(SGColor.textSecondary))
                            }
                        }
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.top, SGSpacing.xxs)
                    .accessibilityElement(children: .combine)
                    .accessibilityLabel("범례")
                }
            }
        }
    }

    private var legend: [(SGEventCategory, String)] {
        var seen: [(SGEventCategory, String)] = []
        for date in cells.filter(\.inMonth).map(\.date) {
            for event in events where event.covers(date) {
                if let shown = display(event), let category = SGEventCategory(rawValue: shown.category),
                   !seen.contains(where: { $0.0 == category }) {
                    seen.append((category, shown.categoryLabel))
                }
            }
        }
        return seen.sorted { SGEventCategory.allCases.firstIndex(of: $0.0)! < SGEventCategory.allCases.firstIndex(of: $1.0)! }
    }

    private func categories(on date: CivilDate) -> [SGEventCategory] {
        var seen: [SGEventCategory] = []
        for event in events where event.covers(date) {
            if let raw = display(event)?.category, let category = SGEventCategory(rawValue: raw), !seen.contains(category) {
                seen.append(category)
            }
        }
        return seen
    }

    private func shift(_ amount: Int) {
        month = firstOfMonth.adding(months: amount)
        let target = month.year == model.today.year && month.month == model.today.month ? model.today : firstOfMonth.adding(months: 0)
        selected = target
    }
}

private struct DayCell: View {
    let date: CivilDate
    let isToday: Bool
    let isSelected: Bool
    let categories: [SGEventCategory]

    private var tile: RoundedRectangle { RoundedRectangle(cornerRadius: 9, style: .continuous) }

    /// Sunday red and Saturday blue, as in Stitch. Public holidays are not
    /// marked: the shared core has no holiday calendar.
    private var dayColor: SGToken {
        switch date.weekday {
        case 0: SGColor.danger
        case 6: SGColor.info // blue in every theme (the Warrior accent is gold)
        default: SGColor.textPrimary
        }
    }

    var body: some View {
        VStack(spacing: 4) {
            Text("\(date.day)")
                .font(SGTypography.font(15, isToday ? .heavy : .medium, relativeTo: .body))
                .monospacedDigit()
                .foregroundStyle(.sg(isSelected ? SGColor.onAccent : dayColor))
                .frame(width: 32, height: 32)
                // Stitch: rounded tiles. Selected is filled, today is outlined,
                // and a day with records is tinted with its first category.
                .background {
                    if isSelected {
                        tile.fill(.sg(SGColor.accent))
                    } else if let first = categories.first {
                        tile.fill(.sg(first.mark)).opacity(0.16)
                    }
                }
                .overlay {
                    if isToday && !isSelected {
                        tile.strokeBorder(.sg(SGColor.accent), lineWidth: 1.5)
                    }
                }
                // Warrior gilded frame around today (transparent in the standard theme).
                .overlay {
                    if isToday {
                        tile.strokeBorder(.sg(SGColor.ornament), lineWidth: 1.5).padding(-3.5)
                    }
                }
            HStack(spacing: 2) {
                ForEach(categories.prefix(3), id: \.self) { SGCategoryMark($0, size: 6) }
            }
            .frame(height: 6)
        }
        .frame(maxWidth: .infinity, minHeight: SGSize.rowMinHeight)
        .contentShape(Rectangle())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Formatters.longDate(date) + (isToday ? ", 오늘" : ""))
        .accessibilityValue(categories.isEmpty ? "기록 없음" : "기록 \(categories.count)종류")
    }
}

private struct DayPanel: View {
    let date: CivilDate
    let events: [ServiceEvent]
    let display: (ServiceEvent) -> EventDisplay?
    let onAdd: () -> Void
    let onOpen: (ServiceEvent) -> Void
    @Environment(AppModel.self) private var model

    var body: some View {
        SGCard {
            VStack(alignment: .leading, spacing: SGSpacing.sm) {
                HStack(spacing: SGSpacing.xs) {
                    RoundedRectangle(cornerRadius: 2).fill(.sg(SGColor.accent))
                        .frame(width: 4, height: 20)
                        .accessibilityHidden(true)
                    Text(Formatters.longDate(date))
                        .font(SGTypography.cardTitle)
                        .foregroundStyle(.sg(SGColor.textPrimary))
                    SGWorldEyebrow("DAILY LOG")
                }
                .accessibilityAddTraits(.isHeader)
                if events.isEmpty {
                    Text("이 날의 기록이 없어요.")
                        .font(SGTypography.body)
                        .foregroundStyle(.sg(SGColor.textSecondary))
                } else {
                    ForEach(events) { event in
                        Button { onOpen(event) } label: {
                            EventRow(event: event, display: display(event))
                        }
                        .buttonStyle(.plain)
                        if event.id != events.last?.id { Divider() }
                    }
                }
                Button(action: onAdd) {
                    Label("이 날에 기록 추가", systemImage: "calendar.badge.plus")
                }
                .buttonStyle(SGSecondaryButtonStyle())
                .disabled(model.isReadOnly)
            }
        }
    }
}

// MARK: Civic Codex sections

/// Month switcher card (Stitch: chevrons in tinted tiles and the month; 오늘
/// lives in the toolbar).
private struct MonthSwitcher: View {
    @Binding var month: CivilDate
    @Binding var selected: CivilDate
    @Environment(AppModel.self) private var model

    private var firstOfMonth: CivilDate { CivilDate(year: month.year, month: month.month, day: 1)! }

    var body: some View {
        SGCard(padding: SGSpacing.sm) {
            HStack {
                tile("chevron.left", label: "이전 달") { shift(-1) }
                Spacer()
                VStack(spacing: SGSpacing.xxxs) {
                    Text(Formatters.month(month)).font(SGTypography.title3).monospacedDigit()
                        .foregroundStyle(.sg(SGColor.textPrimary))
                    SGWorldEyebrow("OPERATION CYCLE")
                }
                Spacer()
                tile("chevron.right", label: "다음 달") { shift(1) }
            }
        }
    }

    private func tile(_ symbol: String, label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(SGTypography.label)
                .foregroundStyle(.sg(SGColor.accent))
                .frame(width: SGSpacing.minimumHitTarget, height: SGSpacing.minimumHitTarget)
                .background(.sg(SGColor.selectedBackground), in: RoundedRectangle(cornerRadius: SGRadius.control, style: .continuous))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }

    private func shift(_ amount: Int) {
        month = firstOfMonth.adding(months: amount)
        selected = month.year == model.today.year && month.month == model.today.month ? model.today : month
    }
}

/// This month at a glance. Counts are records, not days: day totals (half
/// days, hours) belong to the leave ledger's own calculation.
private struct MonthSummary: View {
    let month: CivilDate
    let events: [ServiceEvent]
    let display: (ServiceEvent) -> EventDisplay?
    let next: String?
    @Environment(\.dynamicTypeSize) private var typeSize

    private var inMonth: [ServiceEvent] {
        let first = CivilDate(year: month.year, month: month.month, day: 1)!
        let last = first.adding(days: CivilDate.daysInMonth(year: month.year, month: month.month) - 1)
        return events.filter { $0.startDate.dayNumber <= last.dayNumber && $0.endDate.dayNumber >= first.dayNumber }
    }

    private func count(_ category: SGEventCategory) -> Int {
        inMonth.filter { display($0)?.category == category.rawValue }.count
    }

    private var layout: AnyLayout {
        typeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(spacing: SGSpacing.xxs))
            : AnyLayout(HStackLayout(spacing: SGSpacing.xxs))
    }

    var body: some View {
        layout {
            cell("이번 달 기록", "\(inMonth.count)", unit: "건")
            cell("연가 기록", "\(count(.leave))", unit: "건", highlighted: true)
            cell("병가 기록", "\(count(.sick))", unit: "건")
            cell("다음 이정표", next ?? "—", unit: nil, accent: true)
        }
        .padding(SGSpacing.xs)
        .background(.sg(SGColor.surfaceRaised), in: RoundedRectangle(cornerRadius: SGRadius.card, style: .continuous))
    }

    private func cell(_ title: String, _ value: String, unit: String?, highlighted: Bool = false, accent: Bool = false) -> some View {
        VStack(spacing: SGSpacing.xxxs) {
            Text(title).font(SGTypography.micro).foregroundStyle(.sg(SGColor.textSecondary))
            HStack(alignment: .lastTextBaseline, spacing: 1) {
                Text(value).font(SGTypography.title3).monospacedDigit()
                    .foregroundStyle(.sg(accent ? SGColor.accent : SGColor.textPrimary))
                    .lineLimit(1).minimumScaleFactor(0.7)
                if let unit { Text(unit).font(SGTypography.micro).foregroundStyle(.sg(SGColor.textSecondary)) }
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, SGSpacing.xs)
        .background(highlighted ? AnyShapeStyle(.sg(SGColor.surface)) : AnyShapeStyle(Color.clear),
                    in: RoundedRectangle(cornerRadius: SGRadius.control, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

/// "다가오는 일정" with the add button (Stitch "UPCOMING CIVIC AGENDAS").
/// Stitch's "일정 신청" became 기록 추가: the app records, it files nothing.
private struct UpcomingSection: View {
    let items: [HomeModel.AgendaItem]
    let display: (ServiceEvent) -> EventDisplay?
    let readOnly: Bool
    let onAdd: () -> Void
    let onOpen: (ServiceEvent) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: SGSpacing.sm) {
            HStack(alignment: .center) {
                VStack(alignment: .leading, spacing: 0) {
                    Text("다가오는 일정").font(SGTypography.sectionTitle).foregroundStyle(.sg(SGColor.textPrimary))
                    SGWorldEyebrow("UPCOMING AGENDA")
                }
                .accessibilityAddTraits(.isHeader)
                Spacer()
                Button(action: onAdd) {
                    Label("기록 추가", systemImage: "plus")
                        .font(SGTypography.label)
                        .padding(.horizontal, SGSpacing.sm)
                        .frame(minHeight: SGSpacing.minimumHitTarget)
                        .foregroundStyle(.sg(SGColor.onAccent))
                        .background(.sg(SGColor.accent), in: RoundedRectangle(cornerRadius: SGRadius.control, style: .continuous))
                }
                .buttonStyle(.plain)
                .disabled(readOnly)
            }
            if items.isEmpty {
                SGCard {
                    SGEmptyState(symbol: "sunrise", title: "예정된 일정이 없어요",
                                 message: "휴가를 정했다면 미리 기록해 두세요.")
                }
            } else {
                ForEach(items) { item in
                    Button { onOpen(item.event) } label: {
                        SGCard(padding: SGSpacing.sm) {
                            AgendaRow(item: item, display: display(item.event))
                        }
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }
}

/// Stitch "CIVIC INVENTORY": what is left, at the bottom of the calendar.
private struct InventoryStrip: View {
    let leave: HomeModel.Leave
    let next: String?
    let headline: String
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        let layout = typeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: SGSpacing.xs))
            : AnyLayout(HStackLayout(spacing: SGSpacing.sm))
        layout {
            VStack(alignment: .leading, spacing: 0) {
                SGWorldEyebrow("CIVIC INVENTORY", tint: SGColor.heroForeground3)
                Text("한눈에 보기").font(SGTypography.label).foregroundStyle(.sg(SGColor.heroForeground))
            }
            if !typeSize.isAccessibilitySize { Spacer(minLength: SGSpacing.xs) }
            item("남은 연가", leave.kind == "READY" ? (leave.remaining ?? "—") : "확인 필요")
            if let next { item("다음 이정표", next) }
            item("소집해제", headline)
        }
        .padding(SGSpacing.md)
        .background { SGHeroBackground(celebrate: false) }
        .clipShape(RoundedRectangle(cornerRadius: SGRadius.card, style: .continuous))
        .environment(\.colorScheme, .dark)
        .accessibilityElement(children: .combine)
    }

    private func item(_ title: String, _ value: String) -> some View {
        VStack(alignment: typeSize.isAccessibilitySize ? .leading : .trailing, spacing: 0) {
            Text(title).font(SGTypography.micro).foregroundStyle(.sg(SGColor.heroForeground3))
            Text(value).font(SGTypography.bodyStrong).monospacedDigit().foregroundStyle(.sg(SGColor.heroAccent))
        }
    }
}

struct EventRow: View {
    let event: ServiceEvent
    let display: EventDisplay?

    var body: some View {
        HStack(spacing: SGSpacing.sm) {
            if let display, let category = SGEventCategory(rawValue: display.category) {
                SGCategoryChip(category, text: display.categoryLabel)
            }
            VStack(alignment: .leading, spacing: SGSpacing.xxxs) {
                Text(display?.label ?? event.eventType)
                    .font(SGTypography.bodyStrong)
                    .foregroundStyle(.sg(SGColor.textPrimary))
                Text(display?.timing ?? "")
                    .font(SGTypography.caption)
                    .foregroundStyle(.sg(SGColor.textTertiary))
                if let note = event.note, !note.isEmpty {
                    Text(note).font(SGTypography.caption).foregroundStyle(.sg(SGColor.textSecondary)).lineLimit(2)
                }
            }
            Spacer()
            if event.source.kind == "IMPORT" {
                Image(systemName: "square.and.arrow.down")
                    .foregroundStyle(.sg(SGColor.textTertiary))
                    .accessibilityLabel("가져온 기록")
            }
            Image(systemName: "chevron.right").font(.caption).foregroundStyle(.sg(SGColor.textTertiary))
                .accessibilityHidden(true)
        }
        .frame(minHeight: SGSize.rowMinHeight)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }
}

// MARK: Agenda

private struct AgendaList: View {
    let events: [ServiceEvent]
    let display: (ServiceEvent) -> EventDisplay?
    let today: CivilDate
    let onOpen: (ServiceEvent) -> Void
    let onDelete: (ServiceEvent) -> Void

    var body: some View {
        let upcoming = events.filter { $0.endDate >= today }.sorted { $0.startDate < $1.startDate }
        let past = events.filter { $0.endDate < today }.sorted { $0.startDate > $1.startDate }
        VStack(alignment: .leading, spacing: SGSpacing.md) {
            section("다가오는 기록", upcoming, empty: "다가오는 기록이 없어요.")
            section("지난 기록", past, empty: "지난 기록이 없어요.")
        }
    }

    private func section(_ title: String, _ items: [ServiceEvent], empty: String) -> some View {
        SGCard {
            VStack(alignment: .leading, spacing: SGSpacing.sm) {
                SGSectionHeader(title, detail: items.isEmpty ? nil : "\(items.count)건")
                if items.isEmpty {
                    Text(empty).font(SGTypography.body).foregroundStyle(.sg(SGColor.textSecondary))
                }
                ForEach(items) { event in
                    HStack(alignment: .top, spacing: SGSpacing.sm) {
                        Text("\(event.startDate.month).\(event.startDate.day)")
                            .font(SGTypography.label).monospacedDigit()
                            .foregroundStyle(.sg(SGColor.textSecondary))
                            .frame(width: SGSize.dateTile, alignment: .leading)
                            .padding(.top, SGSpacing.md)
                        Button { onOpen(event) } label: { EventRow(event: event, display: display(event)) }
                            .buttonStyle(.plain)
                    }
                    .contextMenu {
                        Button("수정", systemImage: "pencil") { onOpen(event) }
                        Button("삭제", systemImage: "trash", role: .destructive) { onDelete(event) }
                    }
                    .accessibilityAction(named: "삭제") { onDelete(event) }
                    if event.id != items.last?.id { Divider() }
                }
            }
        }
    }
}

private struct RecentlyDeleted: View {
    let events: [ServiceEvent]
    let label: (ServiceEvent) -> String
    let onRestore: (ServiceEvent) async -> Void

    var body: some View {
        if !events.isEmpty {
            DisclosureGroup {
                VStack(alignment: .leading, spacing: SGSpacing.xs) {
                    ForEach(events) { event in
                        HStack {
                            VStack(alignment: .leading) {
                                Text(label(event)).font(SGTypography.bodyStrong)
                                Text(Formatters.longDate(event.startDate)).font(SGTypography.caption)
                                    .foregroundStyle(.sg(SGColor.textTertiary))
                            }
                            Spacer()
                            Button("되돌리기") { Task { await onRestore(event) } }
                                .font(SGTypography.label)
                        }
                        .frame(minHeight: SGSpacing.minimumHitTarget)
                    }
                }
                .padding(.top, SGSpacing.xs)
            } label: {
                Text("최근 삭제한 기록 \(events.count)건").font(SGTypography.label)
                    .foregroundStyle(.sg(SGColor.textSecondary))
            }
            .padding(SGSpacing.md)
            .background(.sg(SGColor.surface), in: RoundedRectangle(cornerRadius: SGRadius.card, style: .continuous))
        }
    }
}

private struct UndoBar: View {
    let label: String
    let onUndo: () -> Void
    let onDismiss: () -> Void

    var body: some View {
        HStack {
            Text("\(label) 기록을 삭제했어요").font(SGTypography.label)
            Spacer()
            Button("되돌리기", action: onUndo).font(SGTypography.bodyStrong)
            Button(action: onDismiss) { Image(systemName: "xmark") }
                .accessibilityLabel("닫기")
        }
        .foregroundStyle(.sg(SGColor.heroForeground))
        .padding(.horizontal, SGSpacing.md)
        .frame(minHeight: SGSize.rowMinHeight)
        .background(.sg(SGColor.heroBackground), in: RoundedRectangle(cornerRadius: SGRadius.control, style: .continuous))
        .sgShadow(.raised)
    }
}
