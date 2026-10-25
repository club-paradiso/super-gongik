import SGCore

/// Where each missing input of a month's compensation is entered, derived
/// from the shared evaluation's structured fields — component keys and
/// statuses and `serviceDays.missing` codes — never from its Korean text, so
/// the shortcuts stay right when wording changes. The evaluation itself and
/// its gates are untouched: these only open the right form.
enum PaySetupActions {
    enum Target: Hashable {
        case profile(ProfileEditView.Section)
        case attendance
    }

    struct Action: Identifiable, Hashable {
        let target: Target
        let title: String
        var id: Target { target }
    }

    static func actions(for compensation: MonthlyCompensation) -> [Action] {
        var actions: [Action] = []
        func add(_ target: Target, _ title: String) {
            guard !actions.contains(where: { $0.target == target }) else { return }
            actions.append(Action(target: target, title: title))
        }

        // Working-day derivation (meal and transport day counts).
        if let days = compensation.serviceDays, days.status != "READY" {
            if days.status == "UNSUPPORTED" {
                add(.profile(.workPattern), "복무형태 확인")
            }
            for code in days.missing {
                switch code {
                case "WORK_PATTERN", "WORK_WEEKDAYS": add(.profile(.workPattern), "복무형태·근무 요일 입력")
                case "MONTH_CONFIRMATION": add(.attendance, "이 달 근무일 확인")
                case "MONTH_RECONFIRMATION": add(.attendance, "이 달 근무일 다시 확인")
                case "DAY_DECISIONS": add(.attendance, "출근 여부를 정할 날 확인")
                default: break
                }
            }
        }

        for component in compensation.components {
            switch (component.key, component.status) {
            case ("BASE_PAY", "NEEDS_INPUT"):
                add(.profile(.priorService), "이전 복무 경력 입력")
            case ("BASE_PAY", "GATED"):
                // A partial credited month gates on the profile; non-payable
                // dates and the rounding policy gate on the month confirmation.
                if component.explanation.contains("인정 기간") {
                    add(.profile(.priorService), "이전 복무 인정 기간 확인")
                } else {
                    add(.attendance, "미지급 날짜·끝수 처리 확인")
                }
            case ("MEAL", "NEEDS_INPUT") where component.dailyRate == nil:
                add(.profile(.meal), "기관 중식비 확인")
            case ("TRANSPORT", "NEEDS_INPUT") where component.dailyRate == nil:
                add(.profile(.transport), "1일 교통비 입력")
            default:
                break
            }
        }
        return actions
    }
}
