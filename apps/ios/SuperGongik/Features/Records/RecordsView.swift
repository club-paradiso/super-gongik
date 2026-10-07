import SGCore
import SGDesignSystem
import SGFoundation
import SwiftUI

/// 기록: the service calendar. Month grid and agenda over the same live
/// records; create, edit, delete (soft, with undo) and restore all go through
/// the shared store commands.
struct RecordsView: View {
    enum Mode: String, CaseIterable { case month = "월간", agenda = "목록" }

    @Environment(AppModel.self) private var model
    @State private var mode: Mode = .month
    @State private var month: CivilDate = SeoulClock.today(at: .now)
    @State private var selected: CivilDate = SeoulClock.today(at: .now)
    @State private var editing: EditorTarget?
    @State private var filter: SGEventCategory?
    @State private var undo: ServiceEvent?

    struct EditorTarget: Identifiable {
        let event: ServiceEvent?
        let date: CivilDate
        var id: String { event?.id ?? "new-\(date)" }
    }

    private var events: [ServiceEvent] { model.document?.liveEvents ?? [] }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: SGSpacing.md) {
                    Picker("보기", selection: $mode) {
                        ForEach(Mode.allCases, id: \.self) { Text($0.rawValue) }
                    }
                    .pickerStyle(.segmented)

                    switch mode {
                    case .month:
                        MonthCalendar(month: $month, selected: $selected, events: events, display: display)
                        DayPanel(date: selected, events: events.filter { $0.covers(selected) }, display: display,
                                 onAdd: { editing = EditorTarget(event: nil, date: selected) },
                                 onOpen: { editing = EditorTarget(event: $0, date: $0.startDate) })
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
            .navigationTitle("기록")
            .toolbar {
                if mode == .agenda {
                    ToolbarItem(placement: .topBarLeading) { filterMenu }
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

    private var cells: [CivilDate?] {
        let leading = firstOfMonth.weekday
        let count = CivilDate.daysInMonth(year: month.year, month: month.month)
        let days = (0..<count).map { firstOfMonth.adding(days: $0) }
        let all: [CivilDate?] = Array(repeating: nil, count: leading) + days
        return all + Array(repeating: nil, count: (7 - all.count % 7) % 7)
    }

    var body: some View {
        SGCard(padding: SGSpacing.sm) {
            VStack(spacing: SGSpacing.xs) {
                HStack {
                    Button { shift(-1) } label: { Image(systemName: "chevron.left").frame(width: SGSpacing.minimumHitTarget, height: SGSpacing.minimumHitTarget) }
                        .accessibilityLabel("이전 달")
                    Spacer()
                    Text(Formatters.month(month)).font(SGTypography.cardTitle).monospacedDigit()
                    Spacer()
                    Button { shift(1) } label: { Image(systemName: "chevron.right").frame(width: SGSpacing.minimumHitTarget, height: SGSpacing.minimumHitTarget) }
                        .accessibilityLabel("다음 달")
                }
                .overlay(alignment: .trailing) {
                    if month.year != model.today.year || month.month != model.today.month {
                        Button("오늘") {
                            month = model.today
                            selected = model.today
                        }
                        .font(SGTypography.label)
                        .padding(.trailing, 48)
                    }
                }

                HStack(spacing: 0) {
                    ForEach(Array(Formatters.weekdays.enumerated()), id: \.offset) { index, name in
                        Text(name)
                            .font(SGTypography.micro)
                            .foregroundStyle(.sg(index == 0 ? SGColor.danger : SGColor.textTertiary))
                            .frame(maxWidth: .infinity)
                    }
                }
                .accessibilityHidden(true)

                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 2), count: 7), spacing: 2) {
                    ForEach(Array(cells.enumerated()), id: \.offset) { _, date in
                        if let date {
                            DayCell(date: date, isToday: date == model.today, isSelected: date == selected,
                                    categories: categories(on: date))
                                .onTapGesture { selected = date }
                                .accessibilityAddTraits(date == selected ? [.isButton, .isSelected] : .isButton)
                        } else {
                            Color.clear.frame(height: SGSize.rowMinHeight)
                        }
                    }
                }
                .gesture(DragGesture(minimumDistance: 30).onEnded { value in
                    if value.translation.width < -50 { shift(1) } else if value.translation.width > 50 { shift(-1) }
                })
            }
        }
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

    var body: some View {
        VStack(spacing: 4) {
            Text("\(date.day)")
                .font(SGTypography.font(15, isToday ? .heavy : .medium, relativeTo: .body))
                .monospacedDigit()
                .foregroundStyle(.sg(isSelected ? SGColor.onAccent : (date.weekday == 0 ? SGColor.danger : SGColor.textPrimary)))
                .frame(width: 32, height: 32)
                .background {
                    if isSelected {
                        Circle().fill(.sg(SGColor.accent))
                    } else if isToday {
                        Circle().strokeBorder(.sg(SGColor.accent), lineWidth: 1.5)
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
                SGSectionHeader(Formatters.longDate(date))
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

struct EventRow: View {
    let event: ServiceEvent
    let display: EventDisplay?

    var body: some View {
        HStack(spacing: SGSpacing.sm) {
            if let display, let category = SGEventCategory(rawValue: display.category) {
                SGCategoryChip(category, text: display.categoryLabel)
            }
            VStack(alignment: .leading, spacing: 2) {
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
