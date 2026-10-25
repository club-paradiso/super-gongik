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

    /// Stored records sharing a day with the form, oldest first; the record
    /// being edited and deleted records are never conflicts of themselves.
    static func conflicts(with form: EventFormState, excluding editingId: String?, in events: [ServiceEvent]) -> [ServiceEvent] {
        guard let range = range(of: form) else { return [] }
        return events
            .filter { $0.id != editingId && $0.deletedAt == nil && $0.startDate <= range.upperBound && range.lowerBound <= $0.endDate }
            .sorted { $0.startDate < $1.startDate }
    }
}
