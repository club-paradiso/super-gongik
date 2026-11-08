#if DEBUG
import Foundation
import SGCore
import SGFoundation

/// DEBUG-only screenshot fixture: `-SGSeedDemo YES` on an empty store creates a
/// realistic document through the same core commands the UI uses (profile,
/// prior-service answer, a few annual-leave records), so screenshot QA
/// (`apps/ios/scripts/screenshot-qa.sh`) is deterministic without tapping.
/// Compiled out of release builds; it holds no rule, only input values.
enum DebugSeed {
    @MainActor
    static func runIfRequested(_ model: AppModel) async {
        guard model.profile == nil else { return }
        if UserDefaults.standard.string(forKey: "SGSeedFixture") == "figma" {
            await seedFigmaSample(model)
            return
        }
        guard UserDefaults.standard.bool(forKey: "SGSeedDemo") else { return }
        let today = model.today
        let callUp = today.adding(days: -300)
        guard let discharge = await model.pure(
            "calculateExpectedDischargeDate", [.string(callUp.description)], as: CivilDate.self) else { return }
        var issues = await model.run("createProfile", [.object([
            "callUpDate": .string(callUp.description),
            "expectedDischargeDate": .string(discharge.description),
            "serviceCategory": .null,
            "workplaceType": .null,
            "defaultCommuteCost": .null,
            "defaultMealAllowanceOverride": .null,
            "timezone": .string("Asia/Seoul"),
        ])])
        issues += await model.editProfile(["priorServiceCredit": .string("NONE")])
        // `-SGSeedWorkday YES` adds 09:00–18:00 work hours, so the Live
        // Activity can show its 퇴근까지 countdown. Off by default: the other
        // screenshots keep the profile without work hours.
        if UserDefaults.standard.bool(forKey: "SGSeedWorkday") {
            issues += await model.editProfile([
                "workdayStartTime": .string("09:00"),
                "workdayEndTime": .string("18:00"),
            ])
        }
        for (offset, days) in [(-40, 1), (6, 1), (20, 2)] {
            let start = today.adding(days: offset)
            issues += await model.run("createServiceEvent", [.object([
                "eventType": .string("ANNUAL_LEAVE"),
                "startDate": .string(start.description),
                "endDate": .string(start.adding(days: days - 1).description),
                "timing": .object(["kind": .string("ALL_DAY"), "dayCount": .number(Double(days))]),
                "title": .null,
                "note": .null,
            ])])
        }
        if !issues.isEmpty { AppLog.error("demo seed: \(issues.map(\.code))") }
    }

    /// `-SGSeedFixture figma -SGToday 2026-03-14`: the sample state drawn on
    /// Figma page 52 (Civic Codex frames): 소집 2025-03-18, 소집해제 예정
    /// 2027-01-14 (entered by hand, as a user may after an extension), and the
    /// March records the calendar frame shows. Used by the Figma comparison
    /// (`apps/ios/scripts/figma-compare.py`) so both sides render the same
    /// data. Input values only; every number on screen still comes from the core.
    @MainActor
    private static func seedFigmaSample(_ model: AppModel) async {
        var issues = await model.run("createProfile", [.object([
            "callUpDate": .string("2025-03-18"),
            "expectedDischargeDate": .string("2027-01-14"),
            "serviceCategory": .null,
            "workplaceType": .null,
            "defaultCommuteCost": .null,
            "defaultMealAllowanceOverride": .null,
            "timezone": .string("Asia/Seoul"),
        ])])
        issues += await model.editProfile(["priorServiceCredit": .string("NONE")])
        let records: [(String, String, JSONValue, JSONValue)] = [
            ("ANNUAL_LEAVE", "2026-03-06", .object(["kind": .string("ALL_DAY"), "dayCount": .number(1)]), .null),
            ("EDUCATION", "2026-03-11", .object(["kind": .string("ALL_DAY"), "dayCount": .number(1)]), .null),
            ("ANNUAL_LEAVE", "2026-03-14", .object(["kind": .string("ALL_DAY"), "dayCount": .number(1)]), .null),
            ("SICK_LEAVE", "2026-03-20", .object(["kind": .string("ALL_DAY"), "dayCount": .number(1)]), .string("ORDINARY")),
            ("EARLY_LEAVE", "2026-03-30", .object([
                "kind": .string("PARTIAL"), "durationMinutes": .number(120),
                "startTime": .null, "endTime": .null,
            ]), .null),
        ]
        for (type, date, timing, sickCategory) in records {
            var draft: [String: JSONValue] = [
                "eventType": .string(type),
                "startDate": .string(date),
                "endDate": .string(date),
                "timing": timing,
                "title": .null,
                "note": .null,
            ]
            if case .string = sickCategory { draft["sickLeaveCategory"] = sickCategory }
            issues += await model.run("createServiceEvent", [.object(draft)])
        }
        if !issues.isEmpty { AppLog.error("figma fixture: \(issues.map(\.code))") }
    }
}
#endif
