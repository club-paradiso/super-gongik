import SGCore
import SGFoundation

/// What the record editor shows when a save is refused: one summary at the
/// top of the form, the section each issue belongs to (so the hint sits next
/// to the field), and the stored records a duplicate or overlap points at.
/// Pure, so the app tests pin it; the messages themselves come from the
/// shared validation unchanged.
enum EventEditorFeedback {
    /// The form section an issue is shown under.
    enum Area: Hashable {
        case type, timing, dates, other
    }

    static func area(of issue: EventIssue) -> Area {
        switch issue.field {
        case "eventType", "sickLeaveCategory": .type
        case "startDate", "endDate", "dayCount": .dates
        case "timing", "startTime", "endTime", "durationMinutes", "half": .timing
        default: .other
        }
    }

    static func issues(_ issues: [EventIssue], in area: Area) -> [EventIssue] {
        issues.filter { self.area(of: $0) == area }
    }

    /// Title of the summary notice above the form.
    static func summary(_ errors: [EventIssue]) -> String {
        errors.count <= 1
            ? "저장하지 못했어요. 아래 항목을 확인해 주세요."
            : "저장하지 못했어요. 확인할 항목이 \(errors.count)개 있어요."
    }

    /// What VoiceOver reads when a save is refused: the summary and the first
    /// message, so the reason is heard without moving to the notice.
    static func announcement(_ errors: [EventIssue]) -> String {
        [summary(errors), errors.first?.message].compactMap { $0 }.joined(separator: " ")
    }

    /// The shared validation's codes for "another record already covers this".
    static func isConflict(_ issue: EventIssue) -> Bool {
        ["LEAVE_OVERLAP", "LEAVE_OVERLAP_UNRESOLVED", "POSSIBLE_DUPLICATE"].contains(issue.code)
    }

    /// The days a form occupies: the range for all-day records, the start
    /// date alone otherwise. Nil while a date field is not a date yet.
    static func range(of form: EventFormState) -> ClosedRange<CivilDate>? {
        guard let start = CivilDate(form.startDate) else { return nil }
        guard form.mode == "ALL_DAY", let end = CivilDate(form.endDate), start <= end else { return start...start }
        return start...end
    }

    /// Mirror the shared domain validator's leave overlap rules. Date overlap
    /// alone must never point to unrelated records or a disjoint AM/PM slot.
    private static let leaveTypes: Set<String> = [
        "ANNUAL_LEAVE", "SICK_LEAVE", "OFFICIAL_LEAVE", "SPECIAL_LEAVE",
        "COMPASSIONATE_LEAVE", "OUTING", "LATE_ARRIVAL", "EARLY_LEAVE"
    ]

    private static func minutes(_ value: String?) -> Int? {
        guard let value, !value.isEmpty else { return nil }
        let parts = value.split(separator: ":")
        guard parts.count == 2, let h = Int(parts[0]), let m = Int(parts[1]),
              (0...23).contains(h), (0...59).contains(m) else { return nil }
        return h * 60 + m
    }

    private enum SlotVerdict { case conflict, unresolved, none }

    private static func leaveOverlap(_ form: EventFormState, _ existing: ServiceEvent) -> SlotVerdict {
        guard leaveTypes.contains(form.eventType), leaveTypes.contains(existing.eventType) else { return .none }
        if form.mode == "ALL_DAY" || existing.timing.kind == "ALL_DAY" { return .conflict }
        if form.mode == "HALF_DAY" && existing.timing.kind == "HALF_DAY" {
            guard let half = existing.timing.half else { return .unresolved }
            return form.half == half ? .conflict : .none
        }
        if form.mode == "PARTIAL" && existing.timing.kind == "PARTIAL" {
            if let s1 = minutes(form.startTime), let e1 = minutes(form.endTime),
               let s2 = minutes(existing.timing.startTime), let e2 = minutes(existing.timing.endTime) {
                return s1 < e2 && s2 < e1 ? .conflict : .none
            }
        }
        return .unresolved
    }

    private static func sameContent(_ form: EventFormState, _ existing: ServiceEvent) -> Bool {
        guard form.eventType == existing.eventType, form.startDate == existing.startDate.description,
              form.endDate == existing.endDate.description, form.mode == existing.timing.kind else { return false }
        switch form.mode {
        case "ALL_DAY": return Int(form.dayCount) == existing.timing.dayCount
        case "HALF_DAY": return form.half == existing.timing.half
        default:
            let duration = (Int(form.hours) ?? 0) * 60 + (Int(form.minutes) ?? 0)
            return duration == existing.timing.durationMinutes &&
                (form.startTime.isEmpty ? nil : form.startTime) == existing.timing.startTime &&
                (form.endTime.isEmpty ? nil : form.endTime) == existing.timing.endTime
        }
    }

    /// Only stored records that actually caused an error/warning are linked.
    static func conflicts(with form: EventFormState, excluding editingId: String?, in events: [ServiceEvent],
                          issues: [EventIssue]) -> [ServiceEvent] {
        let codes = Set(issues.filter(isConflict).map(\.code))
        guard !codes.isEmpty, let range = range(of: form) else { return [] }
        return events.filter { existing in
            guard existing.id != editingId, existing.deletedAt == nil,
                  existing.startDate <= range.upperBound && range.lowerBound <= existing.endDate else { return false }
            if codes.contains("POSSIBLE_DUPLICATE") && sameContent(form, existing) { return true }
            let verdict = leaveOverlap(form, existing)
            return (codes.contains("LEAVE_OVERLAP") && verdict == .conflict) ||
                (codes.contains("LEAVE_OVERLAP_UNRESOLVED") && verdict == .unresolved)
        }.sorted { $0.startDate < $1.startDate }
    }

    /// Compatibility for the existing focused tests; callers should supply validation issues.
    static func conflicts(with form: EventFormState, excluding editingId: String?, in events: [ServiceEvent]) -> [ServiceEvent] {
        conflicts(with: form, excluding: editingId, in: events,
                  issues: [EventIssue(code: "LEAVE_OVERLAP", message: "", field: "startDate"),
                           EventIssue(code: "LEAVE_OVERLAP_UNRESOLVED", message: "", field: "startDate")])
    }
}
